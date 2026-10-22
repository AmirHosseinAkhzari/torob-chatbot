"""Convert the raw Torob CSVs into neo4j-admin bulk-import CSVs.

Usage: python3 scripts/prepare_import.py <raw_dataset_dir> <output_dir>

Graph model
-----------
(:Shop)-[:HAS_OFFER]->(:Offer)-[:FOR_PRODUCT]->(:Product)
(:Product)-[:IN_CATEGORY]->(:Category)
(:Product)-[:MADE_BY]->(:Brand)
(:Shop)-[:SELLS_CATEGORY]->(:Category)
(:Shop)-[:LOCATED_IN]->(:Area)
(:Shop)-[:ACCEPTS_PAYMENT]->(:PaymentProvider)

Only the standard library is used, so it runs without a virtualenv.
"""
import csv
import json
import os
import sys
from collections import defaultdict

csv.field_size_limit(sys.maxsize)

ARRAY_DELIM = "|"
DAYS = [("sat", "شنبه"), ("sun", "یکشنبه"), ("mon", "دوشنبه"), ("tue", "سه‌شنبه"),
        ("wed", "چهارشنبه"), ("thu", "پنج‌شنبه"), ("fri", "جمعه")]


def clean(v):
    """Raw files use the literal string 'null' for missing values."""
    if v is None:
        return ""
    v = v.strip()
    return "" if v == "null" else v


def load_json(v, default):
    v = clean(v)
    if not v:
        return default
    try:
        return json.loads(v)
    except json.JSONDecodeError:
        return default


def arr(items):
    return ARRAY_DELIM.join(str(i).replace(ARRAY_DELIM, " ") for i in items if i not in (None, ""))


def key_id(prefix, name):
    return f"{prefix}:{name}"


def read(raw_dir, name):
    with open(os.path.join(raw_dir, f"{name}.csv"), encoding="utf-8", newline="") as f:
        yield from csv.DictReader(f)


class Writer:
    def __init__(self, out_dir):
        self.out_dir = out_dir
        self.files = {}

    def open(self, name, header):
        f = open(os.path.join(self.out_dir, f"{name}.csv"), "w", encoding="utf-8", newline="")
        w = csv.writer(f, quoting=csv.QUOTE_MINIMAL)
        w.writerow(header)
        self.files[name] = (f, w)
        return w

    def close(self):
        for f, _ in self.files.values():
            f.close()


def hours_text(weekly):
    parts = []
    for key, fa in DAYS:
        day = weekly.get(key)
        if not day:
            continue
        if day.get("status") == "closed":
            parts.append(f"{fa}: تعطیل")
            continue
        shifts = [f"{s['start_time'][:5]}-{s['end_time'][:5]}" for s in day.get("shifts", [])]
        parts.append(f"{fa}: {'، '.join(shifts) or day.get('status', '')}")
    return " | ".join(parts)


def warranty_text(w):
    bits = []
    if w.get("provider"):
        bits.append(w["provider"])
    if w.get("period_months"):
        bits.append(f"{w['period_months']} ماه")
    if w.get("description"):
        bits.append(w["description"])
    return " - ".join(bits)


def main(raw_dir, out_dir):
    os.makedirs(out_dir, exist_ok=True)
    wr = Writer(out_dir)

    categories, brands, areas, providers = set(), set(), set(), set()

    # --- Offers first, so product price aggregates are known when products are written.
    offer_w = wr.open("offers", [
        "offer_id:ID(Offer)", "price_toman:long", "seller_title", "description",
        "last_price_changed_at:datetime", "warranty", "warranty_provider",
        "warranty_months:int", "warranty_description", "has_price:boolean", ":LABEL"])
    shop_offer_w = wr.open("rel_shop_has_offer", [":START_ID(Shop)", ":END_ID(Offer)", ":TYPE"])
    offer_prod_w = wr.open("rel_offer_for_product", [":START_ID(Offer)", ":END_ID(Product)", ":TYPE"])

    agg = defaultdict(lambda: {"n": 0, "shops": set(), "min": None, "max": None})
    n_offers = 0
    for r in read(raw_dir, "offers"):
        price = clean(r["price_toman"])
        price = str(int(float(price))) if price else ""
        w = load_json(r["warranty"], {}) or {}
        pid, sid = r["product_id"], r["shop_id"]
        offer_w.writerow([
            r["offer_id"], price, clean(r["seller_title"]), clean(r["description"]),
            clean(r["last_price_changed_at"]), warranty_text(w), w.get("provider") or "",
            w.get("period_months") or "", w.get("description") or "",
            "true" if price else "false", "Offer"])
        shop_offer_w.writerow([sid, r["offer_id"], "HAS_OFFER"])
        offer_prod_w.writerow([r["offer_id"], pid, "FOR_PRODUCT"])
        a = agg[pid]
        a["n"] += 1
        a["shops"].add(sid)
        if price:
            p = int(price)
            a["min"] = p if a["min"] is None else min(a["min"], p)
            a["max"] = p if a["max"] is None else max(a["max"], p)
        n_offers += 1

    # --- Products
    prod_w = wr.open("products", [
        "product_id:ID(Product)", "title", "brand_name", "category_name", "model",
        "image_urls:string[]", "specs_json", "specs_text", "offer_count:int", "shop_count:int",
        "min_price_toman:long", "max_price_toman:long", ":LABEL"])
    prod_cat_w = wr.open("rel_product_in_category", [":START_ID(Product)", ":END_ID(Category)", ":TYPE"])
    prod_brand_w = wr.open("rel_product_made_by", [":START_ID(Product)", ":END_ID(Brand)", ":TYPE"])

    n_products = 0
    for r in read(raw_dir, "products"):
        pid = r["product_id"]
        brand, cat = clean(r["brand_name"]), clean(r["category_name"])
        specs = load_json(r["specs"], []) or []
        specs_text = "\n".join(
            f"{s.get('key', '')}: {s.get('value', '')}" for s in specs if s.get("key"))
        a = agg.get(pid, {"n": 0, "shops": (), "min": None, "max": None})
        prod_w.writerow([
            pid, clean(r["persian_title"]), brand, cat, clean(r["model"]),
            arr(load_json(r["image_urls"], []) or []),
            json.dumps(specs, ensure_ascii=False) if specs else "", specs_text,
            a["n"], len(a["shops"]),
            "" if a["min"] is None else a["min"], "" if a["max"] is None else a["max"], "Product"])
        if cat:
            categories.add(cat)
            prod_cat_w.writerow([pid, key_id("cat", cat), "IN_CATEGORY"])
        if brand:
            brands.add(brand)
            prod_brand_w.writerow([pid, key_id("brand", brand), "MADE_BY"])
        n_products += 1

    # --- Shops
    shop_w = wr.open("shops", [
        "shop_id:ID(Shop)", "name", "address", "area", "location:point{crs:WGS-84}",
        "phones:string[]", "website_url", "instagram_handle", "instagram_url",
        "supports_fast_delivery:boolean", "payment_providers:string[]",
        "weekly_hours_json", "weekly_hours_text", "category_count:int", ":LABEL"])
    shop_cat_w = wr.open("rel_shop_sells_category", [":START_ID(Shop)", ":END_ID(Category)", ":TYPE"])
    shop_area_w = wr.open("rel_shop_located_in", [":START_ID(Shop)", ":END_ID(Area)", ":TYPE"])
    shop_pay_w = wr.open("rel_shop_accepts_payment", [":START_ID(Shop)", ":END_ID(PaymentProvider)", ":TYPE"])

    n_shops = 0
    for r in read(raw_dir, "shops"):
        sid = r["shop_id"]
        area = clean(r["location_label"])
        lat, lon = clean(r["lat"]), clean(r["lon"])
        point = f"{{latitude:{lat}, longitude:{lon}}}" if lat and lon else ""
        contacts = load_json(r["contacts"], []) or []
        phones = [c.get("display_number") for c in contacts if c.get("display_number")]
        insta = load_json(r["instagram"], {}) or {}
        pays = sorted({p.get("provider_name") for p in (load_json(r["payment_options"], []) or [])
                       if p.get("provider_name")})
        weekly = load_json(r["weekly_hours"], {}) or {}
        cats = sorted(set(load_json(r["category_names"], []) or []))
        shop_w.writerow([
            sid, clean(r["name"]), clean(r["address"]), area, point, arr(phones),
            clean(r["website_url"]), insta.get("handle") or "", insta.get("profile_url") or "",
            clean(r["supports_fast_delivery"]), arr(pays),
            json.dumps(weekly, ensure_ascii=False) if weekly else "", hours_text(weekly),
            len(cats), "Shop"])
        for c in cats:
            categories.add(c)
            shop_cat_w.writerow([sid, key_id("cat", c), "SELLS_CATEGORY"])
        if area:
            areas.add(area)
            shop_area_w.writerow([sid, key_id("area", area), "LOCATED_IN"])
        for p in pays:
            providers.add(p)
            shop_pay_w.writerow([sid, key_id("pay", p), "ACCEPTS_PAYMENT"])
        n_shops += 1

    # --- Lookup nodes
    for name, prefix, label, idspace, values in [
        ("categories", "cat", "Category", "Category", categories),
        ("brands", "brand", "Brand", "Brand", brands),
        ("areas", "area", "Area", "Area", areas),
        ("payment_providers", "pay", "PaymentProvider", "PaymentProvider", providers),
    ]:
        w = wr.open(name, [f"key:ID({idspace})", "name", ":LABEL"])
        for v in sorted(values):
            w.writerow([key_id(prefix, v), v, label])

    wr.close()
    print(f"offers={n_offers} products={n_products} shops={n_shops} categories={len(categories)} "
          f"brands={len(brands)} areas={len(areas)} payment_providers={len(providers)}")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    main(sys.argv[1], sys.argv[2])
