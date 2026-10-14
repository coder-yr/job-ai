// packages/core/src/docs/guard.ts
// Truthfulness guard: the LLM may re-phrase and re-order, but never invent.
import type { TailoredResume } from "@jobpilot/shared";

export interface ProfileFacts {
  skills: Set<string>;                                   // canonical lower-case
  bullets: Map<string, { text: string; ownerId: string }>;   // Achievement.id -> source bullet
  skillCatalog: string[];                                // every known skill name (lower-case)
}

export interface GuardReport { ok: boolean; violations: string[] }

const NUM_RX = /\d+(?:[.,]\d+)?\s*(?:%|x|k|m|\+)?/gi;
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const mentions = (text: string, term: string) =>
  new RegExp(`(?<![a-z0-9+#.])${esc(term)}(?![a-z0-9+#])`, "i").test(text);

export function guardTailoredResume(t: TailoredResume, f: ProfileFacts): GuardReport {
  const v: string[] = [];

  for (const s of t.skills) {
    if (!f.skills.has(s.toLowerCase())) v.push(`Skill not in profile: "${s}"`);
  }

  for (const sec of t.sections) {
    for (const b of sec.bullets) {
      const src = f.bullets.get(b.sourceBulletId);
      if (!src) { v.push(`Unknown sourceBulletId ${b.sourceBulletId}`); continue; }
      if (src.ownerId !== sec.sourceId) v.push(`Bullet ${b.sourceBulletId} moved to a different section`);

      const srcNums = new Set((src.text.match(NUM_RX) ?? []).map((n) => n.replace(/\s/g, "").toLowerCase()));
      for (const n of b.text.match(NUM_RX) ?? []) {
        if (!srcNums.has(n.replace(/\s/g, "").toLowerCase())) v.push(`New number "${n.trim()}" in bullet ${b.sourceBulletId}`);
      }

      for (const term of f.skillCatalog) {
        if (term.length < 3) continue;                     // "c", "r", "go": too ambiguous to police
        if (mentions(b.text, term) && !mentions(src.text, term) && !f.skills.has(term)) {
          v.push(`Technology "${term}" appears in bullet ${b.sourceBulletId} but not in your profile`);
        }
      }
    }
  }
  return { ok: v.length === 0, violations: v };
}
