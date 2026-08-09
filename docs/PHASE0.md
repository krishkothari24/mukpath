# Phase 0 runbook — content acquisition

Goal: `seed/texts.json`, `seed/sections.json`, `seed/verses.json` ready for
Phase 1 to load into Postgres, scoped to one complete text.

The pipeline is built and tested. Steps 1 and 2 need your Telegram account,
so they can't be automated for you — everything after them is one command.

```
Telegram bot ──(1,2)──> mukhpath_dump.json ──(4)──> seed/*.json
                              │                          ▲
                              └──> downloads/*.ogg ──(3)──┘
```

## 0. Install

```bash
./scripts/setup.sh
source .venv/bin/activate
```

That creates a `.venv` (telethon is a one-off bootstrapping dependency — it
doesn't belong in your global or conda `base` environment), installs
`tools/requirements.txt` into it, and copies `.env.example` to `.env`.

Then fill in `.env`:

```
TELEGRAM_API_ID=1234567
TELEGRAM_API_HASH=abc123...
```

Get both from https://my.telegram.org (log in with your own phone number →
API development tools → create an app). The scraper reads `.env`
automatically; real environment variables still win if you set them, so
`TELEGRAM_API_ID=other python3 tools/...` works for a one-off override.

`.env` is gitignored. It holds credentials for *your* Telegram account, not
the bot's — don't commit or share it.

If the bot turns out to send voice clips you'll also need ffmpeg
(`brew install ffmpeg`); `setup.sh` warns if it's missing.

First scraper run prompts for your phone number and a login code. That creates
`mukhpath_scraper_session.session` — a live credential for your account.
It's gitignored; don't commit or share it.

## 1. Map the menu by hand

Open `@nc27mukhpathguidebot` in Telegram and click around. You need to know:

- **Inline buttons** (attached under the bot's messages) or a **reply
  keyboard** (panel below the text box)? The scraper's `--mode` defaults to
  `auto` and detects per message, but if `auto` misbehaves, pin it.
- Does it ever ask for **free text** ("send me a verse number")? The scraper
  only walks buttons — note any free-text branches, you'll need to capture
  those manually.
- Roughly how deep does the tree go? Sets `--max-depth`.

Sanity-check what the scraper sees before committing to a full walk:

```bash
python3 tools/mukhpath_scraper.py --dry-run
```

That sends `/start`, prints each reply with its buttons and detected button
kind, and exits.

## 2. Scrape

```bash
python3 tools/mukhpath_scraper.py --max-depth 6
```

Notes:

- The walk is **replay-based**: for each menu path it re-sends `/start` and
  re-clicks from the top. Slower, but it's the only thing that works if the
  bot tracks conversation state, and it makes runs resumable.
- Progress is checkpointed to `mukhpath_dump.state.json` after every node.
  Ctrl-C and re-run to resume; `--no-resume` starts clean.
- `--delay` (default 1.5s) throttles requests. Don't lower it — the bot is
  someone else's, and Telegram will flood-wait you.
- Back/Menu-style buttons are skipped so the walk doesn't loop. `--follow-nav`
  if you actually need them.
- Media lands in `downloads/`, deduped by Telegram file id.

## 3. Convert audio

Telegram voice notes are `.ogg` (opus); iOS playback is unreliable, so
convert to `.m4a`:

```bash
./scripts/convert_audio.sh downloads
```

Safe to re-run — already-converted files are skipped. Originals are deleted
unless you pass `--keep`.

## 4. Parse into seed data

```bash
python3 scripts/parse_dump.py mukhpath_dump.json --text "Basic Mukhpath"
```

`--text` scopes output to one top-level menu item. Do this: v1 is one
complete text, not everything at once. Omit it to see what's available (the
error lists the top-level names if nothing matches).

Then **read `seed/review.md`** and hand-fix `seed/verses.json`. The parser
flags verses with no Devanagari/Gujarati line, no meaning, no
transliteration, suspiciously long blocks, and any node that errored during
the scrape.

## What the parser assumes

Heuristics, all of them fallible — that's what `review.md` is for:

- `path[0]` → text, `path[1]` → section, deeper path segments collapse into
  that section.
- A message is **menu chrome** if it has no Devanagari/Gujarati on any line
  and either matches a prompt phrase ("Please choose…"), is short with
  buttons attached, or is a one-line label ending in a colon. Anything with
  scripture on any line is always kept.
- Verses split on a leading number (`1.`, `૧.`, `શ્લોક 1.`, `Verse 3:`). A
  numberless first block ahead of numbered ones is treated as a header and
  dropped — unless it contains scripture.
- Within a verse: script lines → `sanskrit`; `Meaning:` / `અર્થ:` / `अर्थ:` /
  `Translation:` starts `meaning`; other Latin lines → `transliteration` if
  there's already scripture to transliterate, else `meaning`.

## Verifying changes to the tools

```bash
python3 tests/test_parse_dump.py
python3 tests/test_dotenv.py
```

Neither needs telethon or a Telegram session, so they run anywhere.

`test_parse_dump.py` runs against `tests/fixtures/sample_dump.json` — a hand-written dump shaped
like real scraper output, covering chrome filtering, multi-verse splitting,
both scripts, the audio path, and scrape errors. No Telegram needed. Extend
the fixture with any real-world shape the parser gets wrong.

## Boundaries

Per `CLAUDE.md`: `tools/` and `scripts/` are one-off bootstrapping (Python),
not runtime dependencies of the Expo app or the Fastify backend. Only
`seed/` crosses into Phase 1.
