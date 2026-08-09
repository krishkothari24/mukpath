import { pool } from "../db.js";
import { GRADES, computeStreak, dailyPace, review, toDateString } from "../lib/scheduler.js";

// Progress, the daily practice queue, and goals.
//
// Everything here keys off `request.user.sub` — the JWT's user id. One
// account is one learner (see mobile/src/lib/auth.tsx), so there is no
// profile id in any path or body: the server already knows who practised,
// and accepting one from the client would be an authorisation hole for free.

const MAX_REVIEW_BATCH = 200;

// How many verses a day's queue holds when no goal sets a pace. Big enough
// to be a real session, small enough that a learner with 50 untouched verses
// isn't handed all 50 on day one.
const DEFAULT_NEW_PER_DAY = 5;

const VERSE_COLUMNS = `
  v.id, v.sanskrit, v.transliteration, v.meaning, v.audio_url,
  v.question, v.question_transliteration, v.question_gujarati,
  v.reference, v.reference_gujarati, v.audio_url_english, v.has_shlok,
  v.sanskrit_chunks, v.transliteration_chunks, v.meaning_chunks,
  v.order_index AS verse_order,
  s.id AS section_id, s.name AS section_name, s.order_index AS section_order,
  s.text_id
`;

/**
 * The client's "today".
 *
 * The phone is the only thing that knows what day it is where the learner
 * is; a server in UTC would roll a Californian's day over at 5pm. So the
 * date is a request parameter, validated to a plain YYYY-MM-DD and defaulted
 * to the server's date when absent.
 */
function requestDate(value) {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const parsed = Date.parse(`${value}T00:00:00Z`);
    if (!Number.isNaN(parsed)) return value;
  }
  return new Date().toISOString().slice(0, 10);
}

export default async function practiceRoutes(fastify) {
  const auth = { onRequest: [fastify.authenticate] };

  /** Every progress row for the learner — the phone mirrors this into SQLite. */
  fastify.get("/progress", auth, async (request) => {
    const { rows } = await pool.query(
      `SELECT verse_id, status, next_review_date, ease_factor, interval_days,
              repetitions, lapses, started_on, last_reviewed_at, updated_at
         FROM progress WHERE user_id = $1 ORDER BY verse_id`,
      [request.user.sub],
    );
    return rows.map(serialiseProgress);
  });

  /**
   * Record self-assessments.
   *
   * A batch, because the phone practises offline and flushes a session's
   * worth at once. The client sends *what happened* (verse + grade + when),
   * never the computed schedule: the phone schedules optimistically so the
   * UI can move, but the server recomputes from its own stored row so two
   * devices can't disagree about where a verse sits.
   */
  fastify.post("/progress", auth, async (request, reply) => {
    const userId = request.user.sub;
    const body = request.body ?? {};
    const reviews = Array.isArray(body.reviews) ? body.reviews : null;
    if (!reviews) {
      return reply.code(400).send({ error: "reviews must be an array" });
    }
    if (reviews.length > MAX_REVIEW_BATCH) {
      return reply.code(400).send({ error: `at most ${MAX_REVIEW_BATCH} reviews per request` });
    }
    for (const entry of reviews) {
      if (!entry || typeof entry.verse_id !== "string" || !GRADES.includes(entry.grade)) {
        return reply
          .code(400)
          .send({ error: `each review needs a verse_id and a grade of ${GRADES.join("/")}` });
      }
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const updated = new Map();
      for (const entry of reviews) {
        const verse = await client.query("SELECT id FROM verses WHERE id = $1", [entry.verse_id]);
        if (verse.rowCount === 0) {
          await client.query("ROLLBACK");
          return reply.code(404).send({ error: `unknown verse: ${entry.verse_id}` });
        }

        // Row-locked, so replaying the same batch twice concurrently can't
        // interleave two reads of the same pre-review state.
        const existing = await client.query(
          `SELECT status, next_review_date, ease_factor, interval_days, repetitions, lapses
             FROM progress WHERE user_id = $1 AND verse_id = $2 FOR UPDATE`,
          [userId, entry.verse_id],
        );

        const reviewedOn = requestDate(entry.reviewed_on ?? body.today);
        const next = review(existing.rows[0] ?? null, entry.grade, reviewedOn);

        const { rows } = await client.query(
          `INSERT INTO progress (user_id, verse_id, status, next_review_date, ease_factor,
                                 interval_days, repetitions, lapses, started_on,
                                 last_reviewed_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now(), now())
           ON CONFLICT (user_id, verse_id) DO UPDATE SET
             status = EXCLUDED.status,
             next_review_date = EXCLUDED.next_review_date,
             ease_factor = EXCLUDED.ease_factor,
             interval_days = EXCLUDED.interval_days,
             repetitions = EXCLUDED.repetitions,
             lapses = EXCLUDED.lapses,
             -- First introduction only: a later review must not move it, or
             -- the daily cap would forgive itself every time.
             started_on = COALESCE(progress.started_on, EXCLUDED.started_on),
             last_reviewed_at = EXCLUDED.last_reviewed_at,
             updated_at = now()
           RETURNING verse_id, status, next_review_date, ease_factor, interval_days,
                     repetitions, lapses, started_on, last_reviewed_at, updated_at`,
          [
            userId,
            entry.verse_id,
            next.status,
            next.next_review_date,
            next.ease_factor,
            next.interval_days,
            next.repetitions,
            next.lapses,
            reviewedOn,
          ],
        );
        updated.set(entry.verse_id, serialiseProgress(rows[0]));

        // The streak's source of truth. `progress.started_on`/`last_reviewed_at`
        // can't answer "which days did this learner practise" — only the
        // latest one survives a second review on the same verse.
        await client.query(
          `INSERT INTO review_events (user_id, verse_id, grade, reviewed_on)
           VALUES ($1, $2, $3, $4)`,
          [userId, entry.verse_id, entry.grade, reviewedOn],
        );
      }

      await client.query("COMMIT");
      return { progress: [...updated.values()] };
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  });

  /**
   * Today's queue: everything due, then as many new verses as the pace allows.
   *
   * Due reviews come first and are never capped. Forgetting is the expensive
   * failure — a verse reviewed late is a verse partly lost — so the cap only
   * ever limits how much *new* material gets introduced.
   */
  fastify.get("/practice/today", auth, async (request) => {
    const userId = request.user.sub;
    const today = requestDate(request.query?.date);
    const goals = await activeGoals(userId, today);

    const due = await pool.query(
      `SELECT ${VERSE_COLUMNS}, p.status, p.next_review_date, p.ease_factor,
              p.interval_days, p.repetitions, p.lapses
         FROM progress p
         JOIN verses v ON v.id = p.verse_id
         JOIN sections s ON s.id = v.section_id
        WHERE p.user_id = $1
          AND p.status <> 'new'
          AND p.next_review_date IS NOT NULL
          AND p.next_review_date <= $2
        ORDER BY p.next_review_date, s.order_index, v.order_index`,
      [userId, today],
    );

    // New verses in corpus order, but a goal's target jumps its text to the
    // front: if you've committed to finishing Satsang Diksha by adhiveshan,
    // that's what today's new material should come from.
    const goalTextIds = goals.map((goal) => goal.text_id);
    const fresh = await pool.query(
      `SELECT ${VERSE_COLUMNS}
         FROM verses v
         JOIN sections s ON s.id = v.section_id
         LEFT JOIN progress p ON p.verse_id = v.id AND p.user_id = $1
        WHERE p.verse_id IS NULL OR p.status = 'new'
        ORDER BY (s.text_id = ANY($2::text[])) DESC, s.text_id, s.order_index, v.order_index`,
      [userId, goalTextIds],
    );

    // The pace is a *daily* budget, so what today already introduced comes
    // off it. Otherwise finishing the queue and reopening the screen just
    // hands out another full day's worth.
    const introduced = await pool.query(
      "SELECT COUNT(*)::int AS count FROM progress WHERE user_id = $1 AND started_on = $2",
      [userId, today],
    );
    const introducedToday = introduced.rows[0].count;

    const dailyLimit = goals.length
      ? goals.reduce((total, goal) => total + goal.pace.perDay, 0)
      : DEFAULT_NEW_PER_DAY;
    const newLimit = Math.max(0, dailyLimit - introducedToday);

    return {
      date: today,
      due: due.rows.map(serialiseQueueVerse),
      new: fresh.rows.slice(0, newLimit).map(serialiseQueueVerse),
      counts: {
        due: due.rowCount,
        new_available: fresh.rowCount,
        new_limit: newLimit,
        new_introduced_today: introducedToday,
        daily_limit: dailyLimit,
      },
      goals,
    };
  });

  /**
   * Every distinct day this learner has practised, oldest first.
   *
   * The phone merges this into its own `practice_log` on sync so a streak
   * survives a reinstall or a second device; day-to-day it computes the
   * streak itself from that local log, same as goals recompute pace locally
   * against today's date (see mobile/src/lib/db.ts `listGoals`).
   */
  fastify.get("/practice/days", auth, async (request) => {
    const { rows } = await pool.query(
      `SELECT DISTINCT reviewed_on FROM review_events WHERE user_id = $1 ORDER BY reviewed_on`,
      [request.user.sub],
    );
    return rows.map((row) => toDateString(row.reviewed_on));
  });

  /**
   * The streak, computed server-side.
   *
   * Not what the app calls day to day — the phone computes this itself from
   * its local `practice_log` so it works offline, same gap as
   * `GET /practice/today` (see PHASES.md). This exists for a REST-client
   * smoke test and so a fresh install has something to show before its first
   * sync populates the local log.
   */
  fastify.get("/streak", auth, async (request) => {
    const today = requestDate(request.query?.date);
    const { rows } = await pool.query(
      `SELECT DISTINCT reviewed_on FROM review_events WHERE user_id = $1`,
      [request.user.sub],
    );
    return computeStreak(rows.map((row) => toDateString(row.reviewed_on)), today);
  });

  fastify.get("/goals", auth, async (request) => {
    return activeGoals(request.user.sub, requestDate(request.query?.date));
  });

  /**
   * Set (or move) a goal. Upserts on the target, so re-picking a text with a
   * new date changes the date rather than starting a second race for it.
   */
  fastify.post("/goals", auth, async (request, reply) => {
    const { target_type: targetType, target_id: targetId, target_date: targetDate } =
      request.body ?? {};

    if (!["text", "section"].includes(targetType)) {
      return reply.code(400).send({ error: "target_type must be text or section" });
    }
    if (typeof targetId !== "string" || !targetId) {
      return reply.code(400).send({ error: "target_id is required" });
    }
    if (typeof targetDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) {
      return reply.code(400).send({ error: "target_date must be YYYY-MM-DD" });
    }

    const table = targetType === "text" ? "texts" : "sections";
    const exists = await pool.query(`SELECT id FROM ${table} WHERE id = $1`, [targetId]);
    if (exists.rowCount === 0) {
      return reply.code(404).send({ error: `unknown ${targetType}: ${targetId}` });
    }

    const { rows } = await pool.query(
      `INSERT INTO goals (user_id, target_type, target_id, target_date)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id, target_type, target_id)
         DO UPDATE SET target_date = EXCLUDED.target_date
       RETURNING id`,
      [request.user.sub, targetType, targetId, targetDate],
    );

    const goals = await activeGoals(request.user.sub, requestDate(request.body?.today));
    const goal = goals.find((item) => item.id === rows[0].id);
    return reply.code(201).send(goal);
  });

  fastify.delete("/goals/:id", auth, async (request, reply) => {
    const { rowCount } = await pool.query("DELETE FROM goals WHERE id = $1 AND user_id = $2", [
      request.params.id,
      request.user.sub,
    ]);
    if (rowCount === 0) return reply.code(404).send({ error: "goal not found" });
    return reply.code(204).send();
  });
}

/**
 * Goals with their progress and the pace they now imply.
 *
 * Pace is recomputed on every read rather than stored: it is a function of
 * how much is left and how many days remain, both of which change daily
 * without anyone touching the goal row.
 */
async function activeGoals(userId, today) {
  const { rows } = await pool.query(
    `SELECT g.id, g.target_type, g.target_id, g.target_date,
            CASE WHEN g.target_type = 'text' THEN t.name ELSE sec.name END AS target_name,
            CASE WHEN g.target_type = 'text' THEN g.target_id ELSE sec.text_id END AS text_id,
            stats.total, stats.started, stats.mastered
       FROM goals g
       LEFT JOIN texts t ON g.target_type = 'text' AND t.id = g.target_id
       LEFT JOIN sections sec ON g.target_type = 'section' AND sec.id = g.target_id
       CROSS JOIN LATERAL (
         SELECT COUNT(*)::int AS total,
                COUNT(p.verse_id) FILTER (WHERE p.status <> 'new')::int AS started,
                COUNT(p.verse_id) FILTER (WHERE p.status = 'mastered')::int AS mastered
           FROM verses v
           JOIN sections s ON s.id = v.section_id
           LEFT JOIN progress p ON p.verse_id = v.id AND p.user_id = g.user_id
          WHERE (g.target_type = 'text' AND s.text_id = g.target_id)
             OR (g.target_type = 'section' AND s.id = g.target_id)
       ) stats
      WHERE g.user_id = $1
      ORDER BY g.target_date`,
    [userId],
  );

  return rows.map((row) => {
    const targetDate = toDateString(row.target_date);
    // Pace is driven by what hasn't been *started*: anything already in
    // learning or review is on the scheduler's clock and will come back on
    // its own. What needs rationing is how much new material to introduce.
    const pace = dailyPace({ remaining: row.total - row.started, targetDate, today });
    return {
      id: row.id,
      target_type: row.target_type,
      target_id: row.target_id,
      target_name: row.target_name,
      text_id: row.text_id,
      target_date: targetDate,
      total: row.total,
      started: row.started,
      mastered: row.mastered,
      pace,
    };
  });
}

function serialiseProgress(row) {
  return {
    ...row,
    next_review_date: row.next_review_date ? toDateString(row.next_review_date) : null,
    started_on: row.started_on ? toDateString(row.started_on) : null,
    ease_factor: Number(row.ease_factor),
    last_reviewed_at: row.last_reviewed_at ? row.last_reviewed_at.toISOString() : null,
    updated_at: row.updated_at ? row.updated_at.toISOString() : null,
  };
}

/** A queue entry: the full verse (the phone may not have synced it) plus its schedule. */
function serialiseQueueVerse(row) {
  const {
    status,
    next_review_date: nextReviewDate,
    ease_factor: easeFactor,
    interval_days: intervalDays,
    repetitions,
    lapses,
    ...verse
  } = row;

  return {
    ...verse,
    progress: status
      ? {
          status,
          next_review_date: nextReviewDate ? toDateString(nextReviewDate) : null,
          ease_factor: Number(easeFactor),
          interval_days: intervalDays,
          repetitions,
          lapses,
        }
      : null,
  };
}
