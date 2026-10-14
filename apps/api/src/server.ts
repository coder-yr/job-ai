// apps/api/src/server.ts  - process entry point: npm run start -w @jobpilot/api
import { loadEnv } from "@jobpilot/core/config/env.js";
import { checkOllama } from "@jobpilot/core/llm/ollama.js";
import { prisma } from "@jobpilot/db";
import { buildApp } from "./app.js";

const env = loadEnv();                                    // throws with a readable message if misconfigured

const app = await buildApp({
  token: env.API_TOKEN, port: env.PORT, logLevel: env.LOG_LEVEL,
  deps: {
    checkDb: async () => { await prisma.$queryRaw`SELECT 1`; return true; },
    checkOllama,
  },
});

await app.listen({ host: "127.0.0.1", port: env.PORT });   // loopback only, never 0.0.0.0

const shutdown = async () => { await app.close(); await prisma.$disconnect(); process.exit(0); };
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
