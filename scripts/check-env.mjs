// scripts/check-env.mjs - verifies the local toolchain. Usage: npm run check:env
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import pg from "pg";

const root = fileURLToPath(new URL("..", import.meta.url));
config({ path: `${root}.env`, quiet: true });

const results = [];
const check = async (name, fn) => {
  try { results.push({ name, ok: true, detail: await fn() }); }
  catch (e) { results.push({ name, ok: false, detail: e instanceof Error ? e.message : String(e) }); }
};
const withTimeout = (p, ms, what) =>
  Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`${what} timed out after ${ms} ms`)), ms))]);

await check("Node.js >= 22.12", async () => {
  const [maj, min] = process.versions.node.split(".").map(Number);
  if (maj < 22 || (maj === 22 && min < 12)) throw new Error(`found ${process.versions.node}; upgrade: winget upgrade OpenJS.NodeJS.LTS`);
  return `v${process.versions.node}`;
});

await check(".env present with a strong API_TOKEN", async () => {
  if (!existsSync(`${root}.env`)) throw new Error("missing .env - copy .env.example to .env");
  const t = process.env.API_TOKEN ?? "";
  if (t.length < 32) throw new Error("API_TOKEN must be >= 32 chars (see .env.example for a generator command)");
  return "ok";
});

await check("Ollama reachable with required models", async () => {
  const host = process.env.OLLAMA_HOST ?? "http://127.0.0.1:11434";
  const res = await withTimeout(fetch(`${host}/api/tags`), 4000, "Ollama").catch((e) => {
    throw new Error(`cannot reach ${host} (${e.message}). Start Ollama from the Start menu.`);
  });
  const { models = [] } = await res.json();
  const have = models.map((m) => m.name);
  const need = [process.env.OLLAMA_CHAT_MODEL ?? "qwen2.5:7b-instruct", process.env.OLLAMA_EMBED_MODEL ?? "nomic-embed-text"];
  const missing = need.filter((n) => !have.some((h) => h === n || h.startsWith(`${n}:`)));
  if (missing.length) throw new Error(`missing models: run  ollama pull ${missing.join(" ")}`);
  return need.join(", ");
});

await check("PostgreSQL connection (SELECT 1)", async () => {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL not set");
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 4000 });
  try { await withTimeout(c.connect(), 5000, "PostgreSQL"); await c.query("SELECT 1"); }
  catch (e) { throw new Error(`${e.code ?? ""} ${e.message}`.trim() + " - is the service running and the role/database created? (blueprint 14.3)"); }
  finally { await c.end().catch(() => {}); }
  return "ok";
});

let failed = 0;
for (const r of results) {
  if (!r.ok) failed++;
  console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}${r.detail ? `  -  ${r.detail}` : ""}`);
}
console.log(failed ? `\n${failed} check(s) failed.` : "\nAll checks passed.");
process.exit(failed ? 1 : 0);
