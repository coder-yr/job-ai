// tests/integration/db.live.test.ts - runs against a REAL PostgreSQL; skipped (visibly) when none is reachable.
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
import "../../packages/core/src/config/env.js";               // loads repo-root .env
import pg from "pg";
import { afterAll, describe, expect, it } from "vitest";

async function reachable(): Promise<boolean> {
  if (!process.env.DATABASE_URL) return false;
  const isRemote = process.env.DATABASE_URL.includes("supabase") || process.env.DATABASE_URL.includes("sslmode=");
  const c = new pg.Client({
    connectionString: process.env.DATABASE_URL,
    connectionTimeoutMillis: 4000,
    ssl: isRemote ? { rejectUnauthorized: false } : undefined,
  });
  try { await c.connect(); await c.query("SELECT 1"); return true; } catch { return false; } finally { await c.end().catch(() => {}); }
}
const live = await reachable();
const { prisma } = live ? await import("../../packages/db/src/client.js") : { prisma: null };
afterAll(async () => { await prisma?.$disconnect(); });

describe.skipIf(!live)("live PostgreSQL through the Prisma 7 client + pg adapter", () => {
  it("answers SELECT 1", async () => {
    const rows = await prisma!.$queryRaw<{ ok: number }[]>`SELECT 1 AS ok`;
    expect(rows[0]!.ok).toBe(1);
  });
  it("health route reports db ok with the real client", async () => {
    const { buildApp } = await import("../../apps/api/src/app.js");
    const app = await buildApp({ token: "t".repeat(40), port: 4000, logLevel: "silent", deps: {
      checkDb: async () => { await prisma!.$queryRaw`SELECT 1`; return true; },
      checkOllama: async () => ({ up: false, missing: [] }) } });
    const r = await app.inject({ url: "/api/v1/health", headers: { host: "127.0.0.1:4000" } });
    expect(r.json().db).toBe("ok");
    await app.close();
  });
});
