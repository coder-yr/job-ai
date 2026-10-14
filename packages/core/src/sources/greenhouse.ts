// packages/core/src/sources/greenhouse.ts
// Docs: https://developers.greenhouse.io/job-board.html  (GET endpoints need no auth)
import { convert } from "html-to-text";
import { politeFetch } from "./http.js";
import type { JobSourceAdapter, RawJob } from "./types.js";

interface GhJob {
  id: number; title: string; updated_at?: string; absolute_url: string;
  location?: { name?: string }; content?: string;
}

// Greenhouse returns `content` as HTML that is itself HTML-ESCAPED -> unescape once.
const unescapeHtml = (s: string) =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
   .replace(/&#39;/g, "'").replace(/&amp;/g, "&");

export const greenhouse: JobSourceAdapter = {
  kind: "ATS_GREENHOUSE",
  async fetchJobs(config, signal) {
    const token = String(config.boardToken);
    const company = String(config.company ?? token);
    const url = `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(token)}/jobs?content=true`;
    const res = await politeFetch(url, { signal });
    const data = (await res.json()) as { jobs?: GhJob[] };
    return (data.jobs ?? []).map((j): RawJob => {
      const html = unescapeHtml(j.content ?? "");
      return {
        externalId: String(j.id),
        title: j.title,
        company,
        location: j.location?.name ?? null,
        descriptionHtml: html,
        descriptionText: convert(html, { wordwrap: false }),
        applyUrl: j.absolute_url,
        postedAt: j.updated_at ? new Date(j.updated_at) : null,
        raw: j,
      };
    });
  },
};
