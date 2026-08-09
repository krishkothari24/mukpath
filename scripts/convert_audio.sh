#!/usr/bin/env bash
# Convert Telegram .ogg/.oga voice clips to .m4a for mobile playback.
# Expo's audio player handles m4a/aac natively on both platforms; ogg
# playback on iOS is unreliable.
#
#   ./scripts/convert_audio.sh downloads
#   ./scripts/convert_audio.sh downloads --keep    # keep the originals
#
# Re-running is safe: files already converted are skipped.

set -euo pipefail

DIR="${1:-downloads}"
KEEP=0
[[ "${2:-}" == "--keep" ]] && KEEP=1

if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "ffmpeg not found. Install it first:" >&2
  echo "  brew install ffmpeg" >&2
  exit 1
fi

if [[ ! -d "$DIR" ]]; then
  echo "no such directory: $DIR" >&2
  exit 1
fi

converted=0
skipped=0
failed=0

while IFS= read -r -d '' src; do
  dest="${src%.*}.m4a"
  if [[ -f "$dest" ]]; then
    skipped=$((skipped + 1))
    continue
  fi
  # Telegram voice notes are mono opus; 64k aac mono is transparent enough
  # for speech and keeps the app bundle small.
  if ffmpeg -nostdin -loglevel error -i "$src" -c:a aac -b:a 64k -ac 1 "$dest"; then
    converted=$((converted + 1))
    [[ $KEEP -eq 0 ]] && rm -f "$src"
  else
    echo "failed: $src" >&2
    failed=$((failed + 1))
  fi
done < <(find "$DIR" -type f \( -iname '*.ogg' -o -iname '*.oga' \) -print0)

echo "converted $converted, skipped $skipped (already done), failed $failed"
if [[ $converted -gt 0 ]]; then
  echo "Re-run scripts/parse_dump.py so audio_url points at the .m4a files."
fi
