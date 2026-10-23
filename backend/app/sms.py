"""Navatel SMS (same API as Astin core's app/core/integrations/navatel.py).

POST {NAVATEL_BASE_URL}/sms/api/v2/send  {src_phone, message, phones: ["98…"]}, header Authorization: <key>.
With NAVATEL_SEND=false (the default) the message is logged, not sent.
"""
import json
import logging
import os
import urllib.error
import urllib.request

from . import config  # noqa: F401  (loads .env before the settings below are read)

log = logging.getLogger("torob-chat.sms")

BASE_URL = os.environ.get("NAVATEL_BASE_URL", "https://navaphone.com").rstrip("/")
API_KEY = os.environ.get("NAVATEL_API_KEY", "")
SRC_PHONE = os.environ.get("NAVATEL_SRC_PHONE", "")
SEND = os.environ.get("NAVATEL_SEND", "false").lower() in ("1", "true", "yes")


def to_number(phone: str) -> str:
    """09xxxxxxxxx -> 989xxxxxxxxx."""
    digits = "".join(c for c in phone if c.isdigit())
    if digits.startswith("00"):
        digits = digits[2:]
    return digits if digits.startswith("98") else "98" + digits.lstrip("0")


def send(phone: str, text: str) -> dict:
    """{"sent": bool, "to": "98…", "reason": str|None}. Blocking: run it in a thread."""
    to = to_number(phone)
    if not SEND:
        log.info("[NAVATEL] not sent (NAVATEL_SEND=false) to=%s text=%r", to, text)
        return {"sent": False, "to": to, "reason": "test mode (NAVATEL_SEND=false)"}
    if not (API_KEY and SRC_PHONE):
        return {"sent": False, "to": to, "reason": "Navatel is not configured"}
    body = json.dumps({"src_phone": SRC_PHONE, "message": text, "phones": [to]}).encode()
    req = urllib.request.Request(BASE_URL + "/sms/api/v2/send", data=body, method="POST",
                                 headers={"Authorization": API_KEY, "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            doc = json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        return {"sent": False, "to": to, "reason": f"HTTP {e.code}: {e.read()[:200].decode(errors='replace')}"}
    except Exception as e:  # network
        return {"sent": False, "to": to, "reason": str(e)}
    # A 200 whose body says another status (1001 = no credit, 1002 = bad number) did not go.
    code = str(doc.get("status", doc.get("code", 200))) if isinstance(doc, dict) else "200"
    if code != "200":
        return {"sent": False, "to": to, "reason": f"Navatel {code}: {doc.get('message', '')}"}
    return {"sent": True, "to": to, "reason": None}
