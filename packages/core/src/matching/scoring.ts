// packages/core/src/matching/scoring.ts  - deterministic, explainable, unit-testable
import type { Seniority } from "./seniority.js";

export const SCORING_VERSION = "2026.1";

export const WEIGHTS = {
  skills: 0.40, semantic: 0.20, title: 0.15, experience: 0.15, location: 0.10,
} as const;
type Dim = keyof typeof WEIGHTS;

export interface ProfileFeatures {
  skills: Set<string>;               // canonical lower-case skill names
  embedding: number[];
  yearsExperience: number;
  targetRoles: string[];
  locations: string[];               // preferred cities, lower-case
  acceptsRemote: boolean;
}

export interface JobFeatures {
  title: string;
  requiredSkills: string[];
  preferredSkills: string[];
  embedding: number[];
  minYears: number | null;
  maxYears: number | null;
  seniority: Seniority;
  location: string | null;
  workMode: "ONSITE" | "HYBRID" | "REMOTE" | "UNKNOWN";
}

export interface ScoreResult {
  score: number;                      // 0-100
  breakdown: Record<Dim, number>;     // each 0-1
  matchedSkills: string[];
  missingSkills: string[];
}

export function cosine(a: number[], b: number[]): number {
  if (a.length === 0 || a.length !== b.length) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i]! * b[i]!; na += a[i]! ** 2; nb += b[i]! ** 2; }
  return na && nb ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/** required skills weigh 1.0, preferred 0.5 */
export function skillScore(p: Set<string>, req: string[], pref: string[]) {
  const matched: string[] = [], missing: string[] = [];
  let got = 0, total = 0;
  for (const s of req)  { total += 1;   if (p.has(s)) { got += 1;   matched.push(s); } else missing.push(s); }
  for (const s of pref) { total += 0.5; if (p.has(s)) { got += 0.5; matched.push(s); } }
  return { value: total === 0 ? 0.5 : got / total, matched, missing };
}

const tokens = (s: string) => new Set(s.toLowerCase().split(/[^a-z0-9+#.]+/).filter((w) => w.length > 1));

export function titleScore(jobTitle: string, targets: string[]): number {
  const jt = tokens(jobTitle);
  let best = 0;
  for (const t of targets) {
    const tt = tokens(t);
    const inter = [...tt].filter((w) => jt.has(w)).length;
    const union = new Set([...tt, ...jt]).size;
    best = Math.max(best, union ? inter / union : 0);
  }
  return clamp01(best * 1.6);          // short titles rarely hit 1.0 Jaccard
}

export function experienceScore(years: number, min: number | null, max: number | null, sen: Seniority): number {
  if (sen === "SENIOR") return 0;
  if (min === null) return sen === "FRESHER" || sen === "JUNIOR" || sen === "INTERN" ? 1 : 0.7;
  if (years >= min) return max !== null && years > max + 2 ? 0.7 : 1;      // slightly over-qualified
  const gap = min - years;                                                  // under-qualified
  return gap <= 1 ? 0.75 : gap <= 2 ? 0.45 : gap <= 3 ? 0.2 : 0;
}

export function locationScore(p: ProfileFeatures, j: JobFeatures): number {
  if (j.workMode === "REMOTE") return p.acceptsRemote ? 1 : 0.4;
  if (!j.location) return 0.5;
  const loc = j.location.toLowerCase();
  return p.locations.some((c) => loc.includes(c)) ? 1 : 0.15;
}

export function scoreJob(p: ProfileFeatures, j: JobFeatures): ScoreResult {
  const sk = skillScore(p.skills, j.requiredSkills, j.preferredSkills);
  // nomic-embed-text cosine similarities cluster in ~0.35-0.80; rescale (calibrate per model)
  const semantic = clamp01((cosine(p.embedding, j.embedding) - 0.35) / 0.45);
  const breakdown: Record<Dim, number> = {
    skills: sk.value,
    semantic,
    title: titleScore(j.title, p.targetRoles),
    experience: experienceScore(p.yearsExperience, j.minYears, j.maxYears, j.seniority),
    location: locationScore(p, j),
  };
  const raw = (Object.keys(WEIGHTS) as Dim[]).reduce((acc, k) => acc + WEIGHTS[k] * breakdown[k], 0);
  return { score: Math.round(raw * 100), breakdown, matchedSkills: sk.matched, missingSkills: sk.missing };
}

/** Final score = deterministic score + bounded LLM adjustment (-10..+10). */
export const finalScore = (base: number, llmAdjustment: number) =>
  Math.max(0, Math.min(100, base + Math.max(-10, Math.min(10, llmAdjustment))));
