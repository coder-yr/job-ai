import Fastify from "fastify";
import cors from "@fastify/cors";
import sensible from "@fastify/sensible";
import multipart from "@fastify/multipart";
import { registerAuth } from "./plugins/auth.js";
import { registerErrors } from "./plugins/errors.js";
import { jobRoutes } from "./routes/jobs.js";
import { resumeRoutes } from "./routes/resumes.js";
import { sourceRoutes } from "./routes/sources.js";
import { searchRunRoutes } from "./routes/searchRuns.js";
import { settingRoutes } from "./routes/settings.js";
import { documentRoutes } from "./routes/documents.js";
import { applicationRoutes } from "./routes/applications.js";
import { notificationRoutes, eventRoutes } from "./routes/notifications.js";
import { adminRoutes } from "./routes/admin.js";

export interface AppDeps {
  checkDb: () => Promise<boolean>;
  checkOllama: () => Promise<{ up: boolean; missing: string[] }>;
}
export interface AppOptions { token: string; port: number; logLevel?: string; deps: AppDeps }

export async function buildApp(o: AppOptions) {
  const app = Fastify({
    logger: o.logLevel === "silent" ? false : {
      level: o.logLevel ?? "info",
      redact: [
        'req.headers["x-jobpilot-token"]',
        'req.headers.authorization',
        'req.body.content',
        'req.body.resume',
        'req.body.text',
        'req.body.appPassword',
      ],
    },
    bodyLimit: 12 * 1024 * 1024,
  });

  registerErrors(app);
  registerAuth(app, { token: o.token, port: o.port });
  await app.register(sensible);
  await app.register(multipart, { limits: { fileSize: 10 * 1024 * 1024 } });
  await app.register(cors, {
    origin: ["http://localhost:5173", "http://127.0.0.1:5173"],
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["content-type", "x-jobpilot-token"],
  });

  app.get("/api/v1/health", async () => ({
    api: "ok",
    db: (await o.deps.checkDb().catch(() => false)) ? "ok" : "down",
    ollama: await o.deps.checkOllama().catch(() => ({ up: false, missing: ["unknown"] })),
  }));

  await app.register(jobRoutes, { prefix: "/api/v1/jobs" });
  await app.register(resumeRoutes, { prefix: "/api/v1/resumes" });
  await app.register(sourceRoutes, { prefix: "/api/v1/sources" });
  await app.register(searchRunRoutes, { prefix: "/api/v1/search-runs" });
  await app.register(settingRoutes, { prefix: "/api/v1/settings" });
  await app.register(documentRoutes, { prefix: "/api/v1" });
  await app.register(applicationRoutes, { prefix: "/api/v1/applications" });
  await app.register(notificationRoutes, { prefix: "/api/v1/notifications" });
  await app.register(eventRoutes, { prefix: "/api/v1" });
  await app.register(eventRoutes, { prefix: "" });
  await app.register(adminRoutes, { prefix: "/api/v1/admin" });
  await app.register(adminRoutes, { prefix: "/admin" });
  return app;
}
