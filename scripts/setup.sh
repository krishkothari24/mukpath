#!/usr/bin/env bash
# One-time setup for the Phase 0 content tools.
#
#   ./scripts/setup.sh
#
# Creates a .venv, installs telethon into it, and seeds .env from the
# template. Safe to re-run. See docs/PHASE0.md for what comes next.

set -euo pipefail

cd "$(dirname "$0")/.."

PY="${PYTHON:-python3}"

# A virtualenv rather than a plain `pip install`: telethon is a one-off
# bootstrapping dependency, not something that belongs in your global or
# conda base environment.
if [[ ! -d .venv ]]; then
  echo "creating .venv"
  "$PY" -m venv .venv
else
  echo ".venv already exists"
fi

./.venv/bin/pip install --quiet --upgrade pip
./.venv/bin/pip install --quiet -r tools/requirements.txt
echo "installed: $(./.venv/bin/pip show telethon | awk '/^Version:/ {print "telethon " $2}')"

if [[ ! -f .env ]]; then
  cp .env.example .env
  echo "created .env from template — fill in TELEGRAM_API_ID and TELEGRAM_API_HASH"
else
  echo ".env already exists, leaving it alone"
fi

if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "note: ffmpeg not found — needed only if the bot sends voice clips"
  echo "      brew install ffmpeg"
fi

cat <<'EOF'

Done. Next:
  1. Fill in .env
  2. source .venv/bin/activate
  3. python3 tools/mukhpath_scraper.py --dry-run
EOF
