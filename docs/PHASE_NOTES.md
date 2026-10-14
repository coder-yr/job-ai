# JobPilot AI - Phase Notes & Architecture Deviations

## Summary of Phases
- **Phase 0:** Environment & repository scaffolding (TypeScript, Vitest, linting, `.env`).
- **Phase 1:** Database (Prisma 7 + PostgreSQL) and Fastify API skeleton with timingSafeEqual auth.
- **Phase 2:** Resume ingestion, PDF/DOCX text extraction, schema-validated LLM parse, and bullet provenance.
- **Phase 3:** Job discovery engine with adapters (Greenhouse, Lever, Ashby, SmartRecruiters, JSON-LD), robots.txt adherence, deduplication, and kill switch.
- **Phase 4:** Deterministic 5-dimension scoring, skill catalog aliases, embedding cosine similarity, and bounded LLM judge.
- **Phase 5:** Tailored document generation, truthfulness guard (zero invented facts), and mandatory human approval gate.
- **Phase 6:** Application state machine tracker, Playwright assisted apply (no auto-submit, CAPTCHA yielding), and portal deny-list.
- **Phase 7:** Automation background worker (`pg-boss` 12), catch-up scheduler for sleeping machines, and SSE real-time notifications.
- **Phase 8:** Security hardening, AES-256-GCM secrets encryption, SSRF protection, PowerShell backup/restore runbooks, and retention purges.
- **Phase 9:** Hardening and release v1.0.0, operational runbook (`docs/RUNBOOK.md`), compliance register (`docs/COMPLIANCE.md`), and performance optimizations.

---

## Deviations from the Blueprint (and Rationale)

1. **TypeScript pinned to 5.9.3:** `npm i typescript` originally resolved 7.x, which deprecated `baseUrl`; the blueprint was authored and verified against 5.9.
2. **Repo-root `.env` loader (`packages/core/src/config/env.ts`):** In npm monorepo workspaces, scripts run with the current working directory set to individual package folders. The custom `loadEnv()` walks up directory trees to reliably load the root `.env`.
3. **`server.ts` split into `app.ts` (buildApp) + `server.ts`:** Enables integration tests to exercise routes with Fastify's in-memory `app.inject()` without needing a live listening port.
4. **Auth fails closed:** The original blueprint hook evaluated requests as valid when `API_TOKEN` was unset and the header was absent (`undefined !== undefined` was false). The hardened hook enforces that `API_TOKEN` must be at least 32 characters at startup and validates tokens via `crypto.timingSafeEqual`.
5. **Host-header validation added in Phase 1:** Blueprint scheduled DNS rebinding defense for Phase 8; implemented in Phase 1 to prevent unauthorized browser-based loopback calls.
6. **Unified Error Contract (`parseWith`):** Route input validation errors across all endpoints consistently return structured JSON with `{ error: { code: "VALIDATION_ERROR", details: ... } }`.
7. **Prisma 7 Driver Adapter & Remote Supabase TLS:** Uses `@prisma/adapter-pg` with `pg.Pool` configuring SSL `rejectUnauthorized: false` for pooled cloud databases (e.g. Supabase pooler over port 5432) while supporting local unencrypted PostgreSQL.
8. **Graceful Rule-Based LLM Fallback:** If Ollama is offline or experiences VRAM timeouts, job discovery and skill extraction seamlessly fall back to deterministic regex alias matching and rule-based ATS checks rather than crashing the queue worker.
9. **pg-boss Queue Batching:** `pg-boss` >= 10 delivers jobs to worker handlers as an array (`[job]`). The handlers unwrap array parameters to maintain compatibility.
