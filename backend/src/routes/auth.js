import bcrypt from "bcryptjs";
import { pool } from "../db.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default async function authRoutes(fastify) {
  // Parent account creation. Kid/teacher profiles are added under a
  // parent's session via POST /kids, not registered directly — v1 has
  // no separate login for them.
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
      `INSERT INTO users (name, role, email, password_hash)
       VALUES ($1, 'parent', $2, $3)
       RETURNING id, name, role`,
      [name, email, passwordHash],
    );
    const user = rows[0];
    const token = fastify.jwt.sign({ sub: user.id, role: user.role });
    return reply.code(201).send({ token, user });
  });

  fastify.post("/auth/login", async (request, reply) => {
    const { email, password } = request.body ?? {};
    if (!email || !password) {
      return reply.code(400).send({ error: "email and password are required" });
    }

    const { rows } = await pool.query(
      "SELECT id, name, role, password_hash FROM users WHERE email = $1 AND role = 'parent'",
      [email],
    );
    const user = rows[0];
    const ok = user && (await bcrypt.compare(password, user.password_hash));
    if (!ok) {
      return reply.code(401).send({ error: "invalid email or password" });
    }

    const token = fastify.jwt.sign({ sub: user.id, role: user.role });
    return { token, user: { id: user.id, name: user.name, role: user.role } };
  });

  // Who am I / which kid profiles do I have. Handy for a REST client
  // smoke test and for the mobile app's profile switcher later.
  fastify.get("/me", { onRequest: [fastify.authenticate] }, async (request) => {
    const parentId = request.user.sub;
    const [parent, kids] = await Promise.all([
      pool.query("SELECT id, name, role, email FROM users WHERE id = $1", [parentId]),
      pool.query(
        "SELECT id, name, role FROM users WHERE parent_id = $1 ORDER BY name",
        [parentId],
      ),
    ]);
    return { ...parent.rows[0], kids: kids.rows };
  });

  // Add a kid (or teacher) profile under the logged-in parent.
  fastify.post("/kids", { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const { name, role = "kid" } = request.body ?? {};
    if (!name) {
      return reply.code(400).send({ error: "name is required" });
    }
    if (!["kid", "teacher"].includes(role)) {
      return reply.code(400).send({ error: "role must be kid or teacher" });
    }

    const { rows } = await pool.query(
      `INSERT INTO users (name, role, parent_id) VALUES ($1, $2, $3)
       RETURNING id, name, role`,
      [name, role, request.user.sub],
    );
    return reply.code(201).send(rows[0]);
  });
}
