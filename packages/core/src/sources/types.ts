// packages/core/src/sources/types.ts
export type SourceKindName =
  | "EMAIL_ALERT" | "ATS_GREENHOUSE" | "ATS_LEVER" | "ATS_ASHBY" | "ATS_SMARTRECRUITERS"
  | "PUBLIC_API" | "CAREER_PAGE_JSONLD" | "RSS" | "MANUAL";

/** What every adapter must return. Normalisation happens later, in one place. */
export interface RawJob {
  externalId: string | null;
  title: string;
  company: string;
  location: string | null;
  descriptionText: string;
  descriptionHtml?: string;
  applyUrl: string;
  postedAt: Date | null;
  remote?: boolean;
  raw?: unknown;
}

export interface JobSourceAdapter {
  readonly kind: SourceKindName;
  /** `config` comes from JobSource.config (e.g. { boardToken: "acme", company: "Acme" }). */
  fetchJobs(config: Record<string, unknown>, signal?: AbortSignal): Promise<RawJob[]>;
}
