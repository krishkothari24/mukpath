import * as SQLite from 'expo-sqlite';

import { dailyPace, localToday, review, type Grade } from '@/lib/scheduler';
import type { Goal, ProgressRow, Section, Text, Verse } from '@/lib/types';

const DATABASE_NAME = 'mukhpath.db';

// The whole corpus is 5 texts / 50 verses / ~130KB, so this cache holds
// *everything*, not a working subset. Every screen reads from SQLite and
// never from the network directly — that's what makes offline reads work
// without a sync engine. See lib/sync.ts for how it gets filled.
const SCHEMA = `
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS texts (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT
);

CREATE TABLE IF NOT EXISTS sections (
  id          TEXT PRIMARY KEY,
  text_id     TEXT NOT NULL,
  name        TEXT NOT NULL,
  order_index INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS verses (
  id                       TEXT PRIMARY KEY,
  section_id               TEXT NOT NULL,
  -- Denormalised from sections so a text's verse count is one query.
  text_id                  TEXT NOT NULL,
  sanskrit                 TEXT,
  transliteration          TEXT,
  meaning                  TEXT,
  audio_url                TEXT,
  audio_url_english        TEXT,
  question                 TEXT,
  question_transliteration TEXT,
  question_gujarati        TEXT,
  reference                TEXT,
  reference_gujarati       TEXT,
  has_shlok                INTEGER NOT NULL DEFAULT 0,
  -- JSON arrays; SQLite has no array type and we only ever read them whole.
  sanskrit_chunks          TEXT NOT NULL DEFAULT '[]',
  transliteration_chunks   TEXT NOT NULL DEFAULT '[]',
  meaning_chunks           TEXT NOT NULL DEFAULT '[]',
  order_index              INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_sections_text ON sections (text_id, order_index);
CREATE INDEX IF NOT EXISTS idx_verses_section ON verses (section_id, order_index);
CREATE INDEX IF NOT EXISTS idx_verses_text ON verses (text_id, order_index);

-- Small key/value store for device-local settings: chosen script, active
-- kid profile, last successful sync. Deliberately not SecureStore — none of
-- it is a secret, and it wants to be queryable alongside content.
CREATE TABLE IF NOT EXISTS prefs (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Phase 3. Unlike content, these three are *per learner*: they hold whoever
-- is signed in on this device and are wiped on sign-out (see clearPractice).

-- Mirror of the server's progress rows, plus whatever this device has graded
-- since the last successful sync. No user_id column: one device, one account.
CREATE TABLE IF NOT EXISTS progress (
  verse_id         TEXT PRIMARY KEY,
  status           TEXT NOT NULL DEFAULT 'new',
  next_review_date TEXT,
  ease_factor      REAL NOT NULL DEFAULT 2.5,
  interval_days    INTEGER NOT NULL DEFAULT 0,
  repetitions      INTEGER NOT NULL DEFAULT 0,
  lapses           INTEGER NOT NULL DEFAULT 0,
  -- The day this verse was first introduced. What makes the goal's pace a
  -- daily budget rather than a per-screen one; see buildQueue.
  started_on       TEXT,
  last_reviewed_at TEXT
);

-- The outbox. A grade is recorded here the moment it's tapped and stays until
-- the server acknowledges it, which is what makes a whole practice session on
-- a plane survive. Rows are the *event* (verse + grade + when), never the
-- computed schedule — the server recomputes that itself.
CREATE TABLE IF NOT EXISTS pending_reviews (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  verse_id    TEXT NOT NULL,
  grade       TEXT NOT NULL,
  reviewed_on TEXT NOT NULL,
  created_at  TEXT NOT NULL
);

-- Goals are read-mostly and always server-computed (pace depends on counts
-- across the whole corpus), so this is a cache of GET /goals, not a source of
-- truth. Creating one requires connectivity.
CREATE TABLE IF NOT EXISTS goals (
  id          TEXT PRIMARY KEY,
  target_type TEXT NOT NULL,
  target_id   TEXT NOT NULL,
  target_name TEXT,
  text_id     TEXT,
  target_date TEXT NOT NULL,
  -- The plan this goal belongs to (NULL for a goal set outside the
  -- multi-select form), so the Goals screen can group and remove several
  -- texts as one unit. See backend/src/migrations/006_plans.sql.
  plan_id     TEXT,
  total       INTEGER NOT NULL DEFAULT 0,
  started     INTEGER NOT NULL DEFAULT 0,
  mastered    INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_progress_due ON progress (next_review_date);

-- Phase 4. Distinct days this device has recorded a review on, for the
-- streak. Unlike \`progress\`, a row here is never overwritten — a verse
-- reviewed again on a later day doesn't erase the earlier day the way a
-- "last reviewed" column would. Wiped on sign-out along with the rest of
-- practice history (see clearPractice): the streak belongs to whoever
-- signed in, not the device.
CREATE TABLE IF NOT EXISTS practice_log (
  day TEXT PRIMARY KEY
);
`;

// Schema version, tracked in SQLite's own `user_version` pragma — expo-sqlite
// ships no migration runner and this is the pattern its docs use. `CREATE
// TABLE IF NOT EXISTS` above covers fresh installs; this only has to carry
// devices that already hold an older cache.
//
//   1 — Phase 2: content cache and prefs
//   2 — Phase 3: progress, pending_reviews, goals, progress.started_on
//   3 — Phase 4: practice_log (streak days)
//   4 — goals.plan_id (multi-text plans)
const SCHEMA_VERSION = 4;

async function migrateSchema(database: SQLite.SQLiteDatabase): Promise<void> {
  const row = await database.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  if ((row?.user_version ?? 0) >= SCHEMA_VERSION) return;

  const progressColumns = await database.getAllAsync<{ name: string }>('PRAGMA table_info(progress)');
  if (!progressColumns.some((column) => column.name === 'started_on')) {
    await database.execAsync('ALTER TABLE progress ADD COLUMN started_on TEXT');
  }

  const goalColumns = await database.getAllAsync<{ name: string }>('PRAGMA table_info(goals)');
  if (!goalColumns.some((column) => column.name === 'plan_id')) {
    await database.execAsync('ALTER TABLE goals ADD COLUMN plan_id TEXT');
  }

  // CREATE TABLE IF NOT EXISTS in SCHEMA already covers this for anyone
  // upgrading straight to version 4; nothing else to backfill — a device
  // with no local history simply starts its streak at zero, and existing
  // goals just have no plan until the next sync assigns one.

  await database.execAsync(`PRAGMA user_version = ${SCHEMA_VERSION}`);
}

let databasePromise: Promise<SQLite.SQLiteDatabase> | null = null;

export function getDatabase(): Promise<SQLite.SQLiteDatabase> {
  if (!databasePromise) {
    databasePromise = (async () => {
      const database = await SQLite.openDatabaseAsync(DATABASE_NAME);
      await database.execAsync(SCHEMA);
      await migrateSchema(database);
      return database;
    })();
  }
  return databasePromise;
}

/**
 * Transactions, one at a time.
 *
 * `withTransactionAsync` is not reentrant: a second one opened while another
 * is still running fails with "cannot start a transaction within a
 * transaction". Phase 3 made that reachable — a content sync and a practice
 * sync can land together. The obvious fix, `withExclusiveTransactionAsync`,
 * isn't implemented on web, which is the app's dev surface (see
 * mobile/README.md), so instead every writer queues here and waits its turn.
 *
 * Only writes are serialised. Reads still run concurrently, which is the same
 * non-exclusive isolation this file has always had.
 */
let writeQueue: Promise<unknown> = Promise.resolve();

function withWriteTransaction(
  database: SQLite.SQLiteDatabase,
  task: (txn: SQLite.SQLiteDatabase) => Promise<void>,
): Promise<void> {
  const result = writeQueue.then(
    () => database.withTransactionAsync(() => task(database)),
    () => database.withTransactionAsync(() => task(database)),
  );
  // A failed write must not poison the queue for everyone behind it.
  writeQueue = result.catch(() => undefined);
  return result;
}

type VerseRow = Omit<Verse, 'has_shlok' | 'sanskrit_chunks' | 'transliteration_chunks' | 'meaning_chunks'> & {
  has_shlok: number;
  sanskrit_chunks: string;
  transliteration_chunks: string;
  meaning_chunks: string;
};

function parseChunks(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function toVerse(row: VerseRow): Verse {
  return {
    ...row,
    has_shlok: row.has_shlok === 1,
    sanskrit_chunks: parseChunks(row.sanskrit_chunks),
    transliteration_chunks: parseChunks(row.transliteration_chunks),
    meaning_chunks: parseChunks(row.meaning_chunks),
  };
}

export async function listTexts(): Promise<Text[]> {
  const database = await getDatabase();
  return database.getAllAsync<Text>('SELECT id, name, description FROM texts ORDER BY name');
}

export async function listSections(textId: string): Promise<Section[]> {
  const database = await getDatabase();
  return database.getAllAsync<Section>(
    'SELECT id, text_id, name, order_index FROM sections WHERE text_id = ? ORDER BY order_index',
    [textId],
  );
}

/** Every section, across all texts — lets the library screen skip straight
 *  to a text's section when it only has one, instead of an in-between list
 *  of one item. */
export async function listAllSections(): Promise<Section[]> {
  const database = await getDatabase();
  return database.getAllAsync<Section>(
    'SELECT id, text_id, name, order_index FROM sections ORDER BY text_id, order_index',
  );
}

export async function getText(textId: string): Promise<Text | null> {
  const database = await getDatabase();
  return database.getFirstAsync<Text>('SELECT id, name, description FROM texts WHERE id = ?', [
    textId,
  ]);
}

export async function getSection(sectionId: string): Promise<Section | null> {
  const database = await getDatabase();
  return database.getFirstAsync<Section>(
    'SELECT id, text_id, name, order_index FROM sections WHERE id = ?',
    [sectionId],
  );
}

export async function listVerses(sectionId: string): Promise<Verse[]> {
  const database = await getDatabase();
  const rows = await database.getAllAsync<VerseRow>(
    'SELECT * FROM verses WHERE section_id = ? ORDER BY order_index',
    [sectionId],
  );
  return rows.map(toVerse);
}

/**
 * Every verse that's been started, weakest first — lowest ease factor, then
 * most lapses, so the ones that keep slipping surface before ones that are
 * merely not-yet-due.
 *
 * Feeds "Practise anyway" (see app/index.tsx `PracticeCard`): once today's
 * SRS queue is empty there's nothing *due*, but a kid who wants to keep
 * going should land on the verses giving them the most trouble, not a dead
 * end. It's free practice, not a review — no grading, no `progress` write —
 * so drilling here can't be mistaken for a real review and can't skew the
 * schedule (same guarantee as `app/free-practice.tsx`).
 */
export async function listWeakestVerses(limit = 30): Promise<Verse[]> {
  const database = await getDatabase();
  const rows = await database.getAllAsync<VerseRow>(
    `SELECT v.* FROM verses v
       JOIN progress p ON p.verse_id = v.id
      WHERE p.status <> 'new'
      ORDER BY p.ease_factor ASC, p.lapses DESC, v.text_id, v.order_index
      LIMIT ?`,
    [limit],
  );
  return rows.map(toVerse);
}

/** Verse counts keyed by section id — one query for a whole list screen. */
export async function verseCountsBySection(textId: string): Promise<Record<string, number>> {
  const database = await getDatabase();
  const rows = await database.getAllAsync<{ section_id: string; count: number }>(
    'SELECT section_id, COUNT(*) AS count FROM verses WHERE text_id = ? GROUP BY section_id',
    [textId],
  );
  return Object.fromEntries(rows.map((row) => [row.section_id, row.count]));
}

export async function verseCountsByText(): Promise<Record<string, number>> {
  const database = await getDatabase();
  const rows = await database.getAllAsync<{ text_id: string; count: number }>(
    'SELECT text_id, COUNT(*) AS count FROM verses GROUP BY text_id',
  );
  return Object.fromEntries(rows.map((row) => [row.text_id, row.count]));
}

export async function getPref(key: string): Promise<string | null> {
  const database = await getDatabase();
  const row = await database.getFirstAsync<{ value: string }>(
    'SELECT value FROM prefs WHERE key = ?',
    [key],
  );
  return row?.value ?? null;
}

export async function setPref(key: string, value: string): Promise<void> {
  const database = await getDatabase();
  await database.runAsync(
    'INSERT INTO prefs (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = ?',
    [key, value, value],
  );
}

export async function clearPref(key: string): Promise<void> {
  const database = await getDatabase();
  await database.runAsync('DELETE FROM prefs WHERE key = ?', [key]);
}

// --- Practice: progress, the outbox, goals -------------------------------

export async function allProgress(): Promise<Record<string, ProgressRow>> {
  const database = await getDatabase();
  const rows = await database.getAllAsync<ProgressRow>('SELECT * FROM progress');
  return Object.fromEntries(rows.map((row) => [row.verse_id, row]));
}

export async function getProgress(verseId: string): Promise<ProgressRow | null> {
  const database = await getDatabase();
  return database.getFirstAsync<ProgressRow>('SELECT * FROM progress WHERE verse_id = ?', [verseId]);
}

async function writeProgress(
  database: SQLite.SQLiteDatabase,
  row: ProgressRow,
): Promise<void> {
  await database.runAsync(
    `INSERT INTO progress (verse_id, status, next_review_date, ease_factor, interval_days,
                           repetitions, lapses, started_on, last_reviewed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (verse_id) DO UPDATE SET
       status = excluded.status,
       next_review_date = excluded.next_review_date,
       ease_factor = excluded.ease_factor,
       interval_days = excluded.interval_days,
       repetitions = excluded.repetitions,
       lapses = excluded.lapses,
       -- First introduction only, matching the server's COALESCE.
       started_on = COALESCE(progress.started_on, excluded.started_on),
       last_reviewed_at = excluded.last_reviewed_at`,
    [
      row.verse_id,
      row.status,
      row.next_review_date,
      row.ease_factor,
      row.interval_days,
      row.repetitions,
      row.lapses,
      row.started_on,
      row.last_reviewed_at,
    ],
  );
}

/**
 * Record a graded review: schedule locally and queue it for the server.
 *
 * Both writes happen in one transaction, so the outbox can never disagree
 * with what the learner sees — either the verse moved and the server will
 * hear about it, or neither happened.
 */
export async function recordReview(
  verseId: string,
  grade: Grade,
  today: string,
): Promise<ProgressRow> {
  const database = await getDatabase();
  const current = await getProgress(verseId);
  const next = review(current, grade, today);
  const row: ProgressRow = {
    verse_id: verseId,
    ...next,
    started_on: current?.started_on ?? today,
    last_reviewed_at: new Date().toISOString(),
  };

  await withWriteTransaction(database, async (txn) => {
    await writeProgress(txn, row);
    await txn.runAsync(
      'INSERT INTO pending_reviews (verse_id, grade, reviewed_on, created_at) VALUES (?, ?, ?, ?)',
      [verseId, grade, today, new Date().toISOString()],
    );
    // Streak source of truth: today is now a practised day, whether or not
    // this is the first review of it.
    await txn.runAsync('INSERT OR IGNORE INTO practice_log (day) VALUES (?)', [today]);
  });

  return row;
}

export type PendingReview = { id: number; verse_id: string; grade: Grade; reviewed_on: string };

export async function pendingReviews(): Promise<PendingReview[]> {
  const database = await getDatabase();
  return database.getAllAsync<PendingReview>(
    'SELECT id, verse_id, grade, reviewed_on FROM pending_reviews ORDER BY id',
  );
}

export async function pendingReviewCount(): Promise<number> {
  const database = await getDatabase();
  const row = await database.getFirstAsync<{ count: number }>(
    'SELECT COUNT(*) AS count FROM pending_reviews',
  );
  return row?.count ?? 0;
}

/**
 * Clear acknowledged reviews and adopt the server's schedule for them.
 *
 * Only the ids that were actually sent are deleted — anything graded while
 * the request was in flight stays queued for the next flush.
 */
export async function settleReviews(ids: number[], serverRows: ProgressRow[]): Promise<void> {
  const database = await getDatabase();
  await withWriteTransaction(database, async (txn) => {
    if (ids.length) {
      await txn.runAsync(
        `DELETE FROM pending_reviews WHERE id IN (${ids.map(() => '?').join(',')})`,
        ids,
      );
    }
    for (const row of serverRows) await writeProgress(txn, row);
  });
}

/**
 * Adopt the server's full progress set.
 *
 * Rows still sitting in the outbox are left alone: the server hasn't seen
 * those grades yet, so its version of those verses is stale by definition and
 * overwriting would silently undo a review the learner just did.
 */
export async function mergeServerProgress(rows: ProgressRow[]): Promise<void> {
  const database = await getDatabase();
  const queued = new Set((await pendingReviews()).map((entry) => entry.verse_id));
  await withWriteTransaction(database, async (txn) => {
    for (const row of rows) {
      if (!queued.has(row.verse_id)) await writeProgress(txn, row);
    }
  });
}

/** Every day this device has ever logged a review on, for `computeStreak`. */
export async function practiceDays(): Promise<string[]> {
  const database = await getDatabase();
  const rows = await database.getAllAsync<{ day: string }>('SELECT day FROM practice_log');
  return rows.map((row) => row.day);
}

/**
 * Fold the server's day list into the local one.
 *
 * Only ever adds days, never removes — a day this device logged locally is
 * still true even if the server's copy is stale, and this is what lets the
 * streak recover after a reinstall or on a second device (see
 * `GET /practice/days`).
 */
export async function mergePracticeDays(days: string[]): Promise<void> {
  if (!days.length) return;
  const database = await getDatabase();
  await withWriteTransaction(database, async (txn) => {
    for (const day of days) {
      await txn.runAsync('INSERT OR IGNORE INTO practice_log (day) VALUES (?)', [day]);
    }
  });
}

export async function listGoals(): Promise<Goal[]> {
  const database = await getDatabase();
  const rows = await database.getAllAsync<Omit<Goal, 'pace'>>(
    'SELECT * FROM goals ORDER BY target_date',
  );
  // Pace is derived, not stored — recompute it against today's date so a
  // cached goal read offline still shows an honest number.
  const today = localToday();
  return rows.map((row) => ({
    ...row,
    pace: dailyPace({ remaining: row.total - row.started, targetDate: row.target_date, today }),
  }));
}

export async function replaceGoals(goals: Goal[]): Promise<void> {
  const database = await getDatabase();
  await withWriteTransaction(database, async (txn) => {
    await txn.execAsync('DELETE FROM goals');
    for (const goal of goals) {
      await txn.runAsync(
        `INSERT INTO goals (id, target_type, target_id, target_name, text_id, target_date,
                            plan_id, total, started, mastered)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          goal.id,
          goal.target_type,
          goal.target_id,
          goal.target_name,
          goal.text_id,
          goal.target_date,
          goal.plan_id,
          goal.total,
          goal.started,
          goal.mastered,
        ],
      );
    }
  });
}

/**
 * Today's queue, built entirely from SQLite.
 *
 * Deliberately not a call to `GET /practice/today`: practice is the one thing
 * that must work with no signal, and the device already holds the whole
 * corpus. The server endpoint computes the same queue for clients that don't
 * cache; this is the offline path.
 *
 * Due reviews are never capped — forgetting is the expensive failure. The cap
 * only limits how much *new* material gets introduced, and it is a budget for
 * the whole day: verses already introduced today come off it, so finishing a
 * session and reopening the screen doesn't hand out another full day's worth.
 */
export async function buildQueue(
  today: string,
  dailyLimit: number,
  preferredTextIds: string[] = [],
): Promise<{ due: Verse[]; fresh: Verse[]; newAvailable: number; introducedToday: number }> {
  const database = await getDatabase();

  const introduced = await database.getFirstAsync<{ count: number }>(
    'SELECT COUNT(*) AS count FROM progress WHERE started_on = ?',
    [today],
  );
  const introducedToday = introduced?.count ?? 0;
  const newLimit = Math.max(0, dailyLimit - introducedToday);

  const dueRows = await database.getAllAsync<VerseRow>(
    `SELECT v.* FROM verses v
       JOIN progress p ON p.verse_id = v.id
      WHERE p.status <> 'new' AND p.next_review_date IS NOT NULL AND p.next_review_date <= ?
      ORDER BY p.next_review_date, v.text_id, v.order_index`,
    [today],
  );

  const placeholders = preferredTextIds.map(() => '?').join(',');
  const freshRows = await database.getAllAsync<VerseRow>(
    `SELECT v.* FROM verses v
       LEFT JOIN progress p ON p.verse_id = v.id
      WHERE p.verse_id IS NULL OR p.status = 'new'
      ORDER BY ${preferredTextIds.length ? `(v.text_id IN (${placeholders})) DESC,` : ''}
               v.text_id, v.order_index`,
    preferredTextIds,
  );

  return {
    due: dueRows.map(toVerse),
    fresh: freshRows.slice(0, newLimit).map(toVerse),
    newAvailable: freshRows.length,
    introducedToday,
  };
}

/** Wipe everything learner-specific. Called on sign-out; content stays. */
export async function clearPractice(): Promise<void> {
  const database = await getDatabase();
  await database.execAsync(
    'DELETE FROM progress; DELETE FROM pending_reviews; DELETE FROM goals; DELETE FROM practice_log;',
  );
}

/**
 * Replace the cached corpus in one transaction.
 *
 * A full replace rather than a diff: at 50 verses it costs milliseconds, and
 * it means content deleted upstream actually disappears here. If the write
 * fails halfway the transaction rolls back and the old cache survives, which
 * is the behaviour we want — a partial corpus is worse than a stale one.
 */
export async function replaceContent(
  texts: Text[],
  sections: Section[],
  verses: Verse[],
): Promise<void> {
  const database = await getDatabase();
  await withWriteTransaction(database, async (txn) => {
    await txn.execAsync('DELETE FROM verses; DELETE FROM sections; DELETE FROM texts;');

    for (const text of texts) {
      await txn.runAsync('INSERT INTO texts (id, name, description) VALUES (?, ?, ?)', [
        text.id,
        text.name,
        text.description ?? null,
      ]);
    }

    for (const section of sections) {
      await txn.runAsync(
        'INSERT INTO sections (id, text_id, name, order_index) VALUES (?, ?, ?, ?)',
        [section.id, section.text_id, section.name, section.order_index],
      );
    }

    for (const verse of verses) {
      await txn.runAsync(
        `INSERT INTO verses (
           id, section_id, text_id, sanskrit, transliteration, meaning,
           audio_url, audio_url_english, question, question_transliteration,
           question_gujarati, reference, reference_gujarati, has_shlok,
           sanskrit_chunks, transliteration_chunks, meaning_chunks, order_index
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          verse.id,
          verse.section_id,
          verse.text_id,
          verse.sanskrit,
          verse.transliteration,
          verse.meaning,
          verse.audio_url,
          verse.audio_url_english,
          verse.question,
          verse.question_transliteration,
          verse.question_gujarati,
          verse.reference,
          verse.reference_gujarati,
          verse.has_shlok ? 1 : 0,
          JSON.stringify(verse.sanskrit_chunks ?? []),
          JSON.stringify(verse.transliteration_chunks ?? []),
          JSON.stringify(verse.meaning_chunks ?? []),
          verse.order_index,
        ],
      );
    }
  });
}
