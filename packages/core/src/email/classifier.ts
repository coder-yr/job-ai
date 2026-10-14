// packages/core/src/email/classifier.ts
// Classifies incoming emails and generates status change proposals for applications.
// NEVER mutates application status directly - proposals require human approval.
import { generateJson } from "../llm/ollama.js";
import { PROMPTS, wrapUntrusted } from "../llm/prompts.js";
import { EmailClassifySchema, type EmailClassify } from "@jobpilot/shared";
import type { ApplicationStatus } from "../applications/transitions.js";

export interface EmailInput {
  subject: string;
  fromAddr: string;
  snippet: string;
}

export interface StatusProposal {
  category: EmailClassify["category"];
  confidence: number;
  company: string | null;
  roleTitle: string | null;
  nextStepDate: string | null;
  proposedStatus: ApplicationStatus | null;
  applicationId?: string;
}

export function categoryToProposedStatus(
  category: EmailClassify["category"],
): ApplicationStatus | null {
  switch (category) {
    case "ACKNOWLEDGEMENT":
      return "ACKNOWLEDGED";
    case "INTERVIEW":
      return "INTERVIEW";
    case "ASSESSMENT":
      return "ASSESSMENT";
    case "REJECTION":
      return "REJECTED";
    case "OFFER":
      return "OFFER";
    case "OTHER":
    default:
      return null;
  }
}

export async function classifyEmail(email: EmailInput): Promise<StatusProposal> {
  const prompt = [
    wrapUntrusted("from", email.fromAddr),
    wrapUntrusted("subject", email.subject),
    wrapUntrusted("body_snippet", email.snippet),
  ].join("\n\n");

  let result: EmailClassify;
  try {
    result = await generateJson({
      purpose: "email_classify",
      promptVersion: PROMPTS.emailClassify.version,
      system: PROMPTS.emailClassify.system,
      user: prompt,
      schema: EmailClassifySchema,
    });
  } catch {
    result = {
      category: "OTHER",
      confidence: 0,
      company: null,
      roleTitle: null,
      nextStepDate: null,
    };
  }
  return {
    ...result,
    proposedStatus: categoryToProposedStatus(result.category),
  };
}

export function matchApplication(
  proposal: { company: string | null; roleTitle: string | null; fromAddr?: string },
  applications: Array<{ id: string; job: { company: string; title: string } }>,
): string | null {
  if (!proposal.company && !proposal.roleTitle) return null;

  const comp = proposal.company?.toLowerCase().trim();
  const title = proposal.roleTitle?.toLowerCase().trim();

  // Try matching company name first
  if (comp) {
    const match = applications.find((a) => {
      const c = a.job.company.toLowerCase();
      return c.includes(comp) || comp.includes(c);
    });
    if (match) return match.id;
  }

  // Fallback to title match
  if (title) {
    const match = applications.find((a) => {
      const t = a.job.title.toLowerCase();
      return t.includes(title) || title.includes(t);
    });
    if (match) return match.id;
  }

  return null;
}
