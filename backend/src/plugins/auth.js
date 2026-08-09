import fastifyJwt from "@fastify/jwt";
import fp from "fastify-plugin";

// Registers @fastify/jwt and a `authenticate` decorator routes can use as
// an onRequest hook to require a valid parent session.
export default fp(async function authPlugin(fastify) {
  fastify.register(fastifyJwt, {
    secret: process.env.JWT_SECRET,
    // Tokens were unbounded: no exp claim meant one leaked token stayed
    // valid forever. 30 days keeps a phone logged in across normal use
    // without that. When Phase 2 has a real session flow, add refresh.
    sign: { expiresIn: process.env.JWT_EXPIRES_IN || "30d" },
  });

  fastify.decorate("authenticate", async function (request, reply) {
    try {
      await request.jwtVerify();
    } catch (err) {
      reply.code(401).send({ error: "unauthorized" });
    }
  });
});
