"""VoIP test call: rings a phone, asks for a few keys and #, and reports what reached the backend.

    ../.venv/bin/python -m app.voiptest 09121234567    (from backend/: prints the report)
    ../.venv/bin/python -m app.voiptest 09121234567 info
    POST /api/voip-test[?dtmf=info]                     (rings the logged-in account's own phone)

The report says whether the call was answered, every key that arrived and how (RFC 2833 inside the audio,
or SIP INFO), the audio packet counts, where the other side wants our audio, and the useful lines of the
call's SIP log (sign-in headers left out). Keys sent as RFC 2833 travel in the audio (RTP, UDP), so with
no audio packets received, no key can arrive that way.
"""
import asyncio
import json
import logging
import re
import shutil
import sys
import tempfile
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path

from . import tts, voip

log = logging.getLogger("torob-chat.voiptest")

PROMPT = "سَلام، این یِک تَماسِ آزمایِشیِ تُرُبچه اَست. لُطفاً چَند کِلید بِزَنید، مَثَلاً یِک، دو، سه، و دَر آخَر مُرَبَّع رو بِزَنید."
THANKS = "مَمنون، تِست تَمام شُد. خُداحافِظ."
KEY_WINDOW = 30  # seconds to press keys after the prompt

_KEEP = re.compile(r"RX \d+ bytes (Response|Request) msg|TX \d+ bytes Request msg (INVITE|INFO)|^m=audio|^c=IN"
                   r"|telephone-event|^a=crypto|SRTP status|Received DTMF|switch|RTP.*(timeout|error)"
                   r"|TLS connect|Request msg INFO")
_DROP = re.compile(r"authorization|nonce|response=|password", re.I)
_SECRET = re.compile(r"inline:\S+")  # SRTP keys in the SDP

_tests: dict[str, dict] = {}


def _sip_excerpt(path: Path, limit: int = 80) -> list[str]:
    if not path.exists():
        return []
    out: list[str] = []
    for raw in path.read_text(encoding="utf-8", errors="replace").splitlines():
        line = raw.strip()
        if not line or not _KEEP.search(line) or _DROP.search(line):
            continue
        line = _SECRET.sub("inline:***", line)[:220]
        if not out or out[-1] != line:
            out.append(line)
    return out[-limit:]


def _rx_packets(stats: str | None) -> int | None:
    m = re.search(r"rx_pkt=(\d+)", stats or "")
    return int(m.group(1)) if m else None


def _verdict(r: dict) -> str:
    if not r["answered"]:
        return f"not answered ({r.get('end_reason') or 'no answer'})"
    if r["keys"]:
        how = sorted({k.split(" ", 1)[1] for k in r["keys"] if " " in k})
        return f"keys received ({', '.join(how) or 'unknown method'})"
    rx = _rx_packets(r.get("audio"))
    if rx == 0:
        return ("answered, but no audio packet reached the backend: the audio from the phone side (and the "
                "RFC 2833 keys in it) does not get through")
    if rx:
        return f"audio arrives ({rx} packets) but no key event: the keys are not sent as RFC 2833 or SIP INFO"
    return "answered, no key received (no audio statistics)"


async def run(number: str, dtmf: str | None = None) -> dict:
    """dtmf: rfc2833 (keys inside the audio) or info (telephone-event left out of the offer); default VOIP_DTMF."""
    dtmf = dtmf or voip.SIP_DTMF
    report: dict = {"number": number, "dtmf_offer": dtmf, "server": voip.SIP_SERVER, "transport": voip.SIP_TRANSPORT,
                    "srtp": voip.SIP_SRTP, "started_at": datetime.now(timezone.utc).isoformat(),
                    "answered": False, "keys": [], "audio": None, "remote_rtp": None, "end_reason": None}
    work = Path(tempfile.mkdtemp(prefix="voiptest-"))
    trace = work / "sip.log"
    t0 = time.monotonic()
    call = None
    try:
        prompt, _ = await tts.speak(PROMPT, 1.0, 1.0)
        thanks, _ = await tts.speak(THANKS, 0.3, 0.5)
        async with voip.Call(number, debug_log=trace, dtmf=dtmf) as call:
            if await call.answered(timeout=45):
                report["answered"] = True
                await call.play(prompt)  # keys pressed meanwhile stay queued
                end = time.monotonic() + KEY_WINDOW
                while (left := end - time.monotonic()) > 0:
                    k = await call.key(timeout=left)
                    if k is None or k == "#":
                        break
                await call.play(thanks)
    except voip.Hangup:
        pass
    except Exception as e:  # report it instead of failing the request
        report["error"] = f"{type(e).__name__}: {e}"
    finally:
        if call:
            report.update(keys=call.keys_seen, audio=call.stats, remote_rtp=call.remote_rtp,
                          end_reason=call.end_reason)
        report["seconds"] = round(time.monotonic() - t0, 1)
        report["sip"] = _sip_excerpt(trace)
        shutil.rmtree(work, ignore_errors=True)
    report["verdict"] = _verdict(report)
    log.info("voip test %s", json.dumps({k: v for k, v in report.items() if k != "sip"}, ensure_ascii=False))
    return report


def start(phone: str, dtmf: str | None = None) -> dict:
    """Start a test call to `phone` in the background; poll get(id)."""
    dtmf = dtmf if dtmf in ("info", "rfc2833") else voip.SIP_DTMF
    test_id = uuid.uuid4().hex[:12]
    job = {"id": test_id, "phone": phone, "status": "running", "report": None}
    _tests[test_id] = job

    async def go():
        try:
            job["report"] = await run(phone, dtmf)
        finally:
            job["status"] = "done"

    asyncio.create_task(go())
    return {"id": test_id, "status": "running", "dtmf_offer": dtmf}


def get(test_id: str) -> dict | None:
    return _tests.get(test_id)


if __name__ == "__main__":
    logging.basicConfig(level=logging.WARNING)
    if len(sys.argv) not in (2, 3):
        sys.exit("usage: python -m app.voiptest <phone number> [rfc2833|info]")
    print(json.dumps(asyncio.run(run(sys.argv[1], sys.argv[2] if len(sys.argv) == 3 else None)),
                     ensure_ascii=False, indent=2))
