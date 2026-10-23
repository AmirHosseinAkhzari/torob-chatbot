# Stage 1: callctl, the SIP call helper the store inquiry drives (callctl/callctl.c).
# Debian has no pjproject package, so pjproject is built from source: SIP over UDP, TCP and TLS
# (OpenSSL), G.711 and telephone-event only, no sound card or video.
FROM python:3.12-slim AS callctl
ARG PJPROJECT_VERSION=2.17
RUN apt-get update && apt-get install -y --no-install-recommends build-essential pkg-config curl ca-certificates libssl-dev \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /src/pjproject
RUN curl -fsSL "https://github.com/pjsip/pjproject/archive/refs/tags/${PJPROJECT_VERSION}.tar.gz" \
      | tar -xz --strip-components=1 \
 && ./configure --prefix=/opt/pjproject CFLAGS="-O2 -fPIC" \
      --with-ssl --disable-video --disable-sound --disable-opus --disable-speex-codec --disable-speex-aec \
      --disable-ilbc-codec --disable-gsm-codec --disable-g722-codec --disable-g7221-codec --disable-l16-codec \
      --disable-libyuv --disable-libwebrtc --disable-ffmpeg --disable-v4l2 --disable-openh264 --disable-vpx \
      --disable-bcg729 --disable-upnp \
 && make dep && make -j"$(nproc)" && make install
COPY callctl/callctl.c /src/callctl.c
RUN cc -O2 -Wall -o /src/callctl /src/callctl.c \
      $(PKG_CONFIG_PATH=/opt/pjproject/lib/pkgconfig pkg-config --cflags --libs --static libpjproject)

# Stage 2: the API. mpg123 turns the TTS MP3 into the WAV the call plays (app/tts.py).
FROM python:3.12-slim
RUN apt-get update && apt-get install -y --no-install-recommends mpg123 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY requirements.txt .
ENV PIP_DEFAULT_TIMEOUT=120
RUN pip install --no-cache-dir -r requirements.txt
COPY app ./app
COPY --from=callctl /src/callctl ./callctl/callctl
# The app folder is not for writing: voice clips are cached in /tmp.
ENV TTS_CACHE_DIR=/tmp/inquiry_audio
EXPOSE 80
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "80", "--proxy-headers", "--forwarded-allow-ips", "*"]
