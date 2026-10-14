// apps/worker/src/worker.ts  - entry point:  npm run start -w apps/worker
import { loadEnv } from "@jobpilot/core/config/env.js";
import { checkOllama } from "@jobpilot/core/llm/ollama.js";
import { prisma } from "@jobpilot/db";
import { startQueues } from "./boss.js";

loadEnv();

const health = await checkOllama();
if (!health.up) console.warn("[worker] Ollama is not reachable - LLM tasks will fail and be retried.");
else if (health.missing.length) console.warn(`[worker] Missing models: run  ollama pull ${health.missing.join(" ")}`);

const boss = await startQueues();
console.log("[worker] queues started; waiting for jobs");

const shutdown = async () => {
  await boss.stop({ graceful: true, timeout: 30_000 });   // let the current job finish
  await prisma.$disconnect();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
