# backend

Fastify + Postgres API for the Mukhpath training app: schema, a seed loader
for Phase 0 content, the read/auth endpoints the mobile app needs, and the
Phase 3 spaced-repetition scheduler, practice queue and goals.

## Local setup

```
cp .env.example .env          # then edit DATABASE_URL/JWT_SECRET if needed
createdb mukhpath              # requires local Postgres running
npm install
npm run migrate                # applies src/migrations/*.sql
npm run seed                   # loads ../seed/*.json (Phase 0 output)
npm run dev                    # http://localhost:3000, restarts on change
```

```
npm test                       # 61 checks (14 need no database)
```

`npm run seed` expects `seed/texts.json`, `seed/sections.json`, and
`seed/verses.json` to exist — Phase 0's `scripts/fetch_webapp.py` output
(see `docs/PHASE0.md`). To load a different set:
`npm run seed -- --dir /path/to/dir`.

`npm test` runs against the real database via `fastify.inject` (no port
binding). It skips itself with a warning if Postgres isn't reachable, and
cleans up the accounts it creates. `test/scheduler.test.js` is the exception
— the scheduler is pure, so those 14 checks always run.

## Endpoints

| | |
| --- | --- |
| `GET /health` | liveness check |
| `GET /texts` | list all texts |
| `GET /texts/:id/verses` | a text's verses, joined with section info, in order |
| `POST /auth/register` | `{name, email, password}` → creates a parent account, returns a JWT |
| `POST /auth/login` | `{email, password}` → JWT |
| `GET /me` | parent profile + their kid/teacher profiles (auth required) |
| `POST /kids` | `{name, role?}` → adds a kid/teacher profile under the logged-in parent (auth required) |
| `GET /progress` | every progress row for the learner (auth required) |
| `POST /progress` | `{reviews: [{verse_id, grade, reviewed_on?}], today?}` → records self-assessments, returns the recomputed rows (auth required) |
| `GET /practice/today?date=` | today's queue: everything due, then new verses up to the day's budget (auth required) |
| `GET /practice/days` | every distinct day this learner has practised, oldest first (auth required) |
| `GET /streak?date=` | `{current, longest, practicedToday}` computed from `/practice/days` (auth required) |
| `GET /goals?date=` | goals with progress and the pace they now imply (auth required) |
| `POST /goals` | `{target_type, target_id, target_date, today?}` → sets or moves a goal (auth required) |
| `DELETE /goals/:id` | removes a goal (auth required) |

`grade` is `again`, `hard` or `easy`. Dates are `YYYY-MM-DD` and come from
the *client*: the phone is the only thing that knows what day it is where
the learner is, and a server in UTC would roll the day over mid-afternoon
for anyone west of Greenwich.

`POST /progress` takes a batch because the app practises offline and flushes
a session at once. It accepts the *event*, never a computed schedule — the
server recomputes from its own stored row, so two devices can't disagree
about where a verse sits. The whole batch is one transaction: an unknown
verse rejects the lot.

Auth required means `Authorization: Bearer <token>`. Only parents log in
directly in v1 — kid/teacher profiles are managed through the parent's
session, not their own login.

## Schema

`src/migrations/001_init.sql` — the `texts/sections/verses/users/progress/goals`
tables from `CLAUDE.md`. `texts`/`sections`/`verses` use the slug ids Phase 0
generates (diffable, re-runnable); `users`/`goals` use generated UUIDs.

`002_verse_prompts.sql` adds columns `CLAUDE.md` didn't anticipate, because
the real content turned out to be question/answer shaped: `question*`,
`reference*`, `audio_url_english`, `has_shlok`, and `*_chunks`. 40 of the 50
verses carry no shlok, so for those the **question is the only prompt the
practice screen has** — without it there is nothing to ask. See
`seed/review.md`.
`003_scheduling.sql` adds the counters the scheduler branches on
(`repetitions`, `lapses`, `last_reviewed_at`) and makes one goal per target
unique, so re-picking a text moves its date instead of starting a second
race for it.

`004_started_on.sql` adds `progress.started_on` — the day a verse was first
introduced. Without it the daily new-verse cap doesn't hold: the queue is
"verses not yet started, capped at the goal's pace", so practising today's
three and reopening the screen simply offers three more.

`005_review_events.sql` adds an append-only `review_events` log for the
Phase 4 streak. `progress.last_reviewed_at` only holds a verse's *latest*
review, so it can't answer "which days did this learner practise" — a verse
reviewed on day 1 and again on day 5 leaves no trace of day 1. Streaks need
the full set of practice days, hence the separate log.

## The scheduler

`src/lib/scheduler.js` is pure — no database, no clock of its own — so the
whole algorithm is testable without Postgres, and it can be mirrored in
`mobile/src/lib/scheduler.ts` for offline scheduling on the phone. **The two
must stay in step.**

It's the SM-2/Leitner hybrid `CLAUDE.md` calls for: new and lapsed verses walk
fixed learning steps (1 day, then 3), because an ease multiplier applied to an
interval of zero means nothing; graduated verses use `interval * ease_factor`.
Ease is clamped to 1.3–2.8 and intervals to a year. Past a 60-day interval a
verse is `mastered` — still reviewed, just rarely.

Three grades rather than SM-2's 0–5 scale: "how did that go?" is a question a
ten-year-old can answer with three buttons.

Migrations run via `src/migrate.js`, a ~50-line runner (no framework) that
tracks applied files in a `schema_migrations` table. Add a new
`NNN_description.sql` file and run `npm run migrate` to apply it.

## Deploying to Railway

```
railway login
railway link            # or: railway init, to create a new project
railway add             # add a Postgres plugin if the project doesn't have one
railway up
railway run npm run migrate
railway run npm run seed
```

Railway sets `DATABASE_URL` automatically when a Postgres plugin is
attached; set `JWT_SECRET` yourself (`railway variables set JWT_SECRET=...`)
— don't reuse the local dev value.
