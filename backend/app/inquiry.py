"""استعلام دستگاه: call an open shop, ask whether it has the product, record the key press, text the user.

Flow (one background task per inquiry, one call at a time):
  queued -> preparing (TTS) -> ringing -> in_call -> available | unavailable | no_answer | failed
The answer is written to Neo4j: an (:Inquiry) node linked to the offer, and the offer's
stock_status / stock_checked_at. Then the user gets an SMS (logged only while NAVATEL_SEND=false).
"""
import asyncio
import logging
import os
import re
import time
import uuid
from datetime import datetime, timezone

from . import db, hours, sms, tts, voip
from .config import settings  # noqa: F401  (loads .env)

log = logging.getLogger("torob-chat.inquiry")

CALL_OVERRIDE = os.environ.get("INQUIRY_CALL_OVERRIDE", "").strip()  # test: every call goes here
APP_URL = os.environ.get("PUBLIC_APP_URL", "http://localhost:3000").rstrip("/")
ALLOW_CLOSED = os.environ.get("INQUIRY_ALLOW_CLOSED", "false").lower() in ("1", "true", "yes")
MOBILE_RE = re.compile(r"^09\d{9}$")
FINAL = {"available", "unavailable", "no_answer", "failed"}

_jobs: dict[str, dict] = {}


class InquiryError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status, self.message = status, message


def normalize_mobile(phone: str) -> str | None:
    digits = "".join(c for c in phone.translate(str.maketrans("۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩", "01234567890123456789"))
                     if c.isdigit())
    if digits.startswith("0098"):
        digits = "0" + digits[4:]
    elif digits.startswith("98"):
        digits = "0" + digits[2:]
    elif digits.startswith("9") and len(digits) == 10:
        digits = "0" + digits
    return digits if MOBILE_RE.match(digits) else None


def _offer_info(product_id: str, shop_id: str) -> dict | None:
    rows = db.read(
        """
        MATCH (s:Shop {shop_id: $shop})-[:HAS_OFFER]->(o:Offer)-[:FOR_PRODUCT]->(p:Product {product_id: $product})
        RETURN p.product_id AS product_id, p.title AS title, s.shop_id AS shop_id, s.name AS shop,
               s.phones AS phones, s.weekly_hours_json AS hours_json, o.offer_id AS offer_id
        LIMIT 1
        """,
        shop=shop_id, product=product_id,
    )
    return rows[0] if rows else None


def spoken_title(title: str) -> str:
    """A product title that reads well aloud: no brackets, codes or very long tails."""
    t = re.sub(r"[\(\[\{].*?[\)\]\}]", " ", title or "")
    t = re.sub(r"[|/\\_*#«»\"]", " ", t)
    t = re.sub(r"\s+", " ", t).strip()
    words = t.split(" ")
    return " ".join(words[:9])


def question_text(title: str) -> str:
    return (f"سلام، وقت بخیر. از تربچت تماس می‌گیرم. یکی از مشتری‌ها دنبال «{spoken_title(title)}» است. "
            "اگر این کالا را الان موجود دارید، لطفاً عدد یک را بزنید. اگر موجود ندارید، عدد دو را بزنید.")


THANKS_TEXT = "ممنون، پاسخ شما ثبت شد. روز خوبی داشته باشید."


def product_url(product_id: str, shop_id: str) -> str:
    return f"{APP_URL}/p/{product_id}?shop={shop_id}"


def sms_text(job: dict) -> str:
    title = spoken_title(job["product_title"])
    if job["status"] == "available":
        head = f"خبر خوب! «{title}» در فروشگاه «{job['shop_name']}» موجود است."
        tail = f"مسیریابی و اسنپ تا فروشگاه:\n{product_url(job['product_id'], job['shop_id'])}"
    else:
        head = f"«{title}» الان در فروشگاه «{job['shop_name']}» موجود نیست."
        tail = f"فروشگاه‌های دیگر را ببینید:\n{product_url(job['product_id'], job['shop_id'])}"
    return f"تربچت\n{head}\n{tail}"


def _public(job: dict) -> dict:
    return {k: v for k, v in job.items() if not k.startswith("_")}


def get(inquiry_id: str) -> dict | None:
    job = _jobs.get(inquiry_id)
    return _public(job) if job else None


def latest_for(product_id: str, shop_id: str) -> dict | None:
    """The last saved answer for this shop and product (from Neo4j)."""
    rows = db.read(
        """
        MATCH (s:Shop {shop_id: $shop})-[:HAS_OFFER]->(o:Offer)-[:FOR_PRODUCT]->(:Product {product_id: $product})
        RETURN o.stock_status AS status, toString(o.stock_checked_at) AS checked_at LIMIT 1
        """,
        shop=shop_id, product=product_id,
    )
    return rows[0] if rows and rows[0]["status"] else None


async def start(product_id: str, shop_id: str, phone: str) -> dict:
    mobile = normalize_mobile(phone)
    if not mobile:
        raise InquiryError(422, "شماره موبایل درست نیست. مثل ۰۹۱۲۱۲۳۴۵۶۷ بنویس.")
    info = await asyncio.to_thread(_offer_info, product_id, shop_id)
    if not info:
        raise InquiryError(404, "این فروشگاه این کالا رو نداره.")
    open_now = hours.parse(info["hours_json"])["open_now"]
    if not open_now and not ALLOW_CLOSED:
        raise InquiryError(409, "این فروشگاه الان بسته‌ست؛ استعلام فقط وقتی فروشگاه بازه ممکنه.")
    shop_phones = [p for p in (info["phones"] or []) if p]
    dial = CALL_OVERRIDE or (shop_phones[0] if shop_phones else "")
    if not dial:
        raise InquiryError(409, "شماره‌ی تماسی برای این فروشگاه ثبت نشده.")
    if not voip.configured():
        raise InquiryError(503, "تماس تلفنی روی سرور تنظیم نشده.")

    # One running inquiry per shop + product: a second click joins the first.
    for job in _jobs.values():
        if job["shop_id"] == shop_id and job["product_id"] == product_id and job["status"] not in FINAL:
            return _public(job)

    job = {
        "id": uuid.uuid4().hex[:12],
        "product_id": product_id,
        "product_title": info["title"],
        "shop_id": shop_id,
        "shop_name": info["shop"],
        "offer_id": info["offer_id"],
        "status": "queued",
        "digit": None,
        "reason": None,
        "test_call": bool(CALL_OVERRIDE),
        "created_at": datetime.now(timezone.utc).isoformat(),
        "finished_at": None,
        "sms": None,
        "url": product_url(product_id, shop_id),
        "_mobile": mobile,
        "_dial": dial,
        "_shop_phone": shop_phones[0] if shop_phones else None,
    }
    _jobs[job["id"]] = job
    job["_task"] = asyncio.get_running_loop().create_task(_run(job))
    return _public(job)


async def _run(job: dict) -> None:
    async def set_state(state: str):
        if state in ("ringing", "in_call"):
            job["status"] = state
        elif state == "pressed":
            job["status"] = "in_call"

    try:
        job["status"] = "preparing"
        question, provider = await tts.speak(question_text(job["product_title"]))
        thanks, _ = await tts.speak(THANKS_TEXT, lead_silence=0.2, tail_silence=0.5)
        job["tts"] = provider
        job["status"] = "ringing" if not voip._line.locked() else "queued"
        result = await voip.ask(job["_dial"], question, thanks, on_state=set_state)
        job["reason"] = result.reason
        job["digit"] = result.digit
        job["talk_seconds"] = result.talk_seconds
        if result.digit == "1":
            job["status"] = "available"
        elif result.digit == "2":
            job["status"] = "unavailable"
        elif result.status in ("no_answer", "busy", "answered"):  # answered = no key pressed
            job["status"] = "no_answer"
        else:
            job["status"] = "failed"
        if result.status == "failed":
            log.warning("call failed: %s\n%s", result.reason, "\n".join(result.log_tail[-15:]))
    except Exception as e:
        log.exception("inquiry %s failed", job["id"])
        job["status"], job["reason"] = "failed", str(e)
    job["finished_at"] = datetime.now(timezone.utc).isoformat()

    try:
        await asyncio.to_thread(_save, job)
    except Exception:
        log.exception("could not save inquiry %s", job["id"])

    if job["status"] in ("available", "unavailable"):
        text = sms_text(job)
        r = await asyncio.to_thread(sms.send, job["_mobile"], text)
        job["sms"] = {**r, "text": text}


def _save(job: dict) -> None:
    db.write(
        """
        MATCH (o:Offer {offer_id: $offer_id})
        CREATE (i:Inquiry {inquiry_id: $id, product_id: $product_id, shop_id: $shop_id, status: $status,
                           digit: $digit, reason: $reason, test_call: $test_call, dialed: $dialed,
                           created_at: datetime($created_at), finished_at: datetime($finished_at)})
        CREATE (i)-[:ABOUT]->(o)
        WITH o
        WHERE $status IN ['available', 'unavailable']
        SET o.stock_status = $status, o.stock_checked_at = datetime($finished_at)
        """,
        offer_id=job["offer_id"], id=job["id"], product_id=job["product_id"], shop_id=job["shop_id"],
        status=job["status"], digit=job["digit"], reason=job["reason"], test_call=job["test_call"],
        dialed=job["_dial"], created_at=job["created_at"], finished_at=job["finished_at"],
    )
    log.info("inquiry %s saved: %s", job["id"], job["status"])


def stale(max_age_s: int = 6 * 3600) -> None:
    """Forget finished jobs after a while (results stay in Neo4j)."""
    now = time.time()
    for k, j in list(_jobs.items()):
        if j["status"] in FINAL and j["finished_at"]:
            if now - datetime.fromisoformat(j["finished_at"]).timestamp() > max_age_s:
                _jobs.pop(k, None)
