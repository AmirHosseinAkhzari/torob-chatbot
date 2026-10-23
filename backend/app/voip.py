"""One outgoing SIP call, driven step by step: play a clip, wait for keys, play the next one.

Uses callctl (backend/callctl, built on pjsua: `backend/callctl/build.sh`). It dials, reports the call state
and every key pressed (DTMF), and plays a WAV into the call when told to, so the inquiry can run a voice
script with clips made during the call (a price read back to the shop).
"""
import asyncio
import logging
import os
import shutil
import tempfile
import time
import wave
from pathlib import Path

from . import config  # noqa: F401  (loads .env before the settings below are read)

log = logging.getLogger("torob-chat.voip")

SIP_SERVER = os.environ.get("VOIP_SERVER", "voip.asiatech.ir")
SIP_USER = os.environ.get("VOIP_USER", "")
SIP_PASSWORD = os.environ.get("VOIP_PASSWORD", "")
# udp, tcp or tls. Navaphone is TLS only (port 5061), and Liara lets no SIP out over UDP anyway.
SIP_TRANSPORT = os.environ.get("VOIP_TRANSPORT", "udp").strip().lower()
SIP_PORT = int(os.environ.get("VOIP_PORT") or (5061 if SIP_TRANSPORT == "tls" else 5060))
SIP_STUN = os.environ.get("VOIP_STUN", "").strip()        # host:port, for the public audio address behind NAT
# off | optional | mandatory. Over tls, encrypted audio is offered like call.sh (--use-srtp 1).
SIP_SRTP = (os.environ.get("VOIP_SRTP") or ("optional" if SIP_TRANSPORT == "tls" else "off")).strip().lower()
CALLCTL = os.environ.get("CALLCTL_BIN") or str(Path(__file__).resolve().parents[1] / "callctl" / "callctl")

RING_TIMEOUT = 45  # seconds to wait for an answer

# One line, one call at a time.
_line = asyncio.Lock()


def configured() -> bool:
    return bool(SIP_USER and SIP_PASSWORD and Path(CALLCTL).exists())


def dial_uri(number: str) -> str:
    if number.startswith("sip:"):  # a full SIP address, e.g. a local test phone
        return number
    # Same form as the working call.sh: national number with its leading 0.
    digits = "".join(c for c in number if c.isdigit())
    if digits.startswith("0098"):
        digits = "0" + digits[4:]
    elif digits.startswith("98") and len(digits) == 12:
        digits = "0" + digits[2:]
    elif not digits.startswith("0"):
        digits = "0" + digits
    if SIP_TRANSPORT in ("tcp", "tls"):  # the call goes through the server as outbound proxy (callctl)
        return f"sip:{digits}@{SIP_SERVER}"
    return f"sip:{digits}@{SIP_SERVER}:{SIP_PORT}"


def _ca_bundle() -> str:
    """CA certificates for checking the SIP server's TLS certificate."""
    try:
        import certifi
        return certifi.where()
    except ImportError:
        import ssl
        return ssl.get_default_verify_paths().cafile or ""


def wav_seconds(path: Path) -> float:
    with wave.open(str(path)) as w:
        return w.getnframes() / w.getframerate()


class Hangup(Exception):
    """The other side hung up (or the call failed) in the middle of the script."""


class Call:
    """A live call. Use `async with Call(number) as call:`; then `await call.answered()`, `play`, `key`."""

    def __init__(self, number: str, debug_log: Path | None = None, dtmf: str = "rfc2833"):
        self.uri = dial_uri(number)
        self.debug_log = debug_log       # full SIP log of this call only (voiptest.py)
        self.dtmf = dtmf                 # rfc2833 (keys in the audio) or info (ask for SIP INFO)
        self.remote_rtp: str | None = None
        self.proc: asyncio.subprocess.Process | None = None
        self.work = Path(tempfile.mkdtemp(prefix="callctl-"))
        self.keys_q: asyncio.Queue[str] = asyncio.Queue()
        self.confirmed = asyncio.Event()
        self.media = asyncio.Event()
        self.ended = asyncio.Event()
        self.playend = asyncio.Event()
        self.end_code: int | None = None
        self.end_reason: str | None = None
        self.answered_at: float | None = None
        self.log_tail: list[str] = []
        self.keys_seen: list[str] = []   # e.g. ["1 rfc2833"]
        self.stats: str | None = None    # audio packet counts from callctl
        self._reader: asyncio.Task | None = None

    async def __aenter__(self):
        await _line.acquire()
        cfg = self.work / "account.cfg"
        lines = [f"server {SIP_SERVER}", f"user {SIP_USER}", f"password {SIP_PASSWORD}",
                 f"transport {SIP_TRANSPORT}", f"port {SIP_PORT}", f"srtp {SIP_SRTP}", f"dtmf {self.dtmf}"]
        if SIP_TRANSPORT == "tls" and (ca := _ca_bundle()):
            lines.append(f"ca {ca}")
        if SIP_STUN:
            lines.append(f"stun {SIP_STUN}")
        cfg.write_text("\n".join(lines) + "\n", encoding="utf-8")
        os.chmod(cfg, 0o600)
        env = None
        if self.debug_log:
            env = {**os.environ, "CALLCTL_LOG": str(self.debug_log)}
        self.proc = await asyncio.create_subprocess_exec(
            CALLCTL, str(cfg), self.uri,
            stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT,
            env=env,
        )
        self._reader = asyncio.create_task(self._read())
        log.info("calling %s", self.uri)
        return self

    async def __aexit__(self, *exc):
        try:
            await self._send("HANGUP")
            await asyncio.wait_for(self.proc.wait(), timeout=5)
        except Exception:
            if self.proc and self.proc.returncode is None:
                self.proc.kill()
        if self._reader:  # let it read the last lines (STATS) before the helper's output closes
            try:
                await asyncio.wait_for(asyncio.shield(self._reader), timeout=2)
            except (asyncio.TimeoutError, asyncio.CancelledError):
                pass
            self._reader.cancel()
        if self.answered_at:  # what reached us: no audio packets means no RFC 2833 keys either
            log.info("call ended (%s): audio %s, keys %s", self.end_reason or "hung up", self.stats or "no stats",
                     self.keys_seen or "none")
        shutil.rmtree(self.work, ignore_errors=True)
        _line.release()
        return False

    async def _read(self):
        assert self.proc and self.proc.stdout
        while True:
            raw = await self.proc.stdout.readline()
            if not raw:
                if not self.ended.is_set():
                    self.end_reason = self.end_reason or "helper exited"
                    self.ended.set()
                    self.playend.set()
                return
            line = raw.decode(errors="replace").strip()
            self.log_tail = (self.log_tail + [line])[-40:]
            if line.startswith("DTMF "):
                self.keys_q.put_nowait(line[5:6])
                self.keys_seen.append(line[5:])
            elif line.startswith("STATS "):
                self.stats = line[6:]
            elif line.startswith("REMOTE_RTP "):
                self.remote_rtp = line[11:]
            elif line == "PLAYEND":
                self.playend.set()
            elif line == "MEDIA":
                self.media.set()
            elif line.startswith("STATE CONFIRMED"):
                self.answered_at = time.monotonic()
                self.confirmed.set()
            elif line.startswith("DISCONNECTED"):
                parts = line.split(" ", 2)
                self.end_code = int(parts[1]) if len(parts) > 1 and parts[1].isdigit() else None
                self.end_reason = f"{parts[1]} {parts[2]}" if len(parts) > 2 else line
                self.ended.set()
                self.playend.set()

    async def _send(self, cmd: str):
        if self.proc and self.proc.stdin and not self.proc.stdin.is_closing():
            self.proc.stdin.write((cmd + "\n").encode())
            await self.proc.stdin.drain()

    async def answered(self, timeout: float = RING_TIMEOUT) -> bool:
        """True once the shop picks up and audio flows; False if it rings out, is busy or fails."""
        waiters = [asyncio.create_task(self.confirmed.wait()), asyncio.create_task(self.ended.wait())]
        await asyncio.wait(waiters, timeout=timeout, return_when=asyncio.FIRST_COMPLETED)
        for w in waiters:
            w.cancel()
        if self.ended.is_set() or not self.confirmed.is_set():
            return False
        try:
            await asyncio.wait_for(self.media.wait(), timeout=5)
        except asyncio.TimeoutError:
            return False
        await asyncio.sleep(0.4)  # let audio settle before the first word
        return True

    def flush_keys(self):
        while not self.keys_q.empty():
            self.keys_q.get_nowait()

    async def play(self, clip: Path, stop_on_key: bool = False) -> None:
        """Play a clip to the end. With stop_on_key, a key pressed meanwhile cuts it short (the key stays queued)."""
        if self.ended.is_set():
            raise Hangup(self.end_reason)
        self.playend.clear()
        await self._send(f"PLAY {clip}")
        limit = wav_seconds(clip) + 1.5
        start = time.monotonic()
        while time.monotonic() - start < limit:
            if self.ended.is_set():
                raise Hangup(self.end_reason)
            if self.playend.is_set():
                return
            if stop_on_key and not self.keys_q.empty():
                await self._send("STOP")
                return
            await asyncio.sleep(0.05)

    async def key(self, timeout: float) -> str | None:
        """The next key pressed within `timeout` seconds, or None."""
        if self.ended.is_set() and self.keys_q.empty():
            raise Hangup(self.end_reason)
        try:
            return await asyncio.wait_for(self.keys_q.get(), timeout=timeout)
        except asyncio.TimeoutError:
            if self.ended.is_set():
                raise Hangup(self.end_reason)
            return None

    @property
    def talk_seconds(self) -> float:
        return round(time.monotonic() - self.answered_at, 1) if self.answered_at else 0.0
