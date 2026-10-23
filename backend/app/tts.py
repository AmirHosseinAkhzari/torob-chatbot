"""Persian text to a WAV file the phone call can play.

Athena TTS (scripts/athena_tts.py) when a token is set, Edge TTS otherwise or when Athena fails
(Athena's free plan allows only 2 clips a week). Clips are cached by text, so asking the same
question twice costs nothing. Output: 16 kHz mono 16-bit WAV, converted with macOS `afconvert`, else with
the `miniaudio` Python package (the Docker image: no system packages to install), else `ffmpeg` / `mpg123`.
"""
import asyncio
import hashlib
import importlib.util
import logging
import os
import shutil
import subprocess
import urllib.request
import wave
from pathlib import Path

from .config import ROOT

log = logging.getLogger("torob-chat.tts")

CACHE = Path(os.environ.get("TTS_CACHE_DIR") or ROOT / "data" / "inquiry_audio")
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


def _convert_cmd(mp3: Path, wav: Path) -> list[str]:
    """MP3 to 16 kHz mono 16-bit WAV with whichever converter is installed."""
    if shutil.which("afconvert"):  # macOS
        return ["afconvert", "-f", "WAVE", "-d", "LEI16@16000", "-c", "1", str(mp3), str(wav)]
    if shutil.which("ffmpeg"):
        return ["ffmpeg", "-y", "-loglevel", "error", "-i", str(mp3), "-ac", "1", "-ar", "16000",
                "-c:a", "pcm_s16le", str(wav)]
    if shutil.which("mpg123"):
        return ["mpg123", "-q", "--mono", "--rate", "16000", "--encoding", "s16", "-w", str(wav), str(mp3)]
    raise RuntimeError("no audio converter: pip install miniaudio, or install ffmpeg or mpg123")


def _decode(mp3: Path, wav: Path) -> None:
    """MP3 to 16 kHz mono 16-bit WAV."""
    if not shutil.which("afconvert"):
        try:
            import miniaudio
        except ImportError:
            miniaudio = None
        if miniaudio:
            sound = miniaudio.decode_file(str(mp3), output_format=miniaudio.SampleFormat.SIGNED16,
                                          nchannels=1, sample_rate=16000)
            with wave.open(str(wav), "wb") as w:
                w.setnchannels(1)
                w.setsampwidth(2)
                w.setframerate(16000)
                w.writeframes(sound.samples.tobytes())
            return
    subprocess.run(_convert_cmd(mp3, wav), check=True, capture_output=True)


def _to_wav(mp3: Path, wav: Path, lead_silence: float, tail_silence: float) -> None:
    raw = wav.with_suffix(".raw.wav")
    _decode(mp3, raw)
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
