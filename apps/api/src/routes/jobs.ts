// apps/api/src/routes/jobs.ts - ranked job list, job detail, state triage, manual import, rescore
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { prisma } from "@jobpilot/db";
import { assertPublicHttpUrl } from "@jobpilot/core/security/url.js";
import { canonicalUrl, dedupeHash, normalizeCompany, normalizeTitle } from "@jobpilot/core/sources/normalize.js";
import { classifySeniority, parseYears } from "@jobpilot/core/matching/seniority.js";
import { processJob } from "@jobpilot/core/matching/process.js";
import { ApiError, parseWith } from "../errors.js";

const Query = z.object({
  minScore: z.coerce.number().int().min(0).max(100).default(50),
  state: z.enum(["NEW", "SAVED", "HIDDEN", "APPLIED"]).optional(),
  q: z.string().trim().max(100).optional(),
  remote: z
    .enum(["true", "false"])
    .transform((v) => v === "true")
    .optional(),
  source: z.string().trim().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().optional(),
});

const StateBody = z.object({ state: z.enum(["NEW", "SAVED", "HIDDEN", "APPLIED"]) });

const ImportJobSchema = z.object({
  url: z.string().trim().url().optional(),
  company: z.string().trim().min(1),
  title: z.string().trim().min(1),
  location: z.string().trim().optional(),
  descriptionText: z.string().trim().min(10),
  source: z.literal("MANUAL").default("MANUAL"),
});

export const jobRoutes: FastifyPluginAsync = async (app) => {
  // GET /api/v1/jobs - ranked job matches with keyset pagination
  app.get("/", async (req) => {
    const { minScore, state, q, remote, source, limit, cursor } = parseWith(Query, req.query);
    const rows = await prisma.jobMatch.findMany({
      where: {
        score: { gte: minScore },
        ...(state ? { userState: state } : { userState: { not: "HIDDEN" } }),
        ...(q ? { job: { title: { contains: q, mode: "insensitive" } } } : {}),
        ...(remote !== undefined ? { job: { workMode: remote ? "REMOTE" : { not: "REMOTE" } } } : {}),
        ...(source ? { job: { source: { name: { contains: source, mode: "insensitive" } } } } : {}),
      },
      include: {
        job: {
          include: {
            company: true,
            source: true,
            skills: { include: { skill: true } },
          },
        },
      },
      orderBy: [{ score: "desc" }, { id: "asc" }],
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    const next = rows.length > limit ? rows.pop()!.id : null;
    return { data: rows, nextCursor: next };
  });

  // POST /api/v1/jobs/import - manual capture of posting (SSRF guarded)
  app.post("/import", async (req, reply) => {
    const body = parseWith(ImportJobSchema, req.body);
    let canUrl = "";
    if (body.url) {
      try {
        await assertPublicHttpUrl(body.url);
        canUrl = canonicalUrl(body.url);
      } catch (err) {
        throw new ApiError(400, "INVALID_URL", err instanceof Error ? err.message : String(err));
      }
    }

    const hash = dedupeHash(body.company, body.title, body.location ?? null);
    const existing = await prisma.job.findUnique({ where: { dedupeHash: hash } });
    if (existing) {
      return reply.status(200).send({
        jobId: existing.id,
        duplicateOf: existing.id,
        matchQueued: false,
      });
    }

    const seniority = classifySeniority(body.title, body.descriptionText);
    const yrs = parseYears(body.descriptionText);

    const company = await prisma.company.upsert({
      where: { normalizedName: normalizeCompany(body.company) },
      update: {},
      create: { name: body.company, normalizedName: normalizeCompany(body.company) },
    });

    const source = await prisma.jobSource.upsert({
      where: { kind_name: { kind: "MANUAL", name: "Manual Paste" } },
      update: {},
      create: {
        kind: "MANUAL",
        name: "Manual Paste",
        termsNote: "Manual copy/paste by user",
      },
    });

    const job = await prisma.job.create({
      data: {
        sourceId: source.id,
        companyId: company.id,
        title: body.title,
        normalizedTitle: normalizeTitle(body.title),
        descriptionText: body.descriptionText,
        location: body.location ?? null,
        seniority,
        minYears: yrs.min,
        maxYears: yrs.max,
        applyUrl: body.url ?? "",
        canonicalUrl: canUrl,
        dedupeHash: hash,
        embedding: [],
      },
    });

    return reply.status(201).send({
      jobId: job.id,
      duplicateOf: null,
      matchQueued: true,
    });
  });

  // GET /api/v1/jobs/:id - job detail
  app.get<{ Params: { id: string } }>("/:id", async (req) => {
    const job = await prisma.job.findUnique({
      where: { id: req.params.id },
      include: {
        company: true,
        source: true,
        skills: { include: { skill: true } },
        matches: { take: 1, orderBy: { createdAt: "desc" } },
      },
    });
    if (!job) {
      // Fallback: check if id is a match id
      const match = await prisma.jobMatch.findUnique({
        where: { id: req.params.id },
        include: {
          job: {
            include: {
              company: true,
              source: true,
              skills: { include: { skill: true } },
              matches: { take: 1, orderBy: { createdAt: "desc" } },
            },
          },
        },
      });
      if (match) return { data: match.job };
      throw new ApiError(404, "NOT_FOUND", "Job not found");
    }
    return { data: job };
  });

  // PATCH /api/v1/jobs/:id/state - update triage state (accepts job id or match id)
  app.patch<{ Params: { id: string } }>("/:id/state", async (req) => {
    const { state } = parseWith(StateBody, req.body);
    let match = await prisma.jobMatch.findFirst({
      where: { OR: [{ id: req.params.id }, { jobId: req.params.id }] },
    });
    if (!match) {
      const job = await prisma.job.findUnique({ where: { id: req.params.id } });
      if (!job) throw new ApiError(404, "NOT_FOUND", "Job not found");
      const resume = await prisma.resume.findFirst({ where: { isPrimary: true } });
      if (resume) {
        match = await prisma.jobMatch.create({
          data: {
            jobId: job.id,
            profileId: resume.profileId,
            score: 50,
            breakdown: { skills: 0.5, semantic: 0.5, title: 0.5, experience: 0.5, location: 0.5 },
            matchedSkills: [],
            missingSkills: [],
            llmAdjustment: 0,
            userState: state,
            scoringVersion: "2026.1",
            resumeId: resume.id,
          },
        });
        return { data: match };
      }
      throw new ApiError(404, "NOT_FOUND", "Job match not found");
    }
    const updated = await prisma.jobMatch.update({
      where: { id: match.id },
      data: { userState: state },
    });
    return { data: updated };
  });

  // POST /api/v1/jobs/:id/rescore - rescore candidate job against primary profile
  app.post<{ Params: { id: string } }>("/:id/rescore", async (req) => {
    const jobId = req.params.id;
    let job = await prisma.job.findUnique({ where: { id: jobId } });
    if (!job) {
      const match = await prisma.jobMatch.findUnique({ where: { id: jobId } });
      if (match) {
        job = await prisma.job.findUnique({ where: { id: match.jobId } });
      }
    }
    if (!job) throw new ApiError(404, "NOT_FOUND", "Job not found");

    const resume = await prisma.resume.findFirst({ where: { isPrimary: true } });
    if (!resume) throw new ApiError(400, "NO_RESUME", "No primary resume found to rescore against");

    const match = await processJob(job.id, resume.profileId, resume.id, true);
    return { data: match };
  });
};

