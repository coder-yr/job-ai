// packages/core/src/resume/skills.ts  - skill canonicalisation via alias table
export type AliasMap = Map<string, string>;

export function buildAliasMap(skills: { name: string; aliases: string[] }[]): AliasMap {
  const m: AliasMap = new Map();
  for (const s of skills) {
    m.set(s.name.toLowerCase(), s.name);
    for (const a of s.aliases) m.set(a.toLowerCase(), s.name);
  }
  return m;
}

/** "ReactJS" -> "react"; unknown skills are kept (lower-cased) so they can be added to the catalog. */
export const canonSkill = (raw: string, aliases: AliasMap) => {
  const k = raw.trim().toLowerCase().replace(/\s+/g, " ");
  return aliases.get(k) ?? aliases.get(k.replace(/[.\s-]/g, "")) ?? k;
};

export const canonSkills = (raw: string[], aliases: AliasMap) =>
  [...new Set(raw.map((r) => canonSkill(r, aliases)).filter((s) => s.length > 0 && s.length <= 40))];
