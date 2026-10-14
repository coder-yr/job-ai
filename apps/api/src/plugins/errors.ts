// apps/api/src/plugins/errors.ts  - maps every failure to { error: { code, message, details } }
import type { FastifyInstance } from "fastify";
import { ApiError } from "../errors.js";

const CODES: Record<number, string> = {
  400: "BAD_REQUEST", 401: "UNAUTHORIZED", 403: "FORBIDDEN", 404: "NOT_FOUND", 409: "CONFLICT",
  413: "PAYLOAD_TOO_LARGE", 415: "UNSUPPORTED_MEDIA_TYPE", 422: "UNPROCESSABLE", 429: "RATE_LIMITED",
};

export function registerErrors(app: FastifyInstance) {
  app.setErrorHandler((err: Error & { statusCode?: number }, req, reply) => {
    if (err instanceof ApiError) {
      return reply.status(err.status).send({ error: { code: err.code, message: err.message, details: err.details } });
    }
    const status = err.statusCode && err.statusCode >= 400 && err.statusCode < 600 ? err.statusCode : 500;
    if (status >= 500) {
      req.log.error({ err }, "unhandled error");           // log internals, never return them
      return reply.status(500).send({ error: { code: "INTERNAL", message: "Internal server error", details: [] } });
    }
    return reply.status(status).send({ error: { code: CODES[status] ?? "ERROR", message: err.message, details: [] } });
  });

  app.setNotFoundHandler((req, reply) =>
    reply.status(404).send({ error: { code: "NOT_FOUND", message: `Route ${req.method} ${req.url.split("?")[0]} not found`, details: [] } }));
}
