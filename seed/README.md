# seed/

Generated content, committed on purpose — Phase 1's seed script loads these
into Postgres, and they're the reviewed/corrected source of truth for v1
content.

`scripts/parse_dump.py` writes four files here:

| file | shape |
| --- | --- |
| `texts.json` | `{id, name, description}` |
| `sections.json` | `{id, text_id, name, order}` |
| `verses.json` | `{id, section_id, sanskrit, transliteration, meaning, audio_url, order}` |
| `review.md` | everything the parser was unsure about — read this |

The parser is a heuristic first pass over a Telegram dump with menu chrome
mixed into the content. **Hand-correct the JSON after generating it**, then
commit. Don't re-run the parser over corrections you've already made — it
overwrites these files.

`id`s are slugs (`basic-mukhpath--nitya-niyam--1`) rather than UUIDs so the
seed is diffable and re-runnable; the DB can assign real keys on load.

See `docs/PHASE0.md` for the full pipeline.
