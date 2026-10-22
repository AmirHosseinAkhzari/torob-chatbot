"""Outgoing SIP call that plays a question and waits for one key press (DTMF).

Drives the `pjsua` command-line phone (Homebrew: `brew install pjproject`) as a subprocess:
it registers the account, dials, loops the question file into the call, and prints
"Incoming DTMF on call 0: 1" when the shop presses a key. After the key, the thank-you clip
is switched in, then the call hangs up.
"""
import asyncio
import logging
import os
import pty
import re
import shutil
import tempfile
import time
from dataclasses import dataclass, field
from pathlib import Path

from . import config  # noqa: F401  (loads .env before the settings below are read)

log = logging.getLogger("torob-chat.voip")

SIP_SERVER = os.environ.get("VOIP_SERVER", "voip.asiatech.ir")
SIP_USER = os.environ.get("VOIP_USER", "")
SIP_PASSWORD = os.environ.get("VOIP_PASSWORD", "")
PJSUA = os.environ.get("PJSUA_BIN") or shutil.which("pjsua") or "/opt/homebrew/bin/pjsua"

RING_TIMEOUT = 45   # seconds to wait for an answer
ANSWER_TIMEOUT = 60  # seconds to wait for a key after answering

# One line, one call at a time (pjsua also binds the SIP port).
_line = asyncio.Lock()

DTMF_RE = re.compile(r"Incoming DTMF on call \d+: ([0-9*#])")
STATE_RE = re.compile(r"Call \d+ state changed to (\w+)")
DISCONNECTED_RE = re.compile(r"Call \d+ is DISCONNECTED \[reason=(\d+) \(([^)]*)\)\]")
PORT_RE = re.compile(r"Port #(\d+)\[[^\]]*\]\s+(.+?)\s+transmitting")


class _PtyProtocol(asyncio.StreamReaderProtocol):
    """Reading a pty master raises EIO when the child exits: treat it as end of file."""

    def connection_lost(self, exc):
        super().connection_lost(None if isinstance(exc, OSError) else exc)


@dataclass
class CallResult:
    status: str  # answered | no_answer | busy | failed
    digit: str | None = None
    reason: str | None = None
    talk_seconds: float = 0.0
    log_tail: list[str] = field(default_factory=list)


def configured() -> bool:
    return bool(SIP_USER and SIP_PASSWORD and Path(PJSUA).exists())


def dial_uri(number: str) -> str:
    if number.startswith("sip:"):  # a full SIP address, e.g. a local test phone
        return number
    # Same form as the working call.sh: national number with its leading 0, port 5060.
    digits = "".join(c for c in number if c.isdigit())
    if digits.startswith("0098"):
        digits = "0" + digits[4:]
    elif digits.startswith("98") and len(digits) == 12:
        digits = "0" + digits[2:]
    elif not digits.startswith("0"):
        digits = "0" + digits
    return f"sip:{digits}@{SIP_SERVER}:5060"


async def ask(number: str, question_wav: Path, thanks_wav: Path | None, on_state=None,
              valid_digits: str = "12") -> CallResult:
    """Call `number`, loop `question_wav` until a key in `valid_digits` is pressed, return it."""
    async with _line:
        return await _ask(number, question_wav, thanks_wav, on_state, valid_digits)


async def _ask(number, question_wav, thanks_wav, on_state, valid_digits) -> CallResult:
    if not configured():
        return CallResult("failed", reason="VoIP is not configured (VOIP_USER / VOIP_PASSWORD / pjsua)")

    # Credentials go in a private config file, not on the command line (visible in `ps`).
    # pjsua splits that file on spaces, so the clips are copied to a path without any.
    work = Path(tempfile.mkdtemp(prefix="pjsua-"))
    question_wav = Path(shutil.copy(question_wav, work / "question.wav"))
    thanks_wav = Path(shutil.copy(thanks_wav, work / "thanks.wav")) if thanks_wav else None
    fd, cfg_path = tempfile.mkstemp(prefix="pjsua-", suffix=".cfg", dir=work)
    lines = [
        f"--id sip:{SIP_USER}@{SIP_SERVER}",
        f"--registrar sip:{SIP_SERVER}:5060",
        "--reg-timeout 3600",
        "--use-timer 1",
        "--timer-se 1800",
        "--use-srtp 0",
        "--realm *",
        f"--username {SIP_USER}",
        f"--password {SIP_PASSWORD}",
        "--null-audio",
        "--no-tcp",
        "--local-port 0",
        "--max-calls 1",
        f"--play-file {question_wav}",
        f"--duration {ANSWER_TIMEOUT + 15}",
        "--log-level 3",
        "--app-log-level 3",
        "--no-vad",
        "--ec-tail 0",
        # Only G.711 + telephone-event: with every codec the authenticated INVITE passes
        # 1500 bytes, gets fragmented and never reaches Asiatech (408 after 32 s).
        "--dis-codec speex",
        "--dis-codec iLBC",
        "--dis-codec GSM",
        "--dis-codec G722",
        "--clock-rate 8000",
    ]
    if thanks_wav:
        lines.append(f"--play-file {thanks_wav}")
    with os.fdopen(fd, "w") as f:
        f.write("\n".join(lines) + "\n")

    uri = dial_uri(number)
    # pjsua block-buffers its output into a pipe; a pseudo-terminal makes it line-buffered,
    # so the key press is seen the moment it arrives.
    master, slave = pty.openpty()
    proc = await asyncio.create_subprocess_exec(
        PJSUA, "--config-file", cfg_path, uri,
        stdin=asyncio.subprocess.PIPE, stdout=slave, stderr=slave,
    )
    os.close(slave)
    reader = asyncio.StreamReader()
    transport, _ = await asyncio.get_running_loop().connect_read_pipe(
        lambda: _PtyProtocol(reader), os.fdopen(master, "rb", 0))
    tail: list[str] = []
    result = CallResult("no_answer")
    started, answered_at = time.monotonic(), None
    ports: dict[str, int] = {}
    playing = False

    async def send(cmd: str):
        if proc.stdin and not proc.stdin.is_closing():
            proc.stdin.write((cmd + "\n").encode())
            await proc.stdin.drain()

    async def notify(state: str):
        if on_state:
            await on_state(state)

    try:
        log.info("calling %s", uri)
        await notify("ringing")
        while True:
            limit = (answered_at + ANSWER_TIMEOUT) if answered_at else (started + RING_TIMEOUT)
            remaining = limit - time.monotonic()
            if remaining <= 0:
                result.reason = result.reason or ("no key pressed" if answered_at else "no answer")
                break
            try:
                raw = await asyncio.wait_for(reader.readline(), timeout=min(remaining, 1.0))
            except asyncio.TimeoutError:
                continue
            if not raw:
                if result.status == "no_answer" and not result.reason:
                    result.status, result.reason = "failed", "pjsua exited"
                break
            line = raw.decode(errors="replace").rstrip()
            tail = (tail + [line])[-40:]

            if m := PORT_RE.search(line):
                ports[m.group(2).strip()] = int(m.group(1))
                # pjsua's --auto-play only covers incoming calls: connect the question to the call
                # ourselves once `cl` has listed both ports. The player loops until a key is pressed.
                q = _port(ports, question_wav.name)
                call = _port(ports, "sip:")
                if not playing and q is not None and call is not None:
                    await send(f"cc {q} {call}")
                    playing = True
            if m := STATE_RE.search(line):
                state = m.group(1)
                if state == "CONFIRMED" and not answered_at:
                    answered_at = time.monotonic()
                    result.status = "answered"
                    log.info("answered")
                    await notify("in_call")
                    await send("cl")  # list conference ports, to find the thank-you player later
            if m := DISCONNECTED_RE.search(line):
                code, text = int(m.group(1)), m.group(2)
                if not answered_at:
                    result.status = "busy" if code in (486, 600, 603) else ("no_answer" if code in (408, 480, 487) else "failed")
                result.reason = f"{code} {text}"
                break
            if m := DTMF_RE.search(line):
                digit = m.group(1)
                log.info("DTMF %s", digit)
                if digit in valid_digits and result.digit is None:
                    result.digit = digit
                    await notify("pressed")
                    await _play_thanks(send, ports, question_wav, thanks_wav)
                    break
    finally:
        if answered_at:
            result.talk_seconds = round(time.monotonic() - answered_at, 1)
        try:
            await send("ha")
            await asyncio.sleep(0.5)
            await send("q")
            await asyncio.wait_for(proc.wait(), timeout=5)
        except Exception:
            proc.kill()
        transport.close()
        shutil.rmtree(work, ignore_errors=True)
    result.log_tail = tail
    log.info("call to %s: %s digit=%s reason=%s", uri, result.status, result.digit, result.reason)
    return result


def _port(ports: dict[str, int], name: str) -> int | None:
    """Conference port by file name, or the call's port ("sip:")."""
    if name == "sip:":
        return next((p for n, p in ports.items() if n.startswith("sip:")), None)
    return next((p for n, p in ports.items() if n.endswith("/" + name)), None)


async def _play_thanks(send, ports: dict[str, int], question_wav: Path, thanks_wav: Path | None):
    """Swap the looping question for the thank-you clip, let it play, then return (caller hangs up)."""
    q = _port(ports, question_wav.name)
    t = _port(ports, thanks_wav.name) if thanks_wav else None
    call = _port(ports, "sip:")
    if thanks_wav and q is not None and t is not None and call is not None:
        await send(f"cd {q} {call}")
        await send(f"cc {t} {call}")
        import wave  # noqa: PLC0415
        with wave.open(str(thanks_wav)) as w:
            await asyncio.sleep(w.getnframes() / w.getframerate() + 0.3)
    else:
        await asyncio.sleep(0.5)
