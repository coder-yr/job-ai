// packages/shared/src/schemas.ts  - single source of truth for LLM + API shapes
import { z } from "zod";

const yearMonth = z.string().regex(/^\d{4}(-\d{2})?$/).nullable(); // "2024" or "2024-06"

export const ParsedResumeSchema = z.object({
  fullName: z.string(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  location: z.string().nullable(),
  headline: z.string().nullable(),
  summary: z.string().nullable(),
  links: z.object({
    github: z.string().nullable(),
    linkedin: z.string().nullable(),
    portfolio: z.string().nullable(),
  }),
  skills: z.array(z.object({
    name: z.string(),
    category: z.enum(["language", "framework", "database", "tool", "cloud", "soft", "other"]),
  })),
  experiences: z.array(z.object({
    company: z.string(), title: z.string(), location: z.string().nullable(),
    startDate: yearMonth, endDate: yearMonth, isCurrent: z.boolean(),
    bullets: z.array(z.string()),
  })),
  projects: z.array(z.object({
    name: z.string(), url: z.string().nullable(), description: z.string().nullable(),
    techStack: z.array(z.string()), bullets: z.array(z.string()),
  })),
  education: z.array(z.object({
    institution: z.string(), degree: z.string(), field: z.string().nullable(),
    startYear: z.number().int().nullable(), endYear: z.number().int().nullable(),
    grade: z.string().nullable(),
  })),
  certifications: z.array(z.string()),
  totalExperienceMonths: z.number().int().min(0),
});
export type ParsedResume = z.infer<typeof ParsedResumeSchema>;

export const JobExtractSchema = z.object({
  roleTitle: z.string(),
  seniority: z.enum(["INTERN", "FRESHER", "JUNIOR", "MID", "SENIOR", "UNKNOWN"]),
  minYears: z.number().int().nullable(),
  maxYears: z.number().int().nullable(),
  requiredSkills: z.array(z.string()).max(25),
  preferredSkills: z.array(z.string()).max(25),
  responsibilities: z.array(z.string()).max(8),
  workMode: z.enum(["ONSITE", "HYBRID", "REMOTE", "UNKNOWN"]),
  jobType: z.enum(["FULL_TIME", "INTERNSHIP", "CONTRACT", "PART_TIME", "UNKNOWN"]),
  locations: z.array(z.string()),
  isFresherFriendly: z.boolean(),
  redFlags: z.array(z.string()).max(5),
});
export type JobExtract = z.infer<typeof JobExtractSchema>;

export const MatchJudgeSchema = z.object({
  adjustment: z.number().int().min(-10).max(10),
  strengths: z.array(z.string()).max(5),
  gaps: z.array(z.string()).max(5),
  summary: z.string().max(500),
  recommendApply: z.boolean(),
});
export type MatchJudge = z.infer<typeof MatchJudgeSchema>;

// Tailored resume: every bullet must point at a real source bullet (provenance).
export const TailoredResumeSchema = z.object({
  summary: z.string().max(600),
  skills: z.array(z.string()).max(30),
  sections: z.array(z.object({
    kind: z.enum(["experience", "project"]),
    sourceId: z.string(),                       // Experience.id or Project.id
    bullets: z.array(z.object({
      sourceBulletId: z.string(),               // Achievement.id
      text: z.string().max(300),
    })).max(5),
  })),
});
export type TailoredResume = z.infer<typeof TailoredResumeSchema>;

export const CoverLetterSchema = z.object({
  greeting: z.string(),
  paragraphs: z.array(z.string()).min(2).max(4),
  closing: z.string(),
  factsUsed: z.array(z.string()),               // each must exist in the profile
});
export type CoverLetter = z.infer<typeof CoverLetterSchema>;

export const ResumeCritiqueSchema = z.object({
  strengths: z.array(z.string()).max(6),
  weaknesses: z.array(z.string()).max(6),
  suggestions: z.array(z.object({
    section: z.enum(["contact", "summary", "skills", "experience", "projects", "education", "format"]),
    issue: z.string(), fix: z.string(),
    priority: z.enum(["HIGH", "MEDIUM", "LOW"]),
  })).max(10),
});
export type ResumeCritique = z.infer<typeof ResumeCritiqueSchema>;

export const AnswerDraftSchema = z.object({
  answer: z.string().max(1200),
  factsUsed: z.array(z.string()),
  needsHumanInput: z.boolean(),          // true when the profile lacks the facts to answer honestly
});
export type AnswerDraft = z.infer<typeof AnswerDraftSchema>;

export const EmailClassifySchema = z.object({
  category: z.enum(["ACKNOWLEDGEMENT", "INTERVIEW", "ASSESSMENT", "REJECTION", "OFFER", "OTHER"]),
  confidence: z.number().min(0).max(1),
  company: z.string().nullable(),
  roleTitle: z.string().nullable(),
  nextStepDate: z.string().nullable(),
});
export type EmailClassify = z.infer<typeof EmailClassifySchema>;
