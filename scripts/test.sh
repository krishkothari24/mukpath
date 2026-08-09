#!/usr/bin/env bash
# Run every Phase 0 tool test.
#
#   ./scripts/test.sh
#
# Prefers .venv/bin/python so tests/test_navigate.py (which needs telethon
# importable) actually runs; it skips itself cleanly otherwise.

set -uo pipefail

cd "$(dirname "$0")/.."

PY=python3
[[ -x .venv/bin/python ]] && PY=.venv/bin/python

failed=0
for test in tests/test_*.py; do
  printf '%-28s ' "$(basename "$test")"
  if ! "$PY" "$test"; then
    failed=$((failed + 1))
  fi
done

if [[ $failed -gt 0 ]]; then
  echo "$failed suite(s) failed"
  exit 1
fi
echo "all suites passed"
