// The scheduler: given a verse's current progress and how the learner said
// that recall went, produce the next progress row.
//
// Pure — no database, no clock of its own (the caller passes `today`). That
// is deliberate: it makes the whole algorithm testable without Postgres, and
// it is the reason this file can be mirrored almost line-for-line in
// mobile/src/lib/scheduler.ts. The phone schedules optimistically while
// offline; the server recomputes authoritatively when the review syncs up.
// Both must agree, so **any change here needs the same change there**.
//
// SM-2/Leitner hybrid, as CLAUDE.md specifies:
//
//   - New and lapsed verses go through fixed learning steps (Leitner), not
//     an ease multiplier. SM-2's multiplier is meaningless on an interval of
//     zero, and a kid who has just seen a verse for the first time needs to
//     see it tomorrow regardless of what any formula says.
//   - Graduated verses use SM-2's interval * ease_factor, with ease nudged
//     by the self-assessment.
//
// Three grades, not SM-2's 0–5 scale. "How did that go?" is a question a
// ten-year-old can answer with three buttons; a six-point quality scale is
// a question about the algorithm, not about their recall.

/** @typedef {'again' | 'hard' | 'easy'} Grade */

export const GRADES = ["again", "hard", "easy"];

// Ease bounds. 1.3 is SM-2's floor — below it intervals barely grow and a
// verse effectively never leaves daily review. No upper bound in SM-2; 2.8
// keeps a run of "easy" from launching a verse a year into the future off
// three good days.
const MIN_EASE = 1.3;
const MAX_EASE = 2.8;

const EASE_DELTA = { again: -0.2, hard: -0.15, easy: 0.1 };

// Learning steps, in days, for a verse that hasn't graduated yet. Index by
// `repetitions`: first success → tomorrow, second → three days, then it
// graduates to the ease-driven schedule.
const LEARNING_STEPS = [1, 3];

// Once an interval reaches this, the verse is "mastered" — still reviewed,
// just rarely. Two months is roughly the horizon a goal/adhiveshan cycle
// cares about, and it keeps `mastered` meaning "reliably retained" rather
// than "answered easily once".
const MASTERY_INTERVAL_DAYS = 60;

// Ceiling on the interval. Without one, a long run of "easy" compounds past
// what a Date can even represent — and a verse scheduled five years out has
// effectively left the app. A year is the longest gap this content should
// ever go unreviewed.
const MAX_INTERVAL_DAYS = 365;

/** A verse never practised before. Not persisted until it is first graded. */
export function initialProgress() {
  return {
    status: "new",
    ease_factor: 2.5,
    interval_days: 0,
    repetitions: 0,
    lapses: 0,
    next_review_date: null,
  };
}

function clampEase(value) {
  return Math.min(MAX_EASE, Math.max(MIN_EASE, Number(value.toFixed(4))));
}

/** `date` shifted by whole days, as a YYYY-MM-DD string (what `next_review_date` is). */
export function addDays(date, days) {
  const next = new Date(`${toDateString(date)}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().slice(0, 10);
}

/** Accepts a Date, a Date-like, or an already-formatted YYYY-MM-DD string. */
export function toDateString(date) {
  if (typeof date === "string") return date.slice(0, 10);
  return date.toISOString().slice(0, 10);
}

/**
 * Apply one self-assessment.
 *
 * @param {object|null} current  existing progress row, or null for a first review
 * @param {Grade} grade
 * @param {Date|string} today    the review's date; caller's clock, not ours
 * @returns {{status: string, ease_factor: number, interval_days: number,
 *            repetitions: number, lapses: number, next_review_date: string}}
 */
export function review(current, grade, today) {
  if (!GRADES.includes(grade)) {
    throw new Error(`unknown grade: ${grade}`);
  }

  const previous = { ...initialProgress(), ...(current ?? {}) };
  const ease = clampEase(Number(previous.ease_factor) + EASE_DELTA[grade]);
  const graduated = previous.status === "review" || previous.status === "mastered";

  let repetitions;
  let lapses = Number(previous.lapses) || 0;
  let intervalDays;
  let status;

  if (grade === "again") {
    // Forgotten. Back to the start of the learning steps and due again today,
    // so it comes round once more in this same session — the whole point of
    // saying "again" is to see it again now, not tomorrow.
    if (graduated) lapses += 1;
    repetitions = 0;
    intervalDays = 0;
    status = "learning";
  } else if (!graduated) {
    // Still in the learning steps. "Hard" holds position — repeat the current
    // step rather than advancing — while "easy" advances one step.
    repetitions =
      grade === "hard"
        ? Math.max(1, Number(previous.repetitions))
        : Number(previous.repetitions) + 1;

    if (grade === "hard") {
      intervalDays = LEARNING_STEPS[Math.min(repetitions, LEARNING_STEPS.length) - 1];
      status = "learning";
    } else if (repetitions > LEARNING_STEPS.length) {
      // Every step survived: hand over to the ease-driven schedule, starting
      // from the last step rather than from scratch.
      intervalDays = Math.round(LEARNING_STEPS[LEARNING_STEPS.length - 1] * ease);
      status = "review";
    } else {
      intervalDays = LEARNING_STEPS[repetitions - 1];
      status = "learning";
    }
  } else {
    // Graduated: SM-2 proper.
    repetitions = Number(previous.repetitions) + 1;
    const base = Math.max(1, Number(previous.interval_days));
    // "Hard" still moves forward — it was recalled — just barely. Growing
    // slower than ease would is what stops a shaky verse compounding.
    intervalDays = Math.round(base * (grade === "hard" ? 1.2 : ease));
    status = "review";
  }

  intervalDays = Math.min(MAX_INTERVAL_DAYS, Math.max(0, intervalDays));
  if (status === "review" && intervalDays >= MASTERY_INTERVAL_DAYS) {
    status = "mastered";
  }

  return {
    status,
    ease_factor: ease,
    interval_days: intervalDays,
    repetitions,
    lapses,
    next_review_date: addDays(today, intervalDays),
  };
}

/**
 * How many new verses a day a goal needs.
 *
 * Counts only verses not yet started — anything already in learning/review is
 * in the queue on its own schedule and doesn't need introducing again. The
 * result feeds the daily queue size, so it rounds up: 7 verses over 3 days is
 * 3/day, not 2, or the goal quietly slips.
 */
export function dailyPace({ remaining, targetDate, today }) {
  const days = daysBetween(today, targetDate);
  if (remaining <= 0) return { remaining, daysLeft: Math.max(0, days), perDay: 0, behind: false };
  if (days <= 0) {
    // The date is here or gone and there is still material left: everything
    // outstanding is due now, and the goal is behind.
    return { remaining, daysLeft: 0, perDay: remaining, behind: true };
  }
  return { remaining, daysLeft: days, perDay: Math.ceil(remaining / days), behind: false };
}

/** Whole days from `from` to `to`, both YYYY-MM-DD-able. Negative if `to` is past. */
export function daysBetween(from, to) {
  const start = Date.parse(`${toDateString(from)}T00:00:00Z`);
  const end = Date.parse(`${toDateString(to)}T00:00:00Z`);
  return Math.round((end - start) / 86_400_000);
}

/**
 * Consecutive-day streak from a set of practice days.
 *
 * Pure, like the rest of this file: given the days a learner practised
 * (however they were sourced — a DB query server-side, SQLite's
 * `practice_log` on the phone) and what day it is, say how many days in a
 * row that includes.
 *
 * A day not yet practised doesn't break the streak until it's actually over —
 * "current" counts back from today if today is done, or from yesterday if
 * it isn't, so the streak survives showing up at 11pm rather than resetting
 * to zero the moment midnight has passed and before anyone has practised.
 */
export function computeStreak(days, today) {
  const unique = [...new Set(days.map((day) => toDateString(day)))].sort();
  const set = new Set(unique);
  const todayStr = toDateString(today);
  const practicedToday = set.has(todayStr);

  let longest = 0;
  let run = 0;
  let previous = null;
  for (const day of unique) {
    run = previous !== null && daysBetween(previous, day) === 1 ? run + 1 : 1;
    longest = Math.max(longest, run);
    previous = day;
  }

  let current = 0;
  let cursor = practicedToday ? todayStr : addDays(todayStr, -1);
  while (set.has(cursor)) {
    current += 1;
    cursor = addDays(cursor, -1);
  }

  return { current, longest, practicedToday };
}

export const SCHEDULER_CONSTANTS = {
  MIN_EASE,
  MAX_EASE,
  EASE_DELTA,
  LEARNING_STEPS,
  MASTERY_INTERVAL_DAYS,
  MAX_INTERVAL_DAYS,
};
