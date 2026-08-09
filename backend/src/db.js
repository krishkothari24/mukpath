import pg from "pg";
import "dotenv/config";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set (copy .env.example to .env)");
}

// Railway's managed Postgres requires TLS but presents a cert our chain
// doesn't verify against; disable verification only in that case, never
// for a bare local `postgres://localhost` connection.
const useSsl = /sslmode=require/.test(process.env.DATABASE_URL) ||
  process.env.PGSSL === "require";

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: useSsl ? { rejectUnauthorized: false } : false,
});

export async function query(text, params) {
  return pool.query(text, params);
}
