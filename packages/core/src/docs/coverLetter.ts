// packages/core/src/docs/coverLetter.ts  - cover letter + answer draft generation using prompts.ts
import { CoverLetterSchema, AnswerDraftSchema, type CoverLetter, type AnswerDraft } from "@jobpilot/shared";
import { generateJson } from "../llm/ollama.js";
import { PROMPTS, wrapUntrusted } from "../llm/prompts.js";

export interface CoverLetterInput {
  job: { title: string; company: string; description: string };
  candidateFacts: string;   // pre-formatted: skills, bullets, summary snippet
}

export interface AnswerDraftInput {
  question: string;
  candidateFacts: string;
}

/**
 * Generate a cover letter using the coverLetter prompt.
 * Untrusted job description is wrapped before injection.
 */
export async function generateCoverLetter(inp: CoverLetterInput): Promise<CoverLetter> {
  return generateJson({
    purpose: "cover_letter",
    promptVersion: PROMPTS.coverLetter.version,
    system: PROMPTS.coverLetter.system,
    user:
      `Job: ${inp.job.title} at ${inp.job.company}\n` +
      wrapUntrusted("job_posting", inp.job.description.slice(0, 4000)) +
      `\n<candidate_facts>\n${inp.candidateFacts}\n</candidate_facts>`,
    schema: CoverLetterSchema,
    temperature: 0.3,
  });
}

/**
 * Generate a draft answer for a screening question.
 * Falls back gracefully if facts are insufficient (needsHumanInput=true).
 */
export async function generateAnswerDraft(inp: AnswerDraftInput): Promise<AnswerDraft> {
  return generateJson({
    purpose: "answer_draft",
    promptVersion: PROMPTS.answerDraft.version,
    system: PROMPTS.answerDraft.system,
    user:
      `Question: ${inp.question.slice(0, 500)}\n` +
      `<candidate_facts>\n${inp.candidateFacts}\n</candidate_facts>`,
    schema: AnswerDraftSchema,
    temperature: 0.2,
  });
}

/**
 * Build a plain-text facts block from profile data for use in cover letter / answer prompts.
 */
export function buildCandidateFacts(opts: {
  fullName: string;
  yearsExperience: number;
  skills: string[];
  bullets: string[];   // top bullets from experiences/projects
  summary?: string | null;
  links?: { github?: string | null; linkedin?: string | null };
}): string {
  const parts: string[] = [
    `Name: ${opts.fullName}`,
    `Experience: ${opts.yearsExperience.toFixed(1)} years`,
    `Skills: ${opts.skills.slice(0, 20).join(", ")}`,
  ];
  if (opts.summary) parts.push(`Summary: ${opts.summary}`);
  if (opts.bullets.length > 0) {
    parts.push("Key achievements:");
    opts.bullets.slice(0, 8).forEach((b) => parts.push(`- ${b}`));
  }
  if (opts.links?.github) parts.push(`GitHub: ${opts.links.github}`);
  if (opts.links?.linkedin) parts.push(`LinkedIn: ${opts.links.linkedin}`);
  return parts.join("\n");
}
