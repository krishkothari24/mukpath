import bcrypt from "bcryptjs";
import { pool } from "../db.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default async function authRoutes(fastify) {
  // One account, one learner — no parent/kid hierarchy. Whoever registers
  // is who practises and who logs in.
  fastify.post("/auth/register", async (request, reply) => {
    const { name, email, password } = request.body ?? {};
    if (!name || !email || !password) {
      return reply.code(400).send({ error: "name, email, and password are required" });
    }
    if (!EMAIL_RE.test(email)) {
      return reply.code(400).send({ error: "invalid email" });
    }
    if (password.length < 8) {
      return reply.code(400).send({ error: "password must be at least 8 characters" });
    }

    const existing = await pool.query("SELECT id FROM users WHERE email = $1", [email]);
    if (existing.rowCount > 0) {
      return reply.code(409).send({ error: "an account with that email already exists" });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const { rows } = await pool.query(
      `INSERT INTO users (name, email, password_hash)
       VALUES ($1, $2, $3)
       RETURNING id, name, email`,
      [name, email, passwordHash],
    );
    const user = rows[0];
    const token = fastify.jwt.sign({ sub: user.id });
    return reply.code(201).send({ token, user });
  });

  fastify.post("/auth/login", async (request, reply) => {
    const { email, password } = request.body ?? {};
    if (!email || !password) {
      return reply.code(400).send({ error: "email and password are required" });
    }

    const { rows } = await pool.query(
      "SELECT id, name, password_hash FROM users WHERE email = $1",
      [email],
    );
    const user = rows[0];
    const ok = user && (await bcrypt.compare(password, user.password_hash));
    if (!ok) {
      return reply.code(401).send({ error: "invalid email or password" });
    }

    const token = fastify.jwt.sign({ sub: user.id });
    return { token, user: { id: user.id, name: user.name, email: user.email } };
  });

  // Who am I. Handy for a REST client smoke test and for the mobile app's
  // session restore on launch.
  fastify.get("/me", { onRequest: [fastify.authenticate] }, async (request) => {
    const { rows } = await pool.query(
      "SELECT id, name, email FROM users WHERE id = $1",
      [request.user.sub],
    );
    return rows[0];
  });
}
