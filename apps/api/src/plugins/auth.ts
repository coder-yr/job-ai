// apps/api/src/plugins/auth.ts  - loopback-only API protection (blueprint 12.1)
//  1. Host-header allow-list  -> defeats DNS-rebinding
//  2. Shared-secret token     -> a custom header forces a CORS pre-flight for web pages
//  Both FAIL CLOSED: a missing/short server token never means "open".
import { createHash, timingSafeEqual } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { ApiError } from "../errors.js";

const digest = (s: string) => createHash("sha256").update(s).digest();

export function registerAuth(app: FastifyInstance, opts: { token: string; port: number }) {
  if (opts.token.length < 32) throw new Error("API token must be at least 32 characters (refusing to start insecurely)");
  const expected = digest(opts.token);
  const hosts = new Set([`127.0.0.1:${opts.port}`, `localhost:${opts.port}`, `[::1]:${opts.port}`]);

  app.addHook("onRequest", async (req) => {
    if (!hosts.has((req.headers.host ?? "").toLowerCase())) {
      throw new ApiError(403, "FORBIDDEN_HOST", "Requests must target 127.0.0.1 or localhost");
    }
    if (req.method === "OPTIONS") return;                                  // CORS pre-flight carries no token
    if (req.url.split("?")[0] === "/api/v1/health") return;                // liveness endpoint is public (still host-checked)
    const given = req.headers["x-jobpilot-token"];
    if (typeof given !== "string" || !timingSafeEqual(digest(given), expected)) {
      throw new ApiError(401, "UNAUTHORIZED", "Missing or invalid x-jobpilot-token header");
    }
  });
}
