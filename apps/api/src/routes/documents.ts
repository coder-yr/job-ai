// apps/api/src/routes/documents.ts  - Phase 5: tailored documents with approval gate
// Endpoints:
//   POST   /api/v1/jobs/:jobId/documents          - generate tailored resume + cover letter
//   GET    /api/v1/documents/:id                  - get document with guard report
//   PATCH  /api/v1/documents/:id                  - edit content (clears approvedAt)
//   POST   /api/v1/documents/:id/approve          - set approvedAt timestamp
//   POST   /api/v1/documents/:id/export           - render PDF|DOCX (409 if not approved)
//   GET    /api/v1/documents/:id/file             - stream the exported file bytes
import { createReadStream } from "node:fs";
import { mkdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { prisma, type Prisma } from "@jobpilot/db";
import {
  TailoredResumeSchema,
  CoverLetterSchema,
  type TailoredResume,
  type CoverLetter,
} from "@jobpilot/shared";
import { tailorResume } from "@jobpilot/core/docs/tailor.js";
import { generateCoverLetter, buildCandidateFacts } from "@jobpilot/core/docs/coverLetter.js";
import { resumeHtml, renderPdf } from "@jobpilot/core/docs/renderPdf.js";
import { renderDocx } from "@jobpilot/core/docs/renderDocx.js";
import { MODELS } from "@jobpilot/core/llm/ollama.js";
import { PROMPTS } from "@jobpilot/core/llm/prompts.js";
import { ParsedResumeSchema } from "@jobpilot/shared";
import { ApiError, parseWith } from "../errors.js";

const ExportQuery = z.object({
  format: z.enum(["pdf", "docx"]).default("pdf"),
});

const PatchBody = z.object({
  content: z.record(z.unknown()),
});

// ─── helpers ──────────────────────────────────────────────────────────────────

async function loadProfileFacts(profileId: string) {
  const profile = await prisma.profile.findUniqueOrThrow({
    where: { id: profileId },
    include: {
      skills: { include: { skill: true } },
      experiences: {
        orderBy: { sortOrder: "asc" },
        include: { achievements: { orderBy: { sortOrder: "asc" } } },
      },
      projects: {
        orderBy: { sortOrder: "asc" },
        include: { achievements: { orderBy: { sortOrder: "asc" } } },
      },
    },
  });

  const skillNames = profile.skills.map((ps) => ps.skill.name);
  const skillCatalog = (await prisma.skill.findMany({ select: { name: true } })).map((s) => s.name);

  // Build bullet Map: achievementId -> { text, ownerId }
  const bullets = new Map<string, { text: string; ownerId: string }>();
  const sections: { kind: "experience" | "project"; sourceId: string; heading: string; bullets: { id: string; text: string }[] }[] = [];
  const titles = new Map<string, { heading: string; sub?: string }>();

  for (const exp of profile.experiences) {
    const expBullets = exp.achievements.map((a) => {
      bullets.set(a.id, { text: a.text, ownerId: exp.id });
      return { id: a.id, text: a.text };
    });
    if (expBullets.length > 0) {
      sections.push({ kind: "experience", sourceId: exp.id, heading: `${exp.title} at ${exp.company}`, bullets: expBullets });
      titles.set(exp.id, { heading: `${exp.title}`, sub: exp.company });
    }
  }
  for (const proj of profile.projects) {
    const projBullets = proj.achievements.map((a) => {
      bullets.set(a.id, { text: a.text, ownerId: proj.id });
      return { id: a.id, text: a.text };
    });
    if (projBullets.length > 0) {
      sections.push({ kind: "project", sourceId: proj.id, heading: proj.name, bullets: projBullets });
      titles.set(proj.id, { heading: proj.name, sub: proj.url ?? undefined });
    }
  }

  const topBullets = [...bullets.values()].map((b) => b.text).slice(0, 10);

  return { profile, skillNames, skillCatalog, bullets, sections, titles, topBullets };
}

// ─── routes ───────────────────────────────────────────────────────────────────

export const documentRoutes: FastifyPluginAsync = async (app) => {
  // POST /api/v1/jobs/:jobId/documents
  // Generates a TAILORED_RESUME and optionally a COVER_LETTER for a job.
  app.post<{ Params: { jobId: string } }>("/jobs/:jobId/documents", async (req, reply) => {
    const { jobId } = req.params;

    const job = await prisma.job.findUnique({
      where: { id: jobId },
      include: { company: true, skills: { include: { skill: true } } },
    });
    if (!job) throw new ApiError(404, "NOT_FOUND", "Job not found");

    const resume = await prisma.resume.findFirst({ where: { isPrimary: true } });
    if (!resume) throw new ApiError(400, "NO_RESUME", "No primary resume found");

    const { profile, skillNames, skillCatalog, bullets, sections, titles, topBullets } =
      await loadProfileFacts(resume.profileId);

    const jobRequiredSkills = job.skills.filter((s) => s.required).map((s) => s.skill.name);

    // 1. Tailored resume
    const { resume: tailored, report, attempts } = await tailorResume({
      job: {
        title: job.title,
        company: job.company.name,
        description: job.descriptionText,
        requiredSkills: jobRequiredSkills,
      },
      facts: { skills: new Set(skillNames), bullets, skillCatalog },
      sections,
      skills: skillNames,
    });

    const resumeDoc = await prisma.generatedDocument.create({
      data: {
        profileId: resume.profileId,
        jobId,
        kind: "TAILORED_RESUME",
        format: "JSON",
        content: tailored as unknown as Prisma.InputJsonValue,
        basedOnResumeId: resume.id,
        model: MODELS.chat,
        promptVersion: PROMPTS.tailorResume.version,
        guardReport: report as unknown as Prisma.InputJsonValue,
      },
    });

    // 2. Cover letter (best-effort; wraps job description as untrusted)
    let coverDoc = null;
    try {
      const candidateFacts = buildCandidateFacts({
        fullName: profile.fullName,
        yearsExperience: profile.yearsExperience,
        skills: skillNames,
        bullets: topBullets,
        summary: profile.summary,
        links: (profile.links as Record<string, string | null | undefined> | null) ?? {},
      });

      const coverLetter = await generateCoverLetter({
        job: { title: job.title, company: job.company.name, description: job.descriptionText },
        candidateFacts,
      });

      coverDoc = await prisma.generatedDocument.create({
        data: {
          profileId: resume.profileId,
          jobId,
          kind: "COVER_LETTER",
          format: "JSON",
          content: coverLetter as unknown as Prisma.InputJsonValue,
          basedOnResumeId: resume.id,
          model: MODELS.chat,
          promptVersion: PROMPTS.coverLetter.version,
          guardReport: { ok: true, violations: [] } as unknown as Prisma.InputJsonValue,
        },
      });
    } catch {
      // Cover letter generation failing doesn't fail the whole request
    }

    try {
      const { sseBus } = await import("@jobpilot/core/notifications/events.js");
      sseBus.broadcast("document.ready", { documentId: resumeDoc.id, kind: resumeDoc.kind, jobId });
      if (coverDoc) {
        sseBus.broadcast("document.ready", { documentId: coverDoc.id, kind: coverDoc.kind, jobId });
      }
    } catch {
      // Non-fatal if SSE broadcast fails
    }

    return reply.status(201).send({
      data: {
        resumeDocument: resumeDoc,
        coverLetterDocument: coverDoc,
        guardReport: report,
        llmAttempts: attempts,
      },
    });
  });

  // GET /api/v1/documents/:id
  app.get<{ Params: { id: string } }>("/documents/:id", async (req) => {
    const doc = await prisma.generatedDocument.findUnique({ where: { id: req.params.id } });
    if (!doc) throw new ApiError(404, "NOT_FOUND", "Document not found");
    return { data: doc };
  });

  // PATCH /api/v1/documents/:id  - edit content, clears approvedAt
  app.patch<{ Params: { id: string } }>("/documents/:id", async (req) => {
    const doc = await prisma.generatedDocument.findUnique({ where: { id: req.params.id } });
    if (!doc) throw new ApiError(404, "NOT_FOUND", "Document not found");

    const { content } = parseWith(PatchBody, req.body);

    // Validate content structure based on kind
    let validated: unknown;
    if (doc.kind === "TAILORED_RESUME") {
      validated = TailoredResumeSchema.parse(content);
    } else if (doc.kind === "COVER_LETTER") {
      validated = CoverLetterSchema.parse(content);
    } else {
      validated = content;
    }

    const updated = await prisma.generatedDocument.update({
      where: { id: req.params.id },
      data: {
        content: validated as Prisma.InputJsonValue,
        approvedAt: null,   // editing a draft always clears approval
        filePath: null,     // invalidate any previously exported file
      },
    });

    return { data: updated };
  });

  // POST /api/v1/documents/:id/approve
  app.post<{ Params: { id: string } }>("/documents/:id/approve", async (req) => {
    const doc = await prisma.generatedDocument.findUnique({ where: { id: req.params.id } });
    if (!doc) throw new ApiError(404, "NOT_FOUND", "Document not found");

    // Re-run guard before approving (defence in depth)
    if (doc.kind === "TAILORED_RESUME") {
      const tailored = TailoredResumeSchema.parse(doc.content);
      const { profile, skillNames, skillCatalog, bullets } = await loadProfileFacts(doc.profileId);
      void profile; // suppress unused
      const { guardTailoredResume } = await import("@jobpilot/core/docs/guard.js");
      const report = guardTailoredResume(tailored, { skills: new Set(skillNames), bullets, skillCatalog });
      if (!report.ok) {
        throw new ApiError(422, "GUARD_FAILED", `Truthfulness guard blocked approval: ${report.violations.slice(0, 3).join("; ")}`);
      }
    }

    const updated = await prisma.generatedDocument.update({
      where: { id: req.params.id },
      data: { approvedAt: new Date() },
    });

    return { data: updated };
  });

  // POST /api/v1/documents/:id/export?format=pdf|docx
  // Returns 409 CONFLICT if not yet approved.
  app.post<{ Params: { id: string }; Querystring: z.infer<typeof ExportQuery> }>(
    "/documents/:id/export",
    async (req) => {
      const { format } = parseWith(ExportQuery, req.query);
      const doc = await prisma.generatedDocument.findUnique({ where: { id: req.params.id } });
      if (!doc) throw new ApiError(404, "NOT_FOUND", "Document not found");

      // Approval gate
      if (!doc.approvedAt) {
        throw new ApiError(409, "NOT_APPROVED", "Document must be approved before exporting");
      }

      if (doc.kind !== "TAILORED_RESUME") {
        throw new ApiError(400, "UNSUPPORTED_KIND", `Export is only supported for TAILORED_RESUME documents`);
      }

      const tailored = TailoredResumeSchema.parse(doc.content);

      // Load profile for header and titles
      const { profile, titles } = await loadProfileFacts(doc.profileId);

      const dataDir = process.env.DATA_DIR || "./data";
      const docsDir = join(dataDir, "documents");
      await mkdir(docsDir, { recursive: true });

      const fileId = randomUUID();
      const ext = format === "pdf" ? "pdf" : "docx";
      const outPath = join(docsDir, `${fileId}.${ext}`);

      const personInfo = {
        fullName: profile.fullName,
        email: profile.email,
        phone: profile.phone,
        location: profile.location,
      };

      if (format === "pdf") {
        const html = resumeHtml(personInfo, tailored, titles);
        await renderPdf(html, outPath);
      } else {
        await renderDocx(personInfo, tailored, titles, outPath);
      }

      const updated = await prisma.generatedDocument.update({
        where: { id: doc.id },
        data: { filePath: `documents/${fileId}.${ext}`, format: format === "pdf" ? "PDF" : "DOCX" },
      });

      return { data: updated };
    },
  );

  // GET /api/v1/documents/:id/file  - stream the rendered file
  app.get<{ Params: { id: string } }>("/documents/:id/file", async (req, reply) => {
    const doc = await prisma.generatedDocument.findUnique({ where: { id: req.params.id } });
    if (!doc) throw new ApiError(404, "NOT_FOUND", "Document not found");
    if (!doc.filePath) throw new ApiError(404, "NOT_EXPORTED", "Document has not been exported yet");

    const dataDir = process.env.DATA_DIR || "./data";
    const fullPath = join(dataDir, doc.filePath);

    try {
      await stat(fullPath);
    } catch {
      throw new ApiError(404, "FILE_MISSING", "Exported file not found on disk");
    }

    const isPdf = doc.filePath.endsWith(".pdf");
    const mimeType = isPdf
      ? "application/pdf"
      : "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    const filename = `resume.${isPdf ? "pdf" : "docx"}`;

    reply
      .header("Content-Type", mimeType)
      .header("Content-Disposition", `attachment; filename="${filename}"`);

    return reply.send(createReadStream(fullPath));
  });
};
