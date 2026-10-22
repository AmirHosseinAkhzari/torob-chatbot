"""Shop opening hours from weekly_hours_json. Only days marked 'declared' or 'closed' are trusted;
'unsupported' days hold placeholder times like 08:00-08:00 and are treated as unknown."""
import json
from datetime import datetime
from zoneinfo import ZoneInfo

TEHRAN = ZoneInfo("Asia/Tehran")
DAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]  # Python weekday order
DAY_NAMES = {"sat": "شنبه", "sun": "یکشنبه", "mon": "دوشنبه", "tue": "سه‌شنبه", "wed": "چهارشنبه", "thu": "پنج‌شنبه", "fri": "جمعه"}
WEEK_ORDER = ["sat", "sun", "mon", "tue", "wed", "thu", "fri"]


def _hm(t: str) -> int:
    h, m = t.split(":")[:2]
    return int(h) * 60 + int(m)


def _fmt(t: str) -> str:
    return "۲۴:۰۰" if t[:5] == "00:00" else t[:5]


def _all_day(s: dict) -> bool:
    return s["start_time"][:5] == s["end_time"][:5]


def _shift_text(s: dict) -> str:
    return "شبانه‌روزی" if _all_day(s) else f"{s['start_time'][:5]} تا {_fmt(s['end_time'])}"


def parse(raw: str | None, now: datetime | None = None) -> dict:
    """{open_now: bool|None, today: str|None, week: [{day, text}]}"""
    empty = {"open_now": None, "today": None, "week": []}
    if not raw:
        return empty
    try:
        data = json.loads(raw)
    except (TypeError, ValueError):
        return empty
    now = now or datetime.now(TEHRAN)
    week = []
    for key in WEEK_ORDER:
        day = data.get(key) or {}
        status = day.get("status")
        shifts = day.get("shifts") or []
        if status == "closed":
            text = "تعطیل"
        elif status == "declared" and shifts:
            text = "، ".join(_shift_text(s) for s in shifts)
        else:
            text = None
        week.append({"day": DAY_NAMES[key], "key": key, "text": text})

    today_key = DAY_KEYS[now.weekday()]
    today = data.get(today_key) or {}
    status = today.get("status")
    minutes = now.hour * 60 + now.minute
    open_now, today_text = None, None
    if status == "closed":
        open_now, today_text = False, "امروز تعطیل"
    elif status == "declared":
        open_now = False
        for s in today.get("shifts") or []:
            if _all_day(s):
                open_now, today_text = True, "باز است · شبانه‌روزی"
                break
            start, end = _hm(s["start_time"]), _hm(s["end_time"])
            if end <= start:
                end += 24 * 60
            if start <= minutes < end:
                open_now = True
                today_text = f"باز است · تا {_fmt(s['end_time'])}"
                break
        if not open_now:
            upcoming = [s for s in today.get("shifts") or [] if _hm(s["start_time"]) > minutes]
            today_text = f"بسته است · ساعت {_fmt(upcoming[0]['start_time'])} باز می‌شه" if upcoming else "امروز دیگه باز نمی‌شه"
    if not any(d["text"] for d in week):
        return empty
    return {"open_now": open_now, "today": today_text, "week": week}
