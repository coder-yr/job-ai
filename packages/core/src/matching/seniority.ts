// packages/core/src/matching/seniority.ts  - deterministic first-pass filters (no LLM)
export type Seniority = "INTERN" | "FRESHER" | "JUNIOR" | "MID" | "SENIOR" | "UNKNOWN";

export interface YearsRange { min: number | null; max: number | null }

export function parseYears(text: string): YearsRange {
  const t = text.toLowerCase();
  let m = t.match(/(\d{1,2})\s*(?:-|–|to)\s*(\d{1,2})\s*\+?\s*(?:years?|yrs?)/);
  if (m) return { min: Number(m[1]), max: Number(m[2]) };
  m = t.match(/(?:minimum|min\.?|at least)\s*(?:of\s*)?(\d{1,2})\s*\+?\s*(?:years?|yrs?)/)
    ?? t.match(/(\d{1,2})\s*\+\s*(?:years?|yrs?)/);
  if (m) return { min: Number(m[1]), max: null };
  return { min: null, max: null };
}

const SENIOR_RX = /\b(senior|sr\.?|lead|principal|staff|architect|manager|head of|director|sde[- ]?[23]|iii|iv)\b/i;
const JUNIOR_RX = /\b(junior|jr\.?|associate|sde[- ]?1|software engineer i|engineer i|analyst i)\b/i;
const FRESHER_RX = /\b(fresher|freshers|entry[- ]level|new grad(?:uate)?|graduate (?:engineer|trainee|program)|campus|trainee|apprentice)\b/i;
const INTERN_RX = /\b(intern|internship)\b/i;

export function classifySeniority(title: string, description: string): Seniority {
  if (INTERN_RX.test(title)) return "INTERN";
  if (SENIOR_RX.test(title)) return "SENIOR";
  if (FRESHER_RX.test(title) || FRESHER_RX.test(description.slice(0, 1500))) return "FRESHER";
  if (JUNIOR_RX.test(title)) return "JUNIOR";
  const { min } = parseYears(description);
  if (min === null) return "UNKNOWN";
  if (min <= 1) return "FRESHER";
  if (min <= 2) return "JUNIOR";
  return min <= 5 ? "MID" : "SENIOR";
}

export function isEarlyCareer(s: Seniority): boolean {
  return s === "INTERN" || s === "FRESHER" || s === "JUNIOR" || s === "UNKNOWN";
}
