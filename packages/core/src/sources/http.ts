// packages/core/src/sources/http.ts  - polite HTTP: identify yourself, throttle, back off
import { createRequire } from "node:module";

// robots-parser is CommonJS; createRequire is the portable way to load it from ESM.
interface Robot { isAllowed(url: string, ua?: string): boolean | undefined }
const robotsParser = createRequire(import.meta.url)("robots-parser") as
  (url: string, txt: string) => Robot;

export const USER_AGENT =
  process.env.JOBPILOT_UA ?? "JobPilotAI/1.0 (personal, local-only; contact: you@example.com)";

const lastHit = new Map<string, number>();
const MIN_GAP_MS = 2_000;                                   // >= 2 s between hits per host
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function politeFetch(url: string, init: RequestInit = {}, tries = 3): Promise<Response> {
  const host = new URL(url).host;
  for (let attempt = 1; ; attempt++) {
    const wait = (lastHit.get(host) ?? 0) + MIN_GAP_MS - Date.now();
    if (wait > 0) await sleep(wait);
    lastHit.set(host, Date.now());

    const res = await fetch(url, {
      ...init,
      headers: { "User-Agent": USER_AGENT, Accept: "application/json, text/html;q=0.8", ...init.headers },
      signal: init.signal ?? AbortSignal.timeout(30_000),
    });
    if (res.ok) return res;
    if ((res.status === 429 || res.status >= 500) && attempt < tries) {
      const retryAfter = Number(res.headers.get("retry-after")) * 1000;
      await sleep(retryAfter > 0 ? retryAfter : 2 ** attempt * 3_000);   // exponential back-off
      continue;
    }
    throw new Error(`HTTP ${res.status} for ${url}`);
  }
}

const robotsCache = new Map<string, Robot>();

/** RFC 9309 robots.txt check. Fail CLOSED: if robots.txt cannot be read, do not crawl HTML. */
export async function isAllowedByRobots(url: string): Promise<boolean> {
  const u = new URL(url);
  const robotsUrl = `${u.protocol}//${u.host}/robots.txt`;
  let rb = robotsCache.get(robotsUrl);
  if (!rb) {
    try {
      const res = await politeFetch(robotsUrl, { headers: { Accept: "text/plain" } }, 1);
      rb = robotsParser(robotsUrl, await res.text());
    } catch {
      return false;
    }
    robotsCache.set(robotsUrl, rb);
  }
  return rb.isAllowed(url, USER_AGENT) ?? false;
}
