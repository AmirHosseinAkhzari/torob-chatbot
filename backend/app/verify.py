"""Price & stock verification requests (درخواست تأیید قیمت و موجودی).

When a customer looks at a shop whose price is old, whose stock is unknown, or that is closed, a request goes
to that shop's panel automatically: one open request per offer, with every customer who asked as a watcher.
The shop answers in its panel (or an استعلام دستگاه call answers it); the offer's price and stock are updated
and the watchers get the answer by SMS (Navatel).

The follow-up job (run_forever, started with the API) checks every minute:
- a request still open after FOLLOWUP_AFTER while the shop is open gets ONE Navatel SMS to the shop's staff
  (failed sends are retried with backoff, every attempt is logged in notification_log);
- a request still open after EXPIRE_AFTER becomes expired.
A closed shop's request stays pending: its follow-up waits until the shop is open again.
"""
import asyncio
import logging
import os
from datetime import timedelta

from . import config  # noqa: F401  (loads .env)
from . import catalog, db, hours, pg, sms

log = logging.getLogger("torob-chat.verify")

OPEN = ("pending", "in_progress")
FINAL = ("verified", "unavailable", "expired", "cancelled")
FRESH_DAYS = 90                      # same as the recommendation (repo.FRESH_DAYS)
STOCK_FRESH_DAYS = 7                 # a stock answer older than this is uncertain again
FOLLOWUP_AFTER = timedelta(hours=1)
EXPIRE_AFTER = timedelta(hours=int(os.environ.get("VERIFY_EXPIRE_HOURS", "48")))
RETRY_AFTER = [timedelta(minutes=5), timedelta(minutes=15), timedelta(minutes=45)]  # then give up
TICK_S = 60
# Test setups: every store follow-up goes to this number instead of the shop's staff.
SMS_OVERRIDE = (os.environ.get("VERIFY_SMS_OVERRIDE") or os.environ.get("INQUIRY_CALL_OVERRIDE") or "").strip()
APP_URL = os.environ.get("PUBLIC_APP_URL", "http://localhost:3000").rstrip("/")

REASON_FA = {"stale_price": "قیمت قدیمیه", "no_price": "قیمت ثبت نشده", "stock_unknown": "موجودی نامشخصه",
             "store_closed": "فروشگاه بسته بود"}


def needs(st: dict) -> list[str]:
    """Why this shop's offer (a stores_for_product item) must be confirmed by the shop; [] = reliable."""
    stock = st.get("stock") or {}
    days_checked = _days(stock.get("checked_at"))
    reasons = []
    if st.get("price") is None:
        reasons.append("no_price")
    elif st.get("updated_days") is None or st["updated_days"] > FRESH_DAYS:
        reasons.append("stale_price")
    if not stock.get("status") or days_checked is None or days_checked > STOCK_FRESH_DAYS:
        reasons.append("stock_unknown")
    if st["shop"]["hours"].get("open_now") is False:
        reasons.append("store_closed")
    return reasons


def _days(ts) -> int | None:
    from . import pricing
    return pricing.days_since(ts)


def _event(rid: int, kind: str, actor: str = "system", detail: dict | None = None) -> None:
    pg.run("INSERT INTO verification_events (request_id, kind, actor, detail) VALUES (%s, %s, %s, %s)",
           (rid, kind, actor, pg.jsonb(detail or {})))


def ensure(st: dict, product: dict, user_id: int | None, question: str = "") -> dict | None:
    """Open (or join) the request for this offer when it needs confirming. Returns {id, status, reasons}."""
    reasons = needs(st)
    if not reasons:
        return None
    row = pg.one(
        """
        INSERT INTO verification_requests (offer_id, shop_id, product_id, product_title, shop_name, listed_price,
                                           price_days, reasons, question)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
        ON CONFLICT (offer_id) WHERE status IN ('pending', 'in_progress')
        DO UPDATE SET updated_at = verification_requests.updated_at
        RETURNING id, status, reasons, created_at, (xmax = 0) AS created
        """,
        (st["offer_id"], st["shop"]["id"], product["id"], product.get("title") or "", st["shop"]["name"] or "",
         st.get("price"), st.get("updated_days"), reasons, question[:300]),
    )
    if row["created"]:
        _event(row["id"], "created", "system", {"reasons": reasons, "listed_price": st.get("price")})
        log.info("verification %s opened for %s at %s: %s", row["id"], product["id"], st["shop"]["id"], reasons)
    if user_id:
        pg.run("INSERT INTO verification_watchers (request_id, user_id) VALUES (%s, %s) ON CONFLICT DO NOTHING",
               (row["id"], user_id))
    return {"id": row["id"], "status": row["status"], "reasons": row["reasons"], "created_at": row["created_at"]}


def open_for(offer_ids: list[str]) -> dict[str, dict]:
    if not offer_ids:
        return {}
    rows = pg.all_rows("SELECT id, offer_id, status, reasons, created_at FROM verification_requests "
                       "WHERE offer_id = ANY(%s) AND status IN ('pending', 'in_progress')", (offer_ids,))
    return {r["offer_id"]: {"id": r["id"], "status": r["status"], "reasons": r["reasons"],
                            "created_at": r["created_at"].isoformat()} for r in rows}


def annotate(result: dict, user_id: int | None, shop: str | None) -> None:
    """On a stores response: open requests for what the customer is looking at (the recommended shop, or the
    shop they picked), then mark every listed shop with its open request and what it still needs."""
    product = result["product"]
    targets = []
    rec = result.get("recommendation")
    if shop:
        targets += [x for x in result["stores"] if x["shop"]["id"] == shop][:1]
    elif rec:
        primary = next((o for o in rec["options"] if o.get("primary")), None)
        targets += [x for x in result["stores"] if primary and x["offer_id"] == primary["offer_id"]][:1]
    for st in targets:
        try:
            ensure(st, product, user_id)
        except Exception:
            log.exception("could not open a verification request for %s", st.get("offer_id"))
    found = open_for([x["offer_id"] for x in result["stores"]])
    for st in result["stores"]:
        st["needs_confirmation"] = needs(st)
        st["verification"] = found.get(st["offer_id"])


# --- the shop's panel ---------------------------------------------------------------------------------------

def _row(r: dict) -> dict:
    out = dict(r)
    for k in ("created_at", "updated_at", "resolved_at", "followup_sent_at", "followup_next_at"):
        if out.get(k) is not None:
            out[k] = out[k].isoformat()
    return out


def dashboard(shop_id: str) -> dict:
    stats = pg.one(
        """
        SELECT count(*) AS total,
               count(*) FILTER (WHERE status IN ('verified', 'unavailable')) AS answered,
               count(*) FILTER (WHERE status IN ('pending', 'in_progress')) AS open,
               count(*) FILTER (WHERE status = 'verified' AND verified_price IS NOT NULL) AS verified_prices,
               count(*) FILTER (WHERE status = 'unavailable') AS unavailable,
               count(*) FILTER (WHERE status = 'expired') AS expired,
               round(avg(extract(epoch FROM resolved_at - created_at) / 60)
                     FILTER (WHERE resolved_at IS NOT NULL)) AS avg_minutes,
               min(created_at) FILTER (WHERE status IN ('pending', 'in_progress')) AS oldest_open
        FROM verification_requests WHERE shop_id = %s AND created_at > now() - interval '30 days'
        """, (shop_id,))
    watchers = pg.one("SELECT count(DISTINCT w.user_id) AS n FROM verification_watchers w "
                      "JOIN verification_requests r ON r.id = w.request_id "
                      "WHERE r.shop_id = %s AND r.created_at > now() - interval '30 days'", (shop_id,))
    activity = pg.all_rows(
        """
        SELECT e.kind, e.actor, e.detail, e.created_at, r.id AS request_id, r.product_title
        FROM verification_events e JOIN verification_requests r ON r.id = e.request_id
        WHERE r.shop_id = %s ORDER BY e.created_at DESC LIMIT 12
        """, (shop_id,))
    shop = db.read("MATCH (s:Shop {shop_id: $id}) RETURN s.name AS name, s.area AS area, s.weekly_hours_json AS h", id=shop_id)
    s = shop[0] if shop else {"name": "", "area": "", "h": None}
    return {
        "shop": {"id": shop_id, "name": s["name"], "area": s["area"], "hours": hours.parse(s["h"])},
        "stats": {**{k: (int(v) if v is not None and k != "oldest_open" else v) for k, v in stats.items()},
                  "oldest_open": stats["oldest_open"].isoformat() if stats["oldest_open"] else None,
                  "customers": watchers["n"]},
        "open": list_requests(shop_id, "open"),
        "activity": [{**a, "created_at": a["created_at"].isoformat()} for a in activity],
    }


def list_requests(shop_id: str, status: str = "open", limit: int = 100) -> list[dict]:
    where = {"open": "status IN ('pending', 'in_progress')", "all": "true"}.get(status, "status = %(status)s")
    rows = pg.all_rows(
        f"""
        SELECT r.*, (SELECT count(*) FROM verification_watchers w WHERE w.request_id = r.id) AS customers
        FROM verification_requests r WHERE shop_id = %(shop)s AND {where}
        ORDER BY (status IN ('pending', 'in_progress')) DESC, created_at {'ASC' if status == 'open' else 'DESC'}
        LIMIT %(limit)s
        """, {"shop": shop_id, "status": status, "limit": limit})
    return [_row(r) for r in rows]


def detail(shop_id: str, rid: int) -> dict | None:
    r = pg.one("SELECT * FROM verification_requests WHERE id = %s AND shop_id = %s", (rid, shop_id))
    if not r:
        return None
    events = pg.all_rows("SELECT kind, actor, detail, created_at FROM verification_events WHERE request_id = %s "
                         "ORDER BY created_at", (rid,))
    notes = pg.all_rows("SELECT purpose, to_phone, attempt, ok, reason, text, created_at FROM notification_log "
                        "WHERE request_id = %s ORDER BY created_at", (rid,))
    customers = pg.one("SELECT count(*) AS n FROM verification_watchers WHERE request_id = %s", (rid,))["n"]
    return {**_row(r), "customers": customers,
            "events": [{**e, "created_at": e["created_at"].isoformat()} for e in events],
            "notifications": [{**n, "to_phone": _mask(n["to_phone"]), "created_at": n["created_at"].isoformat()} for n in notes]}


def _mask(phone: str) -> str:
    return phone[:4] + "•••" + phone[-4:] if len(phone) > 8 else phone


def claim(shop_id: str, rid: int, actor: str) -> bool:
    row = pg.one("UPDATE verification_requests SET status = 'in_progress', claimed_by = %s, updated_at = now() "
                 "WHERE id = %s AND shop_id = %s AND status = 'pending' RETURNING id", (actor, rid, shop_id))
    if row:
        _event(rid, "claimed", actor)
    return bool(row)


def resolve(shop_id: str, rid: int, actor: str, stock: str, price: int | None, note: str | None = None) -> dict:
    """The shop's answer. available needs today's price; unavailable keeps the price as it is."""
    if stock not in catalog.STOCK:
        raise ValueError("stock must be available or unavailable")
    if stock == "available" and price is None:
        raise ValueError("price is required when the product is available")
    r = pg.one("SELECT * FROM verification_requests WHERE id = %s AND shop_id = %s", (rid, shop_id))
    if not r:
        raise LookupError("request not found")
    if r["status"] not in OPEN:
        raise ValueError("this request is already closed")
    catalog.update_offer(r["offer_id"], price if stock == "available" else None, stock, actor, "store")
    return _close(r, actor, stock, price if stock == "available" else None, note)


def _close(r: dict, actor: str, stock: str, price: int | None, note: str | None) -> dict:
    status = "verified" if stock == "available" else "unavailable"
    pg.run("UPDATE verification_requests SET status = %s, stock = %s, verified_price = %s, note = %s, resolved_by = %s, "
           "resolved_at = now(), updated_at = now(), followup_next_at = NULL WHERE id = %s",
           (status, stock, price, (note or "")[:300] or None, actor, r["id"]))
    _event(r["id"], "resolved", actor, {"status": status, "price": price, "listed_price": r["listed_price"], "note": note})
    pg.run("INSERT INTO store_events (kind, product_id, shop_id, offer_id, reasons, detail) "
           "VALUES ('store_verify', %s, %s, %s, %s, %s)",
           (r["product_id"], r["shop_id"], r["offer_id"], [status], pg.jsonb({"price": price, "by": actor})))
    sent = _notify_customers(r, status, price, note)
    return {"id": r["id"], "status": status, "customers_notified": sent}


def resolve_by_offer(offer_id: str, status: str, price: int | None, actor: str) -> None:
    """The answer came another way (an استعلام دستگاه call, or the shop editing the product): close the open
    request for that offer too. The catalog is already updated by then."""
    r = pg.one("SELECT * FROM verification_requests WHERE offer_id = %s AND status IN ('pending', 'in_progress')", (offer_id,))
    if r and status in ("available", "unavailable"):
        _close(r, actor, status, price if status == "available" else None, None)


def _customer_text(r: dict, status: str, price: int | None, note: str | None) -> str:
    p = f"{price:,}".replace(",", "٬").translate(str.maketrans("0123456789", "۰۱۲۳۴۵۶۷۸۹")) if price else None
    link = f"{APP_URL}/p/{r['product_id']}?shop={r['shop_id']}"
    if status == "verified":
        lines = ["تربچه", f"«{r['product_title']}» در «{r['shop_name']}» موجود است.",
                 f"قیمت تأییدشده: {p} تومان" if p else None, note, "مسیریابی و اسنپ تا فروشگاه:", link]
    else:
        lines = ["تربچه", f"«{r['shop_name']}» گفت «{r['product_title']}» را الان ندارد.", "فروشگاه‌های دیگر:", link]
    return "\n".join(x for x in lines if x)


def _notify_customers(r: dict, status: str, price: int | None, note: str | None) -> int:
    watchers = pg.all_rows("SELECT w.user_id, u.phone FROM verification_watchers w JOIN users u ON u.id = w.user_id "
                           "WHERE w.request_id = %s AND w.notified_at IS NULL", (r["id"],))
    text = _customer_text(r, status, price, note)
    sent = 0
    for w in watchers:
        res = _send(r["id"], "customer_answer", w["phone"], text, 1)
        if res["sent"] or not sms.SEND:
            pg.run("UPDATE verification_watchers SET notified_at = now() WHERE request_id = %s AND user_id = %s",
                   (r["id"], w["user_id"]))
            sent += 1
    return sent


def _send(rid: int, purpose: str, phone: str, text: str, attempt: int) -> dict:
    res = sms.send(phone, text)
    pg.run("INSERT INTO notification_log (request_id, purpose, to_phone, attempt, ok, reason, text) "
           "VALUES (%s, %s, %s, %s, %s, %s, %s)", (rid, purpose, res["to"], attempt, res["sent"], res["reason"], text))
    if not res["sent"]:
        log.warning("SMS %s for request %s to %s not sent: %s", purpose, rid, res["to"], res["reason"])
    return res


# --- the follow-up job -------------------------------------------------------------------------------------

def _staff_phones(shop_id: str) -> list[str]:
    if SMS_OVERRIDE:
        return [SMS_OVERRIDE]
    staff = [r["phone"] for r in pg.all_rows("SELECT phone FROM store_staff WHERE shop_id = %s", (shop_id,))]
    if staff:
        return staff
    rows = db.read("MATCH (s:Shop {shop_id: $id}) RETURN s.phones AS phones", id=shop_id)
    listed = (rows[0]["phones"] or []) if rows else []
    mobiles = ["".join(c for c in p.translate(str.maketrans("۰۱۲۳۴۵۶۷۸۹", "0123456789")) if c.isdigit()) for p in listed]
    return [m for m in mobiles if m.startswith("09") and len(m) == 11][:1]


def _shop_open(shop_id: str) -> bool | None:
    rows = db.read("MATCH (s:Shop {shop_id: $id}) RETURN s.weekly_hours_json AS h", id=shop_id)
    return hours.parse(rows[0]["h"])["open_now"] if rows else None


def _followup_text(r: dict, waiting: int) -> str:
    listed = f"{r['listed_price']:,}".replace(",", "٬") if r["listed_price"] else "ثبت نشده"
    return (f"تربچه\nمشتری منتظر تأیید «{r['product_title']}» در فروشگاه شماست ({waiting} نفر).\n"
            f"قیمت ثبت‌شده: {listed} تومان\nلطفاً در پنل فروشگاه پاسخ بدید:\n{APP_URL}/store/requests/{r['id']}")


def expire_old() -> int:
    rows = pg.all_rows("UPDATE verification_requests SET status = 'expired', updated_at = now(), followup_next_at = NULL "
                       "WHERE status IN ('pending', 'in_progress') AND created_at < now() - %s RETURNING id", (EXPIRE_AFTER,))
    for r in rows:
        _event(r["id"], "expired")
    return len(rows)


def followups() -> int:
    """Send the due follow-ups, at most one successful SMS per request. Safe to run from several instances:
    each request is leased (followup_next_at moved forward) before it is handled."""
    done = 0
    while True:
        r = pg.one(
            """
            UPDATE verification_requests SET followup_next_at = now() + interval '10 minutes'
            WHERE id = (SELECT id FROM verification_requests
                        WHERE status IN ('pending', 'in_progress') AND followup_sent_at IS NULL
                          AND created_at <= now() - %s AND followup_attempts <= %s
                          AND (followup_next_at IS NULL OR followup_next_at <= now())
                        ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED)
            RETURNING *
            """, (FOLLOWUP_AFTER, len(RETRY_AFTER)))
        if not r:
            return done
        if _shop_open(r["shop_id"]) is False:
            # Closed: keep it pending, try again later (no attempt counted, nothing marked available).
            pg.run("UPDATE verification_requests SET followup_next_at = now() + interval '15 minutes' WHERE id = %s", (r["id"],))
            continue
        phones = _staff_phones(r["shop_id"])
        waiting = pg.one("SELECT count(*) AS n FROM verification_watchers WHERE request_id = %s", (r["id"],))["n"] or 1
        text = _followup_text(r, waiting)
        attempt = r["followup_attempts"] + 1
        results = [_send(r["id"], "store_followup", p, text, attempt) for p in phones]
        ok = any(x["sent"] for x in results) or (results and not sms.SEND)
        if ok:
            pg.run("UPDATE verification_requests SET followup_sent_at = now(), followup_attempts = %s, "
                   "followup_next_at = NULL WHERE id = %s", (attempt, r["id"]))
            _event(r["id"], "followup", "system", {"to": [x["to"] for x in results], "sent": True, "attempt": attempt})
            done += 1
        else:
            nxt = RETRY_AFTER[attempt - 1] if attempt <= len(RETRY_AFTER) else None
            pg.run("UPDATE verification_requests SET followup_attempts = %s, followup_next_at = now() + %s WHERE id = %s",
                   (attempt if nxt else attempt + 1, nxt or timedelta(0), r["id"]))
            _event(r["id"], "followup", "system", {"sent": False, "attempt": attempt,
                                                    "reason": results[0]["reason"] if results else "no staff phone",
                                                    "gave_up": nxt is None})


async def run_forever() -> None:
    log.info("verification follow-up job started (every %ss, follow-up after %s)", TICK_S, FOLLOWUP_AFTER)
    while True:
        try:
            n_exp = await asyncio.to_thread(expire_old)
            n_fu = await asyncio.to_thread(followups)
            if n_exp or n_fu:
                log.info("verification job: %s expired, %s follow-ups sent", n_exp, n_fu)
        except Exception:
            log.exception("verification job failed")
        await asyncio.sleep(TICK_S)
