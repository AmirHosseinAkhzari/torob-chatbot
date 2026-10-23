"""Read-only queries over the Torob knowledge graph, shaped for the API and the agent."""
import json
import math
import re
from collections import Counter
from functools import lru_cache

from . import db, hours, pricing
from .text import CITIES, fulltext_query, is_lookalike, is_stock, normalize, tokens

# Spec keys worth showing first, by category; anything else falls back to the product's own order.
SPEC_PRIORITY = {
    "گوشی موبایل": ["تراشه", "پردازنده", "حافظه داخلی", "حافظه RAM", "مقدار RAM", "ظرفیت باتری", "اندازه صفحه نمایش", "دوربین", "رنگ"],
}
SPEC_SKIP = {"برند", "مدل", "اصالت کالا", "نوع محصول", "دسته بندی کالا", "توضیحات سیستم‌عامل"}


# Titles that start with these are parts or accessories for another product.
ACCESSORY_WORDS = {"قاب", "کاور", "گلس", "محافظ", "فلت", "برد", "باتری", "شارژر", "هولدر", "پایه", "قلم",
                   "بند", "تاچ", "ال", "السیدی", "LCD", "درب", "اسپیکر", "سوکت", "کیف", "لنز", "آداپتور", "کابل"}


ACCESSORY_ANYWHERE = ("تاچ", "ال سی دی", "السیدی", "گلس", "قاب ", "کاور", "گارد", "فلت ", "محافظ صفحه")


def _is_accessory(title: str) -> bool:
    words = tokens(title)
    if not words:
        return False
    if words[0] in ACCESSORY_WORDS or words[0] == "گارد":
        return True
    if any(k in normalize(title) + " " for k in ACCESSORY_ANYWHERE):
        return True
    return len(words) > 1 and words[0] == "دوربین" and words[1] == "گوشی"


def _clean_spec_value(v: str) -> str:
    """Source lists end every item with ", ," ("بازی, ,, موسیقی, ,"): turn them into "بازی، موسیقی"."""
    if not re.search(r",\s*,", v):
        return v
    parts = [x.strip(" ,") for x in re.split(r",\s*,", v)]
    return "، ".join(x for x in parts if x)


def parse_specs(raw: str | None) -> list[dict]:
    if not raw:
        return []
    try:
        data = json.loads(raw)
    except (TypeError, ValueError):
        return []
    out = []
    for item in data if isinstance(data, list) else []:
        key, value = (item.get("key") or "").strip(), _clean_spec_value((item.get("value") or "").strip())
        if key and value:
            out.append({"section": item.get("section") or "", "key": key, "value": value})
    return out


def key_specs(specs: list[dict], category: str | None, n: int = 3) -> list[dict]:
    by_key = {s["key"]: s for s in specs}
    picked = [by_key[k] for k in SPEC_PRIORITY.get(category or "", []) if k in by_key]
    for s in specs:
        if len(picked) >= n:
            break
        if s not in picked and s["key"] not in SPEC_SKIP and len(s["value"]) <= 40:
            picked.append(s)
    return [{"key": s["key"], "value": s["value"]} for s in picked[:n]]


def _card(row: dict, n_specs: int = 3) -> dict:
    specs = parse_specs(row.get("specs_json"))
    summary = pricing.summarize(row.get("prices") or [])
    title = row.get("title") or ""
    images = [u for u in (row.get("images") or []) if u]
    return {
        "id": row["id"],
        "title": title,
        "category": row.get("category"),
        "brand": row.get("brand"),
        "image": images[0] if images else None,
        "images": images[:6],
        "shop_count": row.get("shop_count") or 0,
        "price": summary,
        "specs": key_specs(specs, row.get("category"), n_specs),
        "stock": is_stock(title),
        "lookalike": is_lookalike(title),
    }


_CARD_RETURN = """
OPTIONAL MATCH (p)<-[:FOR_PRODUCT]-(o:Offer)
WITH p, score, collect(o.price_toman) AS prices
RETURN p.product_id AS id, p.title AS title, p.category_name AS category, p.brand_name AS brand,
       p.image_urls AS images, p.shop_count AS shop_count, p.specs_json AS specs_json, prices, score
"""


# Installment (BNPL) providers Torob works with, and the terms Torob shows on product pages.
PROVIDERS = {
    "ترب‌پی": {"terms": "پرداخت قسطی بخشی از مبلغ در ۴ قسط", "parts": 4},
    "اسنپ‌پی": {"terms": "الان بخر، بعدا پرداخت کن: ۴ قسط", "parts": 4},
    "دیجی پی": {"terms": "۱۲ قسط تا سقف ۱۰۰ میلیون با سود سالانه ۲۳٪", "loan": (12, 0.23, 100_000_000)},
    "تارا": {"terms": "پرداخت قسطی بخشی از مبلغ در ۲ قسط", "parts": 2},
    "ازکی‌وام": {"terms": "تا ۱۰۰ میلیون، ۱۸ قسط با سود سالانه ۲۲٪ (فقط آنلاین)", "loan": (18, 0.22, 100_000_000)},
}
_PROVIDER_KEYS = {normalize(k).replace(" ", ""): k for k in PROVIDERS} | {
    "تربپی": "ترب‌پی", "torobpay": "ترب‌پی", "اسنپپی": "اسنپ‌پی", "snapppay": "اسنپ‌پی", "اسنپپ": "اسنپ‌پی",
    "دیجیپی": "دیجی پی", "digipay": "دیجی پی", "تارا": "تارا", "tara": "تارا",
    "ازکیوام": "ازکی‌وام", "ازکی": "ازکی‌وام", "azki": "ازکی‌وام", "azkivam": "ازکی‌وام",
}


def canonical_provider(name: str | None) -> str | None:
    if not name:
        return None
    if name == "any":
        return "any"
    key = normalize(name).replace(" ", "").lower()
    return _PROVIDER_KEYS.get(key)


def _pay_filter() -> str:
    return (" AND ($pay IS NULL OR EXISTS { MATCH (p)<-[:FOR_PRODUCT]-(:Offer)<-[:HAS_OFFER]-(:Shop)"
            "-[:ACCEPTS_PAYMENT]->(pp:PaymentProvider) WHERE ($pay = 'any' AND pp.name IN $known) OR pp.name = $pay }) ")


def search_products(query: str, category: str | None = None, min_price: int | None = None,
                    max_price: int | None = None, limit: int = 8, prefix: bool = False,
                    payment: str | None = None, location: dict | None = None) -> list[dict]:
    pay = canonical_provider(payment)
    cards = _search(query, category, min_price, max_price, limit * 2 if pay else limit, prefix, pay)
    if not pay:
        return cards
    cards = apply_bnpl(cards, pay, location)
    if max_price:
        cards = [c for c in cards if c["price"]["min"] is None or c["price"]["min"] <= max_price]
    return cards[:limit]


def _search(query: str, category: str | None, min_price, max_price, limit: int, prefix: bool, pay: str | None) -> list[dict]:
    q = fulltext_query(query, prefix_last=prefix)
    if not q:
        return []
    rows: list[dict] = []
    if category:
        rows = _search_in_category(query, category, min_price, max_price, pay)
        if rows:
            return _rank(rows, query, min_price, max_price, limit)
    # Broad words like «گوشی» match thousands of titles: with a price or category filter, look wider before filtering.
    pool = 400 if (min_price or max_price or category) else 80
    lo_db = int(min_price * 0.8) if min_price else None
    hi_db = int(max_price * 1.2) if max_price else None
    if pay:
        pool = max(pool, 400)
    cypher = (
        "CALL db.index.fulltext.queryNodes('product_title', $q, {limit: $pool}) YIELD node AS p, score "
        "WHERE ($category IS NULL OR p.category_name CONTAINS $category) "
        "AND ($hi IS NULL OR p.min_price_toman <= $hi) AND ($lo IS NULL OR p.max_price_toman >= $lo) "
        + _pay_filter() +
        "WITH p, score ORDER BY score DESC LIMIT 120" + _CARD_RETURN + " ORDER BY score DESC"
    )
    params = dict(category=category or None, pool=pool, lo=lo_db, hi=hi_db, pay=pay, known=list(PROVIDERS))
    rows = db.read(cypher, q=q, **params)
    if not rows and not prefix:
        # Relax: any word may match (OR) on titles.
        loose = " ".join(t.lstrip("+") for t in q.split(" "))
        rows = db.read(cypher, q=loose, **params)
    return _rank(rows, query, min_price, max_price, limit)


# Words that name the product type; inside a category they add nothing to the match.
GENERIC_WORDS = {"گوشی", "موبایل", "تلفن", "همراه", "خوب", "ارزان", "ارزون", "ارزون‌ترین", "ارزان‌ترین", "بهترین", "مدل", "جدید"}


def _search_in_category(query: str, category: str, min_price, max_price, pay: str | None = None) -> list[dict]:
    from .text import SYNONYMS, to_fa_digits, to_latin_digits
    groups = []
    for w in tokens(query):
        if w in GENERIC_WORDS or w in category:
            continue
        latin = to_latin_digits(w)
        forms = {latin.lower(), to_fa_digits(latin).lower()} | {s.lower() for s in SYNONYMS.get(w, [])}
        groups.append(sorted(forms))
    lo = int(min_price * 0.8) if min_price else None
    hi = int(max_price * 1.2) if max_price else None
    base = (
        "MATCH (p:Product) WHERE __CAT__ "
        "AND ($hi IS NULL OR p.min_price_toman <= $hi) AND ($lo IS NULL OR p.max_price_toman >= $lo) "
        "AND all(forms IN $groups WHERE any(f IN forms WHERE toLower(p.title) CONTAINS f)) "
        + _pay_filter() +
        "WITH p, 1.0 AS score ORDER BY p.shop_count DESC LIMIT 150" + _CARD_RETURN
    )
    params = dict(category=category, lo=lo, hi=hi, groups=groups, pay=pay, known=list(PROVIDERS))
    rows = db.read(base.replace("__CAT__", "p.category_name = $category"), **params)
    if not rows:
        rows = db.read(base.replace("__CAT__", "p.category_name CONTAINS $category"), **params)
    return rows


@lru_cache(maxsize=1)
def provider_stats() -> dict[str, dict]:
    rows = db.read(
        "MATCH (pp:PaymentProvider)<-[:ACCEPTS_PAYMENT]-(s:Shop) WHERE pp.name IN $known "
        "RETURN pp.name AS name, count(DISTINCT s) AS shops", known=list(PROVIDERS),
    )
    return {r["name"]: {"shops": r["shops"]} for r in rows}


def _plan(provider: str, price: int | None) -> list[dict] | None:
    info = PROVIDERS[provider]
    if not price:
        return None
    from .text import to_fa_digits
    if "parts" in info:
        n = info["parts"]
        part = price / n
        later = "یک ماه بعد" if n == 2 else to_fa_digits(f"{n - 1} قسط بعدی، هرکدوم")
        return [{"label": "امروز", "value": round(part)}, {"label": later, "value": round(part)}]
    months, rate, cap = info["loan"]
    principal = min(price, cap)
    r = rate / 12
    monthly = principal * r / (1 - (1 + r) ** -months)
    rows = [{"label": to_fa_digits(f"{months} قسط ماهانه"), "value": round(monthly)}, {"label": "جمع بازپرداخت", "value": round(monthly * months)}]
    if price > cap:
        rows.insert(0, {"label": "پیش‌پرداخت (بالای سقف وام)", "value": round(price - cap)})
    return rows


def payment_options(providers: list[str] | None = None) -> dict:
    """The installment providers shops on Torob accept, with Torob's terms and how many shops take each."""
    wanted = [p for p in (canonical_provider(x) for x in providers or []) if p and p != "any"] or list(PROVIDERS)
    stats = provider_stats()
    return {"product": None, "providers": [{
        "name": name, "terms": PROVIDERS[name]["terms"], "shops": stats.get(name, {}).get("shops", 0),
        "online_only": name == "ازکی‌وام", "plan": None, "plan_price": None, "sellers": [], "seller_count": 0,
    } for name in wanted]}


def accepted_providers(payments: list[str], pay: str) -> list[str]:
    """The installment providers in a shop's list that match the filter ('any' = any of the five)."""
    known = [x for x in payments if x in PROVIDERS]
    return known if pay == "any" else [x for x in known if x == pay]


def _user_point(location: dict | None) -> tuple[float, float] | None:
    if not location:
        return None
    if location.get("lat") is not None and location.get("lng") is not None:
        return float(location["lat"]), float(location["lng"])
    for a in areas():
        if a["name"] == location.get("area"):
            return a["lat"], a["lng"]
    return None


def bnpl_for(product_ids: list[str], pay: str | None, location: dict | None = None) -> dict[str, dict]:
    """Per product, only the sellers that accept the installment filter: their price range, the plan for the
    main provider, and the sellers ordered nearest-first (or cheapest-first without a location)."""
    pay = canonical_provider(pay) or "any"
    if not product_ids:
        return {}
    rows = db.read(
        f"""
        MATCH (p:Product)<-[:FOR_PRODUCT]-(o:Offer)<-[:HAS_OFFER]-(s:Shop)
        WHERE p.product_id IN $ids
          AND any(x IN coalesce(s.payment_providers, []) WHERE x IN $known AND ($pay = 'any' OR x = $pay))
        RETURN p.product_id AS pid, {_OFFER_FIELDS} AS offer, {_SHOP_FIELDS} AS shop
        """,
        ids=product_ids, pay=pay, known=list(PROVIDERS),
    )
    grouped: dict[str, list[dict]] = {}
    for r in rows:
        grouped.setdefault(r["pid"], []).append(r)
    point = _user_point(location)
    out: dict[str, dict] = {}
    for pid in product_ids:
        raw = grouped.get(pid, [])
        summary = pricing.summarize([r["offer"].get("price_toman") for r in raw])
        offers = [_offer(r["offer"], r["shop"], summary["median"]) for r in raw]
        sellers = []
        for o in offers:
            sh = o["shop"]
            dist = None
            if point and sh["lat"] is not None and sh["lng"] is not None:
                dist = round(_haversine_m(point[0], point[1], sh["lat"], sh["lng"]))
            sellers.append({
                "offer_id": o["offer_id"], "shop_id": sh["id"], "shop": sh["name"], "area": sh["area"], "address": sh["address"],
                "phone": sh["phones"][0] if sh["phones"] else None, "price": None if o["outlier"] else o["price"],
                "open_now": sh["hours"]["open_now"], "today": sh["hours"]["today"],
                "lat": sh["lat"], "lng": sh["lng"], "distance_m": dist,
                "providers": accepted_providers(sh["payments"], pay),
            })
        if point:
            sellers.sort(key=lambda x: (x["distance_m"] is None, x["distance_m"] or 0))
        else:
            sellers.sort(key=lambda x: (x["price"] is None, x["price"] or 0))
        counts = Counter(name for x in sellers for name in x["providers"])
        available = [name for name in PROVIDERS if counts.get(name)]
        if pay != "any":
            main = pay
        else:
            order = list(PROVIDERS)
            main = "اسنپ‌پی" if counts.get("اسنپ‌پی") else (max(available, key=lambda n: (counts[n], -order.index(n))) if available else None)
        main_prices = [x["price"] for x in sellers if main in x["providers"] and x["price"]]
        base = min(main_prices) if main_prices else None
        out[pid] = {
            "filter": pay,
            "provider": main,
            "terms": PROVIDERS[main]["terms"] if main else None,
            "providers": available,
            "price": base,
            "plan": _plan(main, base) if main else None,
            "seller_count": len(sellers),
            "sellers": sellers[:12],
            "located": bool(point),
            "summary": summary,
        }
    return out


def mark_single_seller(cards: list[dict]) -> list[dict]:
    """When exactly one shop sells the product under the user's filter (the installment filter when set),
    add single_seller = {shop_id, offer_id, in_person, shop, area, price, open_now, today, distance_m}: the app
    then offers «خرید از …» straight to that shop instead of a sellers list."""
    plain = [c["id"] for c in cards if not c.get("bnpl") and c.get("shop_count") == 1]
    found: dict[str, dict] = {}
    if plain:
        rows = db.read(
            """
            MATCH (p:Product)<-[:FOR_PRODUCT]-(o:Offer)<-[:HAS_OFFER]-(s:Shop) WHERE p.product_id IN $ids
            WITH p, collect({shop_id: s.shop_id, offer_id: o.offer_id, in_person: s.location IS NOT NULL,
                             shop: s.name, area: s.area, hours: s.weekly_hours_json, price: o.price_toman}) AS shops
            WHERE size(shops) = 1
            RETURN p.product_id AS pid, shops[0] AS shop
            """,
            ids=plain,
        )
        for r in rows:
            sh = dict(r["shop"])
            h = hours.parse(sh.pop("hours"))
            price = sh["price"]
            sh["price"] = int(price) if price and price >= pricing.MIN_VALID_PRICE else None
            sh.update(open_now=h["open_now"], today=h["today"], distance_m=None)
            found[r["pid"]] = sh
    for c in cards:
        b = c.get("bnpl")
        if b:
            one = b["seller_count"] == 1 and b["sellers"]
            if one:
                x = b["sellers"][0]
                c["single_seller"] = {"shop_id": x["shop_id"], "offer_id": x["offer_id"], "in_person": x["lat"] is not None,
                                      "shop": x["shop"], "area": x["area"], "price": x["price"], "open_now": x["open_now"],
                                      "today": x["today"], "distance_m": x["distance_m"]}
            else:
                c["single_seller"] = None
        else:
            c["single_seller"] = found.get(c["id"])
    return cards


def apply_bnpl(cards: list[dict], pay: str | None, location: dict | None = None) -> list[dict]:
    """Restrict cards to installment sellers: price range and shop count cover only shops that accept it."""
    data = bnpl_for([c["id"] for c in cards], pay, location)
    for c in cards:
        b = data.get(c["id"])
        if not b:
            continue
        summary = b.pop("summary")
        if b["seller_count"]:
            c["price"] = summary
            c["shop_count"] = b["seller_count"]
        c["bnpl"] = b
    return cards


def _rank(rows: list[dict], query: str, min_price, max_price, limit: int) -> list[dict]:
    wants_stock = "استوک" in query or "کارکرده" in query
    qwords = tokens(query)
    wants_accessory = bool(qwords) and (_is_accessory(" ".join(qwords)) or any(w in ACCESSORY_WORDS for w in qwords))
    cards = []
    for r in rows:
        c = _card(r)
        lo = c["price"]["min"]
        if min_price and (lo is None or lo < min_price):
            continue
        if max_price and (lo is None or lo > max_price):
            continue
        c["_score"] = r["score"]
        c["_accessory"] = _is_accessory(c["title"]) and not wants_accessory
        c["_first"] = bool(qwords) and normalize(c["title"]).startswith(qwords[0])
        cards.append(c)
    cards.sort(key=lambda c: (
        (c["stock"] and not wants_stock) or c["lookalike"],
        c["_accessory"],
        c["price"]["min"] is None,
        -c["_score"] - 0.5 * math.log1p(c["shop_count"]) - (0.5 if c["_first"] else 0),
    ))
    for c in cards:
        c.pop("_accessory", None)
        c.pop("_first", None)
    for c in cards:
        c.pop("_score", None)
    return cards[:limit]


def products_by_ids(ids: list[str], n_specs: int = 3) -> list[dict]:
    if not ids:
        return []
    rows = db.read(
        "MATCH (p:Product) WHERE p.product_id IN $ids WITH p, 1.0 AS score" + _CARD_RETURN,
        ids=ids,
    )
    by_id = {r["id"]: _card(r, n_specs) for r in rows}
    return [by_id[i] for i in ids if i in by_id]


def _offer(o: dict, s: dict, med: int | None) -> dict:
    price = o.get("price_toman")
    placeholder = price is None or price < pricing.MIN_VALID_PRICE
    phones = [p for p in (s.get("phones") or []) if p]
    return {
        "offer_id": o.get("offer_id"),
        "price": None if placeholder else int(price),
        "price_note": "تماس بگیرید" if placeholder else None,
        "outlier": pricing.is_outlier(None if placeholder else price, med),
        "updated_days": pricing.days_since(o.get("last_price_changed_at")),
        "warranty": o.get("warranty") or None,
        "warranty_months": o.get("warranty_months"),
        "warranty_provider": o.get("warranty_provider") or None,
        "seller_title": o.get("seller_title") or None,
        "description": (o.get("description") or "")[:280] or None,
        # Set by a store inquiry (استعلام دستگاه): the shop answered by phone.
        "stock": {"status": o["stock_status"], "checked_at": o.get("stock_checked_at"),
                  "price_status": o.get("price_status"), "verified_price": o.get("verified_price_toman")} if o.get("stock_status") else None,
        "shop": {
            "id": s.get("shop_id"),
            "name": s.get("name"),
            "area": s.get("area"),
            "address": s.get("address"),
            "phones": phones,
            "website": s.get("website_url") or None,
            "instagram": (s.get("instagram_handle") or "").lstrip("@") or None,
            "fast_delivery": bool(s.get("supports_fast_delivery")),
            "payments": [p for p in (s.get("payment_providers") or []) if p][:4],
            "hours": hours.parse(s.get("weekly_hours_json")),
            "lat": s.get("lat"),
            "lng": s.get("lng"),
        },
    }


_OFFER_FIELDS = "o {.offer_id, .price_toman, .last_price_changed_at, .warranty, .warranty_months, .warranty_provider, .seller_title, .description, .stock_status, .price_status, .verified_price_toman, stock_checked_at: toString(o.stock_checked_at)}"
_SHOP_FIELDS = ("s {.shop_id, .name, .area, .address, .phones, .website_url, .instagram_handle, .supports_fast_delivery, "
                ".payment_providers, .weekly_hours_json, lat: s.location.latitude, lng: s.location.longitude}")


def get_product(product_id: str) -> dict | None:
    rows = db.read(
        f"""
        MATCH (p:Product {{product_id: $id}})
        OPTIONAL MATCH (p)<-[:FOR_PRODUCT]-(o:Offer)<-[:HAS_OFFER]-(s:Shop)
        RETURN p.product_id AS id, p.title AS title, p.category_name AS category, p.brand_name AS brand,
               p.image_urls AS images, p.shop_count AS shop_count, p.specs_json AS specs_json,
               collect(CASE WHEN o IS NULL THEN NULL ELSE {{offer: {_OFFER_FIELDS}, shop: {_SHOP_FIELDS}}} END) AS offers
        """,
        id=product_id,
    )
    if not rows:
        return None
    r = rows[0]
    raw = [x for x in r["offers"] if x]
    r["prices"] = [x["offer"].get("price_toman") for x in raw]
    card = _card(r, 4)
    med = card["price"]["median"]
    offers = [_offer(x["offer"], x["shop"], med) for x in raw]
    offers.sort(key=lambda x: (x["price"] is None, x["outlier"], x["price"] or 0))
    card["specs_all"] = parse_specs(r.get("specs_json"))[:40]
    card["offers"] = offers
    card["fast_delivery_count"] = sum(1 for o in offers if o["shop"]["fast_delivery"])
    card["warranty_count"] = sum(1 for o in offers if o["warranty"] and o["warranty"] != "بدون گارانتی")
    return card


def _haversine_m(lat1, lng1, lat2, lng2) -> float:
    rad = math.radians
    dlat, dlng = rad(lat2 - lat1), rad(lng2 - lng1)
    a = math.sin(dlat / 2) ** 2 + math.cos(rad(lat1)) * math.cos(rad(lat2)) * math.sin(dlng / 2) ** 2
    return 6_371_000 * 2 * math.asin(math.sqrt(a))


# "Pick the store for me": a shop qualifies when it is near and its price is close to the cheapest on Torob.
PICK_MAX_DISTANCE_M = 4000
PICK_MAX_PRICE_GAP = 0.07


def pick_store(stores: list[dict], cheapest: int | None, area: str | None) -> dict | None:
    """The one in-person shop to recommend, or None when no shop is both near and well priced.
    Score: price gap (%) + distance (km) + penalties for closed now, no warranty and an old price."""
    if not cheapest:
        return None
    best = None
    for st in stores:
        price, dist = st["price"], st.get("distance_m")
        if price is None or st["outlier"]:
            continue
        gap = (price - cheapest) / cheapest
        if gap > PICK_MAX_PRICE_GAP:
            continue
        if dist is not None:
            if dist > PICK_MAX_DISTANCE_M:
                continue
        elif not (area and st["shop"]["area"] == area):
            continue  # no way to tell it is near
        open_now = st["shop"]["hours"]["open_now"]
        warranty = bool(st["warranty"]) and st["warranty"] != "بدون گارانتی"
        stale = (st["updated_days"] or 0) > 30
        score = max(gap, 0) * 100 + (dist if dist is not None else 1500) / 1000 * 1.5 \
            + (4 if open_now is False else 0) + (0 if warranty else 0.5) + (0.5 if stale else 0)
        if best is None or score < best[0]:
            best = (score, st, gap, warranty)
    if best is None:
        return None
    _, st, gap, warranty = best
    return {
        "offer_id": st["offer_id"],
        "price_gap": max(0, st["price"] - cheapest),
        "price_gap_pct": round(max(gap, 0) * 100, 1),
        "cheapest_overall": st["price"] <= cheapest,
        "distance_m": st.get("distance_m"),
        "in_area": bool(area and st["shop"]["area"] == area),
        "open_now": st["shop"]["hours"]["open_now"],
        "warranty": st["warranty"] if warranty else None,
        "updated_days": st["updated_days"],
    }


def stores_for_product(product_id: str, lat: float | None = None, lng: float | None = None,
                       area: str | None = None, pay: str | None = None, shop: str | None = None) -> dict | None:
    """shop: always include this shop in the list (the store-inquiry SMS links to it)."""
    product = get_product(product_id)
    if product is None:
        return None
    pay = canonical_provider(pay)
    candidates = [o for o in product["offers"]
                  if o["shop"]["lat"] is not None and o["shop"]["lng"] is not None
                  and (not pay or accepted_providers(o["shop"]["payments"], pay))]
    everywhere = candidates  # the recommendation looks across Tehran, the list only near the user
    gps = (lat, lng) if lat is not None and lng is not None else None
    area_fallback = False
    if area:
        in_area = [o for o in candidates if o["shop"]["area"] == area]
        if not in_area and candidates:
            # Nothing in that neighborhood: show the shops nearest to it instead of an empty map.
            point = _user_point({"area": area})
            if point:
                lat, lng = point
                area_fallback = True
        else:
            candidates = in_area
    stores = []
    for o in candidates:
        s = o["shop"]
        item = dict(o)
        item["distance_m"] = round(_haversine_m(lat, lng, s["lat"], s["lng"])) if lat is not None and lng is not None else None
        stores.append(item)
    if lat is not None and lng is not None:
        stores.sort(key=lambda x: (x["distance_m"], x["price"] is None))
    else:
        stores.sort(key=lambda x: (x["price"] is None, x["outlier"], x["price"] or 0))
    center = {"lat": lat, "lng": lng} if lat is not None and not area_fallback else None
    if center is None and stores:
        center = {"lat": sum(x["shop"]["lat"] for x in stores) / len(stores),
                  "lng": sum(x["shop"]["lng"] for x in stores) / len(stores)}
    online_min = product["price"]["min"]
    shown = stores[:30]
    if shop and not any(x["shop"]["id"] == shop for x in shown):
        shown += [x for x in stores[30:] if x["shop"]["id"] == shop][:1]
    stores = shown
    rec = recommend(everywhere, gps, area)
    left = left_out(everywhere, rec, gps, area)
    if rec:
        # The recommended shops may sit outside the listed ones (e.g. cheapest in Tehran): add them.
        listed = {x["offer_id"] for x in stores}
        for opt in rec["options"]:
            if opt["offer_id"] not in listed:
                stores.append(opt.pop("_store"))
            opt.pop("_store", None)
    return {
        "product": {k: product[k] for k in ("id", "title", "image", "price", "shop_count")},
        "online_min": online_min,
        "center": center,
        "stores": stores,
        "area": area,
        "area_fallback": area_fallback,
        "pick": pick_store(stores, online_min, None if area_fallback else area),
        "recommendation": rec,
        # Not for the client: why each other shop was not recommended (saved by insights, then dropped).
        "_left_out": left,
    }


# Recommendation: nearest store, cheapest store nearby, cheapest in Tehran — from reliable offers only.
NEARBY_M = 3000          # "nearby" = within 3 km, or in the user's neighborhood
FRESH_DAYS = 90          # older prices are not trusted for a recommendation
NEAREST_WINS_GAP = 0.05  # the nearest shop stays first unless a nearby one is more than 5% cheaper
AREA_NAME_M = 2500       # name the user's neighborhood from GPS when its center is this close


def reliable(st: dict) -> bool:
    """A price we can recommend: listed, not a suspicious outlier, recent, and not denied by phone."""
    return (st["price"] is not None and not st["outlier"]
            and st["updated_days"] is not None and st["updated_days"] <= FRESH_DAYS
            and (st.get("stock") or {}).get("status") != "unavailable")


def _neighborhood(lat: float, lng: float) -> str | None:
    best = min(areas(), key=lambda a: _haversine_m(lat, lng, a["lat"], a["lng"]), default=None)
    return best["name"] if best and _haversine_m(lat, lng, best["lat"], best["lng"]) <= AREA_NAME_M else None


def recommend(offers: list[dict], gps: tuple[float, float] | None, area: str | None) -> dict | None:
    """{primary, options: [{offer_id, roles}], neighborhood, ...} or None when no offer is reliable.
    roles: nearest, cheapest_nearby, cheapest_city. Distances are real only with GPS; with a
    neighborhood, "near" means in that neighborhood (its center ranks the rest)."""
    point = gps or (_user_point({"area": area}) if area else None)
    neighborhood = area or (_neighborhood(*gps) if gps else None)
    ok = []
    for o in offers:
        if not reliable(o):
            continue
        st = dict(o)
        st["_d"] = _haversine_m(point[0], point[1], o["shop"]["lat"], o["shop"]["lng"]) if point else None
        st["distance_m"] = round(st["_d"]) if gps else None
        ok.append(st)
    if not ok:
        return None

    verified = lambda x: (x.get("stock") or {}).get("status") == "available"  # noqa: E731
    by_price = lambda x: (x["price"], not verified(x), x["_d"] or 0)  # noqa: E731
    cheapest_city = min(ok, key=by_price)
    nearest = cheapest_nearby = None
    if point:
        not_closed = [x for x in ok if x["shop"]["hours"]["open_now"] is not False] or ok
        nearest = min(not_closed, key=lambda x: (x["_d"], x["price"]))
        nearby = [x for x in ok if x["_d"] <= NEARBY_M or (neighborhood and x["shop"]["area"] == neighborhood)]
        cheapest_nearby = min(nearby, key=by_price) if nearby else None

    def gap(a, b):  # how much more a costs than b, as a fraction of b
        return (a["price"] - b["price"]) / b["price"]

    if not point:
        primary = cheapest_city
    elif cheapest_nearby is None:
        # Nothing near: the nearest only if it is about as cheap as the best price in Tehran.
        primary = nearest if gap(nearest, cheapest_city) <= NEAREST_WINS_GAP else cheapest_city
    elif nearest["offer_id"] == cheapest_nearby["offer_id"] or gap(nearest, cheapest_nearby) <= NEAREST_WINS_GAP:
        primary = nearest
    else:
        primary = cheapest_nearby

    roles: dict[str, list[str]] = {}
    order: list[dict] = []

    def add(st, role):
        if st is None:
            return
        if st["offer_id"] not in roles:
            roles[st["offer_id"]] = []
            order.append(st)
        roles[st["offer_id"]].append(role)

    add(primary, "primary")
    add(nearest, "nearest")
    add(cheapest_nearby, "cheapest_nearby")
    # Tehran-wide only when it beats what is near the user.
    best_near = cheapest_nearby or (nearest if point else None)
    if best_near is None or cheapest_city["price"] < best_near["price"]:
        add(cheapest_city, "cheapest_city")
    if point and cheapest_nearby and cheapest_nearby["offer_id"] == cheapest_city["offer_id"]:
        roles[cheapest_city["offer_id"]].append("cheapest_city")

    options = []
    for st in order:
        r = [x for x in roles[st["offer_id"]] if x != "primary"]
        options.append({
            "offer_id": st["offer_id"],
            "roles": r,
            "primary": st["offer_id"] == primary["offer_id"],
            "price": st["price"],
            "distance_m": st["distance_m"],
            "verified": verified(st),
            "_store": {k: v for k, v in st.items() if k != "_d"},
        })
    return {
        "primary": primary["offer_id"],
        "options": options,
        "located": bool(point),
        "gps": bool(gps),
        "neighborhood": neighborhood,
        "city": "تهران",
        "nearby_m": NEARBY_M,
        "fresh_days": FRESH_DAYS,
        "unreliable": sum(1 for o in offers if not reliable(o)),
    }


@lru_cache(maxsize=1)
def areas() -> list[dict]:
    rows = db.read(
        "MATCH (a:Area)<-[:LOCATED_IN]-(s:Shop) "
        "RETURN a.name AS name, count(s) AS shops, avg(s.location.latitude) AS lat, avg(s.location.longitude) AS lng "
        "ORDER BY shops DESC"
    )
    return rows


def left_out(offers: list[dict], rec: dict | None, gps: tuple[float, float] | None, area: str | None) -> list[dict]:
    """Every shop that sells the product but was not recommended, with why (for store insights)."""
    picked = {o["offer_id"] for o in (rec or {}).get("options", [])}
    point = gps or (_user_point({"area": area}) if area else None)
    dist = lambda o: _haversine_m(point[0], point[1], o["shop"]["lat"], o["shop"]["lng"]) if point else None  # noqa: E731
    good = [o for o in offers if reliable(o)]
    cheapest = min((o["price"] for o in good), default=None)
    nearest = min((dist(o) for o in good), default=None) if point else None
    out = []
    for o in offers:
        if o["offer_id"] in picked:
            continue
        d = dist(o)
        reasons: list[str] = []
        if o["price"] is None:
            reasons.append("no_price")
        elif o["outlier"]:
            reasons.append("outlier_price")
        if o["updated_days"] is not None and o["updated_days"] > FRESH_DAYS:
            reasons.append("stale_price")
        if (o.get("stock") or {}).get("status") == "unavailable":
            reasons.append("said_unavailable")
        if reliable(o):
            if cheapest is not None and o["price"] > cheapest:
                reasons.append("more_expensive")
            if nearest is not None and d is not None and d > nearest:
                reasons.append("farther")
        if o["shop"]["hours"]["open_now"] is False:
            reasons.append("closed_now")
        out.append({"offer_id": o["offer_id"], "shop_id": o["shop"]["id"], "reasons": reasons,
                    "detail": {"price": o["price"], "updated_days": o["updated_days"],
                               "distance_m": round(d) if d is not None else None}})
    return out
