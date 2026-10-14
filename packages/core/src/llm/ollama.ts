// packages/core/src/llm/ollama.ts  - the ONLY file that talks to Ollama
import { Ollama } from "ollama";
import type { z, ZodTypeAny } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import pino from "pino";

const log = pino({ name: "llm" });
export const ollama = new Ollama({ host: process.env.OLLAMA_HOST ?? "http://127.0.0.1:11434" });

export const MODELS = {
  chat: process.env.OLLAMA_CHAT_MODEL ?? "qwen2.5:7b-instruct",
  embed: process.env.OLLAMA_EMBED_MODEL ?? "nomic-embed-text",
};

export interface JsonCall<S extends ZodTypeAny> {
  purpose: string;                 // for the LlmCall audit table
  promptVersion: string;           // e.g. "resume_parse@3"
  system: string;
  user: string;
  schema: S;
  model?: string;
  temperature?: number;            // default 0.1 -> near-deterministic
  numCtx?: number;                 // default 8192 (raise for long JDs)
  timeoutMs?: number;              // default 180 s (CPU-only machines are slow)
  maxAttempts?: number;            // default 2 (second attempt = repair prompt)
  onCall?: (r: { purpose: string; model: string; promptVersion: string;
                 durationMs: number; success: boolean; error?: string }) => void;
}

export async function generateJson<S extends ZodTypeAny>(c: JsonCall<S>): Promise<z.infer<S>> {
  const model = c.model ?? MODELS.chat;
  const format = zodToJsonSchema(c.schema, { $refStrategy: "none" });
  const messages = [
    { role: "system", content: c.system },
    { role: "user", content: c.user },
  ];
  const attempts = c.maxAttempts ?? 2;
  let lastError = "";

  for (let attempt = 1; attempt <= attempts; attempt++) {
    const started = Date.now();
    try {
      const req = ollama.chat({
        model, messages, format, stream: false,
        keep_alive: "10m",
        options: { temperature: c.temperature ?? 0.1, num_ctx: c.numCtx ?? 8192, seed: 42 },
      });
      const timeout = new Promise<never>((_, rej) => setTimeout(() => {
        ollama.abort();                                  // cancels in-flight request
        rej(new Error(`LLM timeout after ${c.timeoutMs ?? 180_000} ms`));
      }, c.timeoutMs ?? 180_000));

      const res = await Promise.race([req, timeout]);
      const parsed = c.schema.parse(JSON.parse(res.message.content));  // throws on mismatch
      c.onCall?.({ purpose: c.purpose, model, promptVersion: c.promptVersion,
                   durationMs: Date.now() - started, success: true });
      return parsed;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      log.warn({ purpose: c.purpose, attempt, lastError }, "LLM JSON call failed");
      c.onCall?.({ purpose: c.purpose, model, promptVersion: c.promptVersion,
                   durationMs: Date.now() - started, success: false, error: lastError });
      // repair prompt for the next attempt
      messages.push({ role: "user",
        content: `Your previous output was invalid (${lastError.slice(0, 300)}). ` +
                 `Return ONLY JSON that matches the schema.` });
    }
  }
  throw new Error(`LLM failed after ${attempts} attempts: ${lastError}`);
}

export async function embed(texts: string[], batchSize = 16): Promise<number[][]> {
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += batchSize) {
    const res = await ollama.embed({
      model: MODELS.embed,
      input: texts.slice(i, i + batchSize).map((t) => t.slice(0, 6000)),
      truncate: true,
    });
    out.push(...res.embeddings);
  }
  return out;
}

/** Called at startup and by GET /api/v1/health */
export async function checkOllama(): Promise<{ up: boolean; missing: string[] }> {
  try {
    const { models } = await ollama.list();
    const have = models.map((m) => m.name);
    const need = [MODELS.chat, MODELS.embed];
    const missing = need.filter((n) => !have.some((h) => h === n || h.startsWith(n + ":")));
    return { up: true, missing };
  } catch {
    return { up: false, missing: [MODELS.chat, MODELS.embed] };
  }
}
