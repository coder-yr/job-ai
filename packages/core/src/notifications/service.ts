// packages/core/src/notifications/service.ts - Notification management service
import { prisma } from "@jobpilot/db";
import { notifyDesktop } from "./desktop.js";
import { sseBus } from "./events.js";

export interface CreateNotificationInput {
  kind: "new_matches" | "followup_due" | "run_failed" | "source_failing" | "document_ready" | string;
  title: string;
  body: string;
  refType?: string;
  refId?: string;
  sendDesktop?: boolean;
}

export async function createNotification(input: CreateNotificationInput) {
  const notif = await prisma.notification.create({
    data: {
      kind: input.kind,
      title: input.title,
      body: input.body,
      refType: input.refType,
      refId: input.refId,
    },
  });

  if (input.sendDesktop !== false) {
    notifyDesktop({
      title: input.title,
      message: input.body,
    });
  }

  sseBus.broadcast("notification.new", notif);
  return notif;
}

export async function getNotifications(options: { unreadOnly?: boolean; limit?: number } = {}) {
  const { unreadOnly = false, limit = 50 } = options;
  const where = unreadOnly ? { readAt: null } : {};
  const [items, unreadCount] = await Promise.all([
    prisma.notification.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit,
    }),
    prisma.notification.count({ where: { readAt: null } }),
  ]);
  return { items, unreadCount };
}

export async function markNotificationRead(id: string) {
  return prisma.notification.update({
    where: { id },
    data: { readAt: new Date() },
  });
}

export async function markAllNotificationsRead() {
  const res = await prisma.notification.updateMany({
    where: { readAt: null },
    data: { readAt: new Date() },
  });
  return res.count;
}
