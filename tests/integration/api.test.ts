// tests/integration/api.test.ts - Phase 1 acceptance: auth, error contract, health, host + CORS rules
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { buildApp, type AppDeps } from "../../apps/api/src/app.js";
import { loadEnv } from "../../packages/core/src/config/env.js";
import { prisma } from "../../packages/db/src/client.js";

const TOKEN = "t".repeat(40);
const PORT = 4000;
const good = { host: `127.0.0.1:${PORT}` };
const authed = { ...good, "x-jobpilot-token": TOKEN };

const deps = (over: Partial<AppDeps> = {}): AppDeps => ({
  checkDb: async () => true,
  checkOllama: async () => ({ up: true, missing: [] }),
  ...over,
});
const make = (d: AppDeps = deps()) => buildApp({ token: TOKEN, port: PORT, logLevel: "silent", deps: d });

describe("auth (fail closed)", () => {
  let app: Awaited<ReturnType<typeof make>>;
  beforeAll(async () => { app = await make(); });
  afterAll(() => app.close());

  it("401 without a token, in the standard error format", async () => {
    const r = await app.inject({ url: "/api/v1/jobs", headers: good });
    expect(r.statusCode).toBe(401);
    expect(r.json()).toEqual({ error: { code: "UNAUTHORIZED", message: expect.any(String), details: [] } });
  });
  it("200 with a valid token", async () => {
    vi.spyOn(prisma.jobMatch, "findMany").mockResolvedValueOnce([] as never);
    const r = await app.inject({ url: "/api/v1/jobs", headers: authed });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ data: [], nextCursor: null });
  });
  it("401 with a wrong token", async () => {
    const r = await app.inject({ url: "/api/v1/jobs", headers: { ...good, "x-jobpilot-token": "x".repeat(40) } });
    expect(r.statusCode).toBe(401);
  });
  it("401 for an empty token header", async () => {
    expect((await app.inject({ url: "/api/v1/jobs", headers: { ...good, "x-jobpilot-token": "" } })).statusCode).toBe(401);
  });
  it("refuses to start with a missing or short server token", async () => {
    await expect(buildApp({ token: "", port: PORT, logLevel: "silent", deps: deps() })).rejects.toThrow(/32 characters/);
    await expect(buildApp({ token: "short", port: PORT, logLevel: "silent", deps: deps() })).rejects.toThrow();
  });
  it("403 for a foreign Host header (DNS-rebinding defence), even with a valid token", async () => {
    const r = await app.inject({ url: "/api/v1/jobs", headers: { host: "evil.example:4000", "x-jobpilot-token": TOKEN } });
    expect(r.statusCode).toBe(403);
    expect(r.json().error.code).toBe("FORBIDDEN_HOST");
  });
  it("403 for a foreign Host header on the public health route too", async () => {
    expect((await app.inject({ url: "/api/v1/health", headers: { host: "evil.example" } })).statusCode).toBe(403);
  });
});

describe("validation and routing", () => {
  let app: Awaited<ReturnType<typeof make>>;
  beforeAll(async () => { app = await make(); });
  afterAll(() => app.close());

  it("400 VALIDATION_ERROR with field details (no database touched)", async () => {
    const r = await app.inject({ url: "/api/v1/jobs?minScore=abc&limit=9999", headers: authed });
    expect(r.statusCode).toBe(400);
    const body = r.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.details.map((d: { path: string }) => d.path).sort()).toEqual(["limit", "minScore"]);
  });
  it("404 in the standard format", async () => {
    const r = await app.inject({ url: "/api/v1/nope", headers: authed });
    expect(r.statusCode).toBe(404);
    expect(r.json().error.code).toBe("NOT_FOUND");
  });
  it("PATCH with an invalid body is rejected before any DB access", async () => {
    const r = await app.inject({ method: "PATCH", url: "/api/v1/jobs/abc/state", headers: authed, payload: { state: "DELETE_ALL" } });
    expect(r.statusCode).toBe(400);
  });
  it("CORS: a foreign origin is not granted access", async () => {
    const r = await app.inject({ method: "OPTIONS", url: "/api/v1/jobs", headers: { ...good, origin: "https://evil.example",
      "access-control-request-method": "GET", "access-control-request-headers": "x-jobpilot-token" } });
    expect(r.headers["access-control-allow-origin"]).toBeUndefined();
  });
  it("CORS: the Vite dev origin is allowed to send the token header", async () => {
    const r = await app.inject({ method: "OPTIONS", url: "/api/v1/jobs", headers: { ...good, origin: "http://localhost:5173",
      "access-control-request-method": "GET", "access-control-request-headers": "x-jobpilot-token" } });
    expect(r.headers["access-control-allow-origin"]).toBe("http://localhost:5173");
  });
});

describe("GET /api/v1/health", () => {
  it("is reachable without a token and has the documented shape", async () => {
    const app = await make();
    const r = await app.inject({ url: "/api/v1/health", headers: good });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ api: "ok", db: "ok", ollama: { up: true, missing: [] } });
    await app.close();
  });
  it("reports a missing model with the model name", async () => {
    const app = await make(deps({ checkOllama: async () => ({ up: true, missing: ["nomic-embed-text"] }) }));
    expect((await app.inject({ url: "/api/v1/health", headers: good })).json().ollama.missing).toEqual(["nomic-embed-text"]);
    await app.close();
  });
  it("reports db down (still 200) when the database check fails or throws", async () => {
    const app = await make(deps({ checkDb: async () => { throw new Error("ECONNREFUSED"); } }));
    const r = await app.inject({ url: "/api/v1/health", headers: good });
    expect(r.statusCode).toBe(200);
    expect(r.json().db).toBe("down");
    await app.close();
  });
  it("reports ollama down when its check throws", async () => {
    const app = await make(deps({ checkOllama: async () => { throw new Error("x"); } }));
    expect((await app.inject({ url: "/api/v1/health", headers: good })).json().ollama.up).toBe(false);
    await app.close();
  });
});

describe("environment validation", () => {
  const base = { DATABASE_URL: "postgresql://x", API_TOKEN: "a".repeat(32), DATA_DIR: "/tmp/jp" };
  it("accepts a complete environment and applies defaults", () => {
    const e = loadEnv(base);
    expect(e.PORT).toBe(4000);
    expect(e.OLLAMA_HOST).toBe("http://127.0.0.1:11434");
  });
  it("rejects a short API_TOKEN with a readable message", () => {
    expect(() => loadEnv({ ...base, API_TOKEN: "short" })).toThrow(/API_TOKEN/);
  });
  it("rejects a missing DATABASE_URL", () => {
    expect(() => loadEnv({ API_TOKEN: base.API_TOKEN, DATA_DIR: "x" })).toThrow(/DATABASE_URL/);
  });
});
