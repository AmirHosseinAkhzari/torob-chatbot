"""Login with a one-time code by SMS (Navatel), accounts and sessions in Postgres.

POST /api/auth/otp/request {phone} -> texts a 5-digit code. With NAVATEL_SEND=false the code is only logged
(and returned as dev_code) so the page can be tested without SMS credit.
POST /api/auth/otp/verify {phone, code} -> {token, phone, settings}; the token is a bearer token.
Codes and tokens are stored only as sha256 hashes.
"""
import hashlib
import logging
import secrets
from datetime import datetime, timedelta, timezone

from . import pg, sms

log = logging.getLogger("torob-chat.auth")

CODE_TTL = timedelta(minutes=2)
RESEND_AFTER = timedelta(seconds=60)
MAX_TRIES = 5
MAX_CODES_PER_HOUR = 5
SESSION_TTL = timedelta(days=90)
THEMES = {"system", "light", "dark"}


class AuthError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status, self.message = status, message


def _h(v: str) -> str:
    return hashlib.sha256(v.encode()).hexdigest()


def _now() -> datetime:
    return datetime.now(timezone.utc)


def request_code(mobile: str) -> dict:
    now = _now()
    old = pg.one("SELECT sent_at FROM otp_codes WHERE phone = %s", (mobile,))
    if old and now - old["sent_at"] < RESEND_AFTER:
        wait = int((RESEND_AFTER - (now - old["sent_at"])).total_seconds())
        raise AuthError(429, f"کد قبلی هنوز معتبره؛ {wait} ثانیه‌ی دیگه دوباره امتحان کن.")
    recent = pg.one(
        "SELECT count(*) AS n FROM otp_sends WHERE phone = %s AND sent_at > now() - interval '1 hour'",
        (mobile,),
    )
    if recent and recent["n"] >= MAX_CODES_PER_HOUR:
        raise AuthError(429, "برای این شماره زیاد کد گرفتی؛ یه ساعت دیگه دوباره امتحان کن.")
    code = f"{secrets.randbelow(100000):05d}"
    result = sms.send(mobile, f"تربچه\nکد ورود شما: {code}\nاین کد را به کسی ندهید.")
    if sms.SEND and not result["sent"]:
        log.warning("OTP SMS to %s failed: %s", mobile, result["reason"])
        raise AuthError(502, "پیامک ارسال نشد؛ چند دقیقه‌ی دیگه دوباره امتحان کن.")
    pg.run(
        "INSERT INTO otp_codes (phone, code_hash, sent_at, tries) VALUES (%s, %s, now(), 0) "
        "ON CONFLICT (phone) DO UPDATE SET code_hash = EXCLUDED.code_hash, sent_at = now(), tries = 0",
        (mobile, _h(code)),
    )
    pg.run("INSERT INTO otp_sends (phone) VALUES (%s)", (mobile,))
    out = {"sent": result["sent"], "resend_after": int(RESEND_AFTER.total_seconds()), "ttl": int(CODE_TTL.total_seconds())}
    if not sms.SEND:
        log.info("[test mode] login code for %s: %s", mobile, code)
        out["dev_code"] = code
    return out


def verify_code(mobile: str, code: str) -> dict:
    row = pg.one("SELECT code_hash, sent_at, tries FROM otp_codes WHERE phone = %s", (mobile,))
    if not row or _now() - row["sent_at"] > CODE_TTL:
        raise AuthError(410, "کد منقضی شده؛ دوباره کد بگیر.")
    if row["tries"] >= MAX_TRIES:
        pg.run("DELETE FROM otp_codes WHERE phone = %s", (mobile,))
        raise AuthError(429, "چند بار اشتباه زدی؛ دوباره کد بگیر.")
    pg.run("UPDATE otp_codes SET tries = tries + 1 WHERE phone = %s", (mobile,))
    if not secrets.compare_digest(row["code_hash"], _h(code)):
        raise AuthError(401, "کد درست نیست.")
    pg.run("DELETE FROM otp_codes WHERE phone = %s", (mobile,))
    user = pg.one(
        "INSERT INTO users (phone, last_login_at) VALUES (%s, now()) "
        "ON CONFLICT (phone) DO UPDATE SET last_login_at = now() RETURNING id, phone, settings",
        (mobile,),
    )
    token = secrets.token_urlsafe(32)
    pg.run("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (%s, %s, %s)",
           (_h(token), user["id"], _now() + SESSION_TTL))
    return {"token": token, "phone": user["phone"], "settings": user["settings"]}


def user_for_token(token: str | None) -> dict | None:
    if not token:
        return None
    row = pg.one(
        "UPDATE sessions SET last_seen_at = now() WHERE token_hash = %s AND expires_at > now() "
        "RETURNING user_id",
        (_h(token),),
    )
    if not row:
        return None
    return pg.one("SELECT id, phone, settings FROM users WHERE id = %s", (row["user_id"],))


def logout(token: str) -> None:
    pg.run("DELETE FROM sessions WHERE token_hash = %s", (_h(token),))


def save_settings(user_id: int, theme: str | None) -> dict:
    patch = {}
    if theme is not None:
        if theme not in THEMES:
            raise AuthError(422, "theme must be system, light or dark")
        patch["theme"] = theme
    row = pg.one("UPDATE users SET settings = settings || %s WHERE id = %s RETURNING settings", (pg.jsonb(patch), user_id))
    return row["settings"]
