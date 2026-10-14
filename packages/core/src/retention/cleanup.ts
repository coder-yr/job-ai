// packages/core/src/retention/cleanup.ts - Data retention cleanup per Blueprint Section 6.5
import { prisma } from "@jobpilot/db";

export interface RetentionCleanupResult {
  deletedJobs: number;
  deletedEmails: number;
  deletedLlmCalls: number;
  deletedNotifications: number;
}

export async function runRetentionCleanup(now: Date = new Date()): Promise<RetentionCleanupResult> {
  const ninetyDaysAgo = new Date(now.getTime() - 90 * 86400_000);
  const oneEightyDaysAgo = new Date(now.getTime() - 180 * 86400_000);
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 86400_000);

  // 1. Delete closed/stale jobs older than 90 days that have no applications
  const deletedJobs = await prisma.job.deleteMany({
    where: {
      status: { in: ["CLOSED", "STALE"] },
      applications: { none: {} },
      lastSeenAt: { lt: ninetyDaysAgo },
    },
  });

  // 2. Delete email snippets older than 180 days not linked to application events
  const deletedEmails = await prisma.emailMessage.deleteMany({
    where: {
      receivedAt: { lt: oneEightyDaysAgo },
      events: { none: {} },
    },
  });

  // 3. Delete LlmCall logs older than 30 days
  const deletedLlmCalls = await prisma.llmCall.deleteMany({
    where: {
      createdAt: { lt: thirtyDaysAgo },
    },
  });

  // 4. Delete read notifications older than 30 days
  const deletedNotifications = await prisma.notification.deleteMany({
    where: {
      readAt: { not: null, lt: thirtyDaysAgo },
    },
  });

  return {
    deletedJobs: deletedJobs.count,
    deletedEmails: deletedEmails.count,
    deletedLlmCalls: deletedLlmCalls.count,
    deletedNotifications: deletedNotifications.count,
  };
}
