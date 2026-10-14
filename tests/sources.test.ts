// tests/sources.test.ts - Adapter fixture tests and robots.txt fail-closed behavior
import { afterEach, describe, expect, it, vi } from "vitest";
import { ashby } from "../packages/core/src/sources/ashby.js";
import { smartRecruiters } from "../packages/core/src/sources/smartrecruiters.js";
import { jsonLd } from "../packages/core/src/sources/jsonld.js";
import { buildApp } from "../apps/api/src/app.js";

const TOKEN = "t".repeat(40);
const PORT = 4000;
const headers = { host: `127.0.0.1:${PORT}`, "x-jobpilot-token": TOKEN };

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Ashby adapter fixture test", () => {
  it("fetches and maps public Ashby job-board response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          jobs: [
            {
              id: "ashby-job-1",
              title: "Junior Backend Developer",
              location: "Bengaluru",
              isRemote: false,
              jobUrl: "https://jobs.ashbyhq.com/acme/ashby-job-1",
              publishedAt: "2026-10-10T12:00:00Z",
              descriptionPlain: "Build Node.js APIs and services.",
            },
          ],
        }),
        { status: 200 }
      )
    );

    const jobs = await ashby.fetchJobs({ boardName: "acme", company: "Acme" });
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.externalId).toBe("ashby-job-1");
    expect(jobs[0]!.title).toBe("Junior Backend Developer");
    expect(jobs[0]!.company).toBe("Acme");
    expect(jobs[0]!.location).toBe("Bengaluru");
    expect(jobs[0]!.descriptionText).toContain("Build Node.js APIs");
    expect(jobs[0]!.applyUrl).toContain("jobs.ashbyhq.com");
  });
});

describe("SmartRecruiters adapter fixture test", () => {
  it("fetches and maps public SmartRecruiters postings response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          content: [
            {
              id: "sr-12345",
              name: "Graduate Software Engineer",
              releasedDate: "2026-10-11T09:00:00Z",
              location: { city: "Pune", region: "MH", country: "in", remote: true },
              jobAd: {
                sections: {
                  jobDescription: { text: "<p>Work on <b>TypeScript</b> systems.</p>" },
                },
              },
            },
          ],
        }),
        { status: 200 }
      )
    );

    const jobs = await smartRecruiters.fetchJobs({ companyIdentifier: "techcorp", company: "TechCorp" });
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.externalId).toBe("sr-12345");
    expect(jobs[0]!.title).toBe("Graduate Software Engineer");
    expect(jobs[0]!.company).toBe("TechCorp");
    expect(jobs[0]!.location).toBe("Pune, MH, in");
    expect(jobs[0]!.remote).toBe(true);
    expect(jobs[0]!.descriptionText).toContain("Work on TypeScript systems");
    expect(jobs[0]!.applyUrl).toBe("https://jobs.smartrecruiters.com/techcorp/sr-12345");
  });
});

describe("robots.txt fail-closed enforcement on JSON-LD careers page", () => {
  it("refuses fetch when robots.txt disallows path", async () => {
    // Mock robots.txt returning Disallow: /jobs
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      const u = String(url);
      if (u.includes("robots.txt")) {
        return new Response("User-agent: *\nDisallow: /jobs\n", { status: 200 });
      }
      return new Response("<html></html>", { status: 200 });
    });

    await expect(
      jsonLd.fetchJobs({ url: "https://example.com/jobs/openings", company: "Example" })
    ).rejects.toThrow(/robots\.txt disallows/i);
  });

  it("refuses fetch when robots.txt cannot be read (fail-closed)", async () => {
    // Mock robots.txt returning 500 error or network failure
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      const u = String(url);
      if (u.includes("robots.txt")) {
        return new Response("Server error", { status: 500 });
      }
      return new Response("<html></html>", { status: 200 });
    });

    await expect(
      jsonLd.fetchJobs({ url: "https://unreadable-domain.example/careers", company: "Example" })
    ).rejects.toThrow(/robots\.txt disallows/i);
  });
});

describe("POST /api/v1/jobs/import SSRF protection", () => {
  it("Importing http://127.0.0.1 is rejected", async () => {
    const app = await buildApp({
      token: TOKEN,
      port: PORT,
      logLevel: "silent",
      deps: {
        checkDb: async () => true,
        checkOllama: async () => ({ up: true, missing: [] }),
      },
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/jobs/import",
      headers,
      payload: {
        url: "http://127.0.0.1:5432/test",
        company: "Test Co",
        title: "Junior Dev",
        descriptionText: "Looking for an entry level engineer with JavaScript experience.",
      },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("INVALID_URL");
    await app.close();
  });
});
