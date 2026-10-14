import type { FastifyPluginAsync } from "fastify";
import { prisma } from "@jobpilot/db";
import { runDiscovery } from "@jobpilot/core/sources/discovery.js";
import { ApiError } from "../errors.js";

export const searchRunRoutes: FastifyPluginAsync = async (app) => {
  // GET /api/v1/search-runs - run history with stats
  app.get("/", async () => {
    const runs = await prisma.searchRun.findMany({
      orderBy: { createdAt: "desc" },
      take: 20,
    });
    return { data: runs };
  });

  // GET /api/v1/search-runs/:id - run details with per-source errors
  app.get<{ Params: { id: string } }>("/:id", async (req) => {
    const run = await prisma.searchRun.findUnique({ where: { id: req.params.id } });
    if (!run) throw new ApiError(404, "NOT_FOUND", "Search run not found");
    return { data: run };
  });

  // POST /api/v1/search-runs - trigger manual discovery run
  app.post("/", async (_req, reply) => {
    const active = await prisma.searchRun.findFirst({
      where: { status: "RUNNING" },
    });
    if (active) {
      throw new ApiError(409, "RUN_IN_PROGRESS", "A discovery search run is already in progress");
    }

    // Trigger runDiscovery in background or wait
    const promise = runDiscovery("MANUAL").catch((err) => {
      reqLog: console.error("[discovery error]", err);
    });

    // Provide immediate 202 response
    return reply.status(202).send({
      message: "Discovery run initiated",
      trigger: "MANUAL",
    });
  });

  // POST /api/v1/search-runs/:id/cancel - cancel queued/running run
  app.post<{ Params: { id: string } }>("/:id/cancel", async (req) => {
    const run = await prisma.searchRun.findUnique({ where: { id: req.params.id } });
    if (!run) throw new ApiError(404, "NOT_FOUND", "Search run not found");

    if (run.status !== "RUNNING" && run.status !== "QUEUED") {
      throw new ApiError(400, "CANNOT_CANCEL", `Run is already in terminal state: ${run.status}`);
    }

    const updated = await prisma.searchRun.update({
      where: { id: req.params.id },
      data: { status: "CANCELLED", finishedAt: new Date() },
    });

    return { data: updated, success: true };
  });
};
