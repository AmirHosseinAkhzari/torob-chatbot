"""Store insights: what تربچه recommended about in-person shops and why, which shops it left out and why,
and where people actually chose to buy. Saved in Postgres (store_events) for the shops later; not shown anywhere yet.

Reasons are short codes so they can be counted:
  suggested:     nearest, cheapest_nearby, cheapest_city, stock_confirmed, open_now
  not_suggested: no_price, outlier_price, stale_price, said_unavailable, more_expensive, farther, closed_now
  chose_other:   cheaper, nearer, recommended_stale, recommended_closed, open_now, warranty, stock_confirmed,
                 user_said:<what they picked>
"""
import logging
from . import pg, repo

log = logging.getLogger("torob-chat.insights")

DEDUP_MINUTES = 10  # the same view reloaded within this window is not counted twice


def _recent(user_id: int | None, kind: str, product_id: str, shop_id: str) -> bool:
    if user_id is None:
        return False
    r = pg.one(
        "SELECT 1 AS x FROM store_events WHERE user_id = %s AND kind = %s AND product_id = %s AND shop_id = %s "
        "AND created_at > now() - make_interval(mins => %s) LIMIT 1",
        (user_id, kind, product_id, shop_id, DEDUP_MINUTES),
    )
    return bool(r)


def _event(user_id, kind, product_id, shop_id, offer_id=None, recommended_offer_id=None, roles=(), reasons=(), detail=None):
    pg.run(
        "INSERT INTO store_events (user_id, kind, product_id, shop_id, offer_id, recommended_offer_id, roles, reasons, detail) "
        "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)",
        (user_id, kind, product_id, shop_id, offer_id, recommended_offer_id, list(roles), list(reasons), pg.jsonb(detail or {})),
    )


def record_recommendation(user_id: int | None, product_id: str, result: dict, context: str) -> None:
    """After stores_for_product: one 'suggested' row per recommended shop, one 'not_suggested' row per shop left out."""
    rec = result.get("recommendation")
    left_out = result.pop("_left_out", [])
    try:
        if rec:
            by_id = {s["offer_id"]: s for s in result["stores"]}
            for opt in rec["options"]:
                st = by_id.get(opt["offer_id"])
                if not st or _recent(user_id, "suggested", product_id, st["shop"]["id"]):
                    continue
                why = list(opt["roles"]) + (["stock_confirmed"] if opt["verified"] else []) \
                    + (["open_now"] if st["shop"]["hours"]["open_now"] else [])
                _event(user_id, "suggested", product_id, st["shop"]["id"], st["offer_id"], rec["primary"],
                       roles=opt["roles"], reasons=why,
                       detail={"primary": opt["primary"], "price": st["price"], "distance_m": st.get("distance_m"),
                               "neighborhood": rec.get("neighborhood"), "context": context})
        for x in left_out:
            if _recent(user_id, "not_suggested", product_id, x["shop_id"]):
                continue
            _event(user_id, "not_suggested", product_id, x["shop_id"], x["offer_id"], rec["primary"] if rec else None,
                   reasons=x["reasons"], detail={**x["detail"], "context": context})
    except Exception:
        log.exception("could not save recommendation insights")


def record_choice(user_id: int, product_id: str, offer_id: str, recommended_offer_id: str | None,
                  lat: float | None = None, lng: float | None = None, user_said: str | None = None,
                  context: str = "") -> dict:
    """The user pressed «خرید از …» (or answered why they picked a shop). Works out why it differs from the pick."""
    product = repo.get_product(product_id)
    if not product:
        return {"saved": False}
    offers = {o["offer_id"]: o for o in product["offers"]}
    chosen = offers.get(offer_id)
    if not chosen:
        return {"saved": False}
    rec = offers.get(recommended_offer_id) if recommended_offer_id else None
    shop_id = chosen["shop"]["id"]

    def dist(o: dict) -> float | None:
        s = o["shop"]
        if lat is None or lng is None or s["lat"] is None:
            return None
        return repo._haversine_m(lat, lng, s["lat"], s["lng"])

    if rec is None or rec["offer_id"] == chosen["offer_id"]:
        if not user_said:
            _event(user_id, "buy_click", product_id, shop_id, offer_id, recommended_offer_id,
                   detail={"price": chosen["price"], "context": context})
        return {"saved": True, "kind": "buy_click"}

    reasons: list[str] = []
    if chosen["price"] is not None and rec["price"] is not None and chosen["price"] < rec["price"]:
        reasons.append("cheaper")
    dc, dr = dist(chosen), dist(rec)
    if dc is not None and dr is not None and dc < dr:
        reasons.append("nearer")
    if (rec["updated_days"] or 0) > repo.FRESH_DAYS:
        reasons.append("recommended_stale")
    if rec["shop"]["hours"]["open_now"] is False:
        reasons.append("recommended_closed")
    if chosen["shop"]["hours"]["open_now"]:
        reasons.append("open_now")
    if chosen.get("warranty") and chosen["warranty"] != "بدون گارانتی" and not (rec.get("warranty") and rec["warranty"] != "بدون گارانتی"):
        reasons.append("warranty")
    if (chosen.get("stock") or {}).get("status") == "available":
        reasons.append("stock_confirmed")
    if user_said:
        reasons.append(f"user_said:{user_said}")
    _event(user_id, "chose_other", product_id, shop_id, offer_id, recommended_offer_id, reasons=reasons,
           detail={"price": chosen["price"], "recommended_price": rec["price"],
                   "recommended_shop_id": rec["shop"]["id"], "distance_m": dc, "recommended_distance_m": dr,
                   "context": context})
    return {"saved": True, "kind": "chose_other", "reasons": reasons}
