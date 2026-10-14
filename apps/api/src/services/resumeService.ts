// apps/api/src/services/resumeService.ts - Resume ingestion, parsing, persistence and analysis
import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { prisma, type Prisma } from "@jobpilot/db";
import {
  ParsedResumeSchema,
  type ParsedResume,
} from "@jobpilot/shared";
import { extractResumeText } from "@jobpilot/core/resume/extractText.js";
import { parseResume, atsRuleChecks, critiqueResume } from "@jobpilot/core/resume/parse.js";
import { buildAliasMap, canonSkills, canonSkill } from "@jobpilot/core/resume/skills.js";
import { embed, MODELS } from "@jobpilot/core/llm/ollama.js";
import { ApiError } from "../errors.js";

export function detectFileFormat(buffer: Buffer, originalFilename: string): { valid: boolean; mimeType: string; format: "pdf" | "docx" | "txt" } {
  // Check PDF: starts with %PDF- (0x25 0x50 0x44 0x46)
  if (buffer.length >= 4 && buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46) {
    return { valid: true, mimeType: "application/pdf", format: "pdf" };
  }
  // Check DOCX: starts with PK\x03\x04 (0x50 0x4b 0x03 0x04)
  if (buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b && buffer[2] === 0x03 && buffer[3] === 0x04) {
    return { valid: true, mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", format: "docx" };
  }
  // Check plain text: extension is .txt/.md or valid text without zero bytes in first 1024 bytes
  const isTextExt = /\.(txt|md)$/i.test(originalFilename);
  const sample = buffer.subarray(0, Math.min(buffer.length, 1024));
  const hasNullByte = sample.includes(0x00);
  if (!hasNullByte && (isTextExt || sample.length > 0)) {
    return { valid: true, mimeType: "text/plain", format: "txt" };
  }
  return { valid: false, mimeType: "application/octet-stream", format: "txt" };
}

export const auditHook = async (r: {
  purpose: string;
  model: string;
  promptVersion: string;
  durationMs: number;
  success: boolean;
  error?: string;
}) => {
  try {
    await prisma.llmCall.create({
      data: {
        purpose: r.purpose,
        model: r.model,
        promptVersion: r.promptVersion,
        durationMs: r.durationMs,
        success: r.success,
        error: r.error ?? null,
      },
    });
  } catch {
    // Fail soft if db is logging-disabled in test environments
  }
};

export async function getOrCreateDefaultProfile(initial?: Partial<ParsedResume>) {
  let profile = await prisma.profile.findFirst();
  if (!profile) {
    profile = await prisma.profile.create({
      data: {
        fullName: initial?.fullName ?? "Candidate",
        email: initial?.email ?? null,
        phone: initial?.phone ?? null,
        location: initial?.location ?? null,
        headline: initial?.headline ?? null,
        summary: initial?.summary ?? null,
        links: initial?.links ? (initial.links as Prisma.InputJsonValue) : {},
        yearsExperience: initial?.totalExperienceMonths ? initial.totalExperienceMonths / 12 : 0,
        targetRoles: [],
        preferredCities: initial?.location ? [initial.location.toLowerCase()] : [],
        embedding: [],
      },
    });
  }
  return profile;
}

export async function persistParsedResume(profileId: string, resumeId: string, parsed: ParsedResume) {
  const yearsExp = parsed.totalExperienceMonths > 0 ? Number((parsed.totalExperienceMonths / 12).toFixed(1)) : 0;

  // 1. Update Profile
  await prisma.profile.update({
    where: { id: profileId },
    data: {
      fullName: parsed.fullName,
      email: parsed.email,
      phone: parsed.phone,
      location: parsed.location,
      headline: parsed.headline,
      summary: parsed.summary,
      links: parsed.links ? (parsed.links as Prisma.InputJsonValue) : {},
      yearsExperience: yearsExp,
      preferredCities: parsed.location ? [parsed.location.toLowerCase()] : undefined,
    },
  });

  // 2. Persist Experiences & Achievements
  for (let i = 0; i < parsed.experiences.length; i++) {
    const exp = parsed.experiences[i]!;
    const expRow = await prisma.experience.create({
      data: {
        profileId,
        company: exp.company,
        title: exp.title,
        location: exp.location,
        isCurrent: exp.isCurrent,
        sortOrder: i,
      },
    });

    for (let b = 0; b < exp.bullets.length; b++) {
      await prisma.achievement.create({
        data: {
          experienceId: expRow.id,
          text: exp.bullets[b]!,
          skillsUsed: [],
          sortOrder: b,
        },
      });
    }
  }

  // 3. Persist Projects & Achievements
  for (let i = 0; i < parsed.projects.length; i++) {
    const proj = parsed.projects[i]!;
    const projRow = await prisma.project.create({
      data: {
        profileId,
        name: proj.name,
        url: proj.url,
        description: proj.description,
        techStack: proj.techStack,
        sortOrder: i,
      },
    });

    for (let b = 0; b < proj.bullets.length; b++) {
      await prisma.achievement.create({
        data: {
          projectId: projRow.id,
          text: proj.bullets[b]!,
          skillsUsed: proj.techStack,
          sortOrder: b,
        },
      });
    }
  }

  // 4. Persist Education
  for (const edu of parsed.education) {
    await prisma.education.create({
      data: {
        profileId,
        institution: edu.institution,
        degree: edu.degree,
        field: edu.field,
        startYear: edu.startYear,
        endYear: edu.endYear,
        grade: edu.grade,
      },
    });
  }

  // 5. Canonicalize & Persist Skills
  const existingSkills = await prisma.skill.findMany({ select: { name: true, aliases: true } });
  const aliasMap = buildAliasMap(existingSkills);

  for (const s of parsed.skills) {
    const canon = canonSkill(s.name, aliasMap);
    const skillRow = await prisma.skill.upsert({
      where: { name: canon },
      update: { category: s.category },
      create: { name: canon, display: s.name, category: s.category, aliases: [] },
    });

    await prisma.profileSkill.upsert({
      where: { profileId_skillId: { profileId, skillId: skillRow.id } },
      update: { level: "INTERMEDIATE" },
      create: { profileId, skillId: skillRow.id, level: "INTERMEDIATE", source: "RESUME" },
    });
  }

  // 6. Compute Profile Embedding
  try {
    const skillNames = parsed.skills.map((s) => s.name).join(", ");
    const bullets = [
      ...parsed.experiences.flatMap((e) => e.bullets),
      ...parsed.projects.flatMap((p) => p.bullets),
    ].slice(0, 10).join("\n");
    const embedText = `${parsed.fullName} ${parsed.headline ?? ""} ${parsed.summary ?? ""}\nSkills: ${skillNames}\n${bullets}`;

    const [vec] = await embed([embedText]);
    if (vec && vec.length > 0) {
      await prisma.profile.update({
        where: { id: profileId },
        data: { embedding: vec, embeddingModel: MODELS.embed },
      });
    }
  } catch {
    // If Ollama is unavailable, fail soft for embeddings
  }
}

export async function processResumeParse(resumeId: string): Promise<ParsedResume | null> {
  const resume = await prisma.resume.findUniqueOrThrow({ where: { id: resumeId } });

  try {
    const parsed = await parseResume(resume.rawText, auditHook);
    await prisma.resume.update({
      where: { id: resumeId },
      data: {
        parsed: parsed as unknown as Prisma.InputJsonValue,
        parseStatus: "PARSED",
        parserModel: MODELS.chat,
      },
    });
    await persistParsedResume(resume.profileId, resumeId, parsed);
    return parsed;
  } catch (err) {
    // If model failed after retry -> NEEDS_REVIEW
    await prisma.resume.update({
      where: { id: resumeId },
      data: {
        parseStatus: "NEEDS_REVIEW",
      },
    });
    return null;
  }
}

export async function analyzeResume(resumeId: string) {
  const resume = await prisma.resume.findUniqueOrThrow({ where: { id: resumeId } });
  if (!resume.parsed) {
    throw new ApiError(400, "RESUME_NOT_PARSED", "Resume must be parsed before analysis");
  }

  const parsed = ParsedResumeSchema.parse(resume.parsed);
  const { atsScore, issues } = atsRuleChecks(resume.rawText, parsed);

  const sectionScores = {
    contact: issues.some((i) => i.section === "contact" && i.priority === "HIGH") ? 50 : 95,
    summary: issues.some((i) => i.section === "summary") ? 60 : 90,
    skills: issues.some((i) => i.section === "skills") ? 65 : 85,
    experience: issues.some((i) => i.section === "experience") ? 55 : 85,
    education: issues.some((i) => i.section === "education") ? 60 : 90,
    formatting: issues.some((i) => i.section === "format") ? 60 : 80,
  };

  let critique: { strengths: string[]; weaknesses: string[]; suggestions: { section: string; issue: string; fix: string; priority: "HIGH" | "MEDIUM" | "LOW" }[] } | null = null;
  let modelUsed = "rule-based";

  try {
    critique = await critiqueResume(parsed, auditHook);
    modelUsed = MODELS.chat;
  } catch {
    // Fall back to rule checks if Ollama unavailable
    critique = {
      strengths: ["Standard structure", "Technical skills present"],
      weaknesses: issues.map((i) => i.issue),
      suggestions: issues.map((i) => ({
        section: i.section,
        issue: i.issue,
        fix: i.fix,
        priority: i.priority,
      })),
    };
  }

  const analysis = await prisma.resumeAnalysis.create({
    data: {
      resumeId,
      atsScore,
      sectionScores,
      strengths: critique.strengths,
      weaknesses: critique.weaknesses,
      suggestions: critique.suggestions,
      model: modelUsed,
      promptVersion: "ats_analysis@1",
    },
  });

  return analysis;
}
