// packages/core/src/docs/tailor.ts  - generate -> guard -> regenerate -> deterministic fallback
import { TailoredResumeSchema, type TailoredResume } from "@jobpilot/shared";
import { generateJson } from "../llm/ollama.js";
import { PROMPTS, wrapUntrusted } from "../llm/prompts.js";
import { guardTailoredResume, type GuardReport, type ProfileFacts } from "./guard.js";

export interface TailorInput {
  job: { title: string; company: string; description: string; requiredSkills: string[] };
  facts: ProfileFacts;
  sections: { kind: "experience" | "project"; sourceId: string; heading: string;
              bullets: { id: string; text: string }[] }[];
  skills: string[];
}

export async function tailorResume(inp: TailorInput): Promise<{ resume: TailoredResume; report: GuardReport; attempts: number }> {
  const base = `JOB\nTitle: ${inp.job.title} at ${inp.job.company}\nKey skills: ${inp.job.requiredSkills.join(", ")}\n` +
    wrapUntrusted("job_posting", inp.job.description.slice(0, 6000)) +
    `\n<candidate_skills>${inp.skills.join(", ")}</candidate_skills>\n<candidate_bullets>\n` +
    inp.sections.map((s) => `[${s.kind} sourceId=${s.sourceId}] ${s.heading}\n` +
      s.bullets.map((b) => `  (id=${b.id}) ${b.text}`).join("\n")).join("\n") + `\n</candidate_bullets>`;

  let feedback = "";
  let last: TailoredResume | null = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    last = await generateJson({
      purpose: "tailor_resume", promptVersion: PROMPTS.tailorResume.version,
      system: PROMPTS.tailorResume.system, user: base + feedback,
      schema: TailoredResumeSchema, temperature: 0.2, numCtx: 12_288,
    });
    const report = guardTailoredResume(last, inp.facts);
    if (report.ok) return { resume: last, report, attempts: attempt };
    feedback = `\n\nYour previous attempt was REJECTED for these reasons - fix them:\n- ${report.violations.slice(0, 8).join("\n- ")}`;
  }

  // Deterministic fallback: revert any offending bullet to the candidate's own words.
  const safe: TailoredResume = {
    ...last!,
    skills: last!.skills.filter((s) => inp.facts.skills.has(s.toLowerCase())),
    sections: last!.sections.map((sec) => ({
      ...sec,
      bullets: sec.bullets.flatMap((b) => {
        const src = inp.facts.bullets.get(b.sourceBulletId);
        if (!src || src.ownerId !== sec.sourceId) return [];                       // drop unknown bullets
        const one = guardTailoredResume({ ...last!, skills: [], sections: [{ ...sec, bullets: [b] }] }, inp.facts);
        return [one.ok ? b : { sourceBulletId: b.sourceBulletId, text: src.text }]; // revert to original
      }),
    })),
  };
  const report = guardTailoredResume(safe, inp.facts);
  return { resume: safe, report: { ok: report.ok, violations: ["(fallback applied)", ...report.violations] }, attempts: 3 };
}
