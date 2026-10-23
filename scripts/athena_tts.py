#!/usr/bin/env python3
"""Text -> MP3 through Athena's "متن به صدا (TTS)" bot (chat.athenai.app).

Reverse-engineered from the web app; see docs/athena_tts_api.md.
Uses only the standard library.

Auth: set ATHENA_REFRESH_TOKEN (preferred; the script swaps it for a fresh
access token) or ATHENA_ACCESS_TOKEN in the environment or in .env.

    python3 scripts/athena_tts.py "سلام، از ترب تماس می‌گیریم" -v kian -o out.mp3
"""
import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request
import uuid

API = "https://api.athenai.app"
LIBRE = API + "/libre/v1"
TTS_AGENT_ID = "agent_eeMDIFgAZ_x8PUTe-azim"  # "دستیار تولید صدا"
SOUND_MODEL = "tts-athena"
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/130 Safari/537.36"


def load_dotenv(path=".env"):
    if not os.path.exists(path):
        return
    for line in open(path, encoding="utf-8"):
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


def http(method, url, token=None, body=None, stream=False, timeout=60):
    headers = {"User-Agent": UA, "Accept": "application/json",
               "Origin": "https://chat.athenai.app", "Referer": "https://chat.athenai.app/"}
    data = None
    if body is not None:
        data = json.dumps(body).encode()
        headers["Content-Type"] = "application/json"
    if token:
        headers["Authorization"] = "Bearer " + token
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        resp = urllib.request.urlopen(req, timeout=timeout)
    except urllib.error.HTTPError as e:
        raise SystemExit(f"{method} {url} -> {e.code}: {e.read()[:500].decode(errors='replace')}")
    if stream:
        return resp
    raw = resp.read()
    return json.loads(raw) if raw else None


def get_access_token():
    # Access token first: valid for a year and using it doesn't log the browser out.
    token = os.environ.get("ATHENA_ACCESS_TOKEN")
    if token:
        return token
    refresh = os.environ.get("ATHENA_REFRESH_TOKEN")
    if os.path.exists(".athena_refresh_token"):  # newer token from a previous run
        refresh = open(".athena_refresh_token").read().strip() or refresh
    if refresh:
        # Same call the web app makes 60s before the access token expires.
        r = http("POST", API + "/upm/v1/auth/refresh", body={"refreshToken": refresh})
        if r.get("refresh_token") and r["refresh_token"] != refresh:
            # Refresh tokens rotate: keep the new one or the next run fails.
            print("note: refresh token rotated, new value saved to .athena_refresh_token",
                  file=sys.stderr)
            with open(".athena_refresh_token", "w") as f:
                f.write(r["refresh_token"])
        return r["access_token"]
    raise SystemExit("Set ATHENA_ACCESS_TOKEN (the jwtToken cookie) or ATHENA_REFRESH_TOKEN in .env")


def list_voices(token):
    models = http("GET", API + "/chat/v1/sound-models", token)
    tts = next(m for m in models if m["id"] == SOUND_MODEL)
    return tts


def find_audio(obj):
    """Walk any JSON and return the first mp3 attachment filepath."""
    if isinstance(obj, dict):
        if obj.get("context") == "sound_generation" and obj.get("filepath"):
            return obj["filepath"]
        for v in obj.values():
            hit = find_audio(v)
            if hit:
                return hit
    elif isinstance(obj, list):
        for v in obj:
            hit = find_audio(v)
            if hit:
                return hit
    return None


def free_quota(token):
    """Free-plan sound quota: {used, limit, maxChars, resetAtEpochMs, ...}."""
    usage = http("GET", API + "/banker/v1/credit/subscription-usage", token)
    return ((usage or {}).get("freeMedia") or {}).get("sound")


def synthesize(token, text, voice, pace=None, tone=None, timeout=180):
    now = time.time()
    # Mirrors the body the web app sent in a captured request (2026-10-23).
    payload = {
        "text": text,
        "sender": "User",
        "clientTimestamp": time.strftime("%Y-%m-%dT%H:%M:%S", time.localtime(now)),
        "isCreatedByUser": True,
        "parentMessageId": "00000000-0000-0000-0000-000000000000",
        "conversationId": None,  # new conversation; server returns its id
        "messageId": str(uuid.uuid4()),
        "error": False,
        "endpoint": "agents",
        "endpointType": "agents",
        "agent_id": TTS_AGENT_ID,
        "sound_model": SOUND_MODEL,
        "key": time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime(now)),
        "sound_mode": "text-to-speech",
        "sound_voice": voice,  # slug, e.g. "kian"
        "sound_instrumental": False,
        "sound_custom_mode": True,
        "sound_length": len(text),
        "isTemporary": False,
        "isRegenerate": False,
        "isContinued": False,
        "ephemeralAgent": {"artifacts": "auto"},
        "timezone": "Asia/Tehran",
    }
    if pace and pace != "normal":
        payload["sound_pace"] = pace
    if tone:
        payload["sound_tone"] = tone

    # 1) start the job -> {streamId, conversationId, status: "started"}
    start = http("POST", LIBRE + "/api/agents/chat/agents", token, payload)
    convo_id = start.get("conversationId") or start["streamId"]

    # 2) wait until the job is no longer active (the SSE stream 404s once done,
    #    so polling status is simpler and more reliable than reading the stream)
    deadline = time.time() + timeout
    time.sleep(3)
    while time.time() < deadline:
        st = http("GET", f"{LIBRE}/api/agents/chat/status/{convo_id}", token)
        if not (st or {}).get("active"):
            break
        time.sleep(2)
    else:
        raise SystemExit(f"Timed out after {timeout}s (conversation {convo_id})")

    # 3) the reply message carries the mp3 as an attachment
    msgs = http("GET", f"{LIBRE}/api/messages/{convo_id}", token)
    reply = msgs[-1] if msgs else {}
    url = find_audio(reply)
    if not url:
        detail = reply.get("text") or json.dumps(reply.get("content"), ensure_ascii=False)[:800]
        raise SystemExit(f"No audio produced. Bot reply: {detail}")
    return url


def main():
    load_dotenv()
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("text", nargs="?")
    p.add_argument("-v", "--voice", default="kian", help="voice slug, see --list-voices")
    p.add_argument("-o", "--out", default="out.mp3")
    p.add_argument("--pace", choices=["slow", "normal", "fast"])
    p.add_argument("--tone", help="tone key, e.g. serious, warm, happy (see --list-voices)")
    p.add_argument("--list-voices", action="store_true")
    p.add_argument("--quota", action="store_true", help="show free-plan sound quota")
    a = p.parse_args()

    token = get_access_token()
    if a.list_voices:
        tts = list_voices(token)
        for v in tts["voices"]:
            print(f"{v['slug']:10} {v['gender']:6} {v['name']}")
        print("\ntones:", ", ".join(t["key"] for t in tts["toneTags"]))
        print("max chars:", tts["maxInputChars"])
        return
    if a.quota:
        q = free_quota(token)
        if not q:
            print("no free sound quota info (paid plan?)")
        else:
            reset = time.strftime("%Y-%m-%d %H:%M", time.localtime(q["resetAtEpochMs"] / 1000))
            print(f"free TTS: {q['used']}/{q['limit']} used, max {q['maxChars']} chars, resets {reset}")
        return
    if not a.text:
        p.error("text is required")

    q = free_quota(token)
    if q and q.get("maxChars") and len(a.text) > q["maxChars"]:
        raise SystemExit(f"Free plan allows {q['maxChars']} chars; text has {len(a.text)}")

    url = synthesize(token, a.text, a.voice, a.pace, a.tone)
    # The MP3 on s3.metisai.ir is public: no auth header needed.
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req) as r, open(a.out, "wb") as f:
        f.write(r.read())
    print(f"saved {a.out}  ({url})")


if __name__ == "__main__":
    main()
