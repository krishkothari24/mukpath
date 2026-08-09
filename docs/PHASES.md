# Build Phases

Reference `CLAUDE.md` for stack, data model, and conventions. Work
through these roughly in order — each phase should end in something
runnable/testable, not just code that compiles.

## Phase 0 — Content acquisition ✅ done

The plan assumed the content lived in the Telegram bot's menus. It doesn't.
"Open Mukhpath Material" is a Telegram Web App at
<https://bkymukhpath.nahq.baps.dev/>, which loads everything from one
`data.json`. See `docs/PHASE0.md`.

- [x] Map the bot — done via `--dry-run`; that's how the web app was found
- [x] `scripts/fetch_webapp.py` — fetches `data.json`, emits seed data,
      `--audio` mirrors the mp3s, `--offline` reuses the cache
- [x] Output: `seed/texts.json`, `seed/sections.json`, `seed/verses.json`
      — **5 texts, 50 verses**, each with Gujarati, transliteration,
      English and audio. Ready to load into Postgres.
- [x] No ffmpeg pass needed — source audio is already mp3
- [x] No per-language merge needed — every record carries all three
- [x] `seed/review.md` flags what needs a human: placeholder sections, the
      extra question/reference columns, 3 records whose phrase counts
      disagree between Gujarati and transliteration

Superseded but kept (`tools/mukhpath_scraper.py`, `scripts/parse_dump.py`,
`scripts/convert_audio.sh`): the bot walker and its dump parser. Not needed
for content; still the way in if the bot's Practice/Quiz/Progress features
are ever worth mapping.

Open question for Phase 1: `verses` as specified in CLAUDE.md has no column
for `question`/`reference`, but this content is question/answer shaped and
the question is the practice prompt. Either `verses` grows those columns or
they get their own table — decide before writing migrations.

## Phase 1 — Backend skeleton
- [x] Fastify project, Postgres schema/migrations for the tables in CLAUDE.md
      (`backend/`; see `backend/README.md` for the runbook)
- [x] Seed script to load Phase 0 output into the DB (`backend/scripts/seed.js`,
      upserts by id so re-running after hand-corrections is safe)
- [x] REST endpoints: `GET /texts`, `GET /texts/:id/verses`, basic auth
      (parent creates account, adds kid profiles under it)
- [x] Migration `002_verse_prompts.sql` — adds the question/reference/chunk
      columns the real content needs. CLAUDE.md's `verses` was written
      before the content shape was known, and 40 of the 50 verses have no
      shlok: for those the question is the only prompt the practice screen
      has, so without it there is nothing to ask.
- [x] Test suite (`npm test`) — 16 checks: content shape, auth flow, token
      expiry, forged-token rejection, cross-parent isolation
- [ ] **(needs you)** Deploy to Railway, confirm it's reachable from a REST
      client — held off on creating cloud resources without a go-ahead;
      steps are in `backend/README.md`

Verified locally: `npm run migrate && npm run seed && npm test` →
5 texts / 5 sections / 50 verses seeded, 16/16 tests pass.

Known gaps, deliberately not fixed:
- No rate limiting on `POST /auth/login` — brute force is unthrottled.
  Worth adding before the pilot grows past people you know personally.
- `POST /kids` can create a `teacher` under a parent, which is odd
  modelling — a teacher isn't a child of a parent account.
- `db.js` sets `rejectUnauthorized: false` for Railway's Postgres TLS.
  Standard practice for Railway, but it is unverified TLS.

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
