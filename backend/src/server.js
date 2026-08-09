import cors from "@fastify/cors";
import "dotenv/config";
import Fastify from "fastify";
import authPlugin from "./plugins/auth.js";
import authRoutes from "./routes/auth.js";
import practiceRoutes from "./routes/practice.js";
import textsRoutes from "./routes/texts.js";

export function buildServer({ logger = true } = {}) {
  const fastify = Fastify({ logger });

  // The iOS/Android app doesn't need CORS — React Native isn't a browser and
  // never sends an Origin. This exists for `npm run web` in ../mobile, which
  // is how the app is developed without Xcode.
  //
  // CORS_ORIGIN accepts a comma-separated list; unset means "reflect whatever
  // origin asked", which is fine for a laptop-only dev server and is exactly
  // what you must NOT leave unset once this is deployed anywhere public.
  const allowedOrigins = process.env.CORS_ORIGIN?.split(",").map((value) => value.trim());
  fastify.register(cors, {
    origin: allowedOrigins?.length ? allowedOrigins : true,
    credentials: false,
  });

  fastify.get("/health", async () => ({ ok: true }));

  fastify.register(authPlugin);
  fastify.register(authRoutes);
  fastify.register(textsRoutes);
  fastify.register(practiceRoutes);

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
