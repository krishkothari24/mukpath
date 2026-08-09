# Mukhpath Training App

## What this is

A native mobile app (iOS + Android) that helps BAPS kids/families memorize
mukhpath (scripture verses — Satsang Diksha, karikas, daily puja verses,
etc.) with structured goals, spaced-repetition review, and reminders.
Successor to an existing Telegram bot (@nc27mukhpathguidebot) built by
someone else at NC27 — this is a companion app, not a scrape-and-replace.

Starting scope: small pilot group, not multi-mandal yet. Design the data
model to not paint us into a corner on multi-tenancy, but don't build
multi-tenant infra until there's a second group asking for it.

See `PHASES.md` for the build roadmap and current task breakdown.

## Tech stack

- **Mobile**: React Native + Expo (managed workflow). One codebase,
  Expo handles push notifications and store builds without touching
  native Xcode/Android Studio config directly.
- **Backend**: Node + Fastify, Postgres (Railway).
- **Offline cache**: expo-sqlite on device — verse content and progress
  need to work with no connectivity; sync progress up when back online.
- **Local audio**: on-device only, no server upload of recordings.

## Data model

```
texts       (id, name, description)
sections    (id, text_id, name, order)
verses      (id, section_id, sanskrit, transliteration, meaning,
             audio_url, order)
users       (id, name, role: parent | kid | teacher, parent_id nullable)
progress    (user_id, verse_id, status: new|learning|review|mastered,
             next_review_date, ease_factor, interval_days)
goals       (id, user_id, target_type: text|section, target_id,
             target_date)
```

`progress` is a Leitner/SM-2 hybrid — new verses + due reviews form the
daily practice queue. A goal's target_date back-calculates how many new
verses/day are needed to hit it, and that number feeds the daily queue
size.

## Conventions

- The scraper lives at `tools/mukhpath_scraper.py` in this repo. Keep it
  and its output (`mukhpath_dump.json`) out of the *shipped app bundle*
  — it's a one-off content bootstrapping tool (Python/Telethon), not a
  runtime dependency of the Expo app or the backend.
- No child audio ever leaves the device. If this constraint needs to
  change later, that's a deliberate decision, not a default.
- Favor shipping the practice loop (queue + review + goal pacing) over
  polishing earlier screens — that loop is the entire value of the app.
