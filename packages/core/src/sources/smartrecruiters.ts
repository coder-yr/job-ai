// packages/core/src/sources/smartrecruiters.ts - SmartRecruiters public posting API adapter
// Docs: https://developers.smartrecruiters.com/docs/posting-api
import { convert } from "html-to-text";
import { politeFetch } from "./http.js";
import type { JobSourceAdapter, RawJob } from "./types.js";

interface SmartRecruitersPosting {
  id: string;
  name: string;
  uuid?: string;
  releasedDate?: string;
  location?: {
    city?: string;
    region?: string;
    country?: string;
    remote?: boolean;
  };
  jobAd?: {
    sections?: {
      jobDescription?: { text?: string };
      qualifications?: { text?: string };
      additionalInformation?: { text?: string };
    };
  };
  refNumber?: string;
}

export const smartRecruiters: JobSourceAdapter = {
  kind: "ATS_SMARTRECRUITERS",
  async fetchJobs(config, signal) {
    const companyIdentifier = String(config.companyIdentifier ?? config.company);
    const company = String(config.company ?? companyIdentifier);

    const url = `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(companyIdentifier)}/postings`;
    const res = await politeFetch(url, { signal });
    const data = (await res.json()) as { content?: SmartRecruitersPosting[] };

    return (data.content ?? []).map((p): RawJob => {
      const sections = p.jobAd?.sections;
      const htmlParts = [
        sections?.jobDescription?.text,
        sections?.qualifications?.text,
        sections?.additionalInformation?.text,
      ].filter(Boolean) as string[];
      const fullHtml = htmlParts.join("<br/><br/>");
      const fullText = convert(fullHtml, { wordwrap: false });

      const locParts = [p.location?.city, p.location?.region, p.location?.country].filter(Boolean);
      const locStr = locParts.length > 0 ? locParts.join(", ") : null;

      return {
        externalId: p.id,
        title: p.name,
        company,
        location: locStr,
        descriptionHtml: fullHtml || undefined,
        descriptionText: fullText,
        applyUrl: `https://jobs.smartrecruiters.com/${encodeURIComponent(companyIdentifier)}/${p.id}`,
        postedAt: p.releasedDate ? new Date(p.releasedDate) : null,
        remote: p.location?.remote ?? false,
        raw: p,
      };
    });
  },
};
