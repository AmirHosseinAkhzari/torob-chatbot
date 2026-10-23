"""The chat agent: an OpenAI Responses-API tool loop that streams text, status steps and UI blocks.

Data tools (search_products, get_product_details) read the graph. Display tools (show_*,
ask_quick_reply) do not return data to the model; they render a component in the chat, which is
how the answer shows products, comparisons, stores and quick replies instead of long text."""
import asyncio
import json
import logging
import re
from collections import Counter
from typing import Any, AsyncIterator

from openai import AsyncOpenAI

from . import repo, verify
from .config import settings

log = logging.getLogger("uvicorn.error")

SYSTEM_PROMPT = """You are تربچه («تربچه، دستیار کنترل ولخرجی‌هات»), Torob's shopping chat. You help people in Iran find products, compare them and find the shops that sell them. You answer ONLY from the Torob knowledge graph, through your tools.

What the data is
- Every shop is a physical store in Tehran (30 neighborhoods such as فردوسی، شیخ هادی، بهارستان). Many also deliver. There is no data for other cities: say so if asked.
- Prices are in Toman. Some offers have no usable price; the tools mark them "contact". Never quote those as prices.
- Most products have only one seller. Say it plainly when that is the case instead of implying a comparison.
- Titles with «استوک» or «کارکرده» are used or refurbished; «طرح» means a lookalike. Don't present them as the original unless the user asks for them.
- There is no price history and no way to set price alerts or place orders. Don't offer them.

How to work
1. Search before you recommend. Prices, sellers, stock, warranty, delivery and payment methods come ONLY from tool results; never invent them. Product specs come from the tools too; if one is missing, say it is not recorded in Torob.
   You MAY use general product knowledge to interpret specs and give a practical verdict (what a chip, RAM size or battery means for gaming, photos or daily use), said plainly as your judgement, never as a measured Torob fact. Be useful: give a clear verdict instead of only saying data is missing.
   When the user attached products, start from get_product_details for them and show them with show_products (style "pick") unless you show a comparison instead.
2. Titles are often written with English model names (گوشی سامسونگ A26, not آ۲۶). Search with the product type plus brand and model, and try another wording if the first search finds nothing useful.
3. If the request is too vague to search well (no product type, or "a good phone" with no budget or use), call ask_quick_reply with 3 to 6 short tappable options, then stop.
   If the answer depends on where the user is (buying in person, the nearest or a nearby shop, "near me", how far a shop is) and their location is not known, call ask_location with a one-line reason, then stop: the app asks for it and sends the question again with the location. Don't call it when the location is known or the user named a neighborhood themselves.
4. If you had to assume something (budget unit, what a word means), call show_understood first with the conditions you used and mark the assumptions.
5. Every product you recommend or name must also appear as a component in the same answer (show_products, show_comparison or show_summary). Never answer with product names in text only. Show products with components, not lists in text:
   - show_products, style "pick": 1 to 3 recommendations, each with a one-line reason and, when something is unknown or risky, a caveat.
   - show_products, style "row": 4 to 8 alternatives.
   - show_comparison: when the user compares, or is choosing between 2 to 4 models.
   - show_summary: at the end of an answer that weighed several options.
   - show_stores: when the user wants to buy in person, asks where, or asks what is near them. When the user's location is known its result has recommended_shop (nearest and/or cheapest near them, or cheapest in Tehran) and alternatives: the app already shows that shop with directions and Snapp. Name it in one sentence with why; don't list the other shops.
     Each shop may have needs_shop_confirmation. Never present an unconfirmed price or stock as confirmed: stale_price or no_price → say the last recorded price (if any) is old and the shop is being asked for today's price; stock_unknown → say availability is being checked with the shop; store_closed → say the shop is closed now and will confirm when it opens. Add that the answer is texted to them. If the list is empty, the price and stock are confirmed: give the price plainly.
   Call get_product_details before you state warranty, seller, delivery or payment facts about a product.
6. Credit and installments (BNPL). The installment providers are ترب‌پی، اسنپ‌پی، دیجی پی، تارا، ازکی‌وام (any spelling, e.g. «اسنپ پی», «ازکی وام»); a shop's own plan is not one of them. The words are فروش اعتباری، خرید قسطی، پرداخت اقساطی، اقساط، BNPL، «الان بخر بعدا پرداخت کن».
   - When the user wants to buy something on credit, search_products with installment ('any', or the provider they named). Only shops that accept it count: the results' prices, shop counts and sellers already cover only those shops.
   - Then always show the products with show_products and the same installment value, before you write the answer. Each card shows the plan, the shops that accept it and the nearest one with call and Snapp buttons, so don't repeat the plan in text. In text, name the nearest accepting shop (nearest_installment_shop in the results) and its distance when the user's location is known; otherwise the cheapest accepting shop, and say that sharing their location shows the nearest.
   - For a product already in the conversation, call show_products with its product_id and installment. If none of its sellers accept it, say so and search similar products with installment.
   - Never name a shop that does not accept the provider while the user is asking about installments.
   - show_payment_options only when the user asks which credit options exist, with no product in mind. If they want to buy on credit but haven't said what, ask what with ask_quick_reply.
   - Installment amounts are estimates and the card already says so; don't repeat it in text.
7. Write in colloquial Persian (محاوره), the way Torob writes. Lead with the verdict and the number. Keep each text part to 1 to 3 short sentences. No headings, no tables, no bullet lists of specs, no emoji, no greeting, no self-introduction, no "به‌عنوان دستیار", and no closing offers such as «اگه خواستی…». Prices with Persian digits and ٬ separators, e.g. ۶۸٬۳۳۲٬۲۰۰ تومان. Bold only the one product or number that matters, with **…**.
8. Don't repeat in text what a card already shows. Never print product ids (product_…) in text.
"""

TOOLS: list[dict[str, Any]] = [
    {
        "type": "function", "name": "search_products",
        "description": "Search Torob products by name. Returns matching products with cleaned min/max price (toman), shop count and key specs.",
        "parameters": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "Product words as they appear in titles, e.g. 'گوشی سامسونگ A26' or 'کابل افشان 2.5'."},
                "category": {"type": "string", "description": "Optional exact Persian category, e.g. 'گوشی موبایل'."},
                "min_price": {"type": "integer", "description": "Optional minimum price in toman."},
                "max_price": {"type": "integer", "description": "Optional maximum price in toman."},
                "installment": {"type": "string", "enum": ["any", "ترب‌پی", "اسنپ‌پی", "دیجی پی", "تارا", "ازکی‌وام"],
                                "description": "Only shops that accept this installment (BNPL) provider count; 'any' for any provider. Results then include the installment plan and the nearest accepting shop."},
            },
            "required": ["query"],
        },
    },
    {
        "type": "function", "name": "show_payment_options",
        "description": "Render the list of credit / installment (BNPL) providers ترب‌پی، اسنپ‌پی، دیجی پی، تارا، ازکی‌وام with their Torob terms and how many shops accept each. Only for a general question with no product; for products use search_products / show_products with installment.",
        "parameters": {
            "type": "object",
            "properties": {
                "providers": {"type": "array", "items": {"type": "string"}, "description": "Optional: only these providers (when the user named some)."},
            },
        },
    },
    {
        "type": "function", "name": "get_product_details",
        "description": "Full facts for one product: all specs, cleaned price range, and the shops selling it with price, warranty, price age in days, fast delivery, payment providers and whether the shop is open now.",
        "parameters": {"type": "object", "properties": {"product_id": {"type": "string"}}, "required": ["product_id"]},
    },
    {
        "type": "function", "name": "show_understood",
        "description": "Show the conditions you took from the user's message as editable chips. Mark assumptions with assumed=true.",
        "parameters": {
            "type": "object",
            "properties": {"conditions": {"type": "array", "items": {"type": "object", "properties": {
                "label": {"type": "string", "description": "Short Persian label, e.g. 'بودجه ۵۰ تا ۸۰ میلیون تومان'."},
                "assumed": {"type": "boolean"}}, "required": ["label", "assumed"]}}},
            "required": ["conditions"],
        },
    },
    {
        "type": "function", "name": "ask_quick_reply",
        "description": "Ask one short question with tappable options when the request is too vague. Ends your turn.",
        "parameters": {
            "type": "object",
            "properties": {
                "question": {"type": "string"},
                "options": {"type": "array", "items": {"type": "string"}, "description": "3 to 6 short options."},
                "multi_select": {"type": "boolean"},
            },
            "required": ["question", "options"],
        },
    },
    {
        "type": "function", "name": "ask_location",
        "description": "Ask the user for their location (GPS or a Tehran neighborhood) before answering a question that depends on it. Ends your turn.",
        "parameters": {
            "type": "object",
            "properties": {"reason": {"type": "string", "description": "One short colloquial Persian sentence: why you need it."}},
            "required": ["reason"],
        },
    },
    {
        "type": "function", "name": "show_products",
        "description": "Render product cards in the chat.",
        "parameters": {
            "type": "object",
            "properties": {
                "heading": {"type": "string", "description": "Short role label, e.g. 'گزینه‌ی متعادل برای بازی'."},
                "style": {"type": "string", "enum": ["pick", "row"]},
                "items": {"type": "array", "items": {"type": "object", "properties": {
                    "product_id": {"type": "string"},
                    "reason": {"type": "string", "description": "One short Persian sentence: why this one."},
                    "caveat": {"type": "string", "description": "Optional: what is unknown or risky."}},
                    "required": ["product_id"]}},
                "installment": {"type": "string", "enum": ["any", "ترب‌پی", "اسنپ‌پی", "دیجی پی", "تارا", "ازکی‌وام"],
                                "description": "When the user is buying on credit: cards show only the shops that accept this provider, the plan and the nearest accepting shop."},
            },
            "required": ["style", "items"],
        },
    },
    {
        "type": "function", "name": "show_comparison",
        "description": "Render a comparison table of 2 to 4 products: price, shop count and shared specs, with the best value per row marked.",
        "parameters": {
            "type": "object",
            "properties": {
                "heading": {"type": "string"},
                "product_ids": {"type": "array", "items": {"type": "string"}},
                "spec_keys": {"type": "array", "items": {"type": "string"}, "description": "Optional spec keys to show, in order (Persian keys as in get_product_details)."},
            },
            "required": ["product_ids"],
        },
    },
    {
        "type": "function", "name": "show_summary",
        "description": "Render a ranked summary of the options with one reason each, and up to 4 next-step suggestions the user can tap.",
        "parameters": {
            "type": "object",
            "properties": {
                "heading": {"type": "string"},
                "items": {"type": "array", "items": {"type": "object", "properties": {
                    "product_id": {"type": "string"}, "reason": {"type": "string"}}, "required": ["product_id", "reason"]}},
                "next_steps": {"type": "array", "items": {"type": "string"}},
            },
            "required": ["items"],
        },
    },
    {
        "type": "function", "name": "show_stores",
        "description": "Render the in-person store map for a product. The app asks for the user's location (or a Tehran neighborhood) and shows nearby shops with hours, contact and payment methods.",
        "parameters": {"type": "object", "properties": {"product_id": {"type": "string"}}, "required": ["product_id"]},
    },
]

HIGHER_IS_BETTER = ("حافظه", "RAM", "رم", "باتری", "رزولوشن", "مگاپیکسل", "توان", "ظرفیت")
_NUM = re.compile(r"[\d۰-۹]+(?:[.٫][\d۰-۹]+)?")


def _first_number(value: str) -> float | None:
    m = _NUM.search(value or "")
    if not m:
        return None
    from .text import to_latin_digits
    try:
        return float(to_latin_digits(m.group(0)).replace("٫", "."))
    except ValueError:
        return None


def _unique_best(values: list[float | None], higher: bool) -> int | None:
    nums = [(v, i) for i, v in enumerate(values) if v is not None]
    if len(nums) < 2:
        return None
    best = max(nums) if higher else min(nums)
    if sum(1 for v, _ in nums if v == best[0]) > 1:
        return None
    return best[1]


def _compact(card: dict) -> dict:
    p = card["price"]
    return {
        "product_id": card["id"], "title": card["title"], "category": card.get("category"),
        "min_price": p["min"], "max_price": p["max"], "shop_count": card["shop_count"],
        "offers_without_price": p["contact"],
        "specs": {s["key"]: s["value"] for s in card.get("specs", [])},
        "used_or_stock": card.get("stock"), "lookalike": card.get("lookalike"),
        **({"installment": _bnpl_facts(card["bnpl"])} if card.get("bnpl") else {}),
    }


def _bnpl_facts(b: dict) -> dict:
    first = b["sellers"][0] if b["sellers"] else None
    shop = None
    if first:
        shop = {"shop": first["shop"], "area": first["area"], "price": first["price"] or "contact",
                "providers": first["providers"], "open_now": first["open_now"]}
        if first["distance_m"] is not None:
            shop["distance_km"] = round(first["distance_m"] / 1000, 1)
    return {
        "provider_shown": b["provider"], "providers_available": b["providers"], "shops_accepting": b["seller_count"],
        "plan": b["plan"], ("nearest_installment_shop" if b["located"] else "cheapest_installment_shop"): shop,
        "user_location_known": b["located"],
    }


_LATIN_MODEL = re.compile(r"[A-Za-z][A-Za-z0-9+\-]*(?:\s+[A-Za-z0-9+\-]+){0,3}")


def _named_in(title: str, text: str) -> bool:
    """True when the product's Latin model name (e.g. 'Poco M7 4G', or just 'A26') appears in the answer text."""
    low = text.lower()
    for m in _LATIN_MODEL.findall(title):
        words = m.split()
        for n in range(len(words), 0, -1):  # 'A26 5G', then 'A26'
            name = " ".join(words[:n])
            if len(name) >= 3 and any(ch.isdigit() for ch in name) and re.search(rf"(?<![A-Za-z0-9]){re.escape(name.lower())}(?![A-Za-z0-9])", low):
                return True
    return False


def _memo_line(card: dict) -> str:
    price = card["price"]["min"]
    return f"{card['id']}: {card['title']}" + (f" — از {price} تومان" if price else "")


class Turn:
    """State of one chat turn while the agent works."""

    def __init__(self) -> None:
        self.status_id = 0
        self.searches = 0
        self.sources: dict[str, dict] = {}
        self.shown: dict[str, dict] = {}
        self.stop = False
        self.location: dict | None = None
        self.pay: str | None = None  # installment filter used by this turn's searches
        self.results: dict[str, dict] = {}  # cards returned by this turn's searches

    def next_status(self) -> int:
        self.status_id += 1
        return self.status_id

    def add_sources(self, cards: list[dict]) -> None:
        for c in cards:
            self.sources.setdefault(c["id"], {"id": c["id"], "title": c["title"], "image": c["image"], "price": c["price"]["min"]})

    def sources_event(self) -> dict:
        return {"type": "sources", "searches": self.searches, "items": list(self.sources.values())[:30]}


def _single_seller(product: dict) -> dict | None:
    """The one shop selling a product (from get_product's offers), or None when there are several."""
    offers = product.get("offers") or []
    if len({o["shop"]["id"] for o in offers}) != 1:
        return None
    o = offers[0]
    sh = o["shop"]
    return {"shop_id": sh["id"], "offer_id": o["offer_id"], "in_person": sh["lat"] is not None, "shop": sh["name"],
            "area": sh["area"], "price": o["price"], "open_now": sh["hours"]["open_now"], "today": sh["hours"]["today"],
            "distance_m": None}


async def _call(fn, *args, **kwargs):
    return await asyncio.to_thread(fn, *args, **kwargs)


def _int_or_none(v) -> int | None:
    try:
        n = int(float(v))
    except (TypeError, ValueError):
        return None
    return n if n > 0 else None


async def _execute(name: str, args: dict, turn: Turn) -> AsyncIterator[dict | tuple[str, Any]]:
    """Yields events for the client; the final item is ('result', payload) for the model."""
    if name == "search_products":
        q = (args.get("query") or "").strip()
        sid = turn.next_status()
        yield {"type": "status", "id": sid, "state": "running", "text": f"جست‌وجوی «{q}» در ترب"}
        category = (args.get("category") or "").strip() or None
        lo, hi = _int_or_none(args.get("min_price")), _int_or_none(args.get("max_price"))
        pay = repo.canonical_provider(args.get("installment"))
        if pay:
            turn.pay = pay
        cards = await _call(repo.search_products, q, category, lo, hi, 8, False, pay, turn.location)
        if not cards and category:
            cards = await _call(repo.search_products, q, None, lo, hi, 8, False, pay, turn.location)
        log.info("search_products %s -> %d", json.dumps(args, ensure_ascii=False), len(cards))
        turn.searches += 1
        turn.add_sources(cards)
        for c in cards:
            turn.results.setdefault(c["id"], c)
        yield {"type": "status", "id": sid, "state": "done", "text": f"جست‌وجوی «{q}» در ترب", "count": len(cards)}
        yield turn.sources_event()
        result: dict[str, Any] = {"results": [_compact(c) for c in cards]}
        if not cards:
            result["note"] = "Nothing matched. Try fewer words, the Latin model name, or remove the price filter."
            result["filters_used"] = {"category": category, "min_price": lo, "max_price": hi}
        yield ("result", result)
        return

    if name == "get_product_details":
        pid = args.get("product_id", "")
        sid = turn.next_status()
        yield {"type": "status", "id": sid, "state": "running", "text": "خواندن قیمت و فروشنده‌ها"}
        p = await _call(repo.get_product, pid)
        if not p:
            yield {"type": "status", "id": sid, "state": "done", "text": "محصول پیدا نشد", "count": 0}
            yield ("result", {"error": "product not found"})
            return
        turn.add_sources([p])
        yield {"type": "status", "id": sid, "state": "done", "text": f"قیمت و فروشنده‌های «{p['title'][:48]}»", "count": len(p["offers"])}
        offers = []
        for o in p["offers"][:10]:
            s = o["shop"]
            offers.append({
                "shop": s["name"], "area": s["area"], "price": o["price"] or "contact",
                "suspicious_price": o["outlier"], "warranty": o["warranty"],
                "price_updated_days_ago": o["updated_days"], "fast_delivery": s["fast_delivery"],
                "payment_providers": s["payments"], "open_now": s["hours"]["open_now"],
                "has_instagram": bool(s["instagram"]), "has_website": bool(s["website"]),
            })
        yield ("result", {
            "product_id": p["id"], "title": p["title"], "category": p["category"],
            "price": p["price"], "shop_count": p["shop_count"],
            "specs": {s["key"]: s["value"] for s in p["specs_all"][:30]},
            "offers": offers, "shops_with_fast_delivery": p["fast_delivery_count"],
            "offers_with_warranty": p["warranty_count"],
        })
        return

    if name == "show_understood":
        conds = [c for c in args.get("conditions") or [] if c.get("label")][:6]
        yield {"type": "block", "block": {"kind": "understood", "conditions": conds}}
        yield ("result", {"shown": True})
        return

    if name == "ask_quick_reply":
        yield {"type": "block", "block": {
            "kind": "quick_reply", "question": args.get("question", ""),
            "options": [o for o in args.get("options") or [] if o][:6], "multi": bool(args.get("multi_select")),
        }}
        turn.stop = True
        yield ("result", {"shown": True, "note": "Wait for the user's choice."})
        return

    if name == "ask_location":
        if turn.location and (turn.location.get("lat") is not None or turn.location.get("area")):
            yield ("result", {"error": "The location is already known; use it."})
            return
        yield {"type": "block", "block": {"kind": "location_request", "reason": args.get("reason") or "برای پیدا کردن نزدیک‌ترین فروشگاه، موقعیتت رو لازم دارم."}}
        turn.stop = True
        yield ("result", {"shown": True, "note": "Wait: the app asks for the location and sends the question again."})
        return

    if name == "show_products":
        items = args.get("items") or []
        ids = [i.get("product_id") for i in items if i.get("product_id")]
        cards = {c["id"]: c for c in await _call(repo.products_by_ids, ids, 3)}
        pay = repo.canonical_provider(args.get("installment")) or turn.pay
        if pay and cards:
            await _call(repo.apply_bnpl, list(cards.values()), pay, turn.location)
        if cards:
            await _call(repo.mark_single_seller, list(cards.values()))
        out = []
        for i in items:
            c = cards.get(i.get("product_id"))
            if c:
                turn.shown[c["id"]] = c
                out.append({**c, "reason": i.get("reason"), "caveat": i.get("caveat")})
        style = args.get("style") if args.get("style") in ("pick", "row") else ("pick" if len(out) <= 3 else "row")
        if out:
            yield {"type": "block", "block": {"kind": "products", "style": style, "heading": args.get("heading"), "items": out}}
        result = {"shown": len(out), "missing": [i for i in ids if i not in cards]}
        if pay:
            result["installment"] = {c["id"]: _bnpl_facts(c["bnpl"]) for c in out if c.get("bnpl")}
        yield ("result", result)
        return

    if name == "show_comparison":
        ids = [i for i in (args.get("product_ids") or []) if i][:4]
        products = [p for p in await asyncio.gather(*[_call(repo.get_product, i) for i in ids]) if p]
        if len(products) < 2:
            yield ("result", {"error": "need at least two valid product ids"})
            return
        for p in products:
            turn.shown[p["id"]] = p
        rows = [
            {"label": "کمترین قیمت", "type": "price", "values": [p["price"]["min"] for p in products],
             "best": _unique_best([p["price"]["min"] for p in products], higher=False)},
            {"label": "تعداد فروشگاه", "type": "number", "values": [p["shop_count"] for p in products],
             "best": _unique_best([p["shop_count"] for p in products], higher=True)},
        ]
        spec_maps = [{s["key"]: s["value"] for s in p["specs_all"]} for p in products]
        keys = [k for k in (args.get("spec_keys") or []) if any(k in m for m in spec_maps)]
        if not keys:
            counts = Counter(k for m in spec_maps for k in m if k not in repo.SPEC_SKIP)
            priority = repo.SPEC_PRIORITY.get(products[0].get("category") or "", [])
            shared = [k for k, n in counts.items() if n >= 2]
            keys = [k for k in priority if k in shared] + [k for k in shared if k not in priority]
        for k in keys[:7]:
            vals = [m.get(k) for m in spec_maps]
            best = None
            if any(h in k for h in HIGHER_IS_BETTER):
                best = _unique_best([_first_number(v) if v else None for v in vals], higher=True)
            rows.append({"label": k, "type": "text", "values": vals, "best": best})
        warranties = []
        for p in products:
            w = Counter(o["warranty"] for o in p["offers"] if o["warranty"])
            warranties.append(w.most_common(1)[0][0] if w else None)
        if any(warranties):
            rows.append({"label": "گارانتی رایج", "type": "text", "values": warranties, "best": None})
        yield {"type": "block", "block": {
            "kind": "compare", "heading": args.get("heading"),
            "products": [{"id": p["id"], "title": p["title"], "image": p["image"], "price": p["price"], "shop_count": p["shop_count"],
                          "single_seller": _single_seller(p)} for p in products],
            "rows": rows,
        }}
        yield ("result", {"shown": True, "rows": [r["label"] for r in rows]})
        return

    if name == "show_summary":
        items = args.get("items") or []
        cards = {c["id"]: c for c in await _call(repo.products_by_ids, [i.get("product_id") for i in items], 0)}
        out = [{**cards[i["product_id"]], "reason": i.get("reason")} for i in items if i.get("product_id") in cards]
        for c in out:
            turn.shown[c["id"]] = c
        if out:
            yield {"type": "block", "block": {"kind": "summary", "heading": args.get("heading"), "items": out,
                                              "next_steps": [s for s in args.get("next_steps") or [] if s][:4]}}
        yield ("result", {"shown": len(out)})
        return

    if name == "show_payment_options":
        data = await _call(repo.payment_options, args.get("providers") or None)
        yield {"type": "block", "block": {"kind": "payment_options", **data}}
        yield ("result", {"shown": True, "providers": [
            {"name": p["name"], "terms": p["terms"], "shops_in_torob": p["shops"]} for p in data["providers"]]})
        return

    if name == "show_stores":
        cards = await _call(repo.products_by_ids, [args.get("product_id", "")], 0)
        if not cards:
            yield ("result", {"error": "product not found"})
            return
        turn.shown[cards[0]["id"]] = cards[0]
        yield {"type": "block", "block": {"kind": "stores", "product": cards[0]}}
        result: dict[str, Any] = {"shown": True, "note": "The app now asks for the user's location and shows the map."}
        loc = turn.location or {}
        if loc.get("lat") is not None or loc.get("area"):
            r = await _call(repo.stores_for_product, cards[0]["id"], loc.get("lat"), loc.get("lng"), loc.get("area"))
            if r:
                r.pop("_left_out", None)  # store insights are saved when the user's map loads, not here
            rec = r and r.get("recommendation")
            if rec:
                by_id = {x["offer_id"]: x for x in r["stores"]}
                def describe(o):
                    st = by_id[o["offer_id"]]
                    d = {"shop": st["shop"]["name"], "area": st["shop"]["area"], "price": st["price"],
                         "open_now": st["shop"]["hours"]["open_now"], "roles": o["roles"],
                         "price_updated_days_ago": st["updated_days"], "stock_confirmed_by_phone": o["verified"],
                         # Not reliable yet: the app asks the shop (its panel) and texts the user the answer.
                         "needs_shop_confirmation": verify.needs(st)}
                    if o["distance_m"] is not None:
                        d["distance_km"] = round(o["distance_m"] / 1000, 1)
                    return d
                result = {
                    "shown": True,
                    "note": ("The app shows ONE recommended shop, with the other advantage (nearer or cheaper) as a "
                             "one-line alternative, and hides the rest behind «دیدن فروشگاه‌های دیگه». Name the "
                             "recommended shop in one sentence with why (near / cheapest); mention the alternative "
                             "only if it is a different shop. Don't list other shops."),
                    "user_neighborhood": rec["neighborhood"],
                    "recommended_shop": describe(next(o for o in rec["options"] if o["primary"])),
                    "alternatives": [describe(o) for o in rec["options"] if not o["primary"]],
                }
            else:
                result["note"] = ("No shop has a recent, reliable price for this product; the app shows no "
                                  "recommendation. Suggest calling the shop before going.")
        yield ("result", result)
        return

    yield ("result", {"error": f"unknown tool {name}"})


def _context_note(attachments: list[dict], location: dict | None) -> str | None:
    lines = []
    if attachments:
        lines.append("The user attached these products to the message; answer about exactly these:")
        lines += [f"- {_memo_line(a)}" for a in attachments]
    if not location or (location.get("lat") is None and not location.get("area")):
        lines.append("The user's location is not known yet.")
    if location:
        if location.get("area"):
            lines.append(f"The user is in the Tehran neighborhood {location['area']}.")
        elif location.get("lat") is not None:
            lines.append(f"The user shared their location: {location['lat']:.4f}, {location['lng']:.4f} (Tehran).")
    return "\n".join(lines) or None


async def run_turn(history: list[dict], message: str, attachment_ids: list[str],
                   location: dict | None) -> AsyncIterator[dict]:
    client = AsyncOpenAI(base_url=settings.openai_base_url, api_key=settings.openai_api_key)
    turn = Turn()
    turn.location = location
    attachments = await _call(repo.products_by_ids, attachment_ids, 0) if attachment_ids else []

    inputs: list[dict] = [{"role": "system", "content": SYSTEM_PROMPT}]
    for m in history[-16:]:
        if m.get("role") in ("user", "assistant") and m.get("content"):
            inputs.append({"role": m["role"], "content": str(m["content"])[:6000]})
    note = _context_note(attachments, location)
    if note:
        inputs.append({"role": "system", "content": note})
    inputs.append({"role": "user", "content": message})
    answer_text = ""

    try:
        for _ in range(8):
            items: list[dict] = []
            arg_buf: dict[str, str] = {}  # item_id -> streamed arguments (the router may leave item.arguments empty)
            async with client.responses.stream(
                model=settings.openai_model, input=inputs, tools=TOOLS,
                reasoning={"effort": settings.openai_reasoning_effort},
                include=["reasoning.encrypted_content"], store=False, max_output_tokens=4000,
            ) as stream:
                async for ev in stream:
                    if ev.type == "response.output_text.delta":
                        answer_text += ev.delta
                        yield {"type": "text", "delta": ev.delta}
                    elif ev.type == "response.function_call_arguments.delta":
                        arg_buf[ev.item_id] = arg_buf.get(ev.item_id, "") + ev.delta
                    elif ev.type == "response.function_call_arguments.done":
                        arg_buf[ev.item_id] = ev.arguments or arg_buf.get(ev.item_id, "")
                    elif ev.type == "response.output_item.done":
                        items.append(ev.item.model_dump(exclude_none=True))
            calls = [i for i in items if i.get("type") == "function_call"]
            for c in calls:
                if not c.get("arguments") or c["arguments"] == "{}":
                    c["arguments"] = arg_buf.get(c.get("id", ""), c.get("arguments") or "{}")
            if not calls:
                break
            inputs += items
            for call in calls:
                try:
                    args = json.loads(call.get("arguments") or "{}")
                except json.JSONDecodeError:
                    args = {}
                result: Any = {"error": "no result"}
                async for event in _execute(call["name"], args, turn):
                    if isinstance(event, tuple):
                        result = event[1]
                    else:
                        yield event
                inputs.append({"type": "function_call_output", "call_id": call["call_id"],
                               "output": json.dumps(result, ensure_ascii=False, default=str)})
            if turn.stop:
                break
    except Exception as exc:  # surface provider or database failures to the user
        yield {"type": "error", "message": f"مشکلی پیش اومد: {type(exc).__name__}"}

    # Safety net: products named in the answer but never shown as a card get one. For an installment
    # search with nothing named, the top results are shown, so the plan and the nearest shop still appear.
    if turn.searches and not turn.shown and answer_text:
        named = [sid for sid, s in turn.sources.items() if _named_in(s["title"], answer_text)][:3]
        if not named and turn.pay:
            named = list(turn.results)[:3]
        cards = [turn.results[i] for i in named if i in turn.results]
        missing = [i for i in named if i not in turn.results]
        if missing:
            extra = await _call(repo.products_by_ids, missing, 3)
            if turn.pay:
                await _call(repo.apply_bnpl, extra, turn.pay, turn.location)
            cards += extra
        if cards:
            await _call(repo.mark_single_seller, cards)
        for c in cards:
            turn.shown[c["id"]] = c
        if cards:
            yield {"type": "block", "block": {"kind": "products", "style": "pick", "heading": None, "items": cards}}

    if turn.searches:
        yield turn.sources_event()
    if turn.shown:
        memo = "[محصول‌هایی که در این پاسخ نشان داده شد: " + "؛ ".join(_memo_line(c) for c in turn.shown.values()) + "]"
        yield {"type": "memo", "text": memo}
    yield {"type": "done"}
