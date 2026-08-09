# Mukhpath mobile app

Expo (SDK 57) + expo-router. Sign in, browse the corpus, read it offline,
and practise it: a spaced-repetition queue with goal-driven pacing.

## Running it

The app needs the backend. Start that first:

```sh
cd ../backend
npm run dev            # http://localhost:3000
```

Then:

```sh
npm install
npm start              # scan the QR code with Expo Go
```

**You do not need to configure an IP.** The app derives the backend address
from the host Metro is already serving on, so a phone on the same Wi-Fi
reaches your Mac automatically. The address in use is printed at the bottom
of the sign-in screen — check there first when nothing loads. To point
somewhere else, `cp .env.example .env` and set `EXPO_PUBLIC_API_URL`.

The backend binds `0.0.0.0`, so it is already reachable from the LAN.

### In a browser

```sh
npm run web
```

Convenient when you don't have a phone handy, with two caveats:

- The backend needs CORS. It reflects any origin by default, so this works
  out of the box locally — see `CORS_ORIGIN` in `../backend/.env.example`.
- `metro.config.js` sets COOP/COEP headers, which expo-sqlite's WebAssembly
  build requires. That's dev-server-only and does not affect iOS/Android.

Web is a development convenience. The pilot ships to iOS and Android.

## How it's put together

```
src/lib/      config, api client, SQLite cache, sync, scheduler,
              auth + content + practice contexts
src/app/      expo-router screens
src/components/  shared UI
```

**Every screen reads from SQLite, never from the network.** `lib/sync.ts`
pulls the whole corpus (5 texts, 50 verses, ~130KB — six requests) into
SQLite on launch and replaces it in one transaction; screens re-query when
the sync bumps `revision`. That is what makes offline work without a sync
engine, and it means a failed refresh degrades to stale content rather than
an empty screen.

There is no incremental sync. The server has no `updated_at` to build one
from; when the corpus outgrows a full replace, that's a backend change first.

## The practice loop

`/practice` is the point of the app. A session is: prompt → recall → reveal
phrase-by-phrase → say how it went (again / hard / easy). The phrases are the
source's own `*_chunks` boundaries; revealing the lot at once turns recall
into recognition.

Three pieces make it work offline:

- **`lib/scheduler.ts`** is a line-for-line mirror of
  `backend/src/lib/scheduler.js`. Change one, change the other. It exists
  twice so a grade can be scheduled the instant it's tapped, with no network.
- **The outbox** (`pending_reviews`) holds every grade until the server
  acknowledges it. A whole session on a plane survives; a failed flush costs
  a delay, not a review.
- **The server is authoritative.** The phone sends the *event* (verse, grade,
  date), never its computed schedule; `POST /progress` recomputes and returns
  the canonical rows, which overwrite the local guess. Divergence self-heals.

`lib/db.ts` `buildQueue` assembles the queue from SQLite alone: everything
due (never capped) followed by new verses up to the day's budget. The budget
is the active goals' combined pace, or 5 with no goal, minus whatever was
already introduced today — otherwise finishing a session and reopening the
screen would hand out another full day's worth.

Goals (`/goals`) are the one thing that needs connectivity: the pace is
computed from corpus-wide counts, so there's no sensible offline guess.

## Streaks and reminders (Phase 4)

The streak (shown on the home screen) is computed on-device by
`computeStreak` in `lib/scheduler.ts`, from a local `practice_log` table that
`recordReview` writes to alongside progress — one row per day practised,
never overwritten. `GET /practice/days` merges the server's copy in on
sync so a reinstall or a second device doesn't reset it to zero, but day to
day nothing about the streak needs a network request.

The daily reminder (`/reminders`) is a **local** notification
(`lib/reminders.ts`, `expo-notifications`), not a server push: the phone
already knows what time it is where the learner is, same reasoning as
`localToday()`. No push token is ever registered with the backend.

## Offline audio and recording (Phase 5)

Reference audio is cached to disk the first time a verse is opened
(`lib/audio-cache.ts`), not eagerly for the whole corpus during sync — that
would turn a fast ~130KB sync into one that also downloads however many
megabytes of mp3 for texts the learner may never open. `AudioBar` swaps to
the cached file only on the *next* visit to a verse, never mid-playback, so
a background download can never yank the currently-playing track out from
under a remount.

`RecordingBar` lets a kid record themselves and play it back next to the
reference. It never leaves the device — `lib/recordings.ts` writes to this
app's own document directory and nothing else reads from it. See CLAUDE.md:
"No child audio ever leaves the device."

## Things worth knowing before you edit

- **`sanskrit` is Gujarati script**, `transliteration` is romanised Gujarati,
  `meaning` is English. The names come from the original schema in
  `CLAUDE.md`, written before anyone knew what the content looked like.
- **40 of the 50 verses have no shlok.** For those the memorised material is
  the *answer* and `question` is the prompt. `has_shlok` picks between two
  layouts on the verse screen; get this wrong and 80% of the app is untitled
  prose.
- **Sections are placeholders.** Every text has exactly one, named after the
  text. The screen exists for when that changes (splitting Satsang Diksha by
  shlok range is a known want).
- **One account, one learner.** The backend can still model kid profiles
  under a parent (`parent_id`, `POST /kids`) and `GET /me` returns a `kids`
  array, but the app ignores all of it — whoever is signed in is who is
  practising. Progress keys off the JWT's user id, and sign-out wipes
  progress, the outbox and goals from the device (cached content stays).
- **SQLite writes are serialised in JS** (`withWriteTransaction` in
  `lib/db.ts`). `withTransactionAsync` is not reentrant and the exclusive
  variant that would fix that isn't implemented on web, which is the dev
  surface here.
- **The SQLite cache has a schema version** in the `user_version` pragma.
  Adding a column means bumping `SCHEMA_VERSION` and handling the upgrade in
  `migrateSchema` — `CREATE TABLE IF NOT EXISTS` only helps fresh installs.
- **Audio streams from `bkymukhpath.nahq.baps.dev` until it's cached.** A
  verse's first play still needs a connection; after that the track plays
  from disk. There is no bulk "download this text for offline" action —
  caching is per-verse and happens on open.
