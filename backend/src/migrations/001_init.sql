-- Phase 1 schema: the tables from CLAUDE.md's data model.
--
-- texts/sections/verses use slug ids (see seed/README.md) rather than
-- generated keys, so the seed data stays diffable and re-runnable.

CREATE EXTENSION IF NOT EXISTS pgcrypto; -- gen_random_uuid()

CREATE TABLE texts (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT ''
);

CREATE TABLE sections (
  id          TEXT PRIMARY KEY,
  text_id     TEXT NOT NULL REFERENCES texts(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  order_index INTEGER NOT NULL
);
CREATE INDEX sections_text_id_idx ON sections(text_id);

CREATE TABLE verses (
  id              TEXT PRIMARY KEY,
  section_id      TEXT NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
  sanskrit        TEXT,
  transliteration TEXT,
  meaning         TEXT,
  audio_url       TEXT,
  order_index     INTEGER NOT NULL
);
CREATE INDEX verses_section_id_idx ON verses(section_id);

CREATE TABLE users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  -- One account, one learner: whoever signs in is who practises. No
  -- parent/kid hierarchy — see CLAUDE.md.
  email         TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE progress (
  user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  verse_id         TEXT NOT NULL REFERENCES verses(id) ON DELETE CASCADE,
  status           TEXT NOT NULL DEFAULT 'new'
                      CHECK (status IN ('new', 'learning', 'review', 'mastered')),
  next_review_date DATE,
  ease_factor      REAL NOT NULL DEFAULT 2.5,
  interval_days    INTEGER NOT NULL DEFAULT 0,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, verse_id)
);
CREATE INDEX progress_due_idx ON progress(user_id, next_review_date);

CREATE TABLE goals (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL CHECK (target_type IN ('text', 'section')),
  target_id   TEXT NOT NULL,
  target_date DATE NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX goals_user_id_idx ON goals(user_id);
