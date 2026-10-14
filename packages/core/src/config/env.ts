// packages/core/src/config/env.ts
// Loads the repo-root .env regardless of the process working directory.
// (npm workspace scripts run with cwd = the package folder, so plain `dotenv/config` would miss it.)
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { config as loadDotenv } from "dotenv";
import { z } from "zod";

const rootEnv = fileURLToPath(new URL("../../../../.env", import.meta.url));
if (existsSync(rootEnv)) loadDotenv({ path: rootEnv, quiet: true });

if (process.env.DATABASE_URL && (process.env.DATABASE_URL.includes("supabase") || process.env.DATABASE_URL.includes("sslmode="))) {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
}

const EnvSchema = z.object({
  DATABASE_URL: z.string().min(1),
  API_TOKEN: z.string().min(32, "API_TOKEN must be at least 32 characters"),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  OLLAMA_HOST: z.string().url().default("http://127.0.0.1:11434"),
  OLLAMA_CHAT_MODEL: z.string().default("qwen2.5:7b-instruct"),
  OLLAMA_EMBED_MODEL: z.string().default("nomic-embed-text"),
  DATA_DIR: z.string().default(() => (process.env.LOCALAPPDATA ? `${process.env.LOCALAPPDATA.replace(/\\/g, "/")}/JobPilot` : "./data")),
  TZ_DEFAULT: z.string().default("Asia/Kolkata"),
});
export type Env = z.infer<typeof EnvSchema>;

/** Fail fast with a readable message instead of running with a half-configured (insecure) setup. */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const r = EnvSchema.safeParse(source);
  if (!r.success) {
    const lines = r.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`);
    throw new Error(`Invalid environment (.env at ${rootEnv}):\n${lines.join("\n")}`);
  }
  return r.data;
}
