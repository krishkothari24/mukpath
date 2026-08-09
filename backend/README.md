# backend

Fastify + Postgres API for the Mukhpath training app. Phase 1 scope: schema,
a seed loader for Phase 0 content, and the read/auth endpoints the mobile
app skeleton (Phase 2) needs first.

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
npm test                       # 16 checks against the seeded DB
```

`npm run seed` expects `seed/texts.json`, `seed/sections.json`, and
`seed/verses.json` to exist — Phase 0's `scripts/fetch_webapp.py` output
(see `docs/PHASE0.md`). To load a different set:
`npm run seed -- --dir /path/to/dir`.

`npm test` runs against the real database via `fastify.inject` (no port
binding). It skips itself with a warning if Postgres isn't reachable, and
cleans up the accounts it creates.

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
`progress` and `goals` exist now so the schema doesn't need a breaking
migration when Phase 3 (spaced repetition) lands, but nothing writes to them
yet.

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
