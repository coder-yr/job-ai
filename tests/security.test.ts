// tests/security.test.ts - Phase 8 Acceptance & Security Controls (Blueprint ch.12, ch.13)
// 1. Host-header check and auth rejection (fail-closed)
// 2. Upload hardening (file size limit, magic bytes check, empty file rejection)
// 3. Admin routes: POST /admin/backup, POST /admin/export, DELETE /admin/data (typed confirmation)
// 4. Delete-everything leaves no personal rows or files
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdir, writeFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { buildApp, type AppDeps } from "../apps/api/src/app.js";
import { prisma } from "../packages/db/src/client.js";
import { detectFileFormat } from "../apps/api/src/services/resumeService.js";

const TOKEN = "t".repeat(40);
const PORT = 4004;
const authed = { host: `127.0.0.1:${PORT}`, "x-jobpilot-token": TOKEN };
const badHost = { host: "evil.example", "x-jobpilot-token": TOKEN };

const deps = (): AppDeps => ({
  checkDb: async () => true,
  checkOllama: async () => ({ up: true, missing: [] }),
});

describe("Phase 8: Host-header check and Auth (fail closed)", () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeAll(async () => {
    app = await buildApp({ token: TOKEN, port: PORT, logLevel: "silent", deps: deps() });
  });
  afterAll(() => app.close());

  it("rejects request with a foreign Host header (403 FORBIDDEN_HOST)", async () => {
    const r = await app.inject({
      method: "GET",
      url: "/api/v1/jobs",
      headers: badHost,
    });
    expect(r.statusCode).toBe(403);
    expect(r.json().error.code).toBe("FORBIDDEN_HOST");
  });

  it("rejects request with missing token (401 UNAUTHORIZED)", async () => {
    const r = await app.inject({
      method: "GET",
      url: "/api/v1/jobs",
      headers: { host: `127.0.0.1:${PORT}` },
    });
    expect(r.statusCode).toBe(401);
    expect(r.json().error.code).toBe("UNAUTHORIZED");
  });

  it("rejects request with incorrect token (401 UNAUTHORIZED)", async () => {
    const r = await app.inject({
      method: "GET",
      url: "/api/v1/jobs",
      headers: { host: `127.0.0.1:${PORT}`, "x-jobpilot-token": "wrong".repeat(8) },
    });
    expect(r.statusCode).toBe(401);
    expect(r.json().error.code).toBe("UNAUTHORIZED");
  });

  it("rejects health route with foreign Host header (403 FORBIDDEN_HOST)", async () => {
    const r = await app.inject({
      method: "GET",
      url: "/api/v1/health",
      headers: { host: "attacker.com" },
    });
    expect(r.statusCode).toBe(403);
    expect(r.json().error.code).toBe("FORBIDDEN_HOST");
  });
});

describe("Phase 8: Upload hardening (Section 12.2)", () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeAll(async () => {
    app = await buildApp({ token: TOKEN, port: PORT, logLevel: "silent", deps: deps() });
  });
  afterAll(() => app.close());

  it("detects valid PDF by magic bytes %PDF-", () => {
    const pdfBuf = Buffer.from("%PDF-1.4 sample content");
    const res = detectFileFormat(pdfBuf, "resume.pdf");
    expect(res.valid).toBe(true);
    expect(res.format).toBe("pdf");
    expect(res.mimeType).toBe("application/pdf");
  });

  it("detects valid DOCX by magic bytes PK\x03\x04", () => {
    const docxBuf = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00]);
    const res = detectFileFormat(docxBuf, "resume.docx");
    expect(res.valid).toBe(true);
    expect(res.format).toBe("docx");
  });

  it("rejects executable or binary file pretending to be PDF", () => {
    // Windows PE executable starts with MZ (0x4d 0x5a)
    const exeBuf = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00]);
    const res = detectFileFormat(exeBuf, "resume.pdf");
    expect(res.valid).toBe(false);
  });

  it("POST /api/v1/resumes rejects empty file", async () => {
    const r = await app.inject({
      method: "POST",
      url: "/api/v1/resumes",
      headers: authed,
      payload: { content: "" },
    });
    expect(r.statusCode).toBe(400);
    expect(r.json().error.code).toBe("EMPTY_FILE");
  });
});

describe("Phase 8: Admin Backup, Export, and Delete-Everything", () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  const testDataDir = join(process.cwd(), "data", "test_admin");

  beforeAll(async () => {
    process.env.DATA_DIR = testDataDir;
    await mkdir(join(testDataDir, "resumes"), { recursive: true });
    await mkdir(join(testDataDir, "documents"), { recursive: true });
    await mkdir(join(testDataDir, "backups"), { recursive: true });

    app = await buildApp({ token: TOKEN, port: PORT, logLevel: "silent", deps: deps() });
  });

  afterAll(async () => {
    delete process.env.DATA_DIR;
    await app.close();
  });

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("POST /admin/backup creates a backup file in DATA_DIR/backups", async () => {
    vi.spyOn(prisma.auditLog, "create").mockResolvedValueOnce({} as never);
    vi.spyOn(prisma.profile, "findMany").mockResolvedValueOnce([] as never);
    vi.spyOn(prisma.resume, "findMany").mockResolvedValueOnce([] as never);
    vi.spyOn(prisma.job, "findMany").mockResolvedValueOnce([] as never);
    vi.spyOn(prisma.application, "findMany").mockResolvedValueOnce([] as never);
    vi.spyOn(prisma.generatedDocument, "findMany").mockResolvedValueOnce([] as never);
    vi.spyOn(prisma.appSetting, "findMany").mockResolvedValueOnce([] as never);
    vi.spyOn(prisma.jobSource, "findMany").mockResolvedValueOnce([] as never);

    const r = await app.inject({
      method: "POST",
      url: "/api/v1/admin/backup",
      headers: authed,
    });

    expect(r.statusCode).toBe(200);
    expect(r.json().ok).toBe(true);
    expect(r.json().data.filename).toMatch(/^backup-.*\.sql$/);
  });

  it("POST /admin/export exports all candidate data in JSON format", async () => {
    vi.spyOn(prisma.auditLog, "create").mockResolvedValueOnce({} as never);
    vi.spyOn(prisma.profile, "findMany").mockResolvedValueOnce([{ id: "prof-1", fullName: "Test User" }] as never);
    vi.spyOn(prisma.resume, "findMany").mockResolvedValueOnce([{ id: "res-1", label: "My Resume" }] as never);
    vi.spyOn(prisma.experience, "findMany").mockResolvedValueOnce([] as never);
    vi.spyOn(prisma.project, "findMany").mockResolvedValueOnce([] as never);
    vi.spyOn(prisma.achievement, "findMany").mockResolvedValueOnce([] as never);
    vi.spyOn(prisma.education, "findMany").mockResolvedValueOnce([] as never);
    vi.spyOn(prisma.certification, "findMany").mockResolvedValueOnce([] as never);
    vi.spyOn(prisma.profileSkill, "findMany").mockResolvedValueOnce([] as never);
    vi.spyOn(prisma.searchPreference, "findMany").mockResolvedValueOnce([] as never);
    vi.spyOn(prisma.application, "findMany").mockResolvedValueOnce([] as never);
    vi.spyOn(prisma.generatedDocument, "findMany").mockResolvedValueOnce([] as never);
    vi.spyOn(prisma.appSetting, "findMany").mockResolvedValueOnce([] as never);

    const r = await app.inject({
      method: "POST",
      url: "/api/v1/admin/export",
      headers: authed,
    });

    expect(r.statusCode).toBe(200);
    expect(r.json().ok).toBe(true);
    expect(r.json().data.profiles).toHaveLength(1);
    expect(r.json().data.resumes).toHaveLength(1);
    expect(r.json().data.exportedAt).toBeDefined();
  });

  it("DELETE /admin/data rejects without exact typed confirmation", async () => {
    const r = await app.inject({
      method: "DELETE",
      url: "/api/v1/admin/data",
      headers: authed,
      payload: { confirmation: "delete please" },
    });

    expect(r.statusCode).toBe(400);
    expect(r.json().error.code).toBe("VALIDATION_ERROR");
  });

  it("DELETE /admin/data deletes all personal rows and unlinks personal files", async () => {
    // Create dummy personal files on disk to verify deletion
    const resumeFile = join(testDataDir, "resumes", "test_resume.pdf");
    const docFile = join(testDataDir, "documents", "test_tailored.pdf");
    await writeFile(resumeFile, "dummy resume content");
    await writeFile(docFile, "dummy tailored document content");

    vi.spyOn(prisma, "$transaction").mockResolvedValueOnce([
      { count: 10 }, // achievements
      { count: 2 },  // experiences
      { count: 2 },  // projects
      { count: 1 },  // educations
      { count: 1 },  // certifications
      { count: 5 },  // profileSkills
      { count: 1 },  // searchPrefs
      { count: 15 }, // jobMatches
      { count: 4 },  // appEvents
      { count: 2 },  // genDocs
      { count: 2 },  // apps
      { count: 3 },  // emails
      { count: 1 },  // resumeAnalyses
      { count: 1 },  // resumes
      { count: 1 },  // profiles
      { count: 5 },  // notifications
    ] as never);

    vi.spyOn(prisma.auditLog, "deleteMany").mockResolvedValueOnce({ count: 10 } as never);
    vi.spyOn(prisma.auditLog, "create").mockResolvedValueOnce({} as never);

    const r = await app.inject({
      method: "DELETE",
      url: "/api/v1/admin/data",
      headers: authed,
      payload: { confirmation: "DELETE ALL PERSONAL DATA" },
    });

    expect(r.statusCode).toBe(200);
    expect(r.json().ok).toBe(true);
    expect(r.json().deleted.profiles).toBe(1);
    expect(r.json().deleted.resumes).toBe(1);
    expect(r.json().deleted.applications).toBe(2);
    expect(r.json().deleted.files).toBeGreaterThanOrEqual(2);

    // Verify files on disk were unlinked
    const remainingResumes = await readdir(join(testDataDir, "resumes"));
    const remainingDocs = await readdir(join(testDataDir, "documents"));
    expect(remainingResumes).not.toContain("test_resume.pdf");
    expect(remainingDocs).not.toContain("test_tailored.pdf");
  });
});
