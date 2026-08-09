-- When a verse was first introduced.
--
-- Without this the daily cap doesn't hold: the queue is "verses not yet
-- started, capped at the goal's pace", so practising today's three and
-- reopening the screen simply offers three more. The pace a goal implies
-- becomes decorative, and tomorrow inherits reviews nobody planned for.
--
-- `last_reviewed_at` can't answer it — that moves on every review — and
-- `repetitions` resets to 0 on a lapse, so neither distinguishes "started
-- today" from "started in March and forgotten this morning".
--
-- Backfilled from last_reviewed_at: for a row that has only ever been
-- reviewed once that's exactly right, and for older rows it's the closest
-- honest guess. Both only affect today's cap, never the schedule itself.

ALTER TABLE progress ADD COLUMN started_on DATE;

UPDATE progress SET started_on = last_reviewed_at::date WHERE last_reviewed_at IS NOT NULL;

CREATE INDEX progress_started_on_idx ON progress (user_id, started_on);
