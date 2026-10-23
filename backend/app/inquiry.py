"""استعلام دستگاه: call an open shop and run a short voice script on the keypad, then text the user.

The script (natural, short Persian prompts; keys can cut a prompt short):
  1. availability   «… رو الان موجود دارید؟» 1 yes / 2 no. No → unavailable, done.
  2. price          «قیمتش X تومانه؟» 1 yes → price confirmed. 2 no → step 3.
  3. enter_price    the shop types the price in toman and presses # (* starts over).
  4. confirm_price  the entered price is read back in words: 1 correct → price corrected (saved);
                    2 → enter it again (step 3). Up to 3 entries.
A prompt nobody answers is repeated, then the step gives up: availability → no_answer, price → unverified.
When the shop says the listed price is wrong, the listed price is never kept as confirmed.

Status: queued → preparing → ringing → in_call → available | unavailable | no_answer | failed.
Tracked separately: availability, listed_price, quoted_price, price_status (confirmed | corrected | unverified),
attempts per step. Saved to Neo4j (an :Inquiry on the offer, the offer's stock and phone-checked price) and
to the store insights (Postgres); the result is texted to the account's phone.
"""
import asyncio
import logging
import os
import re
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path

from . import db, hours, numwords, pg, pricing, sms, tts, voip
from .config import settings  # noqa: F401  (loads .env)

log = logging.getLogger("torob-chat.inquiry")

CALL_OVERRIDE = os.environ.get("INQUIRY_CALL_OVERRIDE", "").strip()  # test: every call goes here
APP_URL = os.environ.get("PUBLIC_APP_URL", "http://localhost:3000").rstrip("/")
ALLOW_CLOSED = os.environ.get("INQUIRY_ALLOW_CLOSED", "false").lower() in ("1", "true", "yes")
MOBILE_RE = re.compile(r"^09\d{9}$")
FINAL = {"available", "unavailable", "no_answer", "failed"}

KEY_WAIT = 7          # seconds to wait for a key after a prompt
PROMPT_TRIES = 3      # a question is asked up to this many times before giving up
ENTRY_TRIES = 3       # the price can be typed up to this many times
FIRST_DIGIT_WAIT = 12  # seconds to start typing the price
NEXT_DIGIT_WAIT = 6    # seconds between digits
MAX_PRICE_DIGITS = 12

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
               s.phones AS phones, s.weekly_hours_json AS hours_json, o.offer_id AS offer_id, o.price_toman AS price
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
    return " ".join(t.split(" ")[:9])


# The voice prompts (spoken Persian, short). Keys: یک = 1, دو = 2, مربع = #, ستاره = *.
def prompt_availability(title: str) -> str:
    return (f"سلام، وقت بخیر. از تربچه تماس می‌گیرم. «{spoken_title(title)}» رو الان موجود دارید؟ "
            "اگه دارید یک، اگه ندارید دو رو بزنید.")


def prompt_price(price: int) -> str:
    return f"قیمتش {numwords.toman(price)} است؟ اگه درسته یک، اگه نه دو رو بزنید."


PROMPT_ENTER = "لطفاً قیمت درست رو به تومان با صفحه‌کلید وارد کنید و در آخر، مربع رو بزنید."
PROMPT_ENTER_AGAIN = "لطفاً قیمت رو دوباره وارد کنید و در آخر، مربع رو بزنید."
PROMPT_NOT_HEARD = "متوجه نشدم."
PROMPT_WAIT = "یک لحظه."
PROMPT_THANKS = "ممنون، ثبت شد. روز خوبی داشته باشید."
PROMPT_BYE = "ممنون از وقتی که گذاشتید. روز خوبی داشته باشید."


def prompt_readback(price: int) -> str:
    return f"قیمتی که وارد کردید {numwords.toman(price)} است. اگه درسته یک، اگه می‌خواید دوباره وارد کنید دو رو بزنید."


def product_url(product_id: str, shop_id: str) -> str:
    return f"{APP_URL}/p/{product_id}?shop={shop_id}"


def sms_text(job: dict) -> str:
    title = spoken_title(job["product_title"])
    if job["status"] == "available":
        head = f"خبر خوب! «{title}» در فروشگاه «{job['shop_name']}» موجود است."
        if job["price_status"] in ("confirmed", "corrected") and job["quoted_price"]:
            price = f"{job['quoted_price']:,}".replace(",", "٬").translate(str.maketrans("0123456789", "۰۱۲۳۴۵۶۷۸۹"))
            head += f"\nقیمت تلفنی: {price} تومان"
        tail = f"مسیریابی و اسنپ تا فروشگاه:\n{product_url(job['product_id'], job['shop_id'])}"
    else:
        head = f"«{title}» الان در فروشگاه «{job['shop_name']}» موجود نیست."
        tail = f"فروشگاه‌های دیگر را ببینید:\n{product_url(job['product_id'], job['shop_id'])}"
    return f"تربچه\n{head}\n{tail}"


def _public(job: dict) -> dict:
    return {k: v for k, v in job.items() if not k.startswith("_")}


def get(inquiry_id: str) -> dict | None:
    job = _jobs.get(inquiry_id)
    return _public(job) if job else None


async def start(product_id: str, shop_id: str, phone: str, user_id: int | None = None) -> dict:
    mobile = normalize_mobile(phone)
    if not mobile:
        raise InquiryError(422, "شماره موبایل حسابت درست نیست.")
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

    listed = info["price"]
    job = {
        "id": uuid.uuid4().hex[:12],
        "product_id": product_id,
        "product_title": info["title"],
        "shop_id": shop_id,
        "shop_name": info["shop"],
        "offer_id": info["offer_id"],
        "status": "queued",
        "step": None,
        "availability": None,          # available | unavailable | None (no answer)
        "listed_price": int(listed) if listed and listed >= pricing.MIN_VALID_PRICE else None,
        "quoted_price": None,
        "price_status": None,          # confirmed | corrected | unverified
        "attempts": {"availability": 0, "price": 0, "enter_price": 0, "confirm_price": 0},
        "digit": None,
        "reason": None,
        "test_call": bool(CALL_OVERRIDE),
        "created_at": datetime.now(timezone.utc).isoformat(),
        "finished_at": None,
        "sms": None,
        "url": product_url(product_id, shop_id),
        "_mobile": mobile,
        "_dial": dial,
        "_user_id": user_id,
    }
    _jobs[job["id"]] = job
    job["_task"] = asyncio.get_running_loop().create_task(_run(job))
    return _public(job)


async def _clip(text: str, first: bool = False) -> Path:
    path, _ = await tts.speak(text, lead_silence=0.6 if first else 0.15, tail_silence=0.25)
    return path


async def _ask(call: voip.Call, job: dict, step: str, clip: Path, valid: str = "12") -> str | None:
    """Play a yes/no prompt (a key cuts it short) and wait for 1 or 2; repeat it if nobody answers."""
    job["step"] = step
    for _ in range(PROMPT_TRIES):
        job["attempts"][step] += 1
        call.flush_keys()
        await call.play(clip, stop_on_key=True)
        deadline = time.monotonic() + KEY_WAIT
        while time.monotonic() < deadline:
            k = await call.key(max(0.1, deadline - time.monotonic()))
            if k is None:
                break
            if k in valid:
                return k
            # another key: ignore it and keep waiting for 1 or 2
    return None


async def _read_price(call: voip.Call) -> int | None:
    """Digits until #; * clears. None when nothing (valid) was typed in time."""
    digits = ""
    wait = FIRST_DIGIT_WAIT
    while True:
        k = await call.key(wait)
        if k is None:
            return None
        if k == "#":
            break
        if k == "*":
            digits, wait = "", FIRST_DIGIT_WAIT
            continue
        if k.isdigit():
            digits += k
            wait = NEXT_DIGIT_WAIT
            if len(digits) > MAX_PRICE_DIGITS:
                return None
    n = int(digits) if digits else 0
    return n if n >= pricing.MIN_VALID_PRICE else None


async def _price_entry(call: voip.Call, job: dict, clips: dict) -> None:
    """Steps 3-4: type the price, hear it back in words, confirm (or type it again)."""
    for attempt in range(ENTRY_TRIES):
        job["step"] = "enter_price"
        job["attempts"]["enter_price"] += 1
        call.flush_keys()
        await call.play(clips["enter"] if attempt == 0 else clips["enter_again"], stop_on_key=True)
        price = await _read_price(call)
        if price is None:
            await call.play(clips["not_heard"])
            continue
        # Read it back. Making the clip takes a moment: say «یک لحظه» meanwhile.
        making = asyncio.create_task(_clip(prompt_readback(price)))
        await call.play(clips["wait"])
        readback = await making
        answer = await _ask(call, job, "confirm_price", readback)
        if answer == "1":
            job["quoted_price"], job["price_status"] = price, "corrected"
            return
        if answer is None:
            break
        # 2: enter it again
    job["price_status"] = "unverified"


async def _run(job: dict) -> None:
    try:
        job["status"] = "preparing"
        title = job["product_title"]
        texts = {
            "availability": (prompt_availability(title), True),
            "enter": (PROMPT_ENTER, False), "enter_again": (PROMPT_ENTER_AGAIN, False),
            "not_heard": (PROMPT_NOT_HEARD, False), "wait": (PROMPT_WAIT, False),
            "thanks": (PROMPT_THANKS, False), "bye": (PROMPT_BYE, False),
        }
        if job["listed_price"]:
            texts["price"] = (prompt_price(job["listed_price"]), False)
        made = await asyncio.gather(*(_clip(t, first) for t, first in texts.values()))
        clips = dict(zip(texts.keys(), made))

        job["status"] = "ringing"
        async with voip.Call(job["_dial"]) as call:
            if not await call.answered():
                code = call.end_code
                job["reason"] = call.end_reason or "no answer"
                job["status"] = "no_answer" if code in (None, 408, 480, 486, 487, 600, 603) else "failed"
                if job["status"] == "failed":
                    log.warning("call failed: %s\n%s", call.end_reason, "\n".join(call.log_tail[-10:]))
            else:
                job["status"] = "in_call"
                try:
                    k = await _ask(call, job, "availability", clips["availability"])
                    job["digit"] = k
                    if k is None:
                        job["status"], job["reason"] = "no_answer", "no key pressed"
                    elif k == "2":
                        job["availability"] = "unavailable"
                        await call.play(clips["bye"])
                        job["status"] = "unavailable"
                    else:
                        job["availability"] = "available"
                        if job["listed_price"]:
                            p = await _ask(call, job, "price", clips["price"])
                            if p == "1":
                                job["quoted_price"], job["price_status"] = job["listed_price"], "confirmed"
                            elif p == "2":
                                await _price_entry(call, job, clips)
                            else:
                                job["price_status"] = "unverified"
                        else:
                            await _price_entry(call, job, clips)
                        await call.play(clips["thanks"])
                        job["status"] = "available"
                except voip.Hangup as e:
                    # Hung up mid-script: keep what was already answered.
                    job["reason"] = f"hung up: {e}"
                    if job["availability"] == "available":
                        job["status"] = "available"
                        job["price_status"] = job["price_status"] or "unverified"
                    elif job["availability"] == "unavailable":
                        job["status"] = "unavailable"
                    else:
                        job["status"] = "no_answer"
                job["talk_seconds"] = call.talk_seconds
    except Exception as e:
        log.exception("inquiry %s failed", job["id"])
        job["status"], job["reason"] = "failed", str(e)
    job["step"] = None
    job["finished_at"] = datetime.now(timezone.utc).isoformat()
    log.info("inquiry %s: %s availability=%s price=%s/%s attempts=%s", job["id"], job["status"], job["availability"],
             job["price_status"], job["quoted_price"], job["attempts"])

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
                           availability: $availability, listed_price: $listed, quoted_price: $quoted,
                           price_status: $price_status, attempts: $attempts, reason: $reason,
                           test_call: $test_call, dialed: $dialed,
                           created_at: datetime($created_at), finished_at: datetime($finished_at)})
        CREATE (i)-[:ABOUT]->(o)
        WITH o
        WHERE $status IN ['available', 'unavailable']
        SET o.stock_status = $status, o.stock_checked_at = datetime($finished_at),
            o.price_status = CASE WHEN $status = 'available' THEN $price_status ELSE null END,
            o.verified_price_toman = CASE WHEN $price_status IN ['confirmed', 'corrected'] THEN $quoted ELSE null END,
            o.price_checked_at = CASE WHEN $price_status IN ['confirmed', 'corrected'] THEN datetime($finished_at) ELSE o.price_checked_at END
        """,
        offer_id=job["offer_id"], id=job["id"], product_id=job["product_id"], shop_id=job["shop_id"],
        status=job["status"], availability=job["availability"], listed=job["listed_price"], quoted=job["quoted_price"],
        price_status=job["price_status"], attempts=[job["attempts"][k] for k in ("availability", "price", "enter_price", "confirm_price")],
        reason=job["reason"], test_call=job["test_call"], dialed=job["_dial"],
        created_at=job["created_at"], finished_at=job["finished_at"],
    )
    # Store insights: what the shop said on the phone (stale listed prices show up here).
    pg.run(
        "INSERT INTO store_events (user_id, kind, product_id, shop_id, offer_id, reasons, detail) "
        "VALUES (%s, 'phone_check', %s, %s, %s, %s, %s)",
        (job["_user_id"], job["product_id"], job["shop_id"], job["offer_id"],
         [r for r in (job["availability"], job["price_status"],
                      "listed_price_wrong" if job["price_status"] == "corrected" else None) if r],
         pg.jsonb({"status": job["status"], "listed_price": job["listed_price"], "quoted_price": job["quoted_price"],
                   "attempts": job["attempts"], "test_call": job["test_call"]})),
    )
    log.info("inquiry %s saved: %s", job["id"], job["status"])


def stale(max_age_s: int = 6 * 3600) -> None:
    """Forget finished jobs after a while (results stay in Neo4j)."""
    now = time.time()
    for k, j in list(_jobs.items()):
        if j["status"] in FINAL and j["finished_at"]:
            if now - datetime.fromisoformat(j["finished_at"]).timestamp() > max_age_s:
                _jobs.pop(k, None)
