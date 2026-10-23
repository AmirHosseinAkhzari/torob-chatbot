"""Catalog writes (Neo4j): a shop's price and stock, and shops added or edited in the admin panel.

Every change is logged in Postgres data_changes. A price set here (by the shop, an admin or an import) becomes
the listed price, dated now, so the recommendation trusts it again.
"""
import json
import logging
import uuid

from . import db, pg, pricing

log = logging.getLogger("torob-chat.catalog")

STOCK = {"available", "unavailable"}


def log_change(actor: str, kind: str, summary: str, shop_id: str | None = None, offer_id: str | None = None,
               detail: dict | None = None) -> None:
    pg.run("INSERT INTO data_changes (actor, kind, shop_id, offer_id, summary, detail) VALUES (%s, %s, %s, %s, %s, %s)",
           (actor, kind, shop_id, offer_id, summary, pg.jsonb(detail or {})))


def offer_info(offer_id: str) -> dict | None:
    rows = db.read(
        """
        MATCH (s:Shop)-[:HAS_OFFER]->(o:Offer {offer_id: $id})-[:FOR_PRODUCT]->(p:Product)
        RETURN o.offer_id AS offer_id, o.price_toman AS price, o.stock_status AS stock,
               toString(o.last_price_changed_at) AS price_at, o.verified_price_toman AS verified_price,
               p.product_id AS product_id, p.title AS product_title, s.shop_id AS shop_id, s.name AS shop_name
        """, id=offer_id)
    return rows[0] if rows else None


def update_offer(offer_id: str, price: int | None, stock: str | None, actor: str, source: str) -> dict:
    """Set the price (toman) and/or stock of one offer. source: store | admin | import | phone_check."""
    if price is not None and price < pricing.MIN_VALID_PRICE:
        raise ValueError("price too low")
    if stock is not None and stock not in STOCK:
        raise ValueError("stock must be available or unavailable")
    before = offer_info(offer_id)
    if not before:
        raise LookupError("offer not found")
    db.write(
        """
        MATCH (o:Offer {offer_id: $id})
        SET o.stock_status = CASE WHEN $stock IS NULL THEN o.stock_status ELSE $stock END,
            o.stock_checked_at = CASE WHEN $stock IS NULL THEN o.stock_checked_at ELSE datetime() END,
            o.price_status = CASE WHEN $price IS NULL THEN o.price_status
                                  WHEN $price = o.price_toman THEN 'confirmed' ELSE 'corrected' END,
            o.verified_price_toman = CASE WHEN $price IS NULL THEN o.verified_price_toman ELSE $price END,
            o.price_checked_at = CASE WHEN $price IS NULL THEN o.price_checked_at ELSE datetime() END,
            o.price_toman = coalesce($price, o.price_toman),
            o.has_price = CASE WHEN $price IS NULL THEN o.has_price ELSE true END,
            o.last_price_changed_at = CASE WHEN $price IS NULL THEN o.last_price_changed_at ELSE toString(datetime()) END,
            o.price_source = CASE WHEN $price IS NULL THEN o.price_source ELSE $source END
        WITH o
        MATCH (o)-[:FOR_PRODUCT]->(p:Product)
        MATCH (p)<-[:FOR_PRODUCT]-(x:Offer) WHERE x.price_toman >= $min
        WITH p, min(x.price_toman) AS mn, max(x.price_toman) AS mx
        SET p.min_price_toman = mn, p.max_price_toman = mx
        """, id=offer_id, price=price, stock=stock, source=source, min=pricing.MIN_VALID_PRICE)
    parts = []
    if price is not None:
        parts.append(f"قیمت {before['price'] or '—'} ← {price}")
    if stock is not None:
        parts.append("موجود" if stock == "available" else "ناموجود")
    log_change(actor, "offer_update", f"{before['product_title']} در {before['shop_name']}: {'، '.join(parts)}",
               before["shop_id"], offer_id, {"source": source, "old_price": before["price"], "price": price, "stock": stock})
    return {**before, "new_price": price, "new_stock": stock}


# --- shops (admin panel) -------------------------------------------------------------------------------------

DAYS = ["sat", "sun", "mon", "tue", "wed", "thu", "fri"]
DAY_FA = {"sat": "شنبه", "sun": "یکشنبه", "mon": "دوشنبه", "tue": "سه‌شنبه", "wed": "چهارشنبه", "thu": "پنج‌شنبه", "fri": "جمعه"}


def hours_json(hours: dict) -> tuple[str, str]:
    """{sat: {status: open|all_day|closed, start: "10:00", end: "21:00"}} -> (weekly_hours_json, text)."""
    data, text = {}, []
    for d in DAYS:
        h = hours.get(d) or {}
        st = h.get("status")
        if st == "closed":
            data[d] = {"status": "closed", "shifts": []}
            text.append(f"{DAY_FA[d]}: تعطیل")
        elif st == "all_day":
            data[d] = {"status": "declared", "shifts": [{"start_time": "00:00:00", "end_time": "00:00:00"}]}
            text.append(f"{DAY_FA[d]}: شبانه‌روزی")
        elif st == "open" and h.get("start") and h.get("end"):
            data[d] = {"status": "declared", "shifts": [{"start_time": f"{h['start'][:5]}:00", "end_time": f"{h['end'][:5]}:00"}]}
            text.append(f"{DAY_FA[d]}: {h['start'][:5]} تا {h['end'][:5]}")
        else:
            data[d] = {"status": "unsupported", "shifts": []}
    return json.dumps(data), " | ".join(text)


def hours_form(raw: str | None) -> dict:
    """The stored weekly hours back as the form's {day: {status, start, end}}."""
    out = {d: {"status": "unknown", "start": "", "end": ""} for d in DAYS}
    try:
        data = json.loads(raw or "{}")
    except ValueError:
        return out
    for d in DAYS:
        day = data.get(d) or {}
        shifts = day.get("shifts") or []
        if day.get("status") == "closed":
            out[d]["status"] = "closed"
        elif day.get("status") == "declared" and shifts:
            s = shifts[0]
            if s["start_time"][:5] == s["end_time"][:5]:
                out[d]["status"] = "all_day"
            else:
                out[d] = {"status": "open", "start": s["start_time"][:5], "end": s["end_time"][:5]}
    return out


def save_shop(shop_id: str | None, f: dict, actor: str) -> str:
    """Create (shop_id None) or update a shop from the admin form. Returns its id."""
    new = shop_id is None
    shop_id = shop_id or f"shop_{uuid.uuid4().hex[:24]}"
    hours_raw, hours_text = hours_json(f.get("hours") or {})
    phones = [p.strip() for p in f.get("phones") or [] if p and p.strip()]
    payments = [p for p in f.get("payments") or [] if p]
    categories = [c.strip() for c in f.get("categories") or [] if c and c.strip()]
    db.write(
        """
        MERGE (s:Shop {shop_id: $id})
        SET s.name = $name, s.area = $area, s.address = $address, s.phones = $phones,
            s.location = CASE WHEN $lat IS NULL OR $lng IS NULL THEN s.location
                              ELSE point({latitude: $lat, longitude: $lng}) END,
            s.weekly_hours_json = $hours, s.weekly_hours_text = $hours_text,
            s.payment_providers = $payments, s.test = $test,
            s.supports_fast_delivery = coalesce(s.supports_fast_delivery, false)
        WITH s
        OPTIONAL MATCH (s)-[r:LOCATED_IN|ACCEPTS_PAYMENT]->() DELETE r
        WITH DISTINCT s
        FOREACH (_ IN CASE WHEN $area = '' THEN [] ELSE [1] END |
          MERGE (a:Area {name: $area}) MERGE (s)-[:LOCATED_IN]->(a))
        FOREACH (name IN $payments | MERGE (pp:PaymentProvider {name: name}) MERGE (s)-[:ACCEPTS_PAYMENT]->(pp))
        FOREACH (name IN $categories | MERGE (c:Category {name: name}) MERGE (s)-[:SELLS_CATEGORY]->(c))
        SET s.category_count = COUNT { (s)-[:SELLS_CATEGORY]->() }
        """,
        id=shop_id, name=f["name"].strip(), area=(f.get("area") or "").strip(), address=(f.get("address") or "").strip(),
        phones=phones, lat=f.get("lat"), lng=f.get("lng"), hours=hours_raw, hours_text=hours_text,
        payments=payments, categories=categories, test=bool(f.get("test")),
    )
    log_change(actor, "shop_create" if new else "shop_update", f"{'فروشگاه اضافه شد' if new else 'فروشگاه ویرایش شد'}: {f['name'].strip()}",
               shop_id, None, {"area": f.get("area"), "phones": phones})
    return shop_id
