// apps/api/src/routes/sources.ts - Job sources management & test fetch
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { prisma, type Prisma } from "@jobpilot/db";
import { greenhouse } from "@jobpilot/core/sources/greenhouse.js";
import { lever } from "@jobpilot/core/sources/lever.js";
import { jsonLd } from "@jobpilot/core/sources/jsonld.js";
import { ashby } from "@jobpilot/core/sources/ashby.js";
import { smartRecruiters } from "@jobpilot/core/sources/smartrecruiters.js";
import type { JobSourceAdapter } from "@jobpilot/core/sources/types.js";
import { ApiError, parseWith } from "../errors.js";

const ADAPTERS: Record<string, JobSourceAdapter> = {
  ATS_GREENHOUSE: greenhouse,
  ATS_LEVER: lever,
  CAREER_PAGE_JSONLD: jsonLd,
  ATS_ASHBY: ashby,
  ATS_SMARTRECRUITERS: smartRecruiters,
};

const CreateSourceSchema = z.object({
  kind: z.enum([
    "ATS_GREENHOUSE",
    "ATS_LEVER",
    "ATS_ASHBY",
    "ATS_SMARTRECRUITERS",
    "CAREER_PAGE_JSONLD",
    "PUBLIC_API",
    "MANUAL",
    "EMAIL_ALERT",
    "RSS",
  ]),
  name: z.string().trim().min(1),
  config: z.record(z.unknown()).default({}),
  enabled: z.boolean().default(true),
  minIntervalMin: z.number().int().min(1).default(360),
  termsNote: z.string().optional(),
});

const UpdateSourceSchema = z.object({
  enabled: z.boolean().optional(),
  name: z.string().trim().min(1).optional(),
  config: z.record(z.unknown()).optional(),
  minIntervalMin: z.number().int().min(1).optional(),
  termsNote: z.string().optional(),
});

export const sourceRoutes: FastifyPluginAsync = async (app) => {
  // GET /api/v1/sources - list all job sources
  app.get("/", async () => {
    const sources = await prisma.jobSource.findMany({
      orderBy: { createdAt: "desc" },
      include: { _count: { select: { jobs: true } } },
    });
    return { data: sources };
  });

  // POST /api/v1/sources - create new source
  app.post("/", async (req, reply) => {
    const body = parseWith(CreateSourceSchema, req.body);
    const created = await prisma.jobSource.create({
      data: {
        kind: body.kind,
        name: body.name,
        config: body.config as Prisma.InputJsonValue,
        enabled: body.enabled,
        minIntervalMin: body.minIntervalMin,
        termsNote: body.termsNote ?? null,
      },
    });
    return reply.status(201).send({ data: created });
  });

  // PATCH /api/v1/sources/:id - toggle enabled / update configuration
  app.patch<{ Params: { id: string } }>("/:id", async (req) => {
    const source = await prisma.jobSource.findUnique({ where: { id: req.params.id } });
    if (!source) throw new ApiError(404, "NOT_FOUND", "Source not found");

    const body = parseWith(UpdateSourceSchema, req.body);
    const updated = await prisma.jobSource.update({
      where: { id: req.params.id },
      data: {
        ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
        ...(body.name ? { name: body.name } : {}),
        ...(body.config ? { config: body.config as Prisma.InputJsonValue } : {}),
        ...(body.minIntervalMin ? { minIntervalMin: body.minIntervalMin } : {}),
        ...(body.termsNote !== undefined ? { termsNote: body.termsNote } : {}),
      },
    });
    return { data: updated };
  });

  // DELETE /api/v1/sources/:id - remove source
  app.delete<{ Params: { id: string } }>("/:id", async (req, reply) => {
    const source = await prisma.jobSource.findUnique({ where: { id: req.params.id } });
    if (!source) throw new ApiError(404, "NOT_FOUND", "Source not found");

    await prisma.jobSource.delete({ where: { id: req.params.id } });
    return reply.status(204).send();
  });

  // POST /api/v1/sources/:id/test - sample fetch without writing to DB
  app.post<{ Params: { id: string } }>("/:id/test", async (req) => {
    const source = await prisma.jobSource.findUnique({ where: { id: req.params.id } });
    if (!source) throw new ApiError(404, "NOT_FOUND", "Source not found");

    const adapter = ADAPTERS[source.kind];
    if (!adapter) {
      throw new ApiError(400, "ADAPTER_NOT_FOUND", `No automated test adapter available for source kind: ${source.kind}`);
    }

    try {
      const raws = await adapter.fetchJobs(source.config as Record<string, unknown>);
      return {
        ok: true,
        sourceName: source.name,
        kind: source.kind,
        totalDiscovered: raws.length,
        sample: raws.slice(0, 3).map((j) => ({
          title: j.title,
          company: j.company,
          location: j.location,
          applyUrl: j.applyUrl,
          postedAt: j.postedAt,
        })),
      };
    } catch (err) {
      throw new ApiError(502, "SOURCE_TEST_FAILED", `Failed to fetch from ${source.name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  });
};
