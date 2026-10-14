// packages/core/src/sources/ashby.ts - Ashby public job board API adapter
// Docs: https://developers.ashbyhq.com/docs/public-job-posting-api
import { convert } from "html-to-text";
import { politeFetch } from "./http.js";
import type { JobSourceAdapter, RawJob } from "./types.js";

interface AshbyJob {
  id: string;
  title: string;
  location?: string;
  isRemote?: boolean;
  jobUrl?: string;
  applyUrl?: string;
  publishedAt?: string;
  descriptionHtml?: string;
  descriptionPlain?: string;
}

export const ashby: JobSourceAdapter = {
  kind: "ATS_ASHBY",
  async fetchJobs(config, signal) {
    const boardName = String(config.boardName ?? config.boardToken ?? config.company);
    const company = String(config.company ?? boardName);

    // Ashby's posting-api accepts POST or GET on job-board endpoint
    const url = `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(boardName)}`;
    const res = await politeFetch(url, {
      method: "POST",
      signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    }).catch(async () => {
      // Fallback to GET if POST is rejected
      return politeFetch(url, { signal });
    });

    const data = (await res.json()) as { jobs?: AshbyJob[] };
    return (data.jobs ?? []).map((j): RawJob => {
      const descHtml = j.descriptionHtml ?? "";
      const descText = j.descriptionPlain ?? (descHtml ? convert(descHtml, { wordwrap: false }) : "");

      return {
        externalId: j.id,
        title: j.title,
        company,
        location: j.location ?? null,
        descriptionHtml: descHtml || undefined,
        descriptionText: descText,
        applyUrl: j.applyUrl ?? j.jobUrl ?? `https://jobs.ashbyhq.com/${boardName}/${j.id}`,
        postedAt: j.publishedAt ? new Date(j.publishedAt) : null,
        remote: j.isRemote ?? false,
        raw: j,
      };
    });
  },
};
