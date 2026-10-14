// tests/resume.test.ts - Phase 2 acceptance tests for resume upload, parsing, deduplication and edit persistence
import { describe, expect, it, vi, beforeEach } from "vitest";
import { buildApp } from "../apps/api/src/app.js";
import { prisma } from "../packages/db/src/client.js";
import { processResumeParse, detectFileFormat } from "../apps/api/src/services/resumeService.js";
import type { ParsedResume } from "@jobpilot/shared";

const TOKEN = "t".repeat(40);
const PORT = 4000;
const headers = { host: `127.0.0.1:${PORT}`, "x-jobpilot-token": TOKEN };

describe("file format detection and magic-byte checks", () => {
  it("detects valid PDF magic bytes", () => {
    const pdfBuf = Buffer.from("%PDF-1.4 sample content");
    const res = detectFileFormat(pdfBuf, "my_resume.pdf");
    expect(res.valid).toBe(true);
    expect(res.format).toBe("pdf");
  });

  it("detects valid DOCX ZIP magic bytes", () => {
    const docxBuf = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]);
    const res = detectFileFormat(docxBuf, "resume.docx");
    expect(res.valid).toBe(true);
    expect(res.format).toBe("docx");
  });

  it("detects plain text format", () => {
    const txtBuf = Buffer.from("John Doe\nDeveloper Resume");
    const res = detectFileFormat(txtBuf, "resume.txt");
    expect(res.valid).toBe(true);
    expect(res.format).toBe("txt");
  });

  it("rejects unknown binary formats", () => {
    const badBuf = Buffer.from([0x00, 0xff, 0xfe, 0x00, 0x12]);
    const res = detectFileFormat(badBuf, "unknown.exe");
    expect(res.valid).toBe(false);
  });
});

describe("resume upload and de-duplication", () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeEach(async () => {
    vi.restoreAllMocks();
    app = await buildApp({
      token: TOKEN,
      port: PORT,
      logLevel: "silent",
      deps: {
        checkDb: async () => true,
        checkOllama: async () => ({ up: true, missing: [] }),
      },
    });
  });

  it("Duplicate upload creates no new row", async () => {
    const sampleText = "Jane Doe\nFull Stack Developer\njane@example.com";
    const sampleBuf = Buffer.from(sampleText);
    const mockResume = {
      id: "res_123",
      profileId: "prof_1",
      label: "My Resume",
      originalName: "resume.txt",
      mimeType: "text/plain",
      storagePath: "resumes/res_123.txt",
      sha256: "dummy_sha256",
      rawText: sampleText,
      parsed: null,
      parseStatus: "PENDING",
      parserModel: null,
      isPrimary: true,
      createdAt: new Date(),
    };

    // First upload: resume does not exist yet
    vi.spyOn(prisma.resume, "findFirst").mockResolvedValueOnce(null);
    vi.spyOn(prisma.profile, "findFirst").mockResolvedValueOnce({ id: "prof_1" } as never);
    vi.spyOn(prisma.resume, "count").mockResolvedValueOnce(0);
    vi.spyOn(prisma.resume, "create").mockResolvedValueOnce(mockResume as never);

    const r1 = await app.inject({
      method: "POST",
      url: "/api/v1/resumes",
      headers,
      payload: { content: sampleText, filename: "resume.txt" },
    });
    expect(r1.statusCode).toBe(202);
    expect(r1.json().data.id).toBe("res_123");

    // Second upload with the same content: dedupe detects existing row
    vi.spyOn(prisma.resume, "findFirst").mockResolvedValueOnce(mockResume as never);
    const createSpy = vi.spyOn(prisma.resume, "create");
    createSpy.mockClear();

    const r2 = await app.inject({
      method: "POST",
      url: "/api/v1/resumes",
      headers,
      payload: { content: sampleText, filename: "resume.txt" },
    });
    expect(r2.statusCode).toBe(200);
    expect(r2.json().isDuplicate).toBe(true);
    expect(r2.json().data.id).toBe("res_123");
    // Verify create was NOT called on duplicate
    expect(createSpy).not.toHaveBeenCalled();
  });
});

describe("LLM parser error handling and retry mechanism", () => {
  it("Mocked invalid-JSON response -> one retry -> NEEDS_REVIEW", async () => {
    const resumeId = "res_err_1";
    vi.spyOn(prisma.resume, "findUniqueOrThrow").mockResolvedValueOnce({
      id: resumeId,
      profileId: "prof_1",
      rawText: "Sample text with unparseable structure",
    } as never);

    // Mock ollama.chat to fail both attempts with malformed JSON
    const updateSpy = vi.spyOn(prisma.resume, "update").mockResolvedValue({} as never);
    const { ollama } = await import("../packages/core/src/llm/ollama.js");
    let attempts = 0;
    vi.spyOn(ollama, "chat").mockImplementation(async () => {
      attempts++;
      return {
        message: { content: "INVALID_NOT_JSON", role: "assistant" },
      } as never;
    });

    const parsed = await processResumeParse(resumeId);
    expect(parsed).toBeNull();
    // Verify exactly 2 attempts (initial attempt + 1 repair retry)
    expect(attempts).toBe(2);
    // Verify status was updated to NEEDS_REVIEW
    expect(updateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: resumeId },
        data: { parseStatus: "NEEDS_REVIEW" },
      })
    );
  });
});

describe("manual edit persistence", () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeEach(async () => {
    vi.restoreAllMocks();
    app = await buildApp({
      token: TOKEN,
      port: PORT,
      logLevel: "silent",
      deps: {
        checkDb: async () => true,
        checkOllama: async () => ({ up: true, missing: [] }),
      },
    });
  });

  it("Editing a skill in the UI persists", async () => {
    const ollamaModule = await import("../packages/core/src/llm/ollama.js");
    vi.spyOn(ollamaModule, "embed").mockResolvedValue([[0.1, 0.2]]);

    const existingResume = {
      id: "res_edit_1",
      profileId: "prof_1",
      parsed: {
        fullName: "Aarav Sharma",
        email: "aarav@example.com",
        phone: null,
        location: null,
        headline: null,
        summary: null,
        links: { github: null, linkedin: null, portfolio: null },
        skills: [{ name: "React", category: "framework" }],
        experiences: [],
        projects: [],
        education: [],
        certifications: [],
        totalExperienceMonths: 0,
      },
    };

    const updatedParsed: ParsedResume = {
      fullName: "Aarav Sharma",
      email: "aarav@example.com",
      phone: null,
      location: null,
      headline: null,
      summary: null,
      links: { github: null, linkedin: null, portfolio: null },
      skills: [
        { name: "React", category: "framework" },
        { name: "TypeScript", category: "language" },
      ],
      experiences: [],
      projects: [],
      education: [],
      certifications: [],
      totalExperienceMonths: 0,
    };

    vi.spyOn(prisma.resume, "findUnique").mockResolvedValueOnce(existingResume as never);
    vi.spyOn(prisma.resume, "update").mockResolvedValueOnce({
      ...existingResume,
      parsed: updatedParsed,
      parseStatus: "PARSED",
    } as never);
    vi.spyOn(prisma.profile, "update").mockResolvedValueOnce({} as never);
    vi.spyOn(prisma.skill, "findMany").mockResolvedValueOnce([]);
    vi.spyOn(prisma.skill, "upsert").mockResolvedValue({ id: "sk_ts", name: "typescript" } as never);
    vi.spyOn(prisma.profileSkill, "upsert").mockResolvedValue({} as never);

    const res = await app.inject({
      method: "PATCH",
      url: "/api/v1/resumes/res_edit_1",
      headers,
      payload: updatedParsed,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.parseStatus).toBe("PARSED");
    expect(body.data.parsed.skills).toHaveLength(2);
    expect(body.data.parsed.skills[1].name).toBe("TypeScript");
    expect(prisma.profileSkill.upsert).toHaveBeenCalled();
  });
});
