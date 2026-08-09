// Phase 3 endpoints against a real Postgres, same shape as smoke.test.js:
// skips itself if the DB isn't up, cleans up the accounts it makes. The
// algorithm itself is covered without a database in scheduler.test.js — what
// matters here is persistence, queue composition, goal pacing, and the fact
// that one learner cannot see or touch another's progress.
import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { pool } from "../src/db.js";
import { buildServer } from "../src/server.js";

const created = [];

let app = null;
let dbDown = "";
try {
  await pool.query("SELECT 1");
  app = buildServer({ logger: false });
  await app.ready();
} catch (err) {
  dbDown = `no database: ${err.message}`;
  console.warn(`skipping suite — ${dbDown}`);
}

after(async () => {
  if (app && created.length) {
    await pool.query("DELETE FROM users WHERE email = ANY($1)", [created]);
  }
  if (app) await app.close();
  await pool.end();
});

const skip = () => dbDown || false;
const TODAY = "2026-08-09";

async function learner() {
  const address = `test-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`;
  created.push(address);
  const res = await app.inject({
    method: "POST",
    url: "/auth/register",
    payload: { name: "Test Learner", email: address, password: "testpass123" },
  });
  assert.equal(res.statusCode, 201);
  return res.json().token;
}

const authed = (token, options) => app.inject({ ...options, headers: { authorization: `Bearer ${token}` } });

async function firstVerseId() {
  const res = await app.inject({ url: "/texts/satsang-diksha/verses" });
  return res.json()[0].id;
}

describe("progress", () => {
  it("requires auth", { skip: skip() }, async () => {
    assert.equal((await app.inject({ url: "/progress" })).statusCode, 401);
    assert.equal(
      (await app.inject({ method: "POST", url: "/progress", payload: { reviews: [] } })).statusCode,
      401,
    );
  });

  it("starts empty", { skip: skip() }, async () => {
    const res = await authed(await learner(), { url: "/progress" });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.json(), []);
  });

  it("records a review and schedules the next one", { skip: skip() }, async () => {
    const token = await learner();
    const verseId = await firstVerseId();

    const res = await authed(token, {
      method: "POST",
      url: "/progress",
      payload: { reviews: [{ verse_id: verseId, grade: "easy" }], today: TODAY },
    });
    assert.equal(res.statusCode, 200);

    const [row] = res.json().progress;
    assert.equal(row.verse_id, verseId);
    assert.equal(row.status, "learning");
    assert.equal(row.interval_days, 1);
    assert.equal(row.next_review_date, "2026-08-10");
    assert.ok(row.last_reviewed_at, "a review must stamp last_reviewed_at");

    // And it survives the round trip.
    const stored = await authed(token, { url: "/progress" });
    assert.deepEqual(stored.json(), [row]);
  });

  it("compounds across reviews rather than recomputing from scratch", { skip: skip() }, async () => {
    const token = await learner();
    const verseId = await firstVerseId();
    const post = (grade, on) =>
      authed(token, {
        method: "POST",
        url: "/progress",
        payload: { reviews: [{ verse_id: verseId, grade, reviewed_on: on }] },
      });

    await post("easy", TODAY);
    await post("easy", "2026-08-10");
    const third = await post("easy", "2026-08-13");
    const [row] = third.json().progress;
    assert.equal(row.status, "review");
    assert.equal(row.repetitions, 3);
    assert.ok(row.interval_days > 3, `expected growth past the last step, got ${row.interval_days}`);
  });

  it("accepts a whole offline session in one batch", { skip: skip() }, async () => {
    const token = await learner();
    const verses = (await app.inject({ url: "/texts/satsang-diksha/verses" })).json().slice(0, 3);

    const res = await authed(token, {
      method: "POST",
      url: "/progress",
      payload: {
        reviews: verses.map((verse, index) => ({
          verse_id: verse.id,
          grade: ["easy", "hard", "again"][index],
        })),
        today: TODAY,
      },
    });
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().progress.length, 3);
  });

  it("rejects a bad grade or verse, writing nothing", { skip: skip() }, async () => {
    const token = await learner();
    const verseId = await firstVerseId();

    const badGrade = await authed(token, {
      method: "POST",
      url: "/progress",
      payload: { reviews: [{ verse_id: verseId, grade: "brilliant" }] },
    });
    assert.equal(badGrade.statusCode, 400);

    // A valid review followed by an unknown verse must roll back the valid one.
    const badVerse = await authed(token, {
      method: "POST",
      url: "/progress",
      payload: {
        reviews: [
          { verse_id: verseId, grade: "easy" },
          { verse_id: "no-such-verse", grade: "easy" },
        ],
      },
    });
    assert.equal(badVerse.statusCode, 404);

    const stored = await authed(token, { url: "/progress" });
    assert.deepEqual(stored.json(), [], "a rejected batch must not half-apply");
  });

  it("keeps one learner's progress invisible to another", { skip: skip() }, async () => {
    const [mine, theirs] = [await learner(), await learner()];
    const verseId = await firstVerseId();
    await authed(mine, {
      method: "POST",
      url: "/progress",
      payload: { reviews: [{ verse_id: verseId, grade: "easy" }], today: TODAY },
    });

    assert.deepEqual((await authed(theirs, { url: "/progress" })).json(), []);
  });
});

describe("practice queue", () => {
  it("offers new verses when nothing has been practised", { skip: skip() }, async () => {
    const res = await authed(await learner(), { url: `/practice/today?date=${TODAY}` });
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.due.length, 0);
    assert.equal(body.new.length, body.counts.new_limit);
    assert.equal(body.counts.new_available, 50);
    // Queue entries carry the whole verse, so a phone that hasn't synced the
    // corpus can still practise from this response alone.
    assert.ok(body.new[0].question !== undefined && body.new[0].sanskrit !== undefined);
    assert.equal(body.new[0].progress, null);
  });

  it("doesn't re-offer a verse already scheduled for later", { skip: skip() }, async () => {
    const token = await learner();
    const verseId = await firstVerseId();
    await authed(token, {
      method: "POST",
      url: "/progress",
      payload: { reviews: [{ verse_id: verseId, grade: "easy" }], today: TODAY },
    });

    const body = (await authed(token, { url: `/practice/today?date=${TODAY}` })).json();
    assert.ok(!body.new.some((verse) => verse.id === verseId), "practised verse is no longer new");
    assert.ok(!body.due.some((verse) => verse.id === verseId), "and isn't due until tomorrow");
    assert.equal(body.counts.new_available, 49);
  });

  it("spends the day's new-verse budget only once", { skip: skip() }, async () => {
    const token = await learner();
    const first = (await authed(token, { url: `/practice/today?date=${TODAY}` })).json();
    assert.equal(first.counts.new_introduced_today, 0);
    assert.ok(first.new.length > 0);

    await authed(token, {
      method: "POST",
      url: "/progress",
      payload: {
        reviews: first.new.map((verse) => ({ verse_id: verse.id, grade: "easy" })),
        today: TODAY,
      },
    });

    // Reopening the screen must not hand out another full day's worth.
    const second = (await authed(token, { url: `/practice/today?date=${TODAY}` })).json();
    assert.equal(second.counts.new_introduced_today, first.new.length);
    assert.equal(second.counts.new_limit, 0);
    assert.equal(second.new.length, 0);

    // Tomorrow the budget is fresh again.
    const tomorrow = (await authed(token, { url: "/practice/today?date=2026-08-10" })).json();
    assert.equal(tomorrow.counts.new_introduced_today, 0);
    assert.ok(tomorrow.new.length > 0);
  });

  it("dates a verse's introduction once and never moves it", { skip: skip() }, async () => {
    const token = await learner();
    const verseId = await firstVerseId();
    const post = (on) =>
      authed(token, {
        method: "POST",
        url: "/progress",
        payload: { reviews: [{ verse_id: verseId, grade: "easy", reviewed_on: on }] },
      });

    await post(TODAY);
    const later = await post("2026-08-20");
    assert.equal(later.json().progress[0].started_on, TODAY);
  });

  it("surfaces it as due once its date arrives", { skip: skip() }, async () => {
    const token = await learner();
    const verseId = await firstVerseId();
    await authed(token, {
      method: "POST",
      url: "/progress",
      payload: { reviews: [{ verse_id: verseId, grade: "easy" }], today: TODAY },
    });

    const body = (await authed(token, { url: "/practice/today?date=2026-08-10" })).json();
    const entry = body.due.find((verse) => verse.id === verseId);
    assert.ok(entry, "expected the verse to be due on its next_review_date");
    assert.equal(entry.progress.status, "learning");
  });

  it("keeps a forgotten verse in the same day's queue", { skip: skip() }, async () => {
    const token = await learner();
    const verseId = await firstVerseId();
    await authed(token, {
      method: "POST",
      url: "/progress",
      payload: { reviews: [{ verse_id: verseId, grade: "again" }], today: TODAY },
    });

    const body = (await authed(token, { url: `/practice/today?date=${TODAY}` })).json();
    assert.ok(body.due.some((verse) => verse.id === verseId));
  });
});

describe("streak", () => {
  it("requires auth", { skip: skip() }, async () => {
    assert.equal((await app.inject({ url: "/streak" })).statusCode, 401);
    assert.equal((await app.inject({ url: "/practice/days" })).statusCode, 401);
  });

  it("is empty for a learner who hasn't practised", { skip: skip() }, async () => {
    const token = await learner();
    assert.deepEqual((await authed(token, { url: "/practice/days" })).json(), []);
    assert.deepEqual((await authed(token, { url: `/streak?date=${TODAY}` })).json(), {
      current: 0,
      longest: 0,
      practicedToday: false,
    });
  });

  it("logs one day per review, not one row per verse", { skip: skip() }, async () => {
    const token = await learner();
    const verses = (await app.inject({ url: "/texts/satsang-diksha/verses" })).json().slice(0, 2);
    await authed(token, {
      method: "POST",
      url: "/progress",
      payload: {
        reviews: verses.map((verse) => ({ verse_id: verse.id, grade: "easy" })),
        today: TODAY,
      },
    });

    assert.deepEqual((await authed(token, { url: "/practice/days" })).json(), [TODAY]);
    const streak = (await authed(token, { url: `/streak?date=${TODAY}` })).json();
    assert.equal(streak.current, 1);
    assert.equal(streak.practicedToday, true);
  });

  it("carries a streak across days a verse happens to skip", { skip: skip() }, async () => {
    const token = await learner();
    const verseId = await firstVerseId();
    const post = (on) =>
      authed(token, {
        method: "POST",
        url: "/progress",
        payload: { reviews: [{ verse_id: verseId, grade: "easy" }], today: on },
      });

    await post("2026-08-07");
    await post("2026-08-08");
    await post(TODAY);

    const streak = (await authed(token, { url: `/streak?date=${TODAY}` })).json();
    assert.equal(streak.current, 3);
    assert.equal(streak.longest, 3);
  });

  it("keeps one learner's streak invisible to another", { skip: skip() }, async () => {
    const [mine, theirs] = [await learner(), await learner()];
    const verseId = await firstVerseId();
    await authed(mine, {
      method: "POST",
      url: "/progress",
      payload: { reviews: [{ verse_id: verseId, grade: "easy" }], today: TODAY },
    });

    assert.deepEqual((await authed(theirs, { url: "/practice/days" })).json(), []);
  });
});

describe("goals", () => {
  it("validates the target", { skip: skip() }, async () => {
    const token = await learner();
    const post = (payload) => authed(token, { method: "POST", url: "/goals", payload });

    assert.equal((await post({ target_type: "chapter", target_id: "x", target_date: TODAY })).statusCode, 400);
    assert.equal((await post({ target_type: "text", target_id: "satsang-diksha", target_date: "soon" })).statusCode, 400);
    assert.equal((await post({ target_type: "text", target_id: "nope", target_date: TODAY })).statusCode, 404);
  });

  it("computes the daily pace a target date implies", { skip: skip() }, async () => {
    const token = await learner();
    const res = await authed(token, {
      method: "POST",
      url: "/goals",
      // 50 verses in Satsang Diksha? No — 10. Over 5 days that's 2/day.
      payload: {
        target_type: "text",
        target_id: "satsang-diksha",
        target_date: "2026-08-14",
        today: TODAY,
      },
    });
    assert.equal(res.statusCode, 201);
    const goal = res.json();
    assert.equal(goal.target_name, "Satsang Diksha");
    assert.equal(goal.started, 0);
    assert.equal(goal.pace.perDay, Math.ceil(goal.total / 5));
    assert.equal(goal.pace.behind, false);
  });

  it("moves the date instead of stacking a second goal", { skip: skip() }, async () => {
    const token = await learner();
    const post = (date) =>
      authed(token, {
        method: "POST",
        url: "/goals",
        payload: { target_type: "text", target_id: "satsang-diksha", target_date: date, today: TODAY },
      });

    await post("2026-08-14");
    await post("2026-09-14");

    const goals = (await authed(token, { url: `/goals?date=${TODAY}` })).json();
    assert.equal(goals.length, 1);
    assert.equal(goals[0].target_date, "2026-09-14");
  });

  it("sizes the daily queue from the goal's pace", { skip: skip() }, async () => {
    const token = await learner();
    await authed(token, {
      method: "POST",
      url: "/goals",
      payload: {
        target_type: "text",
        target_id: "satsang-diksha",
        target_date: "2026-08-11", // two days: half the text a day
        today: TODAY,
      },
    });

    const body = (await authed(token, { url: `/practice/today?date=${TODAY}` })).json();
    assert.equal(body.counts.new_limit, body.goals[0].pace.perDay);
    assert.equal(body.new.length, body.counts.new_limit);
    // And the goal's text is what gets introduced, not whatever sorts first.
    assert.ok(body.new.every((verse) => verse.text_id === "satsang-diksha"));
  });

  it("counts started verses toward the goal and re-paces", { skip: skip() }, async () => {
    const token = await learner();
    await authed(token, {
      method: "POST",
      url: "/goals",
      payload: {
        target_type: "text",
        target_id: "satsang-diksha",
        target_date: "2026-08-19",
        today: TODAY,
      },
    });
    const verses = (await app.inject({ url: "/texts/satsang-diksha/verses" })).json().slice(0, 4);
    await authed(token, {
      method: "POST",
      url: "/progress",
      payload: {
        reviews: verses.map((verse) => ({ verse_id: verse.id, grade: "easy" })),
        today: TODAY,
      },
    });

    const [goal] = (await authed(token, { url: `/goals?date=${TODAY}` })).json();
    assert.equal(goal.started, 4);
    assert.equal(goal.pace.remaining, goal.total - 4);
  });

  it("flags a goal whose date has passed with work outstanding", { skip: skip() }, async () => {
    const token = await learner();
    await authed(token, {
      method: "POST",
      url: "/goals",
      payload: {
        target_type: "text",
        target_id: "satsang-diksha",
        target_date: "2026-08-01",
        today: TODAY,
      },
    });
    const [goal] = (await authed(token, { url: `/goals?date=${TODAY}` })).json();
    assert.equal(goal.pace.behind, true);
  });

  it("deletes only its owner's goal", { skip: skip() }, async () => {
    const [mine, theirs] = [await learner(), await learner()];
    const goal = (
      await authed(mine, {
        method: "POST",
        url: "/goals",
        payload: { target_type: "text", target_id: "satsang-diksha", target_date: "2026-08-14" },
      })
    ).json();

    assert.equal((await authed(theirs, { method: "DELETE", url: `/goals/${goal.id}` })).statusCode, 404);
    assert.equal((await authed(mine, { method: "DELETE", url: `/goals/${goal.id}` })).statusCode, 204);
    assert.deepEqual((await authed(mine, { url: "/goals" })).json(), []);
  });
});
