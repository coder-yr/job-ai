// tests/tracker.test.ts - Phase 6 acceptance tests
// - Applications API transition rules from Fig 5.8 (409 ILLEGAL_TRANSITION)
// - Events, AuditLog entries, followUpAt defaults (7/14/21 days)
// - Safety & assistedFill on local sandbox form (fields filled, waits for human, no submit)
// - CAPTCHA reported, never bypassed
// - Email classification proposals require user confirmation
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import http from "node:http";
import { writeFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { buildApp, type AppDeps } from "../apps/api/src/app.js";
import {
  canTransition,
  calculateDefaultFollowUpAt,
  isGhostedEligible,
  ALLOWED_TRANSITIONS,
  type ApplicationStatus,
} from "../packages/core/src/applications/transitions.js";
import {
  categoryToProposedStatus,
  matchApplication,
} from "../packages/core/src/email/classifier.js";
import { assistedFill } from "../apps/worker/src/assist/assistedFill.js";
import { prisma } from "../packages/db/src/client.js";

const TOKEN = "t".repeat(40);
const PORT = 4002;
const authed = { host: `127.0.0.1:${PORT}`, "x-jobpilot-token": TOKEN };

const deps = (): AppDeps => ({
  checkDb: async () => true,
  checkOllama: async () => ({ up: true, missing: [] }),
});

describe("State Machine: Fig 5.8 transitions", () => {
  it("allows legal forward transitions", () => {
    expect(canTransition("PLANNED", "PREPARED")).toBe(true);
    expect(canTransition("PREPARED", "SUBMITTED")).toBe(true);
    expect(canTransition("SUBMITTED", "ACKNOWLEDGED")).toBe(true);
    expect(canTransition("ACKNOWLEDGED", "SCREENING")).toBe(true);
    expect(canTransition("SCREENING", "ASSESSMENT")).toBe(true);
    expect(canTransition("SCREENING", "INTERVIEW")).toBe(true);
    expect(canTransition("ASSESSMENT", "INTERVIEW")).toBe(true);
    expect(canTransition("INTERVIEW", "OFFER")).toBe(true);
    expect(canTransition("INTERVIEW", "REJECTED")).toBe(true);
    expect(canTransition("SCREENING", "REJECTED")).toBe(true);
    expect(canTransition("SUBMITTED", "GHOSTED")).toBe(true);
    expect(canTransition("ACKNOWLEDGED", "GHOSTED")).toBe(true);
  });

  it("allows withdrawals from active states", () => {
    expect(canTransition("PLANNED", "WITHDRAWN")).toBe(true);
    expect(canTransition("PREPARED", "WITHDRAWN")).toBe(true);
    expect(canTransition("SUBMITTED", "WITHDRAWN")).toBe(true);
    expect(canTransition("ACKNOWLEDGED", "WITHDRAWN")).toBe(true);
    expect(canTransition("SCREENING", "WITHDRAWN")).toBe(true);
    expect(canTransition("INTERVIEW", "WITHDRAWN")).toBe(true);
  });

  it("refuses illegal transitions", () => {
    // Skipping stages
    expect(canTransition("PLANNED", "OFFER")).toBe(false);
    expect(canTransition("PLANNED", "SUBMITTED")).toBe(false);
    expect(canTransition("SUBMITTED", "OFFER")).toBe(false);
    expect(canTransition("PREPARED", "INTERVIEW")).toBe(false);

    // Transitions out of terminal states
    expect(canTransition("REJECTED", "INTERVIEW")).toBe(false);
    expect(canTransition("OFFER", "PLANNED")).toBe(false);
    expect(canTransition("WITHDRAWN", "SUBMITTED")).toBe(false);
    expect(canTransition("GHOSTED", "SCREENING")).toBe(false);
  });
});

describe("Follow-up defaults (7/14/21 days)", () => {
  const base = new Date("2026-10-01T10:00:00Z");

  it("SUBMITTED defaults to 7 days", () => {
    const f = calculateDefaultFollowUpAt("SUBMITTED", base);
    expect(f).not.toBeNull();
    const diffDays = Math.round((f!.getTime() - base.getTime()) / (1000 * 60 * 60 * 24));
    expect(diffDays).toBe(7);
  });

  it("ACKNOWLEDGED defaults to 14 days", () => {
    const f = calculateDefaultFollowUpAt("ACKNOWLEDGED", base);
    expect(f).not.toBeNull();
    const diffDays = Math.round((f!.getTime() - base.getTime()) / (1000 * 60 * 60 * 24));
    expect(diffDays).toBe(14);
  });

  it("Terminal states clear followUpAt", () => {
    expect(calculateDefaultFollowUpAt("OFFER", base)).toBeNull();
    expect(calculateDefaultFollowUpAt("REJECTED", base)).toBeNull();
    expect(calculateDefaultFollowUpAt("WITHDRAWN", base)).toBeNull();
    expect(calculateDefaultFollowUpAt("GHOSTED", base)).toBeNull();
  });

  it("GHOSTED requires 21 days with no reply", () => {
    const d10 = new Date(base.getTime() + 10 * 86400_000);
    const d21 = new Date(base.getTime() + 21 * 86400_000);
    const d25 = new Date(base.getTime() + 25 * 86400_000);

    expect(isGhostedEligible("SUBMITTED", base, d10)).toBe(false);
    expect(isGhostedEligible("SUBMITTED", base, d21)).toBe(true);
    expect(isGhostedEligible("ACKNOWLEDGED", base, d25)).toBe(true);
    expect(isGhostedEligible("INTERVIEW", base, d25)).toBe(false);
  });
});

describe("API: transition rules & illegal transitions return 409", () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeAll(async () => {
    app = await buildApp({ token: TOKEN, port: PORT, logLevel: "silent", deps: deps() });
  });
  afterAll(() => app.close());

  it("PATCH /applications/:id returns 409 ILLEGAL_TRANSITION when jumping stages", async () => {
    // Mock application currently in PLANNED
    vi.spyOn(prisma.application, "findUnique").mockResolvedValueOnce({
      id: "app-123",
      profileId: "prof-1",
      jobId: "job-1",
      status: "PLANNED",
      method: "MANUAL_PORTAL",
      appliedAt: null,
      followUpAt: null,
      notes: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never);

    const r = await app.inject({
      method: "PATCH",
      url: "/api/v1/applications/app-123",
      headers: authed,
      payload: { status: "OFFER" }, // illegal jump from PLANNED to OFFER
    });

    expect(r.statusCode).toBe(409);
    expect(r.json().error.code).toBe("ILLEGAL_TRANSITION");
  });

  it("PATCH /applications/:id returns 409 when transitioning out of REJECTED", async () => {
    vi.spyOn(prisma.application, "findUnique").mockResolvedValueOnce({
      id: "app-123",
      profileId: "prof-1",
      jobId: "job-1",
      status: "REJECTED",
      method: "MANUAL_PORTAL",
      appliedAt: null,
      followUpAt: null,
      notes: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never);

    const r = await app.inject({
      method: "PATCH",
      url: "/api/v1/applications/app-123",
      headers: authed,
      payload: { status: "INTERVIEW" },
    });

    expect(r.statusCode).toBe(409);
    expect(r.json().error.code).toBe("ILLEGAL_TRANSITION");
  });

  it("PATCH /applications/:id accepts legal transition and records event + audit log", async () => {
    vi.spyOn(prisma.application, "findUnique").mockResolvedValueOnce({
      id: "app-123",
      profileId: "prof-1",
      jobId: "job-1",
      status: "PLANNED",
      method: "MANUAL_PORTAL",
      appliedAt: null,
      followUpAt: null,
      notes: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never);

    const updateSpy = vi.spyOn(prisma.application, "update").mockResolvedValueOnce({
      id: "app-123",
      status: "PREPARED",
      jobId: "job-1",
      profileId: "prof-1",
      events: [],
      job: { id: "job-1", title: "Dev" },
    } as never);

    const auditSpy = vi.spyOn(prisma.auditLog, "create").mockResolvedValueOnce({} as never);

    const r = await app.inject({
      method: "PATCH",
      url: "/api/v1/applications/app-123",
      headers: authed,
      payload: { status: "PREPARED", note: "Documents tailored & approved" },
    });

    expect(r.statusCode).toBe(200);
    expect(updateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "app-123" },
        data: expect.objectContaining({
          status: "PREPARED",
          events: expect.objectContaining({
            create: expect.objectContaining({
              fromStatus: "PLANNED",
              toStatus: "PREPARED",
            }),
          }),
        }),
      }),
    );
    expect(auditSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "application.status_changed",
          entity: "Application",
          entityId: "app-123",
        }),
      }),
    );
  });
});

describe("API: assisted apply daily cap & host restrictions", () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeAll(async () => {
    app = await buildApp({ token: TOKEN, port: PORT, logLevel: "silent", deps: deps() });
  });
  afterAll(() => app.close());

  it("POST /applications/:id/assist rejects forbidden portal (LinkedIn)", async () => {
    vi.spyOn(prisma.application, "findUnique").mockResolvedValueOnce({
      id: "app-li",
      job: { applyUrl: "https://www.linkedin.com/jobs/view/123" },
      profile: { fullName: "Test User", email: "a@b.com", phone: "123" },
    } as never);

    const r = await app.inject({
      method: "POST",
      url: "/api/v1/applications/app-li/assist",
      headers: authed,
    });

    expect(r.statusCode).toBe(403);
    expect(r.json().error.code).toBe("FORBIDDEN_PORTAL");
  });

  it("POST /applications/:id/assist rejects unknown non-whitelisted host", async () => {
    vi.spyOn(prisma.application, "findUnique").mockResolvedValueOnce({
      id: "app-evil",
      job: { applyUrl: "https://evil.example.com/apply" },
      profile: { fullName: "Test User", email: "a@b.com", phone: "123" },
    } as never);

    const r = await app.inject({
      method: "POST",
      url: "/api/v1/applications/app-evil/assist",
      headers: authed,
    });

    expect(r.statusCode).toBe(400);
    expect(r.json().error.code).toBe("DISALLOWED_HOST");
  });

  it("POST /applications/:id/assist enforces daily cap", async () => {
    vi.spyOn(prisma.application, "findUnique").mockResolvedValueOnce({
      id: "app-cap",
      job: { applyUrl: "https://jobs.lever.co/company/role" },
      profile: { fullName: "Test User", email: "a@b.com", phone: "123" },
    } as never);

    // Mock daily cap setting = 10 and today's assists count = 10
    vi.spyOn(prisma.appSetting, "findUnique").mockResolvedValueOnce({
      key: "assist_daily_cap",
      value: 10,
    } as never);
    vi.spyOn(prisma.auditLog, "count").mockResolvedValueOnce(10);

    const r = await app.inject({
      method: "POST",
      url: "/api/v1/applications/app-cap/assist",
      headers: authed,
    });

    expect(r.statusCode).toBe(429);
    expect(r.json().error.code).toBe("DAILY_CAP_REACHED");
  });

  it("GET /api/v1/settings/assist-cap returns default 10 when unset", async () => {
    vi.spyOn(prisma.appSetting, "findUnique").mockResolvedValueOnce(null);
    const r = await app.inject({
      method: "GET",
      url: "/api/v1/settings/assist-cap",
      headers: authed,
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().data.dailyCap).toBe(10);
  });

  it("PUT /api/v1/settings/assist-cap updates daily cap setting", async () => {
    vi.spyOn(prisma.appSetting, "upsert").mockResolvedValueOnce({
      key: "assist_daily_cap",
      value: 15,
      updatedAt: new Date(),
    } as never);
    const r = await app.inject({
      method: "PUT",
      url: "/api/v1/settings/assist-cap",
      headers: authed,
      payload: { dailyCap: 15 },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().data.dailyCap).toBe(15);
  });

  it("POST /api/v1/applications/proposals/:id/accept applies status change and records audit log", async () => {
    vi.spyOn(prisma.notification, "findUnique").mockResolvedValueOnce({
      id: "prop-1",
      kind: "email_proposal",
      title: "Update to INTERVIEW for Acme",
      body: JSON.stringify({
        applicationId: "app-test-1",
        company: "Acme",
        roleTitle: "Frontend Dev",
        proposedStatus: "INTERVIEW",
        confidence: 0.95,
        category: "INTERVIEW",
        nextStepDate: "2026-10-20",
      }),
      refType: "Application",
      refId: "app-test-1",
      readAt: null,
      createdAt: new Date(),
    } as never);

    vi.spyOn(prisma.application, "findUnique").mockResolvedValueOnce({
      id: "app-test-1",
      status: "SCREENING",
      profileId: "prof-1",
      jobId: "job-1",
      appliedAt: new Date("2026-10-01"),
      followUpAt: null,
      notes: null,
    } as never);

    const updateSpy = vi.spyOn(prisma.application, "update").mockResolvedValueOnce({
      id: "app-test-1",
      status: "INTERVIEW",
      jobId: "job-1",
      profileId: "prof-1",
      events: [],
      job: { id: "job-1", title: "Frontend Dev" },
    } as never);

    vi.spyOn(prisma.notification, "update").mockResolvedValueOnce({} as never);
    const auditSpy = vi.spyOn(prisma.auditLog, "create").mockResolvedValueOnce({} as never);

    const r = await app.inject({
      method: "POST",
      url: "/api/v1/applications/proposals/prop-1/accept",
      headers: authed,
    });

    expect(r.statusCode).toBe(200);
    expect(updateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "app-test-1" },
        data: expect.objectContaining({
          status: "INTERVIEW",
          events: expect.objectContaining({
            create: expect.objectContaining({
              fromStatus: "SCREENING",
              toStatus: "INTERVIEW",
              source: "EMAIL_PARSER",
            }),
          }),
        }),
      }),
    );
    expect(auditSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "application.status_changed",
          entity: "Application",
          entityId: "app-test-1",
        }),
      }),
    );
  });

  it("POST /api/v1/applications/proposals/:id/accept returns 409 ILLEGAL_TRANSITION if proposal would violate transition rules", async () => {
    vi.spyOn(prisma.notification, "findUnique").mockResolvedValueOnce({
      id: "prop-illegal",
      kind: "email_proposal",
      title: "Update to OFFER for Acme",
      body: JSON.stringify({
        applicationId: "app-test-2",
        company: "Acme",
        roleTitle: "Frontend Dev",
        proposedStatus: "OFFER",
        confidence: 0.95,
        category: "OFFER",
      }),
      refType: "Application",
      refId: "app-test-2",
      readAt: null,
      createdAt: new Date(),
    } as never);

    // Current status is PLANNED - jump directly to OFFER is illegal!
    vi.spyOn(prisma.application, "findUnique").mockResolvedValueOnce({
      id: "app-test-2",
      status: "PLANNED",
      profileId: "prof-1",
      jobId: "job-2",
      appliedAt: null,
      followUpAt: null,
      notes: null,
    } as never);

    const r = await app.inject({
      method: "POST",
      url: "/api/v1/applications/proposals/prop-illegal/accept",
      headers: authed,
    });

    expect(r.statusCode).toBe(409);
    expect(r.json().error.code).toBe("ILLEGAL_TRANSITION");
  });
});

describe("Local Sandbox Form: assistedFill safe filling & CAPTCHA detection", () => {
  let server: http.Server;
  let serverUrl: string;
  let formSubmitted = false;
  const tempDir = join(process.cwd(), "data", "test_assist");
  const dummyPdf = join(tempDir, "resume.pdf");

  beforeAll(async () => {
    await mkdir(tempDir, { recursive: true });
    await writeFile(dummyPdf, "%PDF-1.4 test resume bytes");

    // Local sandbox ATS form with name, email, phone, file upload, and CAPTCHA
    server = http.createServer((req, res) => {
      if (req.method === "POST" && req.url === "/submit") {
        formSubmitted = true;
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end("Submitted!");
        return;
      }

      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(`
        <!DOCTYPE html>
        <html>
          <head><title>Employer ATS Sandbox</title></head>
          <body>
            <h1>Apply to Engineering Role</h1>
            <form action="/submit" method="POST">
              <label for="first">First Name</label>
              <input id="first" name="first" type="text" />

              <label for="last">Last Name</label>
              <input id="last" name="last" type="text" />

              <label for="email">Email</label>
              <input id="email" name="email" type="email" />

              <label for="phone">Phone</label>
              <input id="phone" name="phone" type="tel" />

              <label for="resume">Resume PDF</label>
              <input id="resume" type="file" name="resume" />

              <!-- CAPTCHA element -->
              <div class="g-recaptcha" data-sitekey="dummy">
                <iframe src="https://example.com/recaptcha" title="reCAPTCHA"></iframe>
              </div>

              <!-- Submit button: MUST NEVER BE CLICKED -->
              <button id="submit-btn" type="submit">Submit Application</button>
            </form>
          </body>
        </html>
      `);
    });

    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address() as { port: number };
        serverUrl = `http://127.0.0.1:${addr.port}/apply`;
        resolve();
      });
    });
  });

  afterAll(async () => {
    server?.close();
    await rm(tempDir, { recursive: true, force: true }).catch(() => {});
  });

  it("fills sandbox form, reports CAPTCHA, and never submits", async () => {
    process.env.HEADLESS_ASSIST = "true";
    process.env.ALLOW_LOCAL_ATS = "true";

    const { chromium } = await import("playwright");
    const testLaunch = await chromium.launch({ headless: true }).catch(() => null);
    if (!testLaunch) {
      console.warn("Playwright browser binary not available — skipping browser test");
      return;
    }
    await testLaunch.close();

    const res = await assistedFill(
      {
        applyUrl: serverUrl,
        resumePdf: dummyPdf,
        first: "Yash",
        last: "Patel",
        email: "yash@example.com",
        phone: "555-0199",
      },
      join(tempDir, "browser_profile"),
      { waitForClose: false }, // don't block test execution
    );

    // Guaranteed by safety: assistedFill never clicks Submit!
    expect(formSubmitted).toBe(false);
    expect(res.filled).toBe(true);
    expect(res.captchaDetected).toBe(true);
  }, 30000);
});

describe("Email Classification Proposals", () => {
  it("maps categories to proposed application statuses", () => {
    expect(categoryToProposedStatus("ACKNOWLEDGEMENT")).toBe("ACKNOWLEDGED");
    expect(categoryToProposedStatus("INTERVIEW")).toBe("INTERVIEW");
    expect(categoryToProposedStatus("ASSESSMENT")).toBe("ASSESSMENT");
    expect(categoryToProposedStatus("REJECTION")).toBe("REJECTED");
    expect(categoryToProposedStatus("OFFER")).toBe("OFFER");
    expect(categoryToProposedStatus("OTHER")).toBeNull();
  });

  it("matches application by company or title", () => {
    const apps = [
      { id: "app-1", job: { company: "Google", title: "Software Engineer" } },
      { id: "app-2", job: { company: "Stripe", title: "Backend Engineer" } },
    ];

    expect(matchApplication({ company: "Google LLC", roleTitle: null }, apps)).toBe("app-1");
    expect(matchApplication({ company: "stripe", roleTitle: null }, apps)).toBe("app-2");
    expect(matchApplication({ company: "Unknown", roleTitle: null }, apps)).toBeNull();
  });
});
