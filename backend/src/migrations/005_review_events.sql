-- Phase 4: a log of every graded review, for streak tracking.
--
-- `progress.last_reviewed_at` only holds the *latest* review of a given
-- verse, so it can't answer "which days did this learner practise" — a verse
-- reviewed on day 1 and again on day 5 leaves no trace of day 1 once day 5
-- overwrites it. Streaks need the full set of practice days, so this is an
-- append-only log alongside `progress`, not a replacement for it.
--
-- No foreign key surprises here: rows are kept even if a verse is removed
-- from the corpus later, because "did the learner practise that day" should
-- outlive the content that prompted it.

CREATE TABLE review_events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  verse_id    TEXT NOT NULL,
  grade       TEXT NOT NULL CHECK (grade IN ('again', 'hard', 'easy')),
  reviewed_on DATE NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Streak reads want "distinct days for this user", not individual events.
CREATE INDEX review_events_user_day_idx ON review_events (user_id, reviewed_on);
