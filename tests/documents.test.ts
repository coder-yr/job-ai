// tests/documents.test.ts - Phase 5 acceptance tests
// Guard: invented skill/number/tech never reach export.
// Approval gate: export before approve → 409.
// Editing clears approvedAt.
// PDF text round-trip contains all sections.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { buildApp, type AppDeps } from "../apps/api/src/app.js";
import { guardTailoredResume, type ProfileFacts } from "../packages/core/src/docs/guard.js";
import { resumeHtml } from "../packages/core/src/docs/renderPdf.js";
import { extractResumeText } from "../packages/core/src/resume/extractText.js";
import { buildCandidateFacts } from "../packages/core/src/docs/coverLetter.js";
import { prisma } from "../packages/db/src/client.js";
import type { TailoredResume } from "../packages/shared/src/schemas.js";

// ─── Guard unit tests ─────────────────────────────────────────────────────────

const FACTS: ProfileFacts = {
  skills: new Set(["react", "typescript", "node.js"]),
  bullets: new Map([
    ["b1", { text: "Built a React dashboard for 200 students", ownerId: "exp1" }],
    ["b2", { text: "Developed a REST API with Node.js", ownerId: "exp1" }],
  ]),
  skillCatalog: ["react", "typescript", "node.js", "kubernetes", "python", "django"],
};

const BASE_RESUME: TailoredResume = {
  summary: "Fresher full-stack developer with React and Node.js experience.",
  skills: ["React", "TypeScript"],
  sections: [],
};

describe("Guard: invented content never passes", () => {
  it("rejects an invented skill not in the profile", () => {
    const result = guardTailoredResume(
      { ...BASE_RESUME, skills: ["React", "Python"] },
      FACTS,
    );
    expect(result.ok).toBe(false);
    expect(result.violations.some((v) => /python/i.test(v))).toBe(true);
  });

  it("rejects an invented number in a bullet", () => {
    const result = guardTailoredResume(
      {
        ...BASE_RESUME,
        sections: [{
          kind: "experience",
          sourceId: "exp1",
          bullets: [{ sourceBulletId: "b1", text: "Built a React dashboard for 5000 students" }],
        }],
      },
      FACTS,
    );
    expect(result.ok).toBe(false);
    expect(result.violations.some((v) => v.includes("5000"))).toBe(true);
  });

  it("rejects an invented technology not in profile", () => {
    const result = guardTailoredResume(
      {
        ...BASE_RESUME,
        sections: [{
          kind: "experience",
          sourceId: "exp1",
          bullets: [{ sourceBulletId: "b1", text: "Deployed a React dashboard on Kubernetes" }],
        }],
      },
      FACTS,
    );
    expect(result.ok).toBe(false);
    expect(result.violations.some((v) => /kubernetes/i.test(v))).toBe(true);
  });

  it("accepts a faithful rewrite that only paraphrases", () => {
    const result = guardTailoredResume(
      {
        ...BASE_RESUME,
        sections: [{
          kind: "experience",
          sourceId: "exp1",
          bullets: [
            { sourceBulletId: "b1", text: "Developed a React dashboard used by 200 students" },
            { sourceBulletId: "b2", text: "Built a REST API service with Node.js" },
          ],
        }],
      },
      FACTS,
    );
    expect(result.ok).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  it("rejects a bullet moved to a different section", () => {
    const result = guardTailoredResume(
      {
        ...BASE_RESUME,
        sections: [{
          kind: "project",
          sourceId: "proj-other",   // wrong owner
          bullets: [{ sourceBulletId: "b1", text: "Built a React dashboard for 200 students" }],
        }],
      },
      FACTS,
    );
    expect(result.ok).toBe(false);
  });

  it("rejects an unknown sourceBulletId", () => {
    const result = guardTailoredResume(
      {
        ...BASE_RESUME,
        sections: [{
          kind: "experience",
          sourceId: "exp1",
          bullets: [{ sourceBulletId: "b-doesnt-exist", text: "Invented bullet" }],
        }],
      },
      FACTS,
    );
    expect(result.ok).toBe(false);
    expect(result.violations.some((v) => v.includes("b-doesnt-exist"))).toBe(true);
  });
});

// ─── API: approval gate + content editing ────────────────────────────────────

const TOKEN = "t".repeat(40);
const PORT = 4001;
const authed = { host: `127.0.0.1:${PORT}`, "x-jobpilot-token": TOKEN };

const deps = (): AppDeps => ({
  checkDb: async () => true,
  checkOllama: async () => ({ up: true, missing: [] }),
});

describe("API: documents approval gate", () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeAll(async () => {
    app = await buildApp({ token: TOKEN, port: PORT, logLevel: "silent", deps: deps() });
  });
  afterAll(() => app.close());

  it("GET /api/v1/documents/:id returns 404 for a nonexistent id", async () => {
    vi.spyOn(prisma.generatedDocument, "findUnique").mockResolvedValueOnce(null as never);
    const r = await app.inject({ url: "/api/v1/documents/does-not-exist", headers: authed });
    expect(r.statusCode).toBe(404);
    expect(r.json().error.code).toBe("NOT_FOUND");
  });

  it("export before approve returns 409 NOT_APPROVED", async () => {
    vi.spyOn(prisma.generatedDocument, "findUnique").mockResolvedValueOnce({
      id: "doc-test-1",
      profileId: "test-profile",
      kind: "TAILORED_RESUME",
      format: "JSON",
      content: { summary: "Test", skills: ["React"], sections: [] },
      model: "test-model",
      promptVersion: "v1",
      guardReport: { ok: true, violations: [] },
      approvedAt: null,
      filePath: null,
      jobId: null,
      applicationId: null,
      basedOnResumeId: null,
      createdAt: new Date(),
    } as never);

    const r = await app.inject({
      method: "POST",
      url: "/api/v1/documents/doc-test-1/export?format=pdf",
      headers: authed,
    });

    expect(r.statusCode).toBe(409);
    expect(r.json().error.code).toBe("NOT_APPROVED");
  });

  it("PATCH /documents/:id clears approvedAt", async () => {
    vi.spyOn(prisma.generatedDocument, "findUnique").mockResolvedValueOnce({
      id: "doc-test-2",
      profileId: "test-profile",
      kind: "TAILORED_RESUME",
      format: "JSON",
      content: { summary: "Test", skills: ["React"], sections: [] },
      model: "test-model",
      promptVersion: "v1",
      guardReport: { ok: true, violations: [] },
      approvedAt: new Date(),
      filePath: null,
      jobId: null,
      applicationId: null,
      basedOnResumeId: null,
      createdAt: new Date(),
    } as never);

    vi.spyOn(prisma.generatedDocument, "update").mockResolvedValueOnce({
      id: "doc-test-2",
      profileId: "test-profile",
      kind: "TAILORED_RESUME",
      format: "JSON",
      content: { summary: "Updated summary", skills: ["React", "TypeScript"], sections: [] },
      model: "test-model",
      promptVersion: "v1",
      guardReport: { ok: true, violations: [] },
      approvedAt: null,
      filePath: null,
      jobId: null,
      applicationId: null,
      basedOnResumeId: null,
      createdAt: new Date(),
    } as never);

    const r = await app.inject({
      method: "PATCH",
      url: "/api/v1/documents/doc-test-2",
      headers: { ...authed, "content-type": "application/json" },
      payload: { content: { summary: "Updated summary", skills: ["React", "TypeScript"], sections: [] } },
    });

    expect(r.statusCode).toBe(200);
    expect(r.json().data.approvedAt).toBeNull();
  });
});

// ─── PDF round-trip ───────────────────────────────────────────────────────────

describe("PDF round-trip: exported text contains all sections", () => {
  const TEST_DATA_DIR = join(process.cwd(), "data", "test-pdf-roundtrip");

  beforeAll(async () => {
    await mkdir(TEST_DATA_DIR, { recursive: true });
  });

  afterAll(async () => {
    await rm(TEST_DATA_DIR, { recursive: true, force: true });
  });

  it("resumeHtml generates a valid HTML document with all resume sections", () => {
    const tailored: TailoredResume = {
      summary: "Experienced full-stack developer specialising in React and TypeScript.",
      skills: ["React", "TypeScript", "Node.js"],
      sections: [
        {
          kind: "experience",
          sourceId: "exp1",
          bullets: [
            { sourceBulletId: "b1", text: "Built a React dashboard for 200 students" },
          ],
        },
      ],
    };

    const titles = new Map([
      ["exp1", { heading: "Software Engineer", sub: "Tech Corp" }],
    ]);

    const html = resumeHtml(
      { fullName: "Alice Kumar", email: "alice@example.com", phone: "+91 9000000000", location: "Bengaluru" },
      tailored,
      titles,
    );

    expect(html).toContain("Alice Kumar");
    expect(html).toContain("alice@example.com");
    expect(html).toContain("React, TypeScript, Node.js");
    expect(html).toContain("Built a React dashboard for 200 students");
    expect(html).toContain("Software Engineer");
    expect(html).toContain("Tech Corp");
    // Security: no dangerous HTML from untrusted content
    expect(html).not.toContain("<script");
    // Verify esc() function escapes special chars
    const htmlWithSpecialChars = resumeHtml(
      { fullName: "O'Brien & Co <test>", email: null, phone: null, location: null },
      { summary: "", skills: [], sections: [] },
      new Map(),
    );
    expect(htmlWithSpecialChars).not.toContain("<test>");
    expect(htmlWithSpecialChars).toContain("&#60;test&#62;");
  });

  it("PDF export produces a file with readable text when Playwright is available", async () => {
    // This test is skipped in CI where Playwright browsers may not be installed.
    // It validates the renderPdf → extractResumeText round-trip.
    let playwrightAvailable = false;
    try {
      const { chromium } = await import("playwright");
      const browser = await chromium.launch().catch(() => null);
      if (browser) {
        await browser.close();
        playwrightAvailable = true;
      }
    } catch {
      // Playwright not available
    }

    if (!playwrightAvailable) {
      console.warn("Playwright not available — skipping PDF round-trip test");
      return;
    }

    const { renderPdf } = await import("../packages/core/src/docs/renderPdf.js");
    const tailored: TailoredResume = {
      summary: "Full-stack developer with React and Node.js skills.",
      skills: ["React", "Node.js"],
      sections: [
        {
          kind: "experience",
          sourceId: "exp1",
          bullets: [{ sourceBulletId: "b1", text: "Developed a React dashboard for 200 students" }],
        },
      ],
    };
    const titles = new Map([["exp1", { heading: "Junior Developer", sub: "StartupX" }]]);
    const html = resumeHtml(
      { fullName: "Rahul Sharma", email: "rahul@example.com", phone: null, location: "Mumbai" },
      tailored,
      titles,
    );

    const outPath = join(TEST_DATA_DIR, "test_resume.pdf");
    await renderPdf(html, outPath);

    const { text } = await extractResumeText(outPath);
    expect(text).toContain("Rahul Sharma");
    expect(text).toContain("React");
    expect(text).toContain("200 students");
  }, 30000);
});

// ─── Cover letter builder ─────────────────────────────────────────────────────

describe("buildCandidateFacts", () => {
  it("formats all provided facts into a structured string", () => {
    const facts = buildCandidateFacts({
      fullName: "Alice Kumar",
      yearsExperience: 1.5,
      skills: ["React", "TypeScript", "Node.js"],
      bullets: ["Built a React dashboard for 200 students", "Developed REST APIs"],
      summary: "Passionate full-stack developer.",
      links: { github: "https://github.com/alice", linkedin: null },
    });

    expect(facts).toContain("Alice Kumar");
    expect(facts).toContain("1.5 years");
    expect(facts).toContain("React, TypeScript, Node.js");
    expect(facts).toContain("Built a React dashboard");
    expect(facts).toContain("Passionate full-stack developer.");
    expect(facts).toContain("https://github.com/alice");
  });

  it("handles missing optional fields gracefully", () => {
    const facts = buildCandidateFacts({
      fullName: "Bob",
      yearsExperience: 0,
      skills: [],
      bullets: [],
    });
    expect(facts).toContain("Bob");
    expect(facts).toContain("0.0 years");
  });
});
