// apps/api/src/routes/resumes.ts - Resume ingestion, editing, ATS analysis routes
import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { prisma, type Prisma } from "@jobpilot/db";
import { ParsedResumeSchema } from "@jobpilot/shared";
import { extractResumeText } from "@jobpilot/core/resume/extractText.js";
import { ApiError, parseWith } from "../errors.js";
import {
  detectFileFormat,
  getOrCreateDefaultProfile,
  processResumeParse,
  persistParsedResume,
  analyzeResume,
} from "../services/resumeService.js";

export const resumeRoutes: FastifyPluginAsync = async (app) => {
  // POST /api/v1/resumes - upload PDF/DOCX/TXT with magic-byte validation, SHA-256 de-dup
  app.post("/", async (req, reply) => {
    let fileBuffer: Buffer | null = null;
    let originalName = "resume.pdf";
    let label = "My Resume";

    if (req.isMultipart()) {
      const data = await req.file({ limits: { fileSize: 10 * 1024 * 1024 } });
      if (!data) throw new ApiError(400, "MISSING_FILE", "No file uploaded");
      fileBuffer = await data.toBuffer();
      originalName = data.filename || "resume.pdf";
      const fields = data.fields as Record<string, { value?: string } | undefined>;
      if (fields?.label?.value) label = fields.label.value;
    } else {
      const body = req.body as { content?: string; filename?: string; label?: string } | undefined;
      if (body?.content) {
        fileBuffer = Buffer.from(body.content, "utf8");
        if (body.filename) originalName = body.filename;
        if (body.label) label = body.label;
      }
    }

    if (!fileBuffer || fileBuffer.length === 0) {
      throw new ApiError(400, "EMPTY_FILE", "Uploaded file is empty");
    }

    if (fileBuffer.length > 10 * 1024 * 1024) {
      throw new ApiError(413, "PAYLOAD_TOO_LARGE", "File size exceeds 10 MB limit");
    }

    // Magic-byte check for PDF/DOCX/TXT
    const detected = detectFileFormat(fileBuffer, originalName);
    if (!detected.valid) {
      throw new ApiError(400, "UNSUPPORTED_MEDIA_TYPE", "Only PDF, DOCX, and TXT files are permitted");
    }

    // SHA-256 de-duplication check
    const sha256 = createHash("sha256").update(fileBuffer).digest("hex");
    const existing = await prisma.resume.findFirst({
      where: { sha256 },
    });

    if (existing) {
      return reply.status(200).send({
        data: existing,
        isDuplicate: true,
        message: "Resume already uploaded",
      });
    }

    // Store under DATA_DIR/resumes with UUID filename
    const dataDir = process.env.DATA_DIR || "./data";
    const resumesDir = join(dataDir, "resumes");
    await mkdir(resumesDir, { recursive: true });

    const uuid = randomUUID();
    const diskFilename = `${uuid}.${detected.format}`;
    const fullDiskPath = join(resumesDir, diskFilename);
    await writeFile(fullDiskPath, fileBuffer);
    const storagePath = `resumes/${diskFilename}`;

    // Extract text locally
    let extractedText = "";
    try {
      const extracted = await extractResumeText(fullDiskPath);
      extractedText = extracted.text;
    } catch {
      extractedText = fileBuffer.toString("utf8");
    }

    // Ensure profile exists
    const profile = await getOrCreateDefaultProfile();

    // Check if this is the first resume to make it primary by default
    const existingCount = await prisma.resume.count({ where: { profileId: profile.id } });
    const isPrimary = existingCount === 0;

    // Create Resume record in DB
    const resume = await prisma.resume.create({
      data: {
        profileId: profile.id,
        label,
        originalName,
        mimeType: detected.mimeType,
        storagePath,
        sha256,
        rawText: extractedText,
        parseStatus: "PENDING",
        isPrimary,
      },
    });

    // Run parsing process (catches LLM failure after 1 retry -> sets NEEDS_REVIEW)
    void processResumeParse(resume.id).catch(() => {});

    return reply.status(202).send({
      data: resume,
      message: "Resume uploaded and parsing initiated",
    });
  });

  // GET /api/v1/resumes - list resumes
  app.get("/", async () => {
    const resumes = await prisma.resume.findMany({
      orderBy: { createdAt: "desc" },
      include: { analyses: { orderBy: { createdAt: "desc" }, take: 1 } },
    });
    return { data: resumes };
  });

  // GET /api/v1/resumes/:id - get resume with parsed JSON
  app.get<{ Params: { id: string } }>("/:id", async (req) => {
    const resume = await prisma.resume.findUnique({
      where: { id: req.params.id },
      include: { analyses: { orderBy: { createdAt: "desc" } } },
    });
    if (!resume) throw new ApiError(404, "NOT_FOUND", "Resume not found");
    return { data: resume };
  });

  // PATCH /api/v1/resumes/:id - edit parsed data manually (becomes source of truth)
  app.patch<{ Params: { id: string } }>("/:id", async (req) => {
    const resume = await prisma.resume.findUnique({ where: { id: req.params.id } });
    if (!resume) throw new ApiError(404, "NOT_FOUND", "Resume not found");

    const validated = parseWith(ParsedResumeSchema, req.body);

    const updated = await prisma.resume.update({
      where: { id: req.params.id },
      data: {
        parsed: validated as unknown as Prisma.InputJsonValue,
        parseStatus: "PARSED",
      },
    });

    // Update Profile and relation tables with manual edits
    await persistParsedResume(resume.profileId, resume.id, validated);

    return { data: updated };
  });

  // POST /api/v1/resumes/:id/analyze - ATS rules + critique
  app.post<{ Params: { id: string } }>("/:id/analyze", async (req, reply) => {
    const analysis = await analyzeResume(req.params.id);
    return reply.status(202).send({ data: analysis });
  });

  // GET /api/v1/resumes/:id/analysis - get latest analysis
  app.get<{ Params: { id: string } }>("/:id/analysis", async (req) => {
    const analysis = await prisma.resumeAnalysis.findFirst({
      where: { resumeId: req.params.id },
      orderBy: { createdAt: "desc" },
    });
    if (!analysis) throw new ApiError(404, "NOT_FOUND", "No analysis found for this resume");
    return { data: analysis };
  });

  // POST /api/v1/resumes/:id/primary - mark as primary resume
  app.post<{ Params: { id: string } }>("/:id/primary", async (req) => {
    const resume = await prisma.resume.findUnique({ where: { id: req.params.id } });
    if (!resume) throw new ApiError(404, "NOT_FOUND", "Resume not found");

    await prisma.resume.updateMany({
      where: { profileId: resume.profileId },
      data: { isPrimary: false },
    });

    const updated = await prisma.resume.update({
      where: { id: req.params.id },
      data: { isPrimary: true },
    });

    return { data: updated, success: true };
  });

  // DELETE /api/v1/resumes/:id - delete resume
  app.delete<{ Params: { id: string } }>("/:id", async (req, reply) => {
    const resume = await prisma.resume.findUnique({ where: { id: req.params.id } });
    if (!resume) throw new ApiError(404, "NOT_FOUND", "Resume not found");

    const dataDir = process.env.DATA_DIR || "./data";
    const fullPath = join(dataDir, resume.storagePath);
    await unlink(fullPath).catch(() => {});

    await prisma.resume.delete({ where: { id: req.params.id } });
    return reply.status(204).send();
  });
};
