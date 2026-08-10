-- Plans: an identity for "these texts, one date" that multi-select on the
-- Goals screen creates.
--
-- Each text still gets its own goal row — pace is still computed per target
-- (see activeGoals in routes/practice.js), because a text with 40 verses and
-- one with 5 need different daily rates to both land on the same date. What
-- a plan adds is a group the UI can show/delete as one thing instead of N
-- goal rows that merely happen to share a target_date. Goals set through the
-- pre-existing POST /goals (still supported, still used solo) have no plan
-- and behave exactly as before.

CREATE TABLE plans (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_date DATE NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX plans_user_id_idx ON plans(user_id);

-- Nullable: a goal created outside the multi-select form belongs to no plan.
-- ON DELETE CASCADE so removing a plan removes its goals in one statement
-- rather than leaving the UI to clean up orphaned rows itself.
ALTER TABLE goals ADD COLUMN plan_id UUID REFERENCES plans(id) ON DELETE CASCADE;
CREATE INDEX goals_plan_id_idx ON goals(plan_id);
