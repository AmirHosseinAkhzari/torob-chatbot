#!/bin/sh
# Builds callctl (the SIP call helper the store inquiry drives) against Homebrew's pjproject.
#   brew install pjproject && backend/callctl/build.sh
set -e
cd "$(dirname "$0")"
SSL="$(brew --prefix openssl@4 2>/dev/null || brew --prefix openssl@3)"
cc -O2 -Wall -o callctl callctl.c -L"$SSL/lib" $(pkg-config --cflags --libs --static libpjproject)
echo "built $(pwd)/callctl"
