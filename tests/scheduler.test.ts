// tests/scheduler.test.ts - Phase 7 Acceptance & Unit Tests
// - With the last successful run >20 h old, starting the worker enqueues exactly one CATCHUP run
// - Scheduled run writes SearchRun trigger=SCHEDULED
// - Kill switch stops all outbound fetching
// - Source fails 3 consecutive days raises notification
// - Follow-up checker and retention cleanup
// - Notifications API and SSE events
import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "../packages/db/src/client.js";
import { checkAndEnqueueCatchUp, startQueues, Q } from "../apps/worker/src/boss.js";
import { runDiscovery, ADAPTERS } from "../packages/core/src/sources/discovery.js";
import { checkFollowUps } from "../packages/core/src/followups/checker.js";
import { runRetentionCleanup } from "../packages/core/src/retention/cleanup.js";
import { sseBus } from "../packages/core/src/notifications/events.js";
import { buildApp, type AppDeps } from "../apps/api/src/app.js";

const TOKEN = "t".repeat(40);
const PORT = 4003;
const authed = { host: `127.0.0.1:${PORT}`, "x-jobpilot-token": TOKEN };

const deps = (): AppDeps => ({
  checkDb: async () => true,
  checkOllama: async () => ({ up: true, missing: [] }),
});

describe("Phase 7: Catch-up logic (>20h old run)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("enqueues exactly one CATCHUP run when last successful run is >20h old", async () => {
    const now = new Date("2026-10-14T12:00:00Z");
    const twentyOneHoursAgo = new Date(now.getTime() - 21 * 3600_000);

    vi.spyOn(prisma.appSetting, "findUnique").mockResolvedValueOnce({
      key: "schedule_config",
      value: { catchUpEnabled: true },
    } as never);

    vi.spyOn(prisma.searchRun, "findFirst").mockResolvedValueOnce({
      id: "run-old",
      status: "SUCCEEDED",
      finishedAt: twentyOneHoursAgo,
    } as never);

    const mockBoss = {
      send: vi.fn().mockResolvedValue("job-catchup-1"),
    };

    const enqueued = await checkAndEnqueueCatchUp(mockBoss, now);

    expect(enqueued).toBe(true);
    expect(mockBoss.send).toHaveBeenCalledTimes(1);
    expect(mockBoss.send).toHaveBeenCalledWith(
      Q.discover,
      { trigger: "CATCHUP" },
      { singletonKey: "catchup", singletonSeconds: 3600 },
    );
  });

  it("enqueues CATCHUP run when no previous run exists", async () => {
    const now = new Date("2026-10-14T12:00:00Z");

    vi.spyOn(prisma.appSetting, "findUnique").mockResolvedValueOnce({
      key: "schedule_config",
      value: { catchUpEnabled: true },
    } as never);

    vi.spyOn(prisma.searchRun, "findFirst").mockResolvedValueOnce(null);

    const mockBoss = {
      send: vi.fn().mockResolvedValue("job-catchup-2"),
    };

    const enqueued = await checkAndEnqueueCatchUp(mockBoss, now);

    expect(enqueued).toBe(true);
    expect(mockBoss.send).toHaveBeenCalledTimes(1);
  });

  it("does NOT enqueue CATCHUP run when last successful run is fresh (<=20h)", async () => {
    const now = new Date("2026-10-14T12:00:00Z");
    const fiveHoursAgo = new Date(now.getTime() - 5 * 3600_000);

    vi.spyOn(prisma.appSetting, "findUnique").mockResolvedValueOnce({
      key: "schedule_config",
      value: { catchUpEnabled: true },
    } as never);

    vi.spyOn(prisma.searchRun, "findFirst").mockResolvedValueOnce({
      id: "run-fresh",
      status: "SUCCEEDED",
      finishedAt: fiveHoursAgo,
    } as never);

    const mockBoss = {
      send: vi.fn().mockResolvedValue(null),
    };

    const enqueued = await checkAndEnqueueCatchUp(mockBoss, now);

    expect(enqueued).toBe(false);
    expect(mockBoss.send).not.toHaveBeenCalled();
  });

  it("does NOT enqueue CATCHUP run when catchUpEnabled is false", async () => {
    const now = new Date("2026-10-14T12:00:00Z");

    vi.spyOn(prisma.appSetting, "findUnique").mockResolvedValueOnce({
      key: "schedule_config",
      value: { catchUpEnabled: false },
    } as never);

    const mockBoss = {
      send: vi.fn().mockResolvedValue(null),
    };

    const enqueued = await checkAndEnqueueCatchUp(mockBoss, now);

    expect(enqueued).toBe(false);
    expect(mockBoss.send).not.toHaveBeenCalled();
  });
});

describe("Phase 7: Scheduled run writes SearchRun trigger=SCHEDULED", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(prisma.appSetting, "findUnique").mockResolvedValue(null as never);
    vi.spyOn(prisma.notification, "create").mockResolvedValue({} as never);
  });

  it("runDiscovery('SCHEDULED') records SearchRun with trigger=SCHEDULED", async () => {
    const createdRun = { id: "run-sched-1", trigger: "SCHEDULED", status: "RUNNING" };
    const createSpy = vi.spyOn(prisma.searchRun, "create").mockResolvedValue(createdRun as never);
    const updateSpy = vi.spyOn(prisma.searchRun, "update").mockResolvedValue({} as never);

    vi.spyOn(prisma.searchPreference, "findMany").mockResolvedValue([]);
    vi.spyOn(prisma.jobSource, "findMany").mockResolvedValue([]);

    const res = await runDiscovery("SCHEDULED");

    expect(res.runId).toBe("run-sched-1");
    expect(createSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          trigger: "SCHEDULED",
          status: "RUNNING",
        }),
      }),
    );
    expect(updateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "run-sched-1" },
        data: expect.objectContaining({
          status: "SUCCEEDED",
        }),
      }),
    );
  });
});

describe("Phase 7: Kill switch stops all outbound fetching", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("halts runDiscovery immediately when kill switch is enabled", async () => {
    vi.spyOn(prisma.appSetting, "findUnique").mockResolvedValueOnce({
      key: "kill_switch_enabled",
      value: { enabled: true },
    } as never);

    const createSpy = vi.spyOn(prisma.searchRun, "create").mockResolvedValue({
      id: "run-cancelled",
      status: "CANCELLED",
    } as never);

    const jobSourceFindSpy = vi.spyOn(prisma.jobSource, "findMany");

    const res = await runDiscovery("SCHEDULED");

    expect(res.runId).toBe("run-cancelled");
    expect(res.newJobIds).toHaveLength(0);
    expect(createSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "CANCELLED",
          error: "Kill switch is active",
        }),
      }),
    );
    // Verified 0 outbound sources queried
    expect(jobSourceFindSpy).not.toHaveBeenCalled();
  });
});

describe("Phase 7: Source failing for 3 consecutive days raises notification", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(prisma.appSetting, "findUnique").mockResolvedValue(null as never);
  });

  it("creates source_failing notification on 3rd failure", async () => {
    vi.spyOn(prisma.searchRun, "create").mockResolvedValue({ id: "run-fail" } as never);
    vi.spyOn(prisma.searchPreference, "findMany").mockResolvedValue([]);
    vi.spyOn(prisma.jobSource, "findMany").mockResolvedValue([
      {
        id: "src-failing",
        name: "Broken Greenhouse",
        kind: "ATS_GREENHOUSE",
        config: { boardToken: "broken", consecutiveFailures: 2 }, // already failed 2 times
        minIntervalMin: 360,
        lastRunAt: null,
      } as never,
    ]);

    // Adapter throws HTTP 500
    vi.spyOn(ADAPTERS.ATS_GREENHOUSE!, "fetchJobs").mockRejectedValue(new Error("500 Server Error"));

    const updateSourceSpy = vi.spyOn(prisma.jobSource, "update").mockResolvedValue({} as never);
    vi.spyOn(prisma.searchRun, "update").mockResolvedValue({} as never);
    vi.spyOn(prisma.notification, "findFirst").mockResolvedValue(null);
    const notifCreateSpy = vi.spyOn(prisma.notification, "create").mockResolvedValue({} as never);

    await runDiscovery("SCHEDULED");

    // Verified consecutiveFailures incremented to 3
    expect(updateSourceSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "src-failing" },
        data: expect.objectContaining({
          config: expect.objectContaining({
            consecutiveFailures: 3,
          }),
        }),
      }),
    );

    // Verified source_failing notification created
    expect(notifCreateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          kind: "source_failing",
          title: "Source failing: Broken Greenhouse",
          refType: "job_source",
          refId: "src-failing",
        }),
      }),
    );
  });
});

describe("Phase 7: Follow-up checker & Retention cleanup", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("checkFollowUps notifies active applications past their follow-up date", async () => {
    const now = new Date("2026-10-14T09:00:00Z");

    vi.spyOn(prisma.application, "findMany").mockResolvedValueOnce([
      {
        id: "app-due-1",
        status: "SUBMITTED",
        followUpAt: new Date("2026-10-13T09:00:00Z"),
        job: { title: "Software Engineer", company: { name: "Acme Corp" } },
      },
    ] as never);

    vi.spyOn(prisma.notification, "findFirst").mockResolvedValue(null);
    const notifSpy = vi.spyOn(prisma.notification, "create").mockResolvedValue({} as never);

    const notified = await checkFollowUps(now);

    expect(notified).toBe(1);
    expect(notifSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          kind: "followup_due",
          title: expect.stringContaining("Follow-up due: Acme Corp - Software Engineer"),
        }),
      }),
    );
  });

  it("runRetentionCleanup deletes old closed jobs, old snippets, old llm logs, and read notifications", async () => {
    const deleteJobsSpy = vi.spyOn(prisma.job, "deleteMany").mockResolvedValue({ count: 5 });
    const deleteEmailsSpy = vi.spyOn(prisma.emailMessage, "deleteMany").mockResolvedValue({ count: 2 });
    const deleteLlmSpy = vi.spyOn(prisma.llmCall, "deleteMany").mockResolvedValue({ count: 12 });
    const deleteNotifsSpy = vi.spyOn(prisma.notification, "deleteMany").mockResolvedValue({ count: 8 });

    const result = await runRetentionCleanup();

    expect(result.deletedJobs).toBe(5);
    expect(result.deletedEmails).toBe(2);
    expect(result.deletedLlmCalls).toBe(12);
    expect(result.deletedNotifications).toBe(8);

    expect(deleteJobsSpy).toHaveBeenCalledTimes(1);
    expect(deleteEmailsSpy).toHaveBeenCalledTimes(1);
    expect(deleteLlmSpy).toHaveBeenCalledTimes(1);
    expect(deleteNotifsSpy).toHaveBeenCalledTimes(1);
  });
});

describe("Phase 7: Notifications API & SSE Events", () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeEach(async () => {
    vi.restoreAllMocks();
  });

  it("GET /api/v1/notifications returns unread count and items", async () => {
    app = await buildApp({ token: TOKEN, port: PORT, logLevel: "silent", deps: deps() });

    vi.spyOn(prisma.notification, "findMany").mockResolvedValueOnce([
      { id: "notif-1", kind: "new_matches", title: "3 new jobs", readAt: null },
    ] as never);
    vi.spyOn(prisma.notification, "count").mockResolvedValueOnce(1);

    const r = await app.inject({
      method: "GET",
      url: "/api/v1/notifications",
      headers: authed,
    });

    expect(r.statusCode).toBe(200);
    expect(r.json().unreadCount).toBe(1);
    expect(r.json().data).toHaveLength(1);

    await app.close();
  });

  it("PATCH /api/v1/notifications/:id/read marks notification as read", async () => {
    app = await buildApp({ token: TOKEN, port: PORT, logLevel: "silent", deps: deps() });

    const updateSpy = vi.spyOn(prisma.notification, "update").mockResolvedValueOnce({
      id: "notif-1",
      readAt: new Date(),
    } as never);

    const r = await app.inject({
      method: "PATCH",
      url: "/api/v1/notifications/notif-1/read",
      headers: authed,
    });

    expect(r.statusCode).toBe(200);
    expect(updateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "notif-1" },
        data: expect.objectContaining({ readAt: expect.any(Date) }),
      }),
    );

    await app.close();
  });

  it("broadcasts SSE events to listeners on sseBus", () => {
    const received: unknown[] = [];
    const listener = (evt: unknown) => received.push(evt);
    sseBus.on("sse", listener);

    sseBus.broadcast("run.progress", { runId: "test-run", status: "RUNNING" });

    expect(received).toHaveLength(1);
    expect((received[0] as { type: string }).type).toBe("run.progress");

    sseBus.off("sse", listener);
  });
});
