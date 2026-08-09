// The scheduler is pure, so this suite needs no database and always runs —
// unlike smoke.test.js, which skips itself without Postgres. If the algorithm
// regresses, this is what says so.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  addDays,
  computeStreak,
  daysBetween,
  dailyPace,
  initialProgress,
  review,
  SCHEDULER_CONSTANTS,
} from "../src/lib/scheduler.js";

const TODAY = "2026-08-09";

describe("scheduler", () => {
  it("rejects an unknown grade", () => {
    assert.throws(() => review(null, "medium", TODAY), /unknown grade/);
  });

  it("introduces a brand-new verse for tomorrow when recalled", () => {
    const next = review(null, "easy", TODAY);
    assert.equal(next.status, "learning");
    assert.equal(next.interval_days, 1);
    assert.equal(next.repetitions, 1);
    assert.equal(next.next_review_date, "2026-08-10");
  });

  it("keeps a forgotten verse in today's session", () => {
    const next = review(null, "again", TODAY);
    assert.equal(next.status, "learning");
    assert.equal(next.interval_days, 0);
    // Due today, not tomorrow: "again" means show it again now.
    assert.equal(next.next_review_date, TODAY);
  });

  it("walks the learning steps then graduates", () => {
    const first = review(null, "easy", TODAY);
    const second = review(first, "easy", "2026-08-10");
    assert.equal(second.status, "learning");
    assert.equal(second.interval_days, 3);

    const third = review(second, "easy", "2026-08-13");
    assert.equal(third.status, "review");
    // Graduation hands over to ease: 3 days * ~2.7.
    assert.ok(third.interval_days >= 6, `expected a multi-day interval, got ${third.interval_days}`);
  });

  it("holds position on hard while still learning", () => {
    const first = review(null, "easy", TODAY);
    const held = review(first, "hard", "2026-08-10");
    assert.equal(held.status, "learning");
    assert.equal(held.interval_days, 1);
    assert.equal(held.repetitions, 1, "hard must not advance the step");
    assert.ok(held.ease_factor < first.ease_factor);
  });

  it("multiplies by ease once graduated, and less so for hard", () => {
    const graduated = {
      status: "review",
      ease_factor: 2.5,
      interval_days: 10,
      repetitions: 3,
      lapses: 0,
    };
    assert.equal(review(graduated, "easy", TODAY).interval_days, 26); // 10 * 2.6
    assert.equal(review(graduated, "hard", TODAY).interval_days, 12); // 10 * 1.2
  });

  it("counts a lapse and restarts learning when a graduated verse is forgotten", () => {
    const graduated = {
      status: "review",
      ease_factor: 2.5,
      interval_days: 30,
      repetitions: 4,
      lapses: 1,
    };
    const lapsed = review(graduated, "again", TODAY);
    assert.equal(lapsed.status, "learning");
    assert.equal(lapsed.lapses, 2);
    assert.equal(lapsed.repetitions, 0);
    assert.equal(lapsed.interval_days, 0);
  });

  it("does not count a lapse for a verse that never graduated", () => {
    const learning = review(null, "easy", TODAY);
    assert.equal(review(learning, "again", TODAY).lapses, 0);
  });

  it("marks a verse mastered past the mastery interval", () => {
    const long = {
      status: "review",
      ease_factor: 2.5,
      interval_days: SCHEDULER_CONSTANTS.MASTERY_INTERVAL_DAYS,
      repetitions: 6,
      lapses: 0,
    };
    assert.equal(review(long, "easy", TODAY).status, "mastered");
  });

  it("clamps ease at both ends", () => {
    let progress = { ...initialProgress(), status: "review", interval_days: 5, repetitions: 3 };
    for (let i = 0; i < 20; i += 1) progress = review(progress, "again", TODAY);
    assert.equal(progress.ease_factor, SCHEDULER_CONSTANTS.MIN_EASE);

    progress = { ...initialProgress(), status: "review", interval_days: 5, repetitions: 3 };
    for (let i = 0; i < 20; i += 1) progress = review(progress, "easy", TODAY);
    assert.equal(progress.ease_factor, SCHEDULER_CONSTANTS.MAX_EASE);
  });

  it("counts days and shifts dates across a month boundary", () => {
    assert.equal(addDays("2026-08-31", 1), "2026-09-01");
    assert.equal(daysBetween("2026-08-09", "2026-09-08"), 30);
    assert.equal(daysBetween("2026-09-08", "2026-08-09"), -30);
  });
});

describe("goal pacing", () => {
  it("rounds the daily pace up so the target date isn't missed", () => {
    const pace = dailyPace({ remaining: 7, targetDate: "2026-08-12", today: TODAY });
    assert.equal(pace.daysLeft, 3);
    assert.equal(pace.perDay, 3); // ceil(7/3) — 2/day lands a day late
    assert.equal(pace.behind, false);
  });

  it("flags a goal whose date has arrived with material left", () => {
    const pace = dailyPace({ remaining: 4, targetDate: TODAY, today: TODAY });
    assert.deepEqual(pace, { remaining: 4, daysLeft: 0, perDay: 4, behind: true });
  });

  it("asks for nothing once the goal is complete, even past its date", () => {
    const pace = dailyPace({ remaining: 0, targetDate: "2026-01-01", today: TODAY });
    assert.equal(pace.perDay, 0);
    assert.equal(pace.behind, false);
  });
});

describe("streak", () => {
  it("is zero with no practice days at all", () => {
    assert.deepEqual(computeStreak([], TODAY), { current: 0, longest: 0, practicedToday: false });
  });

  it("counts a run ending today", () => {
    const days = ["2026-08-07", "2026-08-08", TODAY];
    const streak = computeStreak(days, TODAY);
    assert.equal(streak.current, 3);
    assert.equal(streak.longest, 3);
    assert.equal(streak.practicedToday, true);
  });

  it("stays alive counting from yesterday before today's practice happens", () => {
    const days = ["2026-08-07", "2026-08-08"];
    const streak = computeStreak(days, TODAY);
    assert.equal(streak.current, 2);
    assert.equal(streak.practicedToday, false);
  });

  it("resets once a full day is skipped", () => {
    const days = ["2026-08-01", "2026-08-02", "2026-08-05", "2026-08-06"];
    const streak = computeStreak(days, TODAY);
    assert.equal(streak.current, 0, "the day before today is 08-08, which is missing");
    assert.equal(streak.longest, 2);
  });

  it("finds the longest run even when it isn't the current one", () => {
    const days = ["2026-08-01", "2026-08-02", "2026-08-03", "2026-08-07", TODAY];
    const streak = computeStreak(days, TODAY);
    // 08-08 is missing, so today's run is just today itself.
    assert.equal(streak.current, 1);
    assert.equal(streak.longest, 3);
  });

  it("ignores duplicate and out-of-order entries", () => {
    const days = [TODAY, "2026-08-08", TODAY, "2026-08-07"];
    const streak = computeStreak(days, TODAY);
    assert.equal(streak.current, 3);
    assert.equal(streak.longest, 3);
  });
});
