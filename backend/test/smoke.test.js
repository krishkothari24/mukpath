// End-to-end checks against a real Postgres, via fastify.inject (no port).
//
//   npm test
//
// Assumes `npm run migrate && npm run seed` have run. Skips entirely if the
// database isn't reachable, so it can't fail a machine that has no local
// Postgres — but it will not silently pass if the DB is there and broken.
import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { buildServer } from "../src/server.js";
import { pool } from "../src/db.js";

const created = [];

// Probed at module load, not in before(): `skip:` is evaluated when a
// describe block registers, which happens before any before() hook runs.
// Deciding there would skip every test whether or not the DB was up — a
// suite that quietly skips itself looks exactly like a passing one.
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

function email() {
  const address = `test-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`;
  created.push(address);
  return address;
}

async function registerParent() {
  const address = email();
  const res = await app.inject({
    method: "POST",
    url: "/auth/register",
    payload: { name: "Test Parent", email: address, password: "testpass123" },
  });
  assert.equal(res.statusCode, 201);
  return { address, ...res.json() };
}

describe("content", () => {
  it("serves health", { skip: skip() }, async () => {
    const res = await app.inject({ url: "/health" });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.json(), { ok: true });
  });

  it("lists the seeded texts", { skip: skip() }, async () => {
    const res = await app.inject({ url: "/texts" });
    assert.equal(res.statusCode, 200);
    const texts = res.json();
    assert.ok(texts.length >= 5, `expected >=5 texts, got ${texts.length}`);
    assert.ok(texts.some((t) => t.id === "satsang-diksha"));
  });

  it("404s an unknown text", { skip: skip() }, async () => {
    const res = await app.inject({ url: "/texts/does-not-exist/verses" });
    assert.equal(res.statusCode, 404);
  });

  it("returns verses in section then verse order", { skip: skip() }, async () => {
    const res = await app.inject({ url: "/texts/satsang-diksha/verses" });
    assert.equal(res.statusCode, 200);
    const verses = res.json();
    assert.equal(verses.length, 10);
    const orders = verses.map((v) => v.verse_order);
    assert.deepEqual(orders, [...orders].sort((a, b) => a - b));
  });

  it("carries the practice prompt for question/answer texts", { skip: skip() }, async () => {
    // 40 of 50 verses have no shlok — the question is the only thing the
    // practice screen can ask. Dropping it once made the content unusable.
    const res = await app.inject({ url: "/texts/questions-answers/verses" });
    const verses = res.json();
    assert.ok(verses.length > 0);
    for (const verse of verses) {
      assert.ok(verse.question, `${verse.id} has no question`);
      assert.equal(verse.has_shlok, false);
    }
  });

  it("exposes all three languages and audio", { skip: skip() }, async () => {
    const res = await app.inject({ url: "/texts/satsang-diksha/verses" });
    for (const verse of res.json()) {
      assert.ok(verse.sanskrit, `${verse.id} missing sanskrit`);
      assert.ok(verse.transliteration, `${verse.id} missing transliteration`);
      assert.ok(verse.meaning, `${verse.id} missing meaning`);
      assert.match(verse.audio_url, /^https:\/\//);
    }
  });

  it("returns phrase chunks as arrays", { skip: skip() }, async () => {
    const res = await app.inject({ url: "/texts/satsang-diksha/verses" });
    const verse = res.json()[0];
    assert.ok(Array.isArray(verse.meaning_chunks));
    assert.ok(verse.meaning_chunks.length > 0);
  });
});

describe("auth", () => {
  it("registers a parent and issues an expiring token", { skip: skip() }, async () => {
    const { token } = await registerParent();
    const claims = JSON.parse(
      Buffer.from(token.split(".")[1], "base64url").toString("utf8"),
    );
    assert.equal(claims.role, "parent");
    // An unbounded token means one leak is permanent access.
    assert.ok(claims.exp, "token has no exp claim");
    assert.ok(claims.exp > claims.iat);
  });

  it("rejects a duplicate email", { skip: skip() }, async () => {
    const { address } = await registerParent();
    const res = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: { name: "Other", email: address, password: "testpass123" },
    });
    assert.equal(res.statusCode, 409);
  });

  it("rejects a short password", { skip: skip() }, async () => {
    const res = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: { name: "X", email: email(), password: "short" },
    });
    assert.equal(res.statusCode, 400);
  });

  it("logs in and rejects a wrong password", { skip: skip() }, async () => {
    const { address } = await registerParent();
    const ok = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: address, password: "testpass123" },
    });
    assert.equal(ok.statusCode, 200);
    const bad = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: address, password: "wrongpass123" },
    });
    assert.equal(bad.statusCode, 401);
  });

  it("requires a token for /me", { skip: skip() }, async () => {
    const res = await app.inject({ url: "/me" });
    assert.equal(res.statusCode, 401);
  });

  it("rejects a forged unsigned token", { skip: skip() }, async () => {
    const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
    const body = Buffer.from(JSON.stringify({ sub: "x", role: "parent" })).toString("base64url");
    const res = await app.inject({
      url: "/me",
      headers: { authorization: `Bearer ${header}.${body}.` },
    });
    assert.equal(res.statusCode, 401);
  });

  it("adds a kid and lists it under the parent", { skip: skip() }, async () => {
    const { token } = await registerParent();
    const auth = { authorization: `Bearer ${token}` };
    const kid = await app.inject({
      method: "POST", url: "/kids", headers: auth, payload: { name: "Test Kid" },
    });
    assert.equal(kid.statusCode, 201);
    assert.equal(kid.json().role, "kid");

    const me = await app.inject({ url: "/me", headers: auth });
    assert.equal(me.statusCode, 200);
    assert.equal(me.json().kids.length, 1);
    assert.equal(me.json().kids[0].name, "Test Kid");
  });

  it("refuses a bogus role on /kids", { skip: skip() }, async () => {
    const { token } = await registerParent();
    const res = await app.inject({
      method: "POST",
      url: "/kids",
      headers: { authorization: `Bearer ${token}` },
      payload: { name: "Sneaky", role: "parent" },
    });
    assert.equal(res.statusCode, 400);
  });

  it("does not leak another parent's kids", { skip: skip() }, async () => {
    const a = await registerParent();
    const b = await registerParent();
    await app.inject({
      method: "POST", url: "/kids",
      headers: { authorization: `Bearer ${a.token}` },
      payload: { name: "A's Kid" },
    });
    const me = await app.inject({
      url: "/me", headers: { authorization: `Bearer ${b.token}` },
    });
    assert.deepEqual(me.json().kids, []);
  });
});
