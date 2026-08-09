import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { ApiError, api } from '@/lib/api';
import {
  allProgress,
  buildQueue,
  listGoals,
  mergePracticeDays,
  mergeServerProgress,
  pendingReviews,
  practiceDays,
  recordReview,
  replaceGoals,
  settleReviews,
} from '@/lib/db';
import { computeStreak, DEFAULT_NEW_PER_DAY, localToday, type Grade, type Streak } from '@/lib/scheduler';
import type { Goal, ProgressRow, Verse } from '@/lib/types';
import { useAuth } from '@/lib/auth';
import { useContent } from '@/lib/content';

/**
 * The practice loop's state: what's due, what the goals are, and the sync
 * that reconciles this device with the server.
 *
 * Reads are local and never block on the network (see lib/db.ts `buildQueue`).
 * Sync is: flush the outbox first, *then* pull — pulling first would hand
 * back rows that don't yet know about the session just practised.
 */
type PracticeState = {
  ready: boolean;
  syncing: boolean;
  /** Last sync failure. Practice keeps working; this is informational. */
  error: string | null;
  /** Reviews graded on this device that the server hasn't acknowledged. */
  pending: number;
  goals: Goal[];
  summary: Summary;
  /** Consecutive-day practice streak, computed locally from `practice_log`. */
  streak: Streak;
  /** Grade a verse. Resolves once it's scheduled locally; the flush is async. */
  grade: (verseId: string, grade: Grade) => Promise<void>;
  createGoal: (target: { target_type: 'text' | 'section'; target_id: string; target_date: string }) => Promise<void>;
  deleteGoal: (id: string) => Promise<void>;
  sync: () => Promise<void>;
  /** Bumped whenever progress or goals change, so screens re-query. */
  revision: number;
  today: string;
};

export type Summary = {
  due: number;
  newToday: number;
  newAvailable: number;
  started: number;
  mastered: number;
  /** The queue's new-verse cap: the goals' combined pace, or the default. */
  newLimit: number;
};

const EMPTY_SUMMARY: Summary = {
  due: 0,
  newToday: 0,
  newAvailable: 0,
  started: 0,
  mastered: 0,
  newLimit: DEFAULT_NEW_PER_DAY,
};

const EMPTY_STREAK: Streak = { current: 0, longest: 0, practicedToday: false };

const PracticeContext = createContext<PracticeState | null>(null);

/** A goal's pace decides how much new material today's queue introduces. */
export function newLimitFor(goals: Goal[]): number {
  if (!goals.length) return DEFAULT_NEW_PER_DAY;
  return goals.reduce((total, goal) => total + goal.pace.perDay, 0);
}

export function PracticeProvider({ children }: { children: React.ReactNode }) {
  const { token, status } = useAuth();
  const { ready: contentReady, revision: contentRevision } = useContent();

  const [ready, setReady] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(0);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [summary, setSummary] = useState<Summary>(EMPTY_SUMMARY);
  const [streak, setStreak] = useState<Streak>(EMPTY_STREAK);
  const [revision, setRevision] = useState(0);

  // Recomputed rather than held: a session crossing midnight should roll over.
  const today = localToday();

  const refreshLocal = useCallback(async () => {
    const [localGoals, progress, queued, days] = await Promise.all([
      listGoals(),
      allProgress(),
      pendingReviews(),
      practiceDays(),
    ]);

    const limit = newLimitFor(localGoals);
    const queue = await buildQueue(
      today,
      limit,
      localGoals.map((goal) => goal.text_id).filter((id): id is string => Boolean(id)),
    );

    const rows = Object.values(progress);
    setGoals(localGoals);
    setPending(queued.length);
    setSummary({
      due: queue.due.length,
      newToday: queue.fresh.length,
      newAvailable: queue.newAvailable,
      started: rows.filter((row) => row.status !== 'new').length,
      mastered: rows.filter((row) => row.status === 'mastered').length,
      newLimit: limit,
    });
    setStreak(computeStreak(days, today));
  }, [today]);

  /**
   * Push what this device did, then adopt what the server knows.
   *
   * A 401 is left alone — lib/auth.tsx owns session expiry, and signing the
   * learner out from here would race it. Any other failure is recorded and
   * retried on the next sync; the outbox is what makes that safe.
   */
  const sync = useCallback(async () => {
    if (!token) return;
    setSyncing(true);
    setError(null);
    try {
      const queued = await pendingReviews();
      if (queued.length) {
        const { progress } = await api.submitReviews(
          token,
          queued.map((entry) => ({
            verse_id: entry.verse_id,
            grade: entry.grade,
            reviewed_on: entry.reviewed_on,
          })),
        );
        await settleReviews(
          queued.map((entry) => entry.id),
          progress as ProgressRow[],
        );
      }

      const [serverProgress, serverGoals, serverDays] = await Promise.all([
        api.progress(token),
        api.goals(token, today),
        api.practiceDays(token),
      ]);
      await mergeServerProgress(serverProgress);
      await replaceGoals(serverGoals);
      // Union, never replace — see mergePracticeDays. Recovers the streak
      // after a reinstall without letting a stale server copy erase what
      // this device already logged.
      await mergePracticeDays(serverDays);
    } catch (err) {
      if (!(err instanceof ApiError && err.status === 401)) {
        setError(err instanceof Error ? err.message : 'Could not sync practice');
      }
    } finally {
      await refreshLocal();
      setRevision((current) => current + 1);
      setSyncing(false);
    }
  }, [refreshLocal, today, token]);

  // Local state first so the screens are usable immediately, then reconcile.
  useEffect(() => {
    if (!contentReady) return;
    let cancelled = false;

    (async () => {
      await refreshLocal();
      if (cancelled) return;
      setReady(true);
      if (status === 'signedIn') await sync();
    })();

    return () => {
      cancelled = true;
    };
    // contentRevision: a corpus refresh can add verses, which changes the queue.
  }, [contentReady, contentRevision, refreshLocal, status, sync]);

  const grade = useCallback(
    async (verseId: string, value: Grade) => {
      await recordReview(verseId, value, today);
      await refreshLocal();
      setRevision((current) => current + 1);
      // Fire-and-forget: the outbox already holds the review, so a failed
      // flush costs nothing but a delay.
      void sync();
    },
    [refreshLocal, sync, today],
  );

  const createGoal = useCallback(
    async (target: { target_type: 'text' | 'section'; target_id: string; target_date: string }) => {
      if (!token) throw new Error('Sign in to set a goal');
      // Goals need the server: the pace is computed from corpus-wide counts,
      // and unlike a review there's no sensible offline guess to reconcile.
      await api.createGoal(token, { ...target, today });
      await sync();
    },
    [sync, today, token],
  );

  const deleteGoal = useCallback(
    async (id: string) => {
      if (!token) throw new Error('Sign in to change goals');
      await api.deleteGoal(token, id);
      await sync();
    },
    [sync, token],
  );

  const value = useMemo<PracticeState>(
    () => ({
      ready,
      syncing,
      error,
      pending,
      goals,
      summary,
      streak,
      grade,
      createGoal,
      deleteGoal,
      sync,
      revision,
      today,
    }),
    [
      createGoal,
      deleteGoal,
      error,
      goals,
      grade,
      pending,
      ready,
      revision,
      streak,
      summary,
      sync,
      syncing,
      today,
    ],
  );

  return <PracticeContext.Provider value={value}>{children}</PracticeContext.Provider>;
}

export function usePractice(): PracticeState {
  const context = useContext(PracticeContext);
  if (!context) throw new Error('usePractice must be used inside <PracticeProvider>');
  return context;
}

/** Today's session, in the order it should be practised. */
export async function loadSession(
  today: string,
  goals: Goal[],
): Promise<{ due: Verse[]; fresh: Verse[]; newAvailable: number }> {
  return buildQueue(
    today,
    newLimitFor(goals),
    goals.map((goal) => goal.text_id).filter((id): id is string => Boolean(id)),
  );
}
