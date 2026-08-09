# Build Phases

Reference `CLAUDE.md` for stack, data model, and conventions. Work
through these roughly in order — each phase should end in something
runnable/testable, not just code that compiles.

## Phase 0 — Content acquisition

Pipeline is built and tested; see `docs/PHASE0.md` for the runbook. The
remaining steps need a Telegram account login, so they're yours to run.

- [ ] **(needs you)** Manually explore the Telegram bot to map its actual
      menu structure (inline buttons vs reply keyboard vs free-text state).
      `python3 tools/mukhpath_scraper.py --dry-run` prints what the scraper
      sees, including which button kind it detects.
- [x] Adapt `tools/mukhpath_scraper.py` (Telethon) — handles both button
      kinds, multi-message replies, media dedupe, flood-waits, and resumes
      from a checkpoint
- [ ] **(needs you)** Run it, produce `mukhpath_dump.json`
- [x] One-off parser `scripts/parse_dump.py` — dump → `texts/sections/verses`
      seed data, drops menu chrome, flags everything uncertain in
      `seed/review.md` for manual cleanup
- [x] Parser test against a fixture dump (`python3 tests/test_parse_dump.py`)
      so it can be exercised and corrected without a Telegram session
- [x] ffmpeg pass: `scripts/convert_audio.sh` converts `.ogg` voice clips to
      `.m4a` (not yet run — no content, and ffmpeg isn't installed locally)
- [ ] Scope v1 content to one complete text (e.g. Basic Mukhpath booklet
      content) rather than everything at once — `parse_dump.py --text "..."`
- [ ] Output: `seed/texts.json`, `seed/sections.json`, `seed/verses.json`
      ready to load into Postgres (schema + writer done, awaiting real content)

## Phase 1 — Backend skeleton
- [ ] Fastify project, Postgres schema/migrations for the tables in CLAUDE.md
- [ ] Seed script to load Phase 0 output into the DB
- [ ] REST endpoints: `GET /texts`, `GET /texts/:id/verses`, basic auth
      (parent creates account, adds kid profiles under it)
- [ ] Deploy to Railway, confirm it's reachable from a REST client

## Phase 2 — Mobile app skeleton
- [ ] Expo app, navigation shell (browse texts → sections → verses)
- [ ] Verse detail screen: Sanskrit + transliteration + meaning, audio
      playback if available
- [ ] Pull content from backend, cache to expo-sqlite for offline reads
- [ ] Basic auth flow (parent account, switch between kid profiles)

## Phase 3 — Training plan / spaced repetition
- [ ] Implement the SM-2/Leitner scheduler against the `progress` table
- [ ] "Practice today" screen: due reviews + new verses, in priority order
- [ ] Self-assessment after each verse (easy/hard/again) updates
      `ease_factor` and `next_review_date`
- [ ] Goals screen: pick a text/section + target date, see daily pace
      needed, see progress bar toward it

## Phase 4 — Reminders & engagement
- [ ] Push notifications (Expo push) for daily practice reminder
- [ ] Streak tracking (consecutive days practiced)
- [ ] Parent-facing summary notification (weekly progress digest)

## Phase 5 — Audio
- [ ] Reference audio playback per verse (from Phase 0 content)
- [ ] Local recording: kid records themselves, plays back against
      reference — stored on-device only, never uploaded
- [ ] (Later, not v1) explore STT-based auto-scoring — flag as
      needs-research, Sanskrit pronunciation isn't well covered by most
      off-the-shelf models

## Phase 6 — Teacher/admin reporting
- [ ] Teacher role can see aggregate progress across kids linked to them
- [ ] Simple dashboard: who's complete on what text, who's behind pace
      on an active goal
- [ ] Export view for felicitation/adhiveshan events (who qualifies)

## Phase 7 — Polish & ship
- [ ] Error states, empty states, loading states across all screens
- [ ] TestFlight / internal Android track with the pilot group
- [ ] Collect feedback on the daily practice loop specifically before
      adding anything else
- [ ] App store submission
