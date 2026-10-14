// apps/api/src/errors.ts  - one error contract for the whole API (blueprint 8.1)
import type { ZodTypeAny, z } from "zod";

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details: unknown[] = []) {
    super(message);
  }
}

/** Validate untrusted input; throws ApiError(400, VALIDATION_ERROR) with readable details. */
export function parseWith<S extends ZodTypeAny>(schema: S, data: unknown): z.infer<S> {
  const r = schema.safeParse(data);
  if (r.success) return r.data;
  throw new ApiError(400, "VALIDATION_ERROR", "Request validation failed",
    r.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })));
}
