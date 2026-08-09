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
- [x] Expo app (SDK 57, expo-router), navigation shell — texts → sections →
      verses (`mobile/`; see `mobile/README.md` for the runbook)
- [x] Verse detail screen: verse text + meaning + audio, with a
      Gujarati/Lipi/English toggle persisted per device. Two layouts, chosen
      by `has_shlok` — shlok verses lead with the shlok and its reference,
      the other 40 lead with the question, because for those the answer *is*
      the material
- [x] Pull content from backend, cache to expo-sqlite. Every screen reads
      from SQLite, never the network: a full-corpus replace in one
      transaction on launch (~130KB, six requests), so a failed refresh
      degrades to stale content instead of an empty screen
- [x] Basic auth flow — register/login, token in expo-secure-store, sign out
      from the home screen. **One account, one learner**: no family or kid
      profile switching. The backend still has `parent_id` / `POST /kids`
      and `GET /me` still returns a `kids` array, but the app ignores them —
      unused surface to delete if it stays unused
- [x] `@fastify/cors` on the backend. Only the web build needs it (React
      Native sends no Origin); it's what makes `npm run web` usable as a dev
      surface without Xcode

Verified end-to-end against the local backend: register → sync → browse all
5 texts → both verse layouts → language toggle → sign out, plus a
backend-down reload confirming content still reads from cache.

Known gaps, deliberately not fixed:
- **Sections are a screen that always shows one row.** Every text has exactly
  one placeholder section named after the text, so the middle level is
  currently pure ceremony. Built as specified because real sections are
  expected; collapse it if they never arrive.
- **Audio playback is unverified on a real device.** The wiring is confirmed
  (correct track per language, controls change state) and the source is
  healthy (HTTP 206, valid MP3, 725KB in 0.23s), but `<audio>` never loads in
  the automated browser used to test, and there's no Xcode here for a
  simulator. Needs one pass in Expo Go.
- Phase 1's Railway deploy is still pending, so the app currently only works
  against a backend on your LAN.

(The Phase 2 gap "no progress writes, the app is read-only against the API"
is closed by Phase 3.)

## Phase 3 — Training plan / spaced repetition ✅ done

Inherited from Phase 2, decided as follows:
- Progress rows key off the JWT's user id. One account is one learner, so the
  server already knows who practised — no profile id to pass.
- `*_chunks` are already rendered phrase-by-phrase on the verse screen; they
  are the natural unit to reveal one at a time. `seed/review.md` flags 3
  records whose Gujarati and transliteration chunk counts disagree, which
  will break any side-by-side phrase drill until reconciled.

- [x] SM-2/Leitner scheduler (`backend/src/lib/scheduler.js`) — pure, no DB
      and no clock of its own, so it's testable without Postgres and can be
      mirrored on the phone. Migration `003_scheduling.sql` adds the counters
      it branches on (`repetitions`, `lapses`, `last_reviewed_at`)
- [x] "Practice today" screen (`mobile/src/app/practice.tsx`): everything due
      first and uncapped, then new verses up to the day's budget. Prompt →
      recall → reveal phrase-by-phrase → grade. "Again" re-queues the verse at
      the tail, so it comes back before the session ends
- [x] Self-assessment (again/hard/easy) → `POST /progress`. The phone
      schedules locally the instant it's tapped and queues the *event*; the
      server recomputes from its own row and hands back the canonical
      schedule, which overwrites the local guess
- [x] Goals screen (`mobile/src/app/goals.tsx`): pick a text + date, see the
      daily pace and a progress bar. The pace feeds the queue's new-verse
      budget, so a goal genuinely changes what tomorrow introduces
- [x] Migration `004_started_on.sql` — dates a verse's first introduction.
      Without it the daily cap is per-screen, not per-day: practise today's
      three, reopen, get three more, and the pace is decorative
- [ ] **(still needs you)** Phase 1's Railway deploy — unchanged, and now
      four migrations behind rather than two

Verified end-to-end against the local backend, in the browser: practise a
verse → "again" re-queues it (5 → 6 in the session counter) → set a goal for
Satsang Diksha → the queue re-paces to 3/day and draws from that text →
finish the session → the day's budget is spent and reopening offers no more
new verses → reload with the backend stopped, and the queue, progress and
goal pace all still render from SQLite.

`npm test` in `backend/`: 50/50 (14 of them need no database).

Decisions worth knowing:
- **The scheduler exists twice** — `backend/src/lib/scheduler.js` and
  `mobile/src/lib/scheduler.ts`, deliberately line-for-line. Practice has to
  work with no signal, so the phone must schedule immediately; the server
  stays authoritative and the two self-heal on the next sync. Change one,
  change the other.
- **Dates come from the client.** The phone is the only thing that knows what
  day it is where the learner is; a UTC server rolls the day over
  mid-afternoon for anyone west of Greenwich.
- **The three flagged chunk-count mismatches never came up.** The reveal shows
  one script at a time, so Gujarati and transliteration are never placed side
  by side. Reconciling them is still needed before any side-by-side drill.
- Sign-out wipes progress, the outbox and goals from the device. Content is
  shared and stays.

Known gaps, deliberately not fixed:
- **`GET /practice/today` is not what the app calls.** The phone builds its
  queue from SQLite (`buildQueue`) because practice must work offline, and it
  already holds the whole corpus. The endpoint computes the same queue for a
  client that doesn't cache, and is what the queue tests exercise — but today
  nothing in the app uses it.
- **No streak or "practised today" surface.** `last_reviewed_at` is stored and
  is what such a check would read; the display is Phase 4.
- **A verse's session position isn't persisted.** Quitting mid-session and
  returning rebuilds the queue — already-graded verses are correctly gone, but
  an ungraded "again" verse loses its place in the lap.
- **Goals are text-only in the UI.** The API takes `target_type: 'section'`
  and the tests cover it, but with one placeholder section per text there is
  nothing meaningful to pick yet.
- Phase 1's rate-limiting and `POST /kids` role gaps are unchanged.

## Phase 4 — Reminders & engagement

Parent-facing summary notification (weekly progress digest) was descoped —
v1 is one account, one learner (see Phase 2), and there's no parent/kid
split yet for a summary to be *of* someone else's practice. Revisit once
profile switching exists.

- [x] Daily practice reminder — a **local** notification
      (`mobile/src/lib/reminders.ts`, `expo-notifications`), not an Expo
      push. The phone already knows what time it is where the learner is
      (same reasoning as `localToday()` in the scheduler), so a server round
      trip and a stored push token would add a moving part for nothing a
      local, on-device schedule doesn't already do — and it works from a
      phone that's never been online since install. `/reminders` offers three
      preset times rather than a free time picker, to avoid a new native
      dependency for "morning, after school, or evening".
- [x] Streak tracking (consecutive days practised). `progress.last_reviewed_at`
      can't answer "which days did this learner practise" — it only holds a
      verse's *latest* review, so a verse touched on day 1 and again on day 5
      leaves no trace of day 1. Migration `005_review_events.sql` adds an
      append-only log; `computeStreak` (added to both `scheduler.js` and
      `scheduler.ts`, same mirroring rule as the rest of that file) turns a
      set of practice days into `{current, longest, practicedToday}`. The
      phone keeps its own `practice_log` in SQLite so the streak works
      offline, and merges in `GET /practice/days` on sync (union, never
      replace) so a reinstall or second device doesn't reset it to zero.
- [ ] Parent-facing summary notification — descoped, see above.

Verified: backend streak logic via `scheduler.test.js` (edge cases: a day not
yet practised doesn't reset the streak until it's actually over; a skipped
day breaks it; the longest run needn't be the current one) and
`practice.test.js` (`/practice/days`, `/streak`, per-learner isolation).
`npm test` in `backend/`: 61/61.

## Phase 5 — Audio

- [x] Reference audio playback per verse — already existed since Phase 2/3
      (`AudioBar`, streamed from `bkymukhpath.nahq.baps.dev`). What Phase 5
      adds is **offline** playback: `mobile/src/lib/audio-cache.ts` caches a
      verse's track to disk the first time it's opened. Deliberately not
      folded into the corpus sync — that pulls ~130KB of text on every
      launch, and eagerly downloading every verse's audio alongside it would
      turn a fast, cheap sync into a slow, data-hungry one for texts the
      learner may never open. `AudioBar` only swaps to the cached file on
      the *next* visit to a verse, never mid-playback, so a background
      download can't yank the currently-playing track out from under the
      `key={url}` remount it already relies on.
- [x] Local recording (`mobile/src/components/recording-bar.tsx`,
      `mobile/src/lib/recordings.ts`, `expo-audio`'s recorder API): a kid
      records themselves and plays it back next to the reference, on the
      verse screen and again after reveal in practice. One take per verse —
      recording again replaces the last one. Written to this app's own
      document directory; nothing reads it back except that same playback
      button. No upload path exists, not even a disabled one — see
      CLAUDE.md, "No child audio ever leaves the device."
- [ ] (Later, not v1) explore STT-based auto-scoring — still flagged
      needs-research, untouched this phase. Sanskrit pronunciation isn't
      well covered by most off-the-shelf models.

Known gaps, deliberately not fixed:
- **No bulk "download this text for offline" action.** Caching is
  per-verse-on-open; a learner who wants a whole text available before
  losing signal has to open each verse once first.
- **Reminder times are three presets, not a free picker.** Good enough for a
  small pilot; a real time picker is a native dependency this phase didn't
  need yet.
- Phase 1's Railway deploy is still pending — unchanged, and now five
  migrations behind rather than four.

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
