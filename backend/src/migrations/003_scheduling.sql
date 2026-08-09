-- Phase 3: what the scheduler needs that 001 didn't carry.
--
-- 001 gave `progress` the SM-2 essentials (status, ease_factor,
-- interval_days, next_review_date) but not the two counters the algorithm
-- actually branches on: how many times in a row a verse has been recalled
-- (`repetitions`, which decides the 1-day/3-day/ease-multiplier ladder) and
-- how often it has been forgotten after graduating (`lapses`, which is the
-- only signal that a verse is chronically hard rather than merely new).
--
-- `last_reviewed_at` is a timestamp, not a date, because it is what a
-- streak/"practised today" check reads (Phase 4) and what lets the client
-- resolve two offline devices grading the same verse: newest write wins.

ALTER TABLE progress
  ADD COLUMN repetitions      INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN lapses           INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN last_reviewed_at TIMESTAMPTZ;

-- One active goal per target. A learner setting a new date for the same text
-- is moving the goalpost, not running two races — POST /goals upserts onto
-- this rather than accumulating rows that would each claim their own pace.
CREATE UNIQUE INDEX goals_user_target_idx ON goals (user_id, target_type, target_id);
