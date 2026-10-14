// packages/core/src/resume/parse.ts
import { ParsedResumeSchema, ResumeCritiqueSchema, type ParsedResume } from "@jobpilot/shared";
import { generateJson, type JsonCall } from "../llm/ollama.js";
import { PROMPTS, wrapUntrusted } from "../llm/prompts.js";

type Hook = JsonCall<never>["onCall"];

export async function parseResume(rawText: string, onCall?: Hook): Promise<ParsedResume> {
  return generateJson({
    purpose: "resume_parse", promptVersion: PROMPTS.resumeParse.version,
    system: PROMPTS.resumeParse.system,
    user: `Parse this resume.\n${wrapUntrusted("resume", rawText.slice(0, 24_000))}`,
    schema: ParsedResumeSchema, numCtx: 16_384, timeoutMs: 300_000, onCall,
  });
}

/** Deterministic checks - cheap, explainable, run BEFORE any LLM critique. */
export function atsRuleChecks(text: string, p: ParsedResume) {
  const issues: { section: string; issue: string; fix: string; priority: "HIGH" | "MEDIUM" | "LOW" }[] = [];
  if (!p.email) issues.push({ section: "contact", issue: "No e-mail detected", fix: "Add a professional e-mail in the header", priority: "HIGH" });
  if (!p.phone) issues.push({ section: "contact", issue: "No phone detected", fix: "Add a reachable phone number", priority: "MEDIUM" });
  if (!p.links.github && !p.links.linkedin && !p.links.portfolio)
    issues.push({ section: "contact", issue: "No profile links", fix: "Add GitHub/LinkedIn/portfolio URL", priority: "MEDIUM" });
  if (p.skills.length < 5) issues.push({ section: "skills", issue: "Fewer than 5 skills detected", fix: "List the tools you can actually use", priority: "MEDIUM" });
  const bullets = [...p.experiences.flatMap((e) => e.bullets), ...p.projects.flatMap((x) => x.bullets)];
  const withNumber = bullets.filter((b) => /\d/.test(b)).length;
  if (bullets.length && withNumber / bullets.length < 0.25)
    issues.push({ section: "experience", issue: "Few bullets contain measurable results", fix: "Where true, add numbers (users, speed-ups, size)", priority: "HIGH" });
  if (text.split(/\s+/).length > 900) issues.push({ section: "format", issue: "Resume is long for a fresher", fix: "Aim for one page", priority: "MEDIUM" });
  const penalty = issues.reduce((a, i) => a + (i.priority === "HIGH" ? 15 : i.priority === "MEDIUM" ? 8 : 3), 0);
  return { atsScore: Math.max(0, 100 - penalty), issues };
}

export async function critiqueResume(p: ParsedResume, onCall?: Hook) {
  return generateJson({
    purpose: "resume_critique", promptVersion: PROMPTS.resumeCritique.version,
    system: PROMPTS.resumeCritique.system,
    user: `Review this parsed resume for an entry-level software candidate.\n${wrapUntrusted("resume", JSON.stringify(p))}`,
    schema: ResumeCritiqueSchema, onCall,
  });
}
