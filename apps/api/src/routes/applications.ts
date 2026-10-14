// apps/api/src/routes/applications.ts - Applications Tracker & Assisted Apply API
// State machine transitions: Fig 5.8
// Endpoints:
//   GET    /api/v1/applications             - list applications with job, events, documents
//   POST   /api/v1/applications             - track a job (default PLANNED, followUpAt default)
//   GET    /api/v1/applications/:id         - get single application details
//   PATCH  /api/v1/applications/:id         - transition status (409 ILLEGAL_TRANSITION), edit followUpAt/notes
//   POST   /api/v1/applications/:id/assist  - worker assistedFill on allow-listed ATS with daily cap
//   GET    /api/v1/applications/proposals   - list pending email classification proposals
//   POST   /api/v1/applications/classify-email - classify email & create proposal
//   POST   /api/v1/applications/proposals/:id/accept - apply email proposal with user confirmation
//   POST   /api/v1/applications/proposals/:id/dismiss - dismiss email proposal
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { prisma, type Prisma } from "@jobpilot/db";
import {
  canTransition,
  calculateDefaultFollowUpAt,
  type ApplicationStatus,
} from "@jobpilot/core/applications/transitions.js";
import { classifyEmail, matchApplication } from "@jobpilot/core/email/classifier.js";
import { assistedFill } from "../../../worker/src/assist/assistedFill.js";
import { ApiError, parseWith } from "../errors.js";

const ApplicationStatusSchema = z.enum([
  "PLANNED",
  "PREPARED",
  "SUBMITTED",
  "ACKNOWLEDGED",
  "SCREENING",
  "INTERVIEW",
  "ASSESSMENT",
  "OFFER",
  "REJECTED",
  "WITHDRAWN",
  "GHOSTED",
]);

const CreateApplicationBody = z.object({
  jobId: z.string().min(1),
  status: ApplicationStatusSchema.optional().default("PLANNED"),
  method: z.enum(["MANUAL_PORTAL", "ASSISTED_ATS", "EMAIL", "REFERRAL"]).optional().default("MANUAL_PORTAL"),
  notes: z.string().optional(),
  followUpAt: z.string().datetime().optional().nullable(),
});

const PatchApplicationBody = z.object({
  status: ApplicationStatusSchema.optional(),
  method: z.enum(["MANUAL_PORTAL", "ASSISTED_ATS", "EMAIL", "REFERRAL"]).optional(),
  notes: z.string().optional().nullable(),
  followUpAt: z.string().datetime().optional().nullable(),
  note: z.string().optional(),
  source: z.enum(["USER", "EMAIL_PARSER", "SYSTEM"]).optional().default("USER"),
  emailMessageId: z.string().optional(),
});

const ClassifyEmailBody = z.object({
  subject: z.string(),
  fromAddr: z.string(),
  snippet: z.string().max(3000),
  messageIdHdr: z.string().optional(),
});

export const applicationRoutes: FastifyPluginAsync = async (app) => {
  // Helper: get primary profile id
  async function getProfileId(): Promise<string> {
    const profile = await prisma.profile.findFirst({ select: { id: true } });
    if (!profile) throw new ApiError(404, "NOT_FOUND", "Profile not found. Please upload a resume first.");
    return profile.id;
  }

  // GET /api/v1/applications - list tracked applications
  app.get<{ Querystring: { status?: string } }>("/", async (req) => {
    const profileId = await getProfileId();
    const where: Prisma.ApplicationWhereInput = { profileId };

    if (req.query.status) {
      const statuses = req.query.status.split(",") as ApplicationStatus[];
      where.status = { in: statuses };
    }

    const applications = await prisma.application.findMany({
      where,
      include: {
        job: true,
        events: { orderBy: { occurredAt: "desc" }, take: 10 },
        documents: {
          select: {
            id: true,
            kind: true,
            format: true,
            approvedAt: true,
            filePath: true,
            createdAt: true,
          },
        },
      },
      orderBy: { updatedAt: "desc" },
    });

    return { data: applications };
  });

  // POST /api/v1/applications - track a job
  app.post("/", async (req) => {
    const profileId = await getProfileId();
    const body = parseWith(CreateApplicationBody, req.body);

    const existing = await prisma.application.findUnique({
      where: { profileId_jobId: { profileId, jobId: body.jobId } },
    });
    if (existing) {
      throw new ApiError(409, "APPLICATION_EXISTS", "Application for this job already exists");
    }

    const status = body.status;
    const followUpAt =
      body.followUpAt !== undefined
        ? body.followUpAt ? new Date(body.followUpAt) : null
        : calculateDefaultFollowUpAt(status);

    const appliedAt = status === "SUBMITTED" ? new Date() : null;

    const application = await prisma.application.create({
      data: {
        profileId,
        jobId: body.jobId,
        status,
        method: body.method,
        notes: body.notes,
        followUpAt,
        appliedAt,
        events: {
          create: {
            fromStatus: null,
            toStatus: status,
            source: "USER",
            note: body.notes ?? "Application tracked",
          },
        },
      },
      include: { job: true, events: true },
    });

    await prisma.auditLog.create({
      data: {
        actor: "user",
        action: "application.created",
        entity: "Application",
        entityId: application.id,
        meta: { jobId: body.jobId, status } as Prisma.InputJsonValue,
      },
    });

    return { data: application };
  });

  // GET /api/v1/applications/proposals - pending email classification proposals
  app.get("/proposals", async () => {
    const notifications = await prisma.notification.findMany({
      where: { kind: "email_proposal", readAt: null },
      orderBy: { createdAt: "desc" },
    });

    const proposals = notifications.map((n) => {
      let parsed = {};
      try {
        parsed = JSON.parse(n.body);
      } catch {
        // ignore
      }
      return {
        id: n.id,
        title: n.title,
        createdAt: n.createdAt,
        ...parsed,
      };
    });

    return { data: proposals };
  });

  // POST /api/v1/applications/classify-email - classify email & create human proposal banner
  app.post("/classify-email", async (req) => {
    const profileId = await getProfileId();
    const body = parseWith(ClassifyEmailBody, req.body);

    const proposal = await classifyEmail({
      subject: body.subject,
      fromAddr: body.fromAddr,
      snippet: body.snippet,
    });

    const applications = await prisma.application.findMany({
      where: { profileId },
      include: {
        job: {
          select: {
            title: true,
            company: { select: { name: true } },
          },
        },
      },
    });

    const mapped = applications.map((a) => ({
      id: a.id,
      job: { company: a.job.company.name, title: a.job.title },
    }));

    const matchedAppId = matchApplication(
      { company: proposal.company, roleTitle: proposal.roleTitle, fromAddr: body.fromAddr },
      mapped,
    );

    let notificationId: string | null = null;
    if (proposal.proposedStatus && matchedAppId) {
      const targetApp = mapped.find((a) => a.id === matchedAppId);
      const notif = await prisma.notification.create({
        data: {
          kind: "email_proposal",
          title: `Update to ${proposal.proposedStatus} for ${targetApp?.job.company ?? "Application"}`,
          body: JSON.stringify({
            applicationId: matchedAppId,
            company: proposal.company ?? targetApp?.job.company,
            roleTitle: proposal.roleTitle ?? targetApp?.job.title,
            proposedStatus: proposal.proposedStatus,
            confidence: proposal.confidence,
            category: proposal.category,
            nextStepDate: proposal.nextStepDate,
            fromAddr: body.fromAddr,
            subject: body.subject,
          }),
          refType: "Application",
          refId: matchedAppId,
        },
      });
      notificationId = notif.id;
    }

    return {
      data: {
        proposalId: notificationId,
        ...proposal,
        applicationId: matchedAppId,
      },
    };
  });

  // POST /api/v1/applications/proposals/:id/accept - human clicks Accept on proposal banner
  app.post<{ Params: { id: string } }>("/proposals/:id/accept", async (req) => {
    const notif = await prisma.notification.findUnique({ where: { id: req.params.id } });
    if (!notif || notif.kind !== "email_proposal") {
      throw new ApiError(404, "NOT_FOUND", "Proposal not found");
    }

    const payload = JSON.parse(notif.body);
    const { applicationId, proposedStatus, emailMessageId } = payload as {
      applicationId: string;
      proposedStatus: ApplicationStatus;
      emailMessageId?: string;
    };

    const currentApp = await prisma.application.findUnique({ where: { id: applicationId } });
    if (!currentApp) throw new ApiError(404, "NOT_FOUND", "Target application not found");

    if (!canTransition(currentApp.status as ApplicationStatus, proposedStatus)) {
      throw new ApiError(
        409,
        "ILLEGAL_TRANSITION",
        `Cannot transition application from ${currentApp.status} to ${proposedStatus}`,
      );
    }

    const followUpAt = calculateDefaultFollowUpAt(proposedStatus);
    const appliedAt = proposedStatus === "SUBMITTED" ? currentApp.appliedAt ?? new Date() : currentApp.appliedAt;

    const updated = await prisma.application.update({
      where: { id: applicationId },
      data: {
        status: proposedStatus,
        followUpAt,
        appliedAt,
        events: {
          create: {
            fromStatus: currentApp.status,
            toStatus: proposedStatus,
            source: "EMAIL_PARSER",
            note: `Status updated via email proposal: ${notif.title}`,
            emailMessageId,
          },
        },
      },
      include: { job: true, events: true },
    });

    await prisma.notification.update({
      where: { id: req.params.id },
      data: { readAt: new Date() },
    });

    await prisma.auditLog.create({
      data: {
        actor: "user",
        action: "application.status_changed",
        entity: "Application",
        entityId: applicationId,
        meta: {
          fromStatus: currentApp.status,
          toStatus: proposedStatus,
          via: "email_proposal",
          proposalId: req.params.id,
        } as Prisma.InputJsonValue,
      },
    });

    return { data: updated };
  });

  // POST /api/v1/applications/proposals/:id/dismiss - dismiss proposal banner
  app.post<{ Params: { id: string } }>("/proposals/:id/dismiss", async (req) => {
    const notif = await prisma.notification.findUnique({ where: { id: req.params.id } });
    if (!notif) throw new ApiError(404, "NOT_FOUND", "Proposal not found");

    await prisma.notification.update({
      where: { id: req.params.id },
      data: { readAt: new Date() },
    });

    return { data: { dismissed: true } };
  });

  // GET /api/v1/applications/:id - get single application
  app.get<{ Params: { id: string } }>("/:id", async (req) => {
    const application = await prisma.application.findUnique({
      where: { id: req.params.id },
      include: {
        job: true,
        events: { orderBy: { occurredAt: "desc" } },
        documents: {
          select: {
            id: true,
            kind: true,
            format: true,
            approvedAt: true,
            filePath: true,
            guardReport: true,
            createdAt: true,
          },
        },
      },
    });

    if (!application) throw new ApiError(404, "NOT_FOUND", "Application not found");
    return { data: application };
  });

  // PATCH /api/v1/applications/:id - update status (enforces Fig 5.8 state machine)
  app.patch<{ Params: { id: string } }>("/:id", async (req) => {
    const body = parseWith(PatchApplicationBody, req.body);
    const existing = await prisma.application.findUnique({
      where: { id: req.params.id },
    });
    if (!existing) throw new ApiError(404, "NOT_FOUND", "Application not found");

    let newStatus = existing.status as ApplicationStatus;
    let followUpAt = existing.followUpAt;
    let appliedAt = existing.appliedAt;

    if (body.status && body.status !== existing.status) {
      if (!canTransition(existing.status as ApplicationStatus, body.status)) {
        throw new ApiError(
          409,
          "ILLEGAL_TRANSITION",
          `Cannot transition application from ${existing.status} to ${body.status}`,
        );
      }
      newStatus = body.status;

      // Handle appliedAt
      if (newStatus === "SUBMITTED" && !appliedAt) {
        appliedAt = new Date();
      }

      // Handle followUpAt default
      if (body.followUpAt !== undefined) {
        followUpAt = body.followUpAt ? new Date(body.followUpAt) : null;
      } else {
        followUpAt = calculateDefaultFollowUpAt(newStatus);
      }
    } else if (body.followUpAt !== undefined) {
      followUpAt = body.followUpAt ? new Date(body.followUpAt) : null;
    }

    const updated = await prisma.application.update({
      where: { id: req.params.id },
      data: {
        status: newStatus,
        method: body.method ?? existing.method,
        notes: body.notes !== undefined ? body.notes : existing.notes,
        followUpAt,
        appliedAt,
        ...(newStatus !== existing.status
          ? {
              events: {
                create: {
                  fromStatus: existing.status,
                  toStatus: newStatus,
                  source: body.source,
                  note: body.note ?? `Status transitioned from ${existing.status} to ${newStatus}`,
                  emailMessageId: body.emailMessageId,
                },
              },
            }
          : {}),
      },
      include: { job: true, events: { orderBy: { occurredAt: "desc" }, take: 10 } },
    });

    if (newStatus !== existing.status) {
      await prisma.auditLog.create({
        data: {
          actor: "user",
          action: "application.status_changed",
          entity: "Application",
          entityId: req.params.id,
          meta: {
            fromStatus: existing.status,
            toStatus: newStatus,
            jobId: existing.jobId,
          } as Prisma.InputJsonValue,
        },
      });
    }

    return { data: updated };
  });

  // POST /api/v1/applications/:id/assist - assist apply via headed browser with daily cap
  app.post<{ Params: { id: string } }>("/:id/assist", async (req) => {
    const application = await prisma.application.findUnique({
      where: { id: req.params.id },
      include: {
        job: true,
        profile: { select: { fullName: true, email: true, phone: true } },
      },
    });
    if (!application) throw new ApiError(404, "NOT_FOUND", "Application not found");
    if (!application.job.applyUrl) {
      throw new ApiError(400, "MISSING_APPLY_URL", "Job has no apply URL");
    }

    // Validate applyUrl host
    const url = new URL(application.job.applyUrl);
    const host = url.hostname;
    const FORBIDDEN = /(^|\.)(linkedin|indeed|naukri)\.com$/i;
    if (FORBIDDEN.test(host)) {
      throw new ApiError(403, "FORBIDDEN_PORTAL", "Automation on LinkedIn/Indeed/Naukri is forbidden by design.");
    }

    const ALLOWED = new Set(["boards.greenhouse.io", "job-boards.greenhouse.io", "jobs.lever.co", "jobs.ashbyhq.com"]);
    const isLocalAllowed =
      (process.env.NODE_ENV === "test" || process.env.ALLOW_LOCAL_ATS === "true") &&
      (host === "localhost" || host === "127.0.0.1");

    if (!ALLOWED.has(host) && !isLocalAllowed) {
      throw new ApiError(400, "DISALLOWED_HOST", `Host ${host} is not on the assisted-fill allow-list.`);
    }

    // Daily cap check (default 10)
    const capSetting = await prisma.appSetting.findUnique({ where: { key: "assist_daily_cap" } });
    const dailyCap = typeof capSetting?.value === "number" ? capSetting.value : 10;

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const todayAssists = await prisma.auditLog.count({
      where: {
        action: "application.assisted_fill",
        at: { gte: todayStart },
      },
    });

    if (todayAssists >= dailyCap) {
      throw new ApiError(429, "DAILY_CAP_REACHED", `Daily limit of ${dailyCap} assisted applies reached.`);
    }

    // Find tailored or approved resume PDF
    const tailoredDoc = await prisma.generatedDocument.findFirst({
      where: {
        applicationId: req.params.id,
        kind: "TAILORED_RESUME",
        approvedAt: { not: null },
        filePath: { not: null },
      },
    });

    const resumePdfPath = tailoredDoc?.filePath ?? "data/resumes/default.pdf";
    const [firstName, ...lastParts] = (application.profile.fullName || "Applicant").split(" ");

    // Record audit log entry
    await prisma.auditLog.create({
      data: {
        actor: "user",
        action: "application.assisted_fill",
        entity: "Application",
        entityId: application.id,
        meta: {
          jobId: application.jobId,
          applyUrl: application.job.applyUrl,
          host,
        } as Prisma.InputJsonValue,
      },
    });

    // Run assisted fill asynchronously so the HTTP request completes
    const fillPromise = assistedFill(
      {
        applyUrl: application.job.applyUrl,
        resumePdf: resumePdfPath,
        first: firstName || "Applicant",
        last: lastParts.join(" ") || "User",
        email: application.profile.email || "applicant@example.com",
        phone: application.profile.phone || "555-0100",
      },
      process.env.PLAYWRIGHT_USER_DATA_DIR || "data/browser_profile",
      { waitForClose: true },
    ).catch((err) => {
      console.error("[assistedFill error]", err);
    });

    return {
      data: {
        ok: true,
        message: "Assisted fill launched in visible browser. Review all fields and submit manually.",
      },
    };
  });
};
