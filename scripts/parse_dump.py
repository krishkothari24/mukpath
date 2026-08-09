"""
Turn a raw `mukhpath_dump.json` from the Telegram scraper into seed data
matching the texts/sections/verses schema in CLAUDE.md.

    python3 scripts/parse_dump.py mukhpath_dump.json
    python3 scripts/parse_dump.py mukhpath_dump.json --text "Basic Mukhpath"

Writes seed/texts.json, seed/sections.json, seed/verses.json, and
seed/review.md — a report of everything the heuristics were unsure about.

This is a one-off bootstrapping tool and the dump has menu chrome mixed in
with real content, so treat the output as a first pass: read review.md,
fix the JSON by hand, then load it. It is deliberately conservative — when
a message is ambiguous it keeps it and flags it rather than dropping it.
"""

import argparse
import json
import re
import sys
from collections import defaultdict
from pathlib import Path

DEVANAGARI = r"ऀ-ॿ"
GUJARATI = r"઀-૿"
SCRIPT_RE = re.compile(f"[{DEVANAGARI}{GUJARATI}]")

# A message that is only steering the user around the menu, not content.
CHROME_RE = re.compile(
    r"^\W*(welcome|hello|hi\b|please choose|choose an option|choose a|select an|"
    r"select a|pick a|main menu|menu:|what would you like|tap a button|"
    r"use the buttons|jay swaminarayan|invalid|unknown command|/start)",
    re.IGNORECASE,
)

# Start of a new verse inside one message.
VERSE_START_RE = re.compile(
    r"^\s*(?:(?:verse|shlok|shloka|karika|kariku|sutra|श्लोक|શ્લોક)\s*)?"
    rf"([0-9]+|[{'०-९'}]+|[{'૦-૯'}]+)\s*[.):\-]\s+",
    re.IGNORECASE,
)

MEANING_RE = re.compile(
    r"^\W*(meaning|translation|artha|arth|अर्थ|અર્થ|भावार्थ|ભાવાર્થ)\s*[:\-–]\s*",
    re.IGNORECASE,
)
TRANSLIT_RE = re.compile(
    r"^\W*(transliteration|translit|roman|uchcharan|ઉચ્ચારણ|उच्चारण)\s*[:\-–]\s*",
    re.IGNORECASE,
)

AUDIO_EXT = (".ogg", ".oga", ".mp3", ".m4a", ".aac", ".wav")


def has_script(line: str) -> bool:
    """True if the line is substantially Devanagari/Gujarati, not just a stray char."""
    letters = [c for c in line if c.isalpha()]
    if not letters:
        return False
    scripted = sum(1 for c in letters if SCRIPT_RE.match(c))
    return scripted / len(letters) > 0.5


def contains_script(text: str) -> bool:
    """True if *any* line is scripture.

    Checked per line, not over the whole message: a verse posted with its
    transliteration and English meaning is mostly Latin characters, so a
    whole-message ratio would classify real content as menu chrome.
    """
    return any(has_script(line) for line in text.splitlines())


def slugify(value: str, fallback: str = "item") -> str:
    value = re.sub(r"[^\w\s-]", "", value or "", flags=re.UNICODE).strip().lower()
    value = re.sub(r"[\s_-]+", "-", value)
    return value[:60] or fallback


def is_chrome(text: str, buttons: list) -> bool:
    """Menu scaffolding rather than scripture."""
    if not text or not text.strip():
        return True
    stripped = text.strip()
    if contains_script(stripped):
        return False                      # scripture wins over any prompt wording
    if CHROME_RE.match(stripped):
        return True
    # A short one-liner ending in a colon is introducing something, not
    # scripture itself ("Cheshta — listen along:").
    if len(stripped) < 90 and stripped.endswith(":") and "\n" not in stripped:
        return True
    # Short, button-bearing, no script: almost certainly a menu prompt.
    if buttons and len(stripped) < 200:
        return True
    # The whole body is just an echo of the button labels.
    if buttons:
        body = {ln.strip(" -•*").lower() for ln in stripped.splitlines() if ln.strip()}
        if body and body <= {b.strip().lower() for b in buttons}:
            return True
    return False


def split_verses(text: str):
    """Split one message into verse blocks on leading verse numbers."""
    lines = text.splitlines()
    blocks, current, number = [], [], None
    for line in lines:
        match = VERSE_START_RE.match(line)
        if match and (current or blocks or line.strip()):
            if current:
                blocks.append((number, current))
            number = match.group(1)
            current = [line[match.end():]]
        else:
            current.append(line)
    if current:
        blocks.append((number, current))
    blocks = [(n, ls) for n, ls in blocks if any(l.strip() for l in ls)]
    # A numberless first block ahead of numbered ones is a section header
    # ("Nitya Niyam" above "1. ..."), not verse zero. Only drop it if it
    # carries no scripture — otherwise it's an unnumbered opening verse.
    if len(blocks) > 1 and blocks[0][0] is None and not any(
        has_script(line) for line in blocks[0][1]
    ):
        blocks = blocks[1:]
    return blocks


def parse_verse(lines):
    """Classify a verse block's lines into sanskrit / transliteration / meaning."""
    sanskrit, translit, meaning = [], [], []
    bucket = None
    for raw in lines:
        line = raw.strip()
        if not line:
            continue
        meaning_match = MEANING_RE.match(line)
        if meaning_match:
            bucket = "meaning"
            rest = line[meaning_match.end():].strip()
            if rest:
                meaning.append(rest)
            continue
        translit_match = TRANSLIT_RE.match(line)
        if translit_match:
            bucket = "translit"
            rest = line[translit_match.end():].strip()
            if rest:
                translit.append(rest)
            continue
        if bucket == "meaning":
            meaning.append(line)
        elif has_script(line):
            sanskrit.append(line)
        elif bucket == "translit":
            translit.append(line)
        else:
            # Latin text before any explicit marker: transliteration if we
            # already have script lines to transliterate, else meaning.
            (translit if sanskrit and not meaning else meaning).append(line)
    return (
        "\n".join(sanskrit).strip(),
        "\n".join(translit).strip(),
        "\n".join(meaning).strip(),
    )


def collect_audio(messages):
    paths = []
    for msg in messages:
        media = msg.get("media") or {}
        path = media.get("path")
        if path and path.lower().endswith(AUDIO_EXT):
            paths.append(path)
    return paths


def build(nodes, only_text=None):
    texts, sections, verses = {}, {}, []
    notes = []
    skipped_chrome = 0

    for node in nodes:
        path = node.get("path") or []
        if node.get("error"):
            notes.append(f"- node `{' > '.join(path) or '(root)'}` failed during "
                         f"scrape: {node['error']}")
            continue
        if not path:
            continue                        # root menu is never content
        text_name = path[0]
        if only_text and text_name.strip().lower() != only_text.strip().lower():
            continue
        section_name = path[1] if len(path) > 1 else "General"
        leaf = path[-1]

        content = []
        for msg in node.get("messages", []):
            body = msg.get("text") or ""
            if is_chrome(body, msg.get("buttons") or []):
                skipped_chrome += 1
                continue
            content.append(body)
        audio = collect_audio(node.get("messages", []))
        if not content and not audio:
            continue

        text_id = slugify(text_name, "text")
        texts.setdefault(text_id, {
            "id": text_id, "name": text_name.strip(), "description": "",
        })
        section_id = f"{text_id}--{slugify(section_name, 'section')}"
        if section_id not in sections:
            sections[section_id] = {
                "id": section_id,
                "text_id": text_id,
                "name": section_name.strip(),
                "order": len(sections),
            }

        blocks = []
        for body in content:
            blocks.extend(split_verses(body))
        if not blocks and audio:
            blocks = [(None, [leaf])]       # audio-only node

        for index, (number, lines) in enumerate(blocks):
            sanskrit, translit, meaning = parse_verse(lines)
            if not any((sanskrit, translit, meaning)):
                continue
            order = len(
                [v for v in verses if v["section_id"] == section_id]
            )
            verse_id = f"{section_id}--{number or order + 1}"
            if any(v["id"] == verse_id for v in verses):
                verse_id = f"{verse_id}-{order}"
            verse = {
                "id": verse_id,
                "section_id": section_id,
                "sanskrit": sanskrit,
                "transliteration": translit,
                "meaning": meaning,
                "audio_url": audio[index] if index < len(audio) else (
                    audio[0] if len(audio) == 1 and len(blocks) == 1 else None
                ),
                "order": order,
                "_source_path": path,
            }
            verses.append(verse)

            where = f"`{' > '.join(path)}` verse {number or order + 1}"
            if not sanskrit:
                notes.append(f"- {where}: no Devanagari/Gujarati line found — "
                             f"may be a heading, not a verse")
            if not meaning:
                notes.append(f"- {where}: no meaning captured")
            if sanskrit and not translit:
                notes.append(f"- {where}: no transliteration captured")
            if len(sanskrit) > 1200:
                notes.append(f"- {where}: very long ({len(sanskrit)} chars) — "
                             f"probably several verses that failed to split")

    return texts, sections, verses, notes, skipped_chrome


def write_outputs(out_dir, texts, sections, verses, notes, skipped_chrome, source):
    out_dir.mkdir(parents=True, exist_ok=True)
    clean = [{k: v for k, v in verse.items() if not k.startswith("_")}
             for verse in verses]

    (out_dir / "texts.json").write_text(
        json.dumps(list(texts.values()), ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8")
    (out_dir / "sections.json").write_text(
        json.dumps(list(sections.values()), ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8")
    (out_dir / "verses.json").write_text(
        json.dumps(clean, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8")

    ogg = [v["audio_url"] for v in clean
           if v.get("audio_url", "") and v["audio_url"].lower().endswith((".ogg", ".oga"))]
    lines = [
        "# Parse review",
        "",
        f"Source: `{source}`",
        "",
        f"- texts: {len(texts)}",
        f"- sections: {len(sections)}",
        f"- verses: {len(clean)}",
        f"- messages dropped as menu chrome: {skipped_chrome}",
        f"- verses with audio: {sum(1 for v in clean if v.get('audio_url'))}",
        "",
    ]
    if ogg:
        lines += [
            f"{len(ogg)} verse(s) still point at .ogg voice clips. Run:",
            "",
            "    ./scripts/convert_audio.sh downloads",
            "",
            "then re-run this parser so `audio_url` picks up the .m4a files.",
            "",
        ]
    lines += ["## Needs a human look", ""]
    lines += notes or ["- nothing flagged"]
    lines += ["", "Fix the JSON by hand where needed — this parser is a first "
                  "pass, not the source of truth."]
    (out_dir / "review.md").write_text("\n".join(lines) + "\n", encoding="utf-8")


def load_nodes(path: Path):
    data = json.loads(path.read_text(encoding="utf-8"))
    if isinstance(data, dict):
        return data.get("nodes", [])
    # Tolerate the older flat list-of-messages dump format.
    if isinstance(data, list) and data and "path" not in data[0]:
        return [{"path": [f"message {i}"], "messages": [m]}
                for i, m in enumerate(data)]
    return data


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("dump", nargs="?", default="mukhpath_dump.json")
    p.add_argument("--out", default="seed")
    p.add_argument("--text", help="only emit this top-level text (scope v1 content)")
    args = p.parse_args(argv)

    dump_path = Path(args.dump)
    if not dump_path.exists():
        sys.exit(f"{dump_path} not found — run tools/mukhpath_scraper.py first")

    nodes = load_nodes(dump_path)
    texts, sections, verses, notes, chrome = build(nodes, args.text)
    if not verses:
        sys.exit("no verses parsed — check the dump, or --text didn't match "
                 f"any top-level menu item ({sorted({n['path'][0] for n in nodes if n.get('path')})})")
    out_dir = Path(args.out)
    write_outputs(out_dir, texts, sections, verses, notes, chrome, dump_path)
    print(f"{len(texts)} texts, {len(sections)} sections, {len(verses)} verses "
          f"-> {out_dir}/")
    print(f"{len(notes)} thing(s) flagged — read {out_dir}/review.md")
    return 0


if __name__ == "__main__":
    sys.exit(main())
