/**
 * Mirror of `backend/src/lib/scheduler.js`. **Keep the two in step** — if a
 * constant changes there it must change here, and vice versa.
 *
 * Why it exists twice rather than living on the server: practice has to work
 * with no connectivity (CLAUDE.md), so the phone must be able to schedule the
 * next review the instant a grade is tapped. The server stays authoritative —
 * every graded review is queued and replayed to `POST /progress`, which
 * recomputes from its own stored row and hands back the canonical schedule,
 * which then overwrites what the phone guessed. Divergence is therefore
 * self-healing: worst case a verse is briefly due on the wrong day, on one
 * device, until the next sync.
 *
 * See the backend file for why the algorithm is shaped the way it is; the
 * commentary isn't repeated here so the two can't drift in what they claim.
 */

export type Grade = 'again' | 'hard' | 'easy';

export const GRADES: Grade[] = ['again', 'hard', 'easy'];

export type ProgressState = {
  status: 'new' | 'learning' | 'review' | 'mastered';
  ease_factor: number;
  interval_days: number;
  repetitions: number;
  lapses: number;
  next_review_date: string | null;
};

const MIN_EASE = 1.3;
const MAX_EASE = 2.8;
const EASE_DELTA: Record<Grade, number> = { again: -0.2, hard: -0.15, easy: 0.1 };
const LEARNING_STEPS = [1, 3];
const MASTERY_INTERVAL_DAYS = 60;
const MAX_INTERVAL_DAYS = 365;

export function initialProgress(): ProgressState {
  return {
    status: 'new',
    ease_factor: 2.5,
    interval_days: 0,
    repetitions: 0,
    lapses: 0,
    next_review_date: null,
  };
}

function clampEase(value: number): number {
  return Math.min(MAX_EASE, Math.max(MIN_EASE, Number(value.toFixed(4))));
}

export function toDateString(date: Date | string): string {
  return typeof date === 'string' ? date.slice(0, 10) : date.toISOString().slice(0, 10);
}

export function addDays(date: Date | string, days: number): string {
  const next = new Date(`${toDateString(date)}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().slice(0, 10);
}

export function daysBetween(from: Date | string, to: Date | string): number {
  const start = Date.parse(`${toDateString(from)}T00:00:00Z`);
  const end = Date.parse(`${toDateString(to)}T00:00:00Z`);
  return Math.round((end - start) / 86_400_000);
}

/**
 * The learner's local date. The server takes this as a parameter rather than
 * reading its own clock — a UTC server would roll the day over mid-afternoon
 * for anyone west of Greenwich.
 */
export function localToday(): string {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

export function review(
  current: ProgressState | null,
  grade: Grade,
  today: Date | string,
): ProgressState {
  const previous: ProgressState = { ...initialProgress(), ...(current ?? {}) };
  const ease = clampEase(Number(previous.ease_factor) + EASE_DELTA[grade]);
  const graduated = previous.status === 'review' || previous.status === 'mastered';

  let repetitions: number;
  let lapses = Number(previous.lapses) || 0;
  let intervalDays: number;
  let status: ProgressState['status'];

  if (grade === 'again') {
    if (graduated) lapses += 1;
    repetitions = 0;
    intervalDays = 0;
    status = 'learning';
  } else if (!graduated) {
    repetitions =
      grade === 'hard' ? Math.max(1, Number(previous.repetitions)) : Number(previous.repetitions) + 1;

    if (grade === 'hard') {
      intervalDays = LEARNING_STEPS[Math.min(repetitions, LEARNING_STEPS.length) - 1];
      status = 'learning';
    } else if (repetitions > LEARNING_STEPS.length) {
      intervalDays = Math.round(LEARNING_STEPS[LEARNING_STEPS.length - 1] * ease);
      status = 'review';
    } else {
      intervalDays = LEARNING_STEPS[repetitions - 1];
      status = 'learning';
    }
  } else {
    repetitions = Number(previous.repetitions) + 1;
    const base = Math.max(1, Number(previous.interval_days));
    intervalDays = Math.round(base * (grade === 'hard' ? 1.2 : ease));
    status = 'review';
  }

  intervalDays = Math.min(MAX_INTERVAL_DAYS, Math.max(0, intervalDays));
  if (status === 'review' && intervalDays >= MASTERY_INTERVAL_DAYS) {
    status = 'mastered';
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

export function dailyPace({
  remaining,
  targetDate,
  today,
}: {
  remaining: number;
  targetDate: string;
  today: string;
}): { remaining: number; daysLeft: number; perDay: number; behind: boolean } {
  const days = daysBetween(today, targetDate);
  if (remaining <= 0) return { remaining, daysLeft: Math.max(0, days), perDay: 0, behind: false };
  if (days <= 0) return { remaining, daysLeft: 0, perDay: remaining, behind: true };
  return { remaining, daysLeft: days, perDay: Math.ceil(remaining / days), behind: false };
}

/** How many new verses to introduce today when no goal is setting the pace. */
export const DEFAULT_NEW_PER_DAY = 5;

export type Streak = { current: number; longest: number; practicedToday: boolean };

/**
 * Consecutive-day streak from a set of practice days. Mirrors
 * `backend/src/lib/scheduler.js` `computeStreak` — see it for why "current"
 * counts from yesterday rather than resetting to zero before today's
 * practice happens.
 */
export function computeStreak(days: string[], today: string): Streak {
  const unique = [...new Set(days.map((day) => toDateString(day)))].sort();
  const set = new Set(unique);
  const todayStr = toDateString(today);
  const practicedToday = set.has(todayStr);

  let longest = 0;
  let run = 0;
  let previous: string | null = null;
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
