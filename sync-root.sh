#!/usr/bin/env bash
# sync-root.sh — keep root index.html in sync with dashboard/index.html
# Usage: ./sync-root.sh
# Run this whenever dashboard/index.html changes, before committing.
set -euo pipefail

REPO="$(cd "$(dirname "$0")" && pwd)"
SRC="$REPO/dashboard/index.html"
DST="$REPO/index.html"

if [ ! -f "$SRC" ]; then
  echo "ERROR: $SRC not found" >&2
  exit 1
fi

cp "$SRC" "$DST"
echo "✓ index.html updated from dashboard/index.html"
