// tests/discovery.test.ts - Tests for discovery pipeline: min interval, seniority filter, cross-source dedupe, error resilience
import { beforeEach, describe, expect, it, vi } from "vitest";
import { runDiscovery, ADAPTERS } from "../packages/core/src/sources/discovery.js";
import { prisma } from "../packages/db/src/client.js";

describe("runDiscovery pipeline guarantees", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(prisma.appSetting, "findUnique").mockResolvedValue(null as never);
    vi.spyOn(prisma.notification, "create").mockResolvedValue({} as never);
  });

  it("Senior titles never reach the database", async () => {
    vi.spyOn(prisma.searchRun, "create").mockResolvedValue({ id: "run_senior" } as never);
    vi.spyOn(prisma.searchPreference, "findMany").mockResolvedValue([]);
    vi.spyOn(prisma.jobSource, "findMany").mockResolvedValue([
      { id: "src_1", kind: "ATS_GREENHOUSE", config: {}, minIntervalMin: 360, lastRunAt: null, name: "Src1" } as never,
    ]);

    // Adapter returns senior jobs + fresher job
    vi.spyOn(ADAPTERS.ATS_GREENHOUSE!, "fetchJobs").mockResolvedValue([
      {
        externalId: "job-1",
        title: "Senior Lead Architect (10+ years)",
        company: "BigCorp",
        location: "Pune",
        descriptionText: "Looking for 10+ years of experience in distributed systems.",
        applyUrl: "https://example.com/apply/1",
        postedAt: new Date(),
      },
      {
        externalId: "job-2",
        title: "Junior Full Stack Developer",
        company: "BigCorp",
        location: "Pune",
        descriptionText: "Entry level role, 0-1 years of experience in React and Node.",
        applyUrl: "https://example.com/apply/2",
        postedAt: new Date(),
      },
    ]);

    vi.spyOn(prisma.job, "findUnique").mockResolvedValue(null);
    vi.spyOn(prisma.company, "upsert").mockResolvedValue({ id: "comp_1" } as never);
    const jobCreateSpy = vi.spyOn(prisma.job, "create").mockResolvedValue({ id: "job_created_1" } as never);
    vi.spyOn(prisma.jobSource, "update").mockResolvedValue({} as never);
    const runUpdateSpy = vi.spyOn(prisma.searchRun, "update").mockResolvedValue({} as never);

    const result = await runDiscovery("MANUAL");

    // Only junior job should be created
    expect(jobCreateSpy).toHaveBeenCalledTimes(1);
    expect(jobCreateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          title: "Junior Full Stack Developer",
        }),
      })
    );
    // Verified 1 filtered out
    expect(runUpdateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          stats: expect.objectContaining({ filtered: 1, new: 1 }),
        }),
      })
    );
  });

  it("Second run immediately after the first adds 0 jobs (min interval check)", async () => {
    vi.spyOn(prisma.searchRun, "create").mockResolvedValue({ id: "run_skip" } as never);
    vi.spyOn(prisma.searchPreference, "findMany").mockResolvedValue([]);

    // Source was run 2 minutes ago with minInterval of 360 min (6 hours)
    const recentlyRunDate = new Date(Date.now() - 2 * 60_000);
    vi.spyOn(prisma.jobSource, "findMany").mockResolvedValue([
      { id: "src_recent", kind: "ATS_GREENHOUSE", config: {}, minIntervalMin: 360, lastRunAt: recentlyRunDate, name: "Recent" } as never,
    ]);

    const fetchSpy = vi.spyOn(ADAPTERS.ATS_GREENHOUSE!, "fetchJobs");
    const jobCreateSpy = vi.spyOn(prisma.job, "create");
    const runUpdateSpy = vi.spyOn(prisma.searchRun, "update").mockResolvedValue({} as never);

    const result = await runDiscovery("MANUAL");

    // Adapter should not be called due to minInterval check
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(jobCreateSpy).not.toHaveBeenCalled();
    expect(runUpdateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          stats: expect.objectContaining({ fetched: 0, new: 0 }),
        }),
      })
    );
  });

  it("Same job from two sources yields one row via dedupeHash", async () => {
    vi.spyOn(prisma.searchRun, "create").mockResolvedValue({ id: "run_dedupe" } as never);
    vi.spyOn(prisma.searchPreference, "findMany").mockResolvedValue([]);

    vi.spyOn(prisma.jobSource, "findMany").mockResolvedValue([
      { id: "src_gh", kind: "ATS_GREENHOUSE", config: {}, minIntervalMin: 360, lastRunAt: null, name: "Greenhouse" } as never,
      { id: "src_lv", kind: "ATS_LEVER", config: {}, minIntervalMin: 360, lastRunAt: null, name: "Lever" } as never,
    ]);

    const sameRole = {
      externalId: "101",
      title: "Junior Web Developer",
      company: "Acme Software Private Limited",
      location: "Bengaluru",
      descriptionText: "Looking for an entry level frontend developer.",
      applyUrl: "https://example.com/apply/web",
      postedAt: new Date(),
    };

    vi.spyOn(ADAPTERS.ATS_GREENHOUSE!, "fetchJobs").mockResolvedValue([sameRole]);
    vi.spyOn(ADAPTERS.ATS_LEVER!, "fetchJobs").mockResolvedValue([
      {
        ...sameRole,
        externalId: "202",
        company: "ACME SOFTWARE", // slight name variation
      },
    ]);

    // First time job doesn't exist, second time it does
    vi.spyOn(prisma.job, "findUnique")
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "existing_job_1" } as never);

    vi.spyOn(prisma.company, "upsert").mockResolvedValue({ id: "comp_1" } as never);
    const jobCreateSpy = vi.spyOn(prisma.job, "create").mockResolvedValue({ id: "job_created_1" } as never);
    const jobUpdateSpy = vi.spyOn(prisma.job, "update").mockResolvedValue({} as never);
    vi.spyOn(prisma.jobSource, "update").mockResolvedValue({} as never);
    const runUpdateSpy = vi.spyOn(prisma.searchRun, "update").mockResolvedValue({} as never);

    await runDiscovery("MANUAL");

    // Only created once
    expect(jobCreateSpy).toHaveBeenCalledTimes(1);
    // Updated on duplicate
    expect(jobUpdateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "ACTIVE" }),
      })
    );
    // Verified 1 dupe in stats
    expect(runUpdateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          stats: expect.objectContaining({ new: 1, dupes: 1 }),
        }),
      })
    );
  });

  it("A source returning HTTP 500 sets status PARTIAL, other sources continue processing", async () => {
    vi.spyOn(prisma.searchRun, "create").mockResolvedValue({ id: "run_partial" } as never);
    vi.spyOn(prisma.searchPreference, "findMany").mockResolvedValue([]);

    vi.spyOn(prisma.jobSource, "findMany").mockResolvedValue([
      { id: "src_failing", kind: "ATS_GREENHOUSE", config: {}, minIntervalMin: 360, lastRunAt: null, name: "Failing Greenhouse" } as never,
      { id: "src_working", kind: "ATS_LEVER", config: {}, minIntervalMin: 360, lastRunAt: null, name: "Working Lever" } as never,
    ]);

    // Greenhouse fails with 500
    vi.spyOn(ADAPTERS.ATS_GREENHOUSE!, "fetchJobs").mockRejectedValue(new Error("HTTP 500 Internal Server Error"));
    // Lever succeeds with a junior job
    vi.spyOn(ADAPTERS.ATS_LEVER!, "fetchJobs").mockResolvedValue([
      {
        externalId: "lev-1",
        title: "Graduate Software Trainee",
        company: "Nimbus",
        location: "Remote",
        descriptionText: "Graduate program for new engineers.",
        applyUrl: "https://example.com/apply/lev",
        postedAt: new Date(),
      },
    ]);

    vi.spyOn(prisma.job, "findUnique").mockResolvedValue(null);
    vi.spyOn(prisma.company, "upsert").mockResolvedValue({ id: "comp_2" } as never);
    vi.spyOn(prisma.job, "create").mockResolvedValue({ id: "job_lev_1" } as never);
    vi.spyOn(prisma.jobSource, "update").mockResolvedValue({} as never);
    const runUpdateSpy = vi.spyOn(prisma.searchRun, "update").mockResolvedValue({} as never);

    const result = await runDiscovery("MANUAL");

    // The whole run does NOT throw, it finishes with PARTIAL
    expect(runUpdateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "PARTIAL",
          stats: expect.objectContaining({
            new: 1,
            errors: [expect.stringContaining("Failing Greenhouse: HTTP 500")],
          }),
        }),
      })
    );
  });
});
