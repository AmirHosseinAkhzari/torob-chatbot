"""پنل مدیریت (admin.<domain>): store analytics, the shop list, adding and editing shops, prices and stock,
CSV import and the change history. Only ADMIN_PHONES may call these (main.py checks)."""
import csv
import io
import time

from . import catalog, db, hours, pg, pricing

_totals_cache: tuple[float, dict] | None = None

KINDS = ("suggested", "not_suggested", "buy_click", "chose_other", "phone_check", "store_verify")


def _names(shop_ids: list[str]) -> dict[str, dict]:
    if not shop_ids:
        return {}
    rows = db.read("MATCH (s:Shop) WHERE s.shop_id IN $ids RETURN s.shop_id AS id, s.name AS name, s.area AS area, "
                   "coalesce(s.test, false) AS test", ids=shop_ids)
    return {r["id"]: r for r in rows}


def _titles(product_ids: list[str]) -> dict[str, str]:
    if not product_ids:
        return {}
    rows = db.read("MATCH (p:Product) WHERE p.product_id IN $ids RETURN p.product_id AS id, p.title AS title", ids=product_ids)
    return {r["id"]: r["title"] for r in rows}


def overview(days: int | None) -> dict:
    since = "now() - make_interval(days => %(days)s)" if days else "'-infinity'::timestamptz"
    p = {"days": days or 0}
    counts = {r["kind"]: r["n"] for r in pg.all_rows(
        f"SELECT kind, count(*) AS n FROM store_events WHERE created_at > {since} GROUP BY kind", p)}
    buy_value = pg.one(f"SELECT coalesce(sum((detail->>'price')::bigint), 0) AS v FROM store_events "
                       f"WHERE kind = 'buy_click' AND created_at > {since}", p)["v"]

    def reasons(kind: str) -> list[dict]:
        return pg.all_rows(f"SELECT r AS reason, count(*) AS n FROM store_events, unnest(reasons) r "
                           f"WHERE kind = %(kind)s AND created_at > {since} GROUP BY r ORDER BY n DESC LIMIT 10",
                           {**p, "kind": kind})

    shops = pg.all_rows(
        f"""
        SELECT shop_id,
               count(*) FILTER (WHERE kind = 'suggested') AS suggested,
               count(*) FILTER (WHERE kind = 'not_suggested') AS not_suggested,
               count(*) FILTER (WHERE kind = 'buy_click') AS buy_click,
               count(*) FILTER (WHERE kind = 'chose_other') AS chose_other,
               count(*) FILTER (WHERE kind = 'phone_check') AS phone_check
        FROM store_events WHERE created_at > {since} GROUP BY shop_id ORDER BY count(*) DESC LIMIT 10
        """, p)
    names = _names([s["shop_id"] for s in shops])
    calls = pg.all_rows(f"SELECT shop_id, product_id, reasons, detail, created_at FROM store_events "
                        f"WHERE kind = 'phone_check' AND created_at > {since} ORDER BY created_at DESC LIMIT 8", p)
    vr = pg.one(
        f"""
        SELECT count(*) AS total, count(*) FILTER (WHERE status IN ('pending', 'in_progress')) AS open,
               count(*) FILTER (WHERE status IN ('verified', 'unavailable')) AS answered,
               count(*) FILTER (WHERE status = 'expired') AS expired,
               round(avg(extract(epoch FROM resolved_at - created_at) / 60) FILTER (WHERE resolved_at IS NOT NULL)) AS avg_minutes
        FROM verification_requests WHERE created_at > {since}
        """, p)
    names |= _names([c["shop_id"] for c in calls if c["shop_id"] not in names])
    titles = _titles(list({c["product_id"] for c in calls}))
    return {
        "days": days,
        "counts": {k: counts.get(k, 0) for k in KINDS},
        "buy_value": int(buy_value or 0),
        "reasons": {k: reasons(k) for k in ("not_suggested", "suggested", "chose_other")},
        "shops": [{**s, "name": names.get(s["shop_id"], {}).get("name") or s["shop_id"],
                   "area": names.get(s["shop_id"], {}).get("area"), "test": names.get(s["shop_id"], {}).get("test", False)}
                  for s in shops],
        "calls": [{"shop": names.get(c["shop_id"], {}).get("name") or c["shop_id"], "product": titles.get(c["product_id"], ""),
                   "status": c["detail"].get("status"), "listed_price": c["detail"].get("listed_price"),
                   "quoted_price": c["detail"].get("quoted_price"), "test_call": c["detail"].get("test_call"),
                   "reasons": c["reasons"], "created_at": c["created_at"].isoformat()} for c in calls],
        "verification": {k: (int(v) if v is not None else None) for k, v in vr.items()},
    }


def totals() -> dict:
    global _totals_cache
    if _totals_cache and time.time() - _totals_cache[0] < 600:
        return _totals_cache[1]
    q = {"shops": "MATCH (s:Shop) RETURN count(s) AS n", "products": "MATCH (p:Product) RETURN count(p) AS n",
         "offers": "MATCH (o:Offer) RETURN count(o) AS n", "areas": "MATCH (a:Area) RETURN count(a) AS n",
         "categories": "MATCH (c:Category) RETURN count(c) AS n"}
    out = {k: db.read(v)[0]["n"] for k, v in q.items()}
    out["area_list"] = db.read("MATCH (s:Shop)-[:LOCATED_IN]->(a:Area) RETURN a.name AS name, count(s) AS shops "
                               "ORDER BY shops DESC")
    _totals_cache = (time.time(), out)
    return out


_SHOP_ROW = """
RETURN s.shop_id AS id, s.name AS name, s.area AS area, s.phones AS phones, coalesce(s.test, false) AS test,
       COUNT { (s)-[:HAS_OFFER]->() } AS offers, s.weekly_hours_json AS hours_raw,
       [(s)-[:HAS_OFFER]->(o) | o.last_price_changed_at] AS price_dates
"""


def _shop_out(r: dict, activity: dict) -> dict:
    dates = [d for d in (r.pop("price_dates") or []) if d]
    days = min((pricing.days_since(d) for d in dates if pricing.days_since(d) is not None), default=None)
    h = hours.parse(r.pop("hours_raw"))
    a = activity.get(r["id"], {})
    return {**r, "last_price_days": days, "open_now": h["open_now"],
            "suggested": a.get("suggested", 0), "not_suggested": a.get("not_suggested", 0),
            "phone_check": a.get("phone_check", 0), "open_requests": a.get("open_requests", 0)}


def _activity(ids: list[str]) -> dict[str, dict]:
    if not ids:
        return {}
    rows = pg.all_rows(
        """
        SELECT shop_id, count(*) FILTER (WHERE kind = 'suggested') AS suggested,
               count(*) FILTER (WHERE kind = 'not_suggested') AS not_suggested,
               count(*) FILTER (WHERE kind = 'phone_check') AS phone_check
        FROM store_events WHERE shop_id = ANY(%s) GROUP BY shop_id
        """, (ids,))
    out = {r["shop_id"]: r for r in rows}
    for r in pg.all_rows("SELECT shop_id, count(*) AS n FROM verification_requests WHERE shop_id = ANY(%s) "
                         "AND status IN ('pending', 'in_progress') GROUP BY shop_id", (ids,)):
        out.setdefault(r["shop_id"], {})["open_requests"] = r["n"]
    return out


def stores(q: str | None, area: str | None, test_only: bool, page: int, size: int = 20) -> dict:
    """Search by name, address or phone (full-text), or list by most activity, then name."""
    skip = max(0, page - 1) * size
    filters = "WHERE ($area IS NULL OR s.area = $area) AND (NOT $test OR coalesce(s.test, false))"
    params = {"area": area or None, "test": test_only, "skip": skip, "size": size}
    if q:
        terms = " ".join(f"{w}*" for w in q.replace('"', " ").split() if w)
        rows = db.read(f"CALL db.index.fulltext.queryNodes('shop_text', $q) YIELD node AS s, score {filters} "
                       f"WITH s, score ORDER BY score DESC SKIP $skip LIMIT $size {_SHOP_ROW}", q=terms, **params)
        total = db.read(f"CALL db.index.fulltext.queryNodes('shop_text', $q) YIELD node AS s {filters} RETURN count(s) AS n",
                        q=terms, **params)[0]["n"]
    else:
        ranked = [r["shop_id"] for r in pg.all_rows(
            "SELECT shop_id FROM store_events GROUP BY shop_id ORDER BY count(*) DESC LIMIT 200")]
        ranked_rows = db.read(f"MATCH (s:Shop) WHERE s.shop_id IN $ids WITH s {filters.replace('WHERE', 'WHERE true AND')} "
                              f"{_SHOP_ROW}", ids=ranked, **params) if ranked else []
        order = {sid: i for i, sid in enumerate(ranked)}
        ranked_rows.sort(key=lambda r: order.get(r["id"], 1e9))
        rows = ranked_rows[skip:skip + size]
        rest = size - len(rows)
        if rest > 0:
            rows += db.read(f"MATCH (s:Shop) {filters} AND NOT s.shop_id IN $ids WITH s ORDER BY s.name "
                            f"SKIP $skip2 LIMIT $rest {_SHOP_ROW}", ids=ranked, skip2=max(0, skip - len(ranked_rows)),
                            rest=rest, **params)
        total = db.read(f"MATCH (s:Shop) {filters} RETURN count(s) AS n", **params)[0]["n"]
    act = _activity([r["id"] for r in rows])
    return {"total": total, "page": page, "size": size, "stores": [_shop_out(r, act) for r in rows]}


def store(shop_id: str) -> dict | None:
    rows = db.read("""
        MATCH (s:Shop {shop_id: $id})
        RETURN s.shop_id AS id, s.name AS name, s.area AS area, s.address AS address, s.phones AS phones,
               s.location.latitude AS lat, s.location.longitude AS lng, s.weekly_hours_json AS hours_raw,
               s.payment_providers AS payments, coalesce(s.test, false) AS test,
               [(s)-[:SELLS_CATEGORY]->(c) | c.name][..20] AS categories,
               COUNT { (s)-[:HAS_OFFER]->() } AS offers
        """, id=shop_id)
    if not rows:
        return None
    r = rows[0]
    r["hours"] = catalog.hours_form(r.pop("hours_raw"))
    r["staff"] = [{**s, "created_at": s["created_at"].isoformat()} for s in pg.all_rows(
        "SELECT phone, name, role, created_at FROM store_staff WHERE shop_id = %s ORDER BY created_at", (shop_id,))]
    return r


def add_staff(shop_id: str, phone: str, name: str, role: str, actor: str) -> None:
    pg.run("INSERT INTO store_staff (shop_id, phone, name, role) VALUES (%s, %s, %s, %s) "
           "ON CONFLICT (shop_id, phone) DO UPDATE SET name = EXCLUDED.name, role = EXCLUDED.role",
           (shop_id, phone, name, role if role in ("owner", "staff") else "staff"))
    catalog.log_change(actor, "staff_add", f"دسترسی پنل فروشگاه برای {phone}", shop_id)


def remove_staff(shop_id: str, phone: str, actor: str) -> None:
    pg.run("DELETE FROM store_staff WHERE shop_id = %s AND phone = %s", (shop_id, phone))
    catalog.log_change(actor, "staff_remove", f"دسترسی پنل فروشگاه برای {phone} برداشته شد", shop_id)


def offers(q: str | None, shop_id: str | None, stale_only: bool, limit: int = 50) -> list[dict]:
    """Prices and stock to edit: a shop's offers, or a product search across shops."""
    params = {"shop": shop_id or None, "limit": limit, "fresh": 90}
    stale = ("AND (o.last_price_changed_at IS NULL OR datetime(o.last_price_changed_at) < datetime() - duration({days: $fresh}))"
             if stale_only else "")
    ret = """
        RETURN o.offer_id AS offer_id, p.product_id AS product_id, p.title AS title, s.shop_id AS shop_id, s.name AS shop,
               o.price_toman AS price, o.stock_status AS stock, o.verified_price_toman AS verified_price,
               o.price_status AS price_status, toString(o.last_price_changed_at) AS price_at, o.price_source AS source
        LIMIT $limit"""
    if q:
        terms = " ".join(f"{w}*" for w in q.replace('"', " ").split() if w)
        rows = db.read(f"""
            CALL db.index.fulltext.queryNodes('product_title', $q) YIELD node AS p, score
            WITH p, score ORDER BY score DESC LIMIT 40
            MATCH (s:Shop)-[:HAS_OFFER]->(o:Offer)-[:FOR_PRODUCT]->(p)
            WHERE ($shop IS NULL OR s.shop_id = $shop) {stale}
            {ret}""", q=terms, **params)
    elif shop_id:
        rows = db.read(f"""
            MATCH (s:Shop {{shop_id: $shop}})-[:HAS_OFFER]->(o:Offer)-[:FOR_PRODUCT]->(p:Product)
            WHERE true {stale}
            WITH s, o, p ORDER BY p.title
            {ret}""", **params)
    else:
        return []
    for r in rows:
        r["price_days"] = pricing.days_since(r.pop("price_at"))
        if r["price"] is not None and r["price"] < pricing.MIN_VALID_PRICE:
            r["price"] = None
    return rows


def changes(limit: int = 50) -> list[dict]:
    rows = pg.all_rows("SELECT actor, kind, shop_id, offer_id, summary, detail, created_at FROM data_changes "
                       "ORDER BY created_at DESC LIMIT %s", (limit,))
    return [{**r, "created_at": r["created_at"].isoformat()} for r in rows]


FA_DIGITS = str.maketrans("۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩", "01234567890123456789")
STOCK_WORDS = {"available": "available", "موجود": "available", "yes": "available", "1": "available",
               "unavailable": "unavailable", "ناموجود": "unavailable", "no": "unavailable", "0": "unavailable"}


def import_prices(text: str, apply: bool, actor: str) -> dict:
    """CSV with columns shop_id, product_id (or offer_id), price_toman, stock. Preview first, then apply."""
    reader = csv.DictReader(io.StringIO(text.lstrip("﻿")))
    rows, bad = [], []
    for i, r in enumerate(reader, start=2):
        r = {(k or "").strip().lower(): (v or "").strip() for k, v in r.items()}
        price_raw = r.get("price_toman", "").translate(FA_DIGITS).replace(",", "").replace("٬", "")
        price = int(price_raw) if price_raw.isdigit() else None
        stock = STOCK_WORDS.get(r.get("stock", "").lower()) if r.get("stock") else None
        if price is None and stock is None:
            bad.append({"line": i, "reason": "نه قیمت دارد نه موجودی"})
            continue
        if price is not None and price < pricing.MIN_VALID_PRICE:
            bad.append({"line": i, "reason": "قیمت کمتر از ۱٬۰۰۰ تومان"})
            continue
        rows.append({"line": i, "offer_id": r.get("offer_id") or None, "shop_id": r.get("shop_id") or None,
                     "product_id": r.get("product_id") or None, "price": price, "stock": stock})
        if len(rows) > 5000:
            break
    found = db.read("""
        UNWIND $rows AS r
        OPTIONAL MATCH (s:Shop)-[:HAS_OFFER]->(o:Offer)-[:FOR_PRODUCT]->(p:Product)
        WHERE (r.offer_id IS NOT NULL AND o.offer_id = r.offer_id)
           OR (r.offer_id IS NULL AND s.shop_id = r.shop_id AND p.product_id = r.product_id)
        RETURN r.line AS line, o.offer_id AS offer_id, o.price_toman AS old_price, p.title AS title, s.name AS shop
        """, rows=rows) if rows else []
    by_line = {}
    for f in found:
        by_line.setdefault(f["line"], f)
    matched, unmatched = [], []
    for r in rows:
        f = by_line.get(r["line"])
        if f and f["offer_id"]:
            matched.append({**r, "offer_id": f["offer_id"], "old_price": f["old_price"], "title": f["title"], "shop": f["shop"]})
        else:
            unmatched.append({"line": r["line"], "reason": "فروشگاه یا کالا پیدا نشد"})
    applied = 0
    if apply:
        for m in matched:
            catalog.update_offer(m["offer_id"], m["price"], m["stock"], actor, "import")
            applied += 1
        catalog.log_change(actor, "import", f"بارگذاری فایل قیمت: {applied} ردیف اعمال شد", detail={"rows": applied})
    return {"matched": len(matched), "unmatched": unmatched[:50], "invalid": bad[:50], "applied": applied,
            "preview": matched[:20]}
