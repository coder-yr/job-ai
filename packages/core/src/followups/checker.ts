// packages/core/src/followups/checker.ts - Daily follow-up deadline checker
import { prisma } from "@jobpilot/db";
import { createNotification } from "../notifications/service.js";

const ACTIVE_FOLLOWUP_STATUSES = [
  "SUBMITTED",
  "ACKNOWLEDGED",
  "SCREENING",
  "INTERVIEW",
  "ASSESSMENT",
] as const;

export async function checkFollowUps(now: Date = new Date()): Promise<number> {
  const dueApps = await prisma.application.findMany({
    where: {
      followUpAt: { lte: now },
      status: { in: ACTIVE_FOLLOWUP_STATUSES as unknown as never[] },
    },
    include: {
      job: {
        include: { company: true },
      },
    },
  });

  let notifiedCount = 0;
  for (const app of dueApps) {
    const existing = await prisma.notification.findFirst({
      where: {
        kind: "followup_due",
        refId: app.id,
        readAt: null,
      },
    });

    if (!existing) {
      const companyName = app.job.company.name;
      const jobTitle = app.job.title;
      await createNotification({
        kind: "followup_due",
        title: `Follow-up due: ${companyName} - ${jobTitle}`,
        body: `Application to ${companyName} for ${jobTitle} has reached its scheduled follow-up date.`,
        refType: "application",
        refId: app.id,
      });
      notifiedCount++;
    }
  }

  return notifiedCount;
}
