// packages/core/src/sources/lever.ts
// Docs: https://github.com/lever/postings-api  (EU tenants use api.eu.lever.co)
import { politeFetch } from "./http.js";
import type { JobSourceAdapter, RawJob } from "./types.js";

interface LeverPosting {
  id: string; text: string; hostedUrl: string; applyUrl?: string; createdAt?: number;
  descriptionPlain?: string; description?: string; additionalPlain?: string;
  categories?: { location?: string; commitment?: string; team?: string };
  workplaceType?: string;
}

export const lever: JobSourceAdapter = {
  kind: "ATS_LEVER",
  async fetchJobs(config, signal) {
    const site = String(config.site);
    const host = config.eu ? "api.eu.lever.co" : "api.lever.co";
    const res = await politeFetch(`https://${host}/v0/postings/${encodeURIComponent(site)}?mode=json`, { signal });
    const postings = (await res.json()) as LeverPosting[];
    return postings.map((p): RawJob => ({
      externalId: p.id,
      title: p.text,
      company: String(config.company ?? site),
      location: p.categories?.location ?? null,
      descriptionHtml: p.description,
      descriptionText: [p.descriptionPlain, p.additionalPlain].filter(Boolean).join("\n\n"),
      applyUrl: p.applyUrl ?? p.hostedUrl,
      postedAt: p.createdAt ? new Date(p.createdAt) : null,   // epoch milliseconds
      remote: p.workplaceType === "remote",
      raw: p,
    }));
  },
};
