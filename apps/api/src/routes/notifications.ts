// apps/api/src/routes/notifications.ts - Notifications API and SSE /events endpoint
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import {
  getNotifications,
  markNotificationRead,
  markAllNotificationsRead,
} from "@jobpilot/core/notifications/service.js";
import { sseBus, type SseEvent } from "@jobpilot/core/notifications/events.js";
import { parseWith } from "../errors.js";

const GetNotificationsQuerySchema = z.object({
  unreadOnly: z
    .string()
    .optional()
    .transform((val) => val === "true" || val === "1"),
  limit: z
    .string()
    .optional()
    .transform((val) => (val ? parseInt(val, 10) : 50)),
});

export const notificationRoutes: FastifyPluginAsync = async (app) => {
  // GET /api/v1/notifications
  app.get("/", async (req) => {
    const query = parseWith(GetNotificationsQuerySchema, req.query);
    const { items, unreadCount } = await getNotifications({
      unreadOnly: query.unreadOnly,
      limit: query.limit,
    });
    return { data: items, unreadCount };
  });

  // PATCH /api/v1/notifications/:id/read
  app.patch("/:id/read", async (req) => {
    const { id } = req.params as { id: string };
    const updated = await markNotificationRead(id);
    return { data: updated };
  });

  // POST /api/v1/notifications/read-all
  app.post("/read-all", async () => {
    const count = await markAllNotificationsRead();
    return { ok: true, count };
  });
};

export const eventRoutes: FastifyPluginAsync = async (app) => {
  // GET /events and GET /api/v1/events - Server-Sent Events stream
  app.get("/events", async (req, reply) => {
    reply.raw.setHeader("Content-Type", "text/event-stream");
    reply.raw.setHeader("Cache-Control", "no-cache, no-transform");
    reply.raw.setHeader("Connection", "keep-alive");
    reply.raw.setHeader("Access-Control-Allow-Origin", "*");
    reply.raw.flushHeaders?.();

    // Initial message
    reply.raw.write(`: connected\n\n`);

    const onEvent = (evt: SseEvent) => {
      try {
        reply.raw.write(`event: ${evt.type}\ndata: ${JSON.stringify(evt.data)}\n\n`);
      } catch {
        // stream may be closed
      }
    };

    sseBus.on("sse", onEvent);

    const heartbeat = setInterval(() => {
      try {
        reply.raw.write(`: ping\n\n`);
      } catch {
        // stream may be closed
      }
    }, 20_000);

    req.raw.on("close", () => {
      clearInterval(heartbeat);
      sseBus.off("sse", onEvent);
    });
  });
};
