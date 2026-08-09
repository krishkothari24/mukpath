"""
Fetch NC27 mukhpath content from the bot's web app and emit seed data.

    python3 scripts/fetch_webapp.py
    python3 scripts/fetch_webapp.py --audio        # also download the mp3s
    python3 scripts/fetch_webapp.py --offline      # reuse the cached copy

The Telegram bot's "Open Mukhpath Material" button is a Telegram Web App
pointing at https://bkymukhpath.nahq.baps.dev/, and that page pulls all of
its content from a single `data.json`. That file is the real content
source — the bot's message tree never contains verses at all, so walking
its menus (tools/mukhpath_scraper.py) can't produce them.

Every record already carries all three languages, so there's no per-language
scraping or merging to do.

Writes seed/texts.json, seed/sections.json, seed/verses.json and
seed/review.md. Re-runnable; overwrites its own output.
"""

import argparse
import ast
import json
import re
import shutil
import ssl
import subprocess
import sys
import urllib.parse
import urllib.request
from pathlib import Path

BASE_URL = "https://bkymukhpath.nahq.baps.dev/"
DATA_URL = urllib.parse.urljoin(BASE_URL, "data.json")
CACHE = Path("mukhpath_webapp.json")

# The web app splits on this, trims, drops empties, and joins with blank
# lines (see normalizeText in its inline script). Match that exactly.
CHUNK_MARKER = "{{$$}}"

# Prettier names than the raw JSON keys.
TEXT_NAMES = {
    "Q_A": "Questions & Answers",
    "Vachnamrut": "Vachanamrut",
    "Swami_ni_Vato": "Swamini Vato",
    "Satsang_Diksha": "Satsang Diksha",
    "Upasana_Prasangs": "Upasana Prasangs",
}


def slugify(value, fallback="item"):
    value = re.sub(r"[^\w\s-]", "", value or "", flags=re.UNICODE).strip().lower()
    return re.sub(r"[\s_-]+", "-", value)[:60] or fallback


def as_text(value):
    """Fields arrive as stringified Python lists, or plain strings."""
    if value is None:
        return ""
    if isinstance(value, str):
        stripped = value.strip()
        if stripped.startswith("[") and stripped.endswith("]"):
            try:
                value = ast.literal_eval(stripped)
            except (ValueError, SyntaxError):
                return normalize(stripped)
        else:
            return normalize(stripped)
    if isinstance(value, (list, tuple)):
        return "\n\n".join(p for p in (normalize(v) for v in value) if p)
    return normalize(str(value))


def normalize(value):
    return "\n\n".join(chunks_of(value))


def chunks_of(value):
    """The {{$$}}-delimited phrases, trimmed, empties dropped."""
    return [p for p in (s.strip() for s in str(value or "").split(CHUNK_MARKER))
            if p]


def as_chunks(value):
    """Phrase list for a field, flattening the stringified-list wrapper."""
    if value is None:
        return []
    if isinstance(value, str):
        stripped = value.strip()
        if stripped.startswith("[") and stripped.endswith("]"):
            try:
                value = ast.literal_eval(stripped)
            except (ValueError, SyntaxError):
                return chunks_of(stripped)
        else:
            return chunks_of(stripped)
    if isinstance(value, (list, tuple)):
        out = []
        for item in value:
            out += chunks_of(item)
        return out
    return chunks_of(str(value))


def absolute(path):
    if not path:
        return None
    # Paths carry spaces ("NC27 Mukhpath Final/..."), so quote each segment
    # but keep the separators.
    quoted = "/".join(urllib.parse.quote(seg) for seg in str(path).split("/"))
    return urllib.parse.urljoin(BASE_URL, quoted)


def fetch_bytes(url, timeout=60):
    """GET a URL, working around python.org builds with no CA bundle.

    Those installs raise CERTIFICATE_VERIFY_FAILED for every https request
    until you run "Install Certificates.command". Rather than making that a
    prerequisite, use certifi's bundle when it's importable and otherwise
    hand off to curl, which carries its own roots. Verification stays on in
    both paths.
    """
    context = None
    try:
        import certifi
        context = ssl.create_default_context(cafile=certifi.where())
    except ImportError:
        pass
    try:
        with urllib.request.urlopen(url, timeout=timeout, context=context) as r:
            return r.read()
    except urllib.error.URLError as exc:
        if not isinstance(getattr(exc, "reason", None), ssl.SSLError):
            raise
        if not shutil.which("curl"):
            raise
        result = subprocess.run(
            ["curl", "-sSfL", "--max-time", str(int(timeout)), url],
            capture_output=True, check=True)
        return result.stdout


def load_data(offline):
    if offline:
        if not CACHE.exists():
            sys.exit(f"{CACHE} not found — run once without --offline first")
        return json.loads(CACHE.read_text(encoding="utf-8"))
    print(f"fetching {DATA_URL}")
    raw = fetch_bytes(DATA_URL).decode("utf-8")
    CACHE.write_text(raw, encoding="utf-8")
    print(f"cached -> {CACHE} ({CACHE.stat().st_size:,} bytes)")
    return json.loads(raw)


def build(data, only_text=None):
    texts, sections, verses, notes = [], [], [], []

    for text_key, records in data.items():
        name = TEXT_NAMES.get(text_key, text_key.replace("_", " "))
        if only_text and only_text.strip().lower() not in (
            name.lower(), text_key.lower()
        ):
            continue
        text_id = slugify(name, "text")
        texts.append({"id": text_id, "name": name, "description": ""})

        # The source has no sub-structure below the text, so each text gets
        # one section. Flagged in review.md rather than invented.
        section_id = f"{text_id}--all"
        sections.append({
            "id": section_id, "text_id": text_id, "name": name,
            "order": len(sections),
        })

        for order, record in enumerate(records):
            shlok_guj = as_text(record.get("shlok_gujarati"))
            shlok_lipi = as_text(record.get("shlok_lipi"))
            answer_guj = as_text(record.get("answer_gujarati"))
            answer_lipi = as_text(record.get("answer_lipi"))
            answer_eng = as_text(record.get("answer_english"))

            # Satsang Diksha records carry the shlok itself; the rest are
            # question/answer material where the answer is the memorised text.
            sanskrit = shlok_guj or answer_guj
            transliteration = shlok_lipi or answer_lipi

            verse_id = slugify(record.get("id") or f"{text_id}-{order + 1}")
            verse = {
                "id": verse_id,
                "section_id": section_id,
                "sanskrit": sanskrit,
                "transliteration": transliteration,
                "meaning": answer_eng,
                "audio_url": absolute(record.get("audio_src_gujarati")
                                      or record.get("audio_src")),
                "order": order,
                # Not in the CLAUDE.md schema, but real content — see review.md.
                "question": as_text(record.get("question")),
                "question_lipi": as_text(record.get("question_lipi")),
                "question_gujarati": as_text(record.get("question_gujarati")),
                "reference": as_text(record.get("reference")),
                "reference_gujarati": as_text(record.get("reference_gujarati")),
                "audio_url_english": absolute(record.get("audio_src_english")),
                "has_shlok": bool(shlok_guj),
                # Phrase boundaries from the source's {{$$}} markers. The web
                # app has repeat-playback controls, so these line up with how
                # the audio is meant to be practised a phrase at a time —
                # worth keeping rather than flattening into one blob.
                "sanskrit_chunks": as_chunks(
                    record.get("shlok_gujarati") or record.get("answer_gujarati")),
                "transliteration_chunks": as_chunks(
                    record.get("shlok_lipi") or record.get("answer_lipi")),
                "meaning_chunks": as_chunks(record.get("answer_english")),
            }
            verses.append(verse)

            where = f"`{name}` #{order + 1} ({verse_id})"
            if not sanskrit:
                notes.append(f"- {where}: no Gujarati text")
            if not transliteration:
                notes.append(f"- {where}: no transliteration")
            if not answer_eng:
                notes.append(f"- {where}: no English meaning")
            if not verse["audio_url"]:
                notes.append(f"- {where}: no audio")
            guj_chunks = len(verse["sanskrit_chunks"])
            lipi_chunks = len(verse["transliteration_chunks"])
            if guj_chunks != lipi_chunks:
                notes.append(
                    f"- {where}: {guj_chunks} Gujarati phrase(s) vs "
                    f"{lipi_chunks} transliteration — they can't be shown "
                    f"side by side until this is reconciled")

    return texts, sections, verses, notes


def download_audio(verses, out_dir):
    out_dir.mkdir(parents=True, exist_ok=True)
    seen, failed = {}, 0
    for verse in verses:
        for field in ("audio_url", "audio_url_english"):
            url = verse.get(field)
            if not url or url in seen:
                continue
            name = urllib.parse.unquote(url.rsplit("/", 1)[-1])
            dest = out_dir / f"{verse['id']}-{slugify(field)}{Path(name).suffix}"
            if dest.exists():
                seen[url] = dest
                continue
            try:
                dest.write_bytes(fetch_bytes(url, timeout=120))
                seen[url] = dest
                print(f"  {dest.name}")
            except Exception as exc:                     # noqa: BLE001
                print(f"  ! {url}: {exc}")
                failed += 1
    print(f"downloaded {len(seen)} file(s), {failed} failed")


def write_outputs(out_dir, texts, sections, verses, notes):
    out_dir.mkdir(parents=True, exist_ok=True)
    for filename, payload in (("texts.json", texts),
                              ("sections.json", sections),
                              ("verses.json", verses)):
        (out_dir / filename).write_text(
            json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8")

    with_shlok = sum(1 for v in verses if v["has_shlok"])
    lines = [
        "# Seed review",
        "",
        f"Source: {DATA_URL}",
        "",
        f"- texts: {len(texts)}",
        f"- sections: {len(sections)}",
        f"- verses: {len(verses)} ({with_shlok} carry an actual shlok)",
        f"- with audio: {sum(1 for v in verses if v['audio_url'])}",
        "",
        "## Decisions worth a second look",
        "",
        "- **Sections are placeholders.** The source has no level between",
        "  text and verse, so each text gets one section named after it.",
        "  If you want Satsang Diksha split by shlok range, that's a manual",
        "  pass or a rule based on `reference`.",
        "- **Only Satsang Diksha has a `shlok`.** For the other four texts",
        "  the memorised material is the *answer*, so `sanskrit` /",
        "  `transliteration` hold the Gujarati and lipi answers. `has_shlok`",
        "  marks which is which.",
        "- **Extra fields beyond the CLAUDE.md schema** are kept rather than",
        "  dropped: `question*`, `reference*`, `audio_url_english`,",
        "  `has_shlok`. This content is question/answer shaped and the",
        "  question is what a learner is prompted with — losing it would",
        "  gut the practice screen. Decide whether `verses` grows these",
        "  columns or they move to their own table.",
        "- **`*_chunks` preserve the source's `{{$$}}` phrase boundaries.**",
        "  The web app splits on them and has repeat-playback controls, so",
        "  they most likely mark the phrase-at-a-time practice units. Worth",
        "  confirming against the audio before building the practice screen",
        "  on top of them — they may not be timestamp-aligned.",
        "- **`audio_url` is the Gujarati recitation**; the English",
        "  explanation track is `audio_url_english`. Both are absolute URLs",
        "  on bkymukhpath.nahq.baps.dev — mirror them before shipping if you",
        "  don't want a runtime dependency on that host.",
        "",
        "## Flagged records",
        "",
    ]
    lines += notes or ["- nothing flagged"]
    (out_dir / "review.md").write_text("\n".join(lines) + "\n", encoding="utf-8")


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--out", default="seed")
    p.add_argument("--text", help="only emit this text (scope v1 content)")
    p.add_argument("--offline", action="store_true",
                   help=f"reuse {CACHE} instead of refetching")
    p.add_argument("--audio", action="store_true",
                   help="also download the mp3s into <out>/audio/")
    args = p.parse_args(argv)

    data = load_data(args.offline)
    texts, sections, verses, notes = build(data, args.text)
    if not verses:
        sys.exit(f"no verses built — --text didn't match any of "
                 f"{sorted(data)}")

    out_dir = Path(args.out)
    write_outputs(out_dir, texts, sections, verses, notes)
    print(f"{len(texts)} texts, {len(sections)} sections, {len(verses)} verses "
          f"-> {out_dir}/")
    if args.audio:
        download_audio(verses, out_dir / "audio")
    print(f"{len(notes)} record(s) flagged — read {out_dir}/review.md")
    return 0


if __name__ == "__main__":
    sys.exit(main())
