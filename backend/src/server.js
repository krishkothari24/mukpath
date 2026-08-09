import "dotenv/config";
import Fastify from "fastify";
import authPlugin from "./plugins/auth.js";
import authRoutes from "./routes/auth.js";
import textsRoutes from "./routes/texts.js";

export function buildServer({ logger = true } = {}) {
  const fastify = Fastify({ logger });

  fastify.get("/health", async () => ({ ok: true }));

  fastify.register(authPlugin);
  fastify.register(authRoutes);
  fastify.register(textsRoutes);

  return fastify;
}

async function main() {
  const fastify = buildServer();
  const port = Number(process.env.PORT) || 3000;
  try {
    await fastify.listen({ port, host: "0.0.0.0" });
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
}

// Only auto-start when run directly (`node src/server.js`), not when
// imported by tests.
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
