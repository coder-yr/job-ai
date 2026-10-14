// packages/core/src/sources/normalize.ts  - canonical URLs and cross-source de-duplication
import { createHash } from "node:crypto";

const TRACKING = /^(utm_.*|gclid|fbclid|ref|refid|trk|trackingid|source|src|campaign)$/i;

export function canonicalUrl(raw: string): string {
  const u = new URL(raw);
  u.hash = "";
  for (const k of [...u.searchParams.keys()]) if (TRACKING.test(k)) u.searchParams.delete(k);
  u.searchParams.sort();
  u.hostname = u.hostname.toLowerCase();
  return u.toString().replace(/\/$/, "");
}

const COMPANY_SUFFIX = /\b(pvt\.?|private|ltd\.?|limited|inc\.?|llc|llp|corp\.?|corporation|technologies|technology|solutions|india)\b/g;

export const normalizeCompany = (s: string) =>
  s.toLowerCase().replace(COMPANY_SUFFIX, "").replace(/[^a-z0-9]+/g, " ").trim();

export const normalizeTitle = (s: string) =>
  s.toLowerCase()
   .replace(/\((.*?)\)|\[(.*?)\]/g, " ")            // drop "(Remote)" "[Bangalore]"
   .replace(/\b(m\/f|f\/m|\d+\s*-\s*\d+\s*years?)\b/g, " ")
   .replace(/[^a-z0-9+#]+/g, " ").trim();

const normalizeLocation = (s: string | null) => (s ?? "").toLowerCase().split(/[,/|]/)[0]!.trim();

/** Same role posted on LinkedIn alert + Greenhouse + Indeed alert collapses to one row. */
export function dedupeHash(company: string, title: string, location: string | null): string {
  return createHash("sha256")
    .update([normalizeCompany(company), normalizeTitle(title), normalizeLocation(location)].join("|"))
    .digest("hex");
}
