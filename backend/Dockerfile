# The API on Liara. callctl (the SIP call helper) is prebuilt for Linux x86-64 by callctl/build-linux.sh,
# because compiling pjproject on Liara's builder hangs or hits its time limit.
# No system packages: the TTS MP3 is decoded with miniaudio (requirements.txt), so the build only runs pip.
# Liara's PyPI mirror; local builds can pass --build-arg PIP_INDEX_URL=https://pypi.org/simple
FROM python:3.12-slim
ARG PIP_INDEX_URL=https://package-mirror.liara.ir/repository/pypi/simple
WORKDIR /app
COPY requirements.txt .
ENV PIP_DEFAULT_TIMEOUT=120
RUN pip install --no-cache-dir -r requirements.txt
COPY app ./app
COPY callctl/dist/callctl-linux-amd64 ./callctl/callctl
# The app folder is not for writing: voice clips are cached in /tmp.
ENV TTS_CACHE_DIR=/tmp/inquiry_audio
EXPOSE 80
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "80", "--proxy-headers", "--forwarded-allow-ips", "*"]
