#!/bin/sh
# Builds callctl for Liara (Linux x86-64) in Docker and writes callctl/dist/callctl-linux-amd64.
# Run it after changing callctl.c, then commit the binary. Needs Docker (on Apple silicon it runs x86-64
# through emulation; the first run compiles pjproject and takes a few minutes).
set -e
cd "$(dirname "$0")/.."
docker build --platform linux/amd64 -f callctl/Dockerfile.build -t torob-callctl-build .
id=$(docker create --platform linux/amd64 torob-callctl-build)
mkdir -p callctl/dist
docker cp "$id:/src/callctl" callctl/dist/callctl-linux-amd64
docker rm "$id" >/dev/null
echo "built $(pwd)/callctl/dist/callctl-linux-amd64"
