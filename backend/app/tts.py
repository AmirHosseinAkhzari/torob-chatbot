"""Persian text to a WAV file the phone call can play.

Athena TTS (scripts/athena_tts.py) when a token is set, Edge TTS otherwise or when Athena fails
(Athena's free plan allows only 2 clips a week). Clips are cached by text, so asking the same
question twice costs nothing. Output: 16 kHz mono 16-bit WAV, converted with macOS `afconvert`.
"""
import asyncio
import hashlib
import importlib.util
import logging
import os
import subprocess
import urllib.request
import wave
from pathlib import Path

from .config import ROOT

log = logging.getLogger("torob-chat.tts")

CACHE = ROOT / "data" / "inquiry_audio"
EDGE_VOICE = os.environ.get("EDGE_TTS_VOICE", "fa-IR-FaridNeural")
ATHENA_VOICE = os.environ.get("ATHENA_TTS_VOICE", "kian")
PROVIDER = os.environ.get("TTS_PROVIDER", "auto")  # auto | athena | edge


def _athena_module():
    spec = importlib.util.spec_from_file_location("athena_tts", ROOT / "scripts" / "athena_tts.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _athena_mp3(text: str, out: Path) -> None:
    if not (os.environ.get("ATHENA_ACCESS_TOKEN") or os.environ.get("ATHENA_REFRESH_TOKEN")):
        raise RuntimeError("no Athena token")
    athena = _athena_module()
    try:
        token = athena.get_access_token()
        url = athena.synthesize(token, text, ATHENA_VOICE, tone="warm")
    except SystemExit as e:  # the script reports errors with SystemExit
        raise RuntimeError(str(e)) from None
    req = urllib.request.Request(url, headers={"User-Agent": athena.UA})
    with urllib.request.urlopen(req, timeout=60) as r:
        out.write_bytes(r.read())


async def _edge_mp3(text: str, out: Path) -> None:
    import edge_tts

    await edge_tts.Communicate(text, EDGE_VOICE, rate="-5%").save(str(out))


def _to_wav(mp3: Path, wav: Path, lead_silence: float, tail_silence: float) -> None:
    raw = wav.with_suffix(".raw.wav")
    subprocess.run(["afconvert", "-f", "WAVE", "-d", "LEI16@16000", "-c", "1", str(mp3), str(raw)],
                   check=True, capture_output=True)
    # Pad with silence: the start is often cut while the call connects, and the player loops,
    # so the tail is the pause before the question repeats.
    with wave.open(str(raw)) as src:
        params, frames = src.getparams(), src.readframes(src.getnframes())
    rate, width = params.framerate, params.sampwidth
    pad = lambda sec: b"\x00" * int(rate * sec) * width  # noqa: E731
    with wave.open(str(wav), "wb") as dst:
        dst.setparams(params)
        dst.writeframes(pad(lead_silence) + frames + pad(tail_silence))
    raw.unlink(missing_ok=True)


async def speak(text: str, lead_silence: float = 1.0, tail_silence: float = 2.0) -> tuple[Path, str]:
    """(wav path, provider used) for `text`, from cache when it was made before."""
    CACHE.mkdir(parents=True, exist_ok=True)
    key = hashlib.sha1(f"{text}|{lead_silence}|{tail_silence}".encode()).hexdigest()[:16]
    for provider in ("athena", "edge"):
        cached = CACHE / f"{key}-{provider}.wav"
        if cached.exists():
            return cached, provider

    mp3 = CACHE / f"{key}.mp3"
    used = None
    if PROVIDER in ("auto", "athena"):
        try:
            await asyncio.to_thread(_athena_mp3, text, mp3)
            used = "athena"
        except Exception as e:
            log.warning("Athena TTS failed (%s); falling back to Edge TTS", e)
            if PROVIDER == "athena":
                raise
    if used is None:
        await _edge_mp3(text, mp3)
        used = "edge"

    wav = CACHE / f"{key}-{used}.wav"
    await asyncio.to_thread(_to_wav, mp3, wav, lead_silence, tail_silence)
    mp3.unlink(missing_ok=True)
    return wav, used
