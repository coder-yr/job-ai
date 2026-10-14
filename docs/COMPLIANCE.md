# JobPilot AI - Compliance & Permitted Sources Register

**Document Version:** 1.0.0  
**Initial Review Date:** 2026-10-14  
**Review Cycle:** Quarterly (Next scheduled review: 2027-01-14)  
**Blueprint Reference:** Appendix F, Chapter 2 ("What JobPilot Does Not Do"), Chapter 12 ("Security and Privacy")

---

## 1. Quarterly Compliance & Maintenance Checklist (Blueprint Appendix F)

Perform this checklist every 90 days to maintain compliance, security, and stability:

- [ ] **Deny-List Audit:** Re-read LinkedIn, Indeed, and Naukri terms of service for any changes to automation language; confirm no code in JobPilot touches those domains directly.
- [ ] **JobSource Terms & Endpoint Review:** For each enabled `JobSource`, re-open its API documentation; verify that the endpoint remains public, unauthenticated, and candidate-facing. Update `termsNote` and `lastReviewed` in the database.
- [ ] **Robots.txt Verification:** For each configured JSON-LD career page, manually re-fetch `/robots.txt` and confirm the job listing path remains allowed.
- [ ] **User-Agent String Check:** Verify that the `JOBPILOT_UA` environment variable contains an honest name and an active, working contact email.
- [ ] **Dependency Audit:** Run `npm audit --omit=dev`; review all dependencies, document exceptions, and apply patches one-by-one with green test suites.
- [ ] **Evaluation Benchmark:** Run `npm run eval:rank` and `npm run eval:parse`; compare precision and F1 against previous benchmarks.
- [ ] **Disaster Recovery Exercise:** Perform a full backup restore into a fresh scratch database using `scripts/restore.ps1`.
- [ ] **Audit Trail Review:** Inspect `AuditLog` table for unexpected actions or unknown IP access; inspect `AppSetting` for unrecognized source configurations.
- [ ] **Data Retention & Encryption:** Trigger data retention cleanup; verify BitLocker full-disk encryption remains enabled on host machine.
- [ ] **Truthfulness Spot-Audit:** Spot-audit three sent job applications against your actual resume and experience to verify zero hallucinations.

---

## 2. Permitted Job Sources Register

JobPilot AI interfaces only with publicly documented, candidate-facing APIs or candidate-owned mailboxes. It strictly enforces a minimum polling interval (`minIntervalMin`, default 360 min) and exponential back-off.

| Source Name | Kind | Method | Rate Limit & Polling | Terms Note (`termsNote`) | Last Reviewed |
|---|---|---|---|---|---|
| **Greenhouse ATS** | `ATS_GREENHOUSE` | HTTP GET: `https://boards-api.greenhouse.io/v1/boards/{boardToken}/jobs?content=true` | >= 2 s between calls; min 6 h interval | Public unauthenticated candidate API documented by Greenhouse. Permitted for job-search. | 2026-10-14 |
| **Lever ATS** | `ATS_LEVER` | HTTP GET: `https://api.lever.co/v0/postings/{site}?mode=json` | >= 2 s between calls; min 6 h interval | Public unauthenticated candidate postings API designed for external job listing. | 2026-10-14 |
| **Ashby ATS** | `ATS_ASHBY` | HTTP POST/GET: `https://api.ashbyhq.com/posting-api/job-board/{boardToken}` | >= 2 s between calls; min 6 h interval | Public unauthenticated job board API provided for candidate access. | 2026-10-14 |
| **SmartRecruiters ATS** | `ATS_SMARTRECRUITERS` | HTTP GET: `https://api.smartrecruiters.com/v1/companies/{company}/postings` | >= 2 s between calls; min 6 h interval | Public candidate job postings API. Permitted per terms. | 2026-10-14 |
| **Direct Career JSON-LD** | `CAREER_PAGE_JSONLD` | Static HTML fetch with robots.txt check; schema.org/JobPosting extraction | >= 5 s per domain; fail-closed on robots.txt disallow | Permitted: respects robots.txt fail-closed, polite User-Agent with contact email, no JS execution. | 2026-10-14 |
| **User Email Job Alerts** | `EMAIL_ALERT` | Read-only IMAP (port 993, TLS) with user's encrypted app password | Polled every 30 min | Candidate's own mailbox containing alerts the user explicitly subscribed to. No portal scraping. | 2026-10-14 |
| **Manual URL Import** | `MANUAL` | User clicks "Import by URL" in Web UI | Single on-demand request with SSRF guard | Candidate-initiated manual import. Bounded and protected against private IP ranges. | 2026-10-14 |

---

## 3. Explicit Portal Deny-List

The following portals are strictly excluded from automated fetching, crawling, or browser form-filling:

| Portal | Status | Enforced Guardrail | Justification |
|---|---|---|---|
| **LinkedIn** (`linkedin.com`) | **DENIED** | `assistedFill.ts: FORBIDDEN regex` + URL guards | Terms of Service strictly forbid automation/scraping. Account restriction risk damages career search. |
| **Indeed** (`indeed.com`) | **DENIED** | `assistedFill.ts: FORBIDDEN regex` + URL guards | Terms of Service prohibit robotic/automated queries. Cloudflare blocks and account penalties. |
| **Naukri** (`naukri.com`) | **DENIED** | `assistedFill.ts: FORBIDDEN regex` + URL guards | Terms of Service disallow automated tools. IP blocking and account deactivation risk. |

### How LinkedIn / Indeed / Naukri Alerts Are Handled Safely
Rather than automating logins or scraping portals, JobPilot relies exclusively on **first-party email alerts**:
1. You subscribe to job alerts inside your personal LinkedIn, Indeed, or Naukri accounts.
2. The portals email notifications to your inbox.
3. JobPilot reads those emails over read-only IMAP using a dedicated app password (passphrase encrypted with AES-256-GCM).
4. Job links are extracted locally from your email text.
5. You click the link to view the role and manually decide whether to import the description.

---

## 4. Automation & Assisted Fill Guardrails

1. **Headed Browser Only:** Playwright always launches in visible (non-headless) mode with slow-motion delay (`slowMo: 120ms`) so the human operator can see every action.
2. **Strict Host Allow-List:** `boards.greenhouse.io`, `job-boards.greenhouse.io`, `jobs.lever.co`, `jobs.ashbyhq.com`. All other hosts are rejected.
3. **Never Click Submit:** Verified by automated unit test (`tests/tracker.test.ts`). The tool pre-fills basic contact fields and attaches your resume, then stops.
4. **CAPTCHA = Human Checkpoint:** Detection of reCAPTCHA or hCaptcha immediately logs a checkpoint and yields control to the human operator.
5. **Mandatory Human Approval Gate:** Export of tailored resumes or cover letters returns HTTP `409 NOT_APPROVED` until you review the diff and explicitly approve the document. Any subsequent edits clear approval.
6. **Kill Switch:** Outbound fetching can be disabled instantly from the Settings UI or via `POST /api/v1/settings/kill-switch`.

---

## 5. Security & Privacy Audit Trail

- **Loopback Enforcement:** Fastify binds strictly to `127.0.0.1`. Inbound external requests are rejected.
- **Authentication:** Per-installation random 32+ byte token validated via `crypto.timingSafeEqual`.
- **SSRF Guard:** `assertPublicHttpUrl` verifies URL scheme (http/https), validates domain DNS resolution, and rejects all private, multicast, loopback, and cloud metadata IP ranges (`169.254.169.254`, `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `127.0.0.0/8`, `::1`).
- **Audit Logging:** Every assisted fill attempt, status change, and setting update is permanently recorded in `AuditLog`.
- **No Over-Sharing:** Loggers record only IDs, counts, and durations. Document bodies, resumes, and prompts are never printed to log files.
