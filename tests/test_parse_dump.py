"""
Checks scripts/parse_dump.py against tests/fixtures/sample_dump.json, so the
parser can be exercised without a Telegram session.

    python3 tests/test_parse_dump.py

No pytest dependency on purpose — this is a one-off content tool, not app code.
"""

import json
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))

import parse_dump  # noqa: E402

FIXTURE = ROOT / "tests" / "fixtures" / "sample_dump.json"

failures = []


def check(label, actual, expected):
    if actual != expected:
        failures.append(f"{label}\n    expected: {expected!r}\n    actual:   {actual!r}")


def check_true(label, condition):
    if not condition:
        failures.append(label)


def main():
    nodes = parse_dump.load_nodes(FIXTURE)
    texts, sections, verses, notes, chrome = parse_dump.build(nodes)

    # --- structure ---
    check("texts", sorted(texts), ["basic-mukhpath", "satsang-diksha"])
    check("sections", sorted(sections), [
        "basic-mukhpath--cheshta",
        "basic-mukhpath--nitya-niyam",
        "satsang-diksha--shloks-1-10",
    ])
    check("verse count", len(verses), 4)

    # --- menu chrome is dropped, not parsed as scripture ---
    check_true("root menu prompt dropped", chrome >= 3)
    check_true(
        "no verse came from a pure menu node",
        all(v["sanskrit"] or v["meaning"] for v in verses),
    )
    check_true(
        "'Choose a section:' never became a verse",
        not any("Choose a section" in v["meaning"] for v in verses),
    )

    by_id = {v["id"]: v for v in verses}

    # --- two verses split out of one message ---
    first = by_id.get("basic-mukhpath--nitya-niyam--1")
    check_true("nitya niyam verse 1 exists", first is not None)
    if first:
        check("v1 sanskrit", first["sanskrit"], "શ્રી સ્વામિનારાયણો વિજયતે")
        check("v1 transliteration", first["transliteration"],
              "Shri Swaminarayano Vijayate")
        check("v1 meaning", first["meaning"], "Victory to Shri Swaminarayan.")
        check("v1 order", first["order"], 0)
    second = by_id.get("basic-mukhpath--nitya-niyam--2")
    check_true("nitya niyam verse 2 exists", second is not None)
    if second:
        check("v2 sanskrit", second["sanskrit"], "જય સ્વામિનારાયણ")
        check("v2 order", second["order"], 1)
        check("v2 section", second["section_id"], "basic-mukhpath--nitya-niyam")

    # --- the "Nitya Niyam" header line must not leak into verse 1 ---
    check_true(
        "header line dropped",
        first is not None and "Nitya Niyam" not in first["transliteration"],
    )

    # --- Devanagari + 'अर्थ:' marker + attached audio ---
    cheshta = [v for v in verses if v["section_id"] == "basic-mukhpath--cheshta"]
    check("cheshta verse count", len(cheshta), 1)
    if cheshta:
        verse = cheshta[0]
        check("cheshta sanskrit", verse["sanskrit"], "धन्य धन्य हरि साधु आ")
        check("cheshta translit", verse["transliteration"],
              "Dhanya dhanya hari sadhu aa")
        check("cheshta meaning", verse["meaning"],
              "Blessed indeed are the Lord and His holy sadhus.")
        check("cheshta audio", verse["audio_url"],
              "downloads/basic-mukhpath-cheshta-5.ogg")

    # --- 'શ્લોક 1.' prefix recognised as a verse number ---
    shlok = by_id.get("satsang-diksha--shloks-1-10--1")
    check_true("satsang diksha shlok 1 exists", shlok is not None)
    if shlok:
        check("shlok sanskrit", shlok["sanskrit"], "સ્વામિનારાયણઃ શ્રીમાન્")
        check("shlok meaning", shlok["meaning"], "Shriman Swaminarayan.")

    # --- scrape errors surface in the review, not silently ---
    check_true("scrape error reported", any("Broken Branch" in n for n in notes))
    # --- ogg audio flagged for the ffmpeg pass ---
    with tempfile.TemporaryDirectory() as tmp:
        out = Path(tmp)
        parse_dump.write_outputs(out, texts, sections, verses, notes, chrome, FIXTURE)
        review = (out / "review.md").read_text(encoding="utf-8")
        check_true("review flags ogg conversion", "convert_audio.sh" in review)
        check_true("verses.json has no private fields", all(
            not k.startswith("_")
            for v in json.loads((out / "verses.json").read_text(encoding="utf-8"))
            for k in v
        ))

    # --- --text scoping ---
    _, scoped_sections, scoped_verses, _, _ = parse_dump.build(nodes, "Basic Mukhpath")
    check("scoped sections", len(scoped_sections), 2)
    check("scoped verses", len(scoped_verses), 3)

    # --- --strip, for dumps scraped with --branch ---
    # Every path gains the branch button at the front; --strip 1 removes it
    # so the real text name lands back at path[0].
    branched = [dict(n, path=["Open Mukhpath Material"] + (n.get("path") or []))
                for n in nodes]
    s_texts, _, s_verses, s_notes, _ = parse_dump.build(branched, strip=1)
    check("strip restores text ids", sorted(s_texts),
          ["basic-mukhpath", "satsang-diksha"])
    check("strip keeps every verse", len(s_verses), len(verses))
    check_true(
        "branch button never becomes a text",
        "open-mukhpath-material" not in s_texts,
    )
    check_true(
        "scrape errors still reported under --strip",
        any("Broken Branch" in n for n in s_notes),
    )
    # Without --strip the branch button would swallow everything into one text.
    unstripped, _, _, _, _ = parse_dump.build(branched)
    check("no strip collapses to one text", sorted(unstripped),
          ["open-mukhpath-material"])

    if failures:
        print(f"FAILED ({len(failures)})\n")
        for failure in failures:
            print(" ", failure)
        return 1
    print("all parser checks passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
