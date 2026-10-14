// packages/core/src/sources/jsonld.ts
// Reads schema.org/JobPosting JSON-LD from a company careers page (static HTML only),
// ONLY if robots.txt allows it. Docs: https://schema.org/JobPosting
import { convert } from "html-to-text";
import { isAllowedByRobots, politeFetch } from "./http.js";
import type { JobSourceAdapter, RawJob } from "./types.js";

type Json = Record<string, unknown>;

function* walk(node: unknown): Generator<Json> {
  if (Array.isArray(node)) { for (const n of node) yield* walk(n); return; }
  if (node && typeof node === "object") {
    const o = node as Json;
    const t = o["@type"];
    if (t === "JobPosting" || (Array.isArray(t) && t.includes("JobPosting"))) yield o;
    if (o["@graph"]) yield* walk(o["@graph"]);
  }
}

export function extractJobPostings(html: string): Json[] {
  const out: Json[] = [];
  const rx = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (const m of html.matchAll(rx)) {
    try { out.push(...walk(JSON.parse(m[1]!))); } catch { /* ignore malformed block */ }
  }
  return out;
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

export const jsonLd: JobSourceAdapter = {
  kind: "CAREER_PAGE_JSONLD",
  async fetchJobs(config, signal) {
    const pageUrl = String(config.url);
    if (!(await isAllowedByRobots(pageUrl))) throw new Error(`robots.txt disallows ${pageUrl}`);
    const html = await (await politeFetch(pageUrl, { signal })).text();
    return extractJobPostings(html).map((j): RawJob => {
      const org = j.hiringOrganization as Json | undefined;
      const addr = (j.jobLocation as Json | undefined)?.address as Json | undefined;
      const descHtml = str(j.description) ?? "";
      return {
        externalId: str((j.identifier as Json | undefined)?.value) ?? null,
        title: str(j.title) ?? "Untitled",
        company: str(org?.name) ?? String(config.company ?? new URL(pageUrl).hostname),
        location: str(addr?.addressLocality) ?? str(addr?.addressRegion),
        descriptionHtml: descHtml,
        descriptionText: convert(descHtml, { wordwrap: false }),
        applyUrl: str(j.url) ?? pageUrl,
        postedAt: str(j.datePosted) ? new Date(str(j.datePosted)!) : null,
        remote: j.jobLocationType === "TELECOMMUTE",
        raw: j,
      };
    });
  },
};
