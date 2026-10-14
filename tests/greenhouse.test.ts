// tests/greenhouse.test.ts - adapter test with a recorded fixture, no network
import { afterEach, describe, expect, it, vi } from "vitest";
import { greenhouse } from "../packages/core/src/sources/greenhouse.js";

afterEach(() => vi.restoreAllMocks());

describe("greenhouse adapter", () => {
  it("unescapes content and maps fields", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ jobs: [{
      id: 42, title: "Graduate Engineer", updated_at: "2026-10-01T10:00:00Z",
      absolute_url: "https://boards.greenhouse.io/acme/jobs/42", location: { name: "Pune" },
      content: "&lt;p&gt;Build things with &lt;b&gt;React&lt;/b&gt;&lt;/p&gt;",
    }] }), { status: 200 }));
    const [job] = await greenhouse.fetchJobs({ boardToken: "acme", company: "Acme" });
    expect(job!.descriptionText).toContain("React");
    expect(job!.descriptionText).not.toContain("<");
    expect(job!.company).toBe("Acme");
  });
});
