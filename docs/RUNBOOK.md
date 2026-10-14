# JobPilot AI - Operational Runbook

**Version:** 1.0.0  
**Design Reference:** `docs/JobPilot_AI_Blueprint.pdf` (Section 11.6, Chapters 12 & 14)  
**Philosophy:** Local-first, zero recurring cost, human-in-the-loop.

---

## 1. Quick Failure Triage (Blueprint Section 11.6)

| Situation | System Behaviour | Your Action |
|---|---|---|
| **PC asleep at 08:00** | Catch-up run triggered automatically at next start (if last successful run was over 20 hours ago). | None required. |
| **One source returns 429/5xx** | Exponential back-off, record error, continue with remaining sources. In-app notification emitted if source fails 3 consecutive days. | Check the source website/status or lengthen `minIntervalMin` in Settings. |
| **Ollama stopped or unreachable** | UI displays amber health banner; worker skips LLM tasks and retries when Ollama returns. Rule-based skill extraction serves as fallback. | Start Ollama (`ollama serve` or launch from Start menu). Verify `ollama list` contains required models. |
| **Alert e-mail format changed** | Link extractor finds 0 links; emits notification: *"Alert parsing returned nothing"*. | Update the `JOB_LINK` regex pattern in Settings or inspect received email HTML. |
| **Source terms or robots.txt changed** | Quarterly compliance review detects change; adapter fail-closed on disallow. | Disable the source in Settings. |

---

## 2. Component Health and Diagnostics

### 2.1 Health Check Endpoints
- **API Health:** `GET http://127.0.0.1:4000/api/v1/health` (no auth required)
  - Returns: `{ "status": "ok" | "degraded", "db": "ok" | "down", "ollama": "ok" | "down", "missingModels": [] }`
- **Environment Verification:**
  ```powershell
  npm run check:env
  ```
  Tests Node.js >= 22.12, `.env` API_TOKEN length (>= 32 chars), Ollama connectivity, and PostgreSQL connection (`SELECT 1`).

### 2.2 System Ports & Bindings
All services are strictly bound to local loopback (`127.0.0.1`) to prevent external network exposure:
- **API Server:** `127.0.0.1:4000` (Fastify, required header: `x-jobpilot-token`)
- **Web UI:** `127.0.0.1:5173` (Vite / React dev server)
- **PostgreSQL:** Local (`127.0.0.1:5432`) or Supabase pooler over TLS
- **Ollama:** `127.0.0.1:11434`

---

## 3. Incident Scenarios & Troubleshooting

### Scenario A: Ollama Service Fails or Model Times Out
- **Symptom:** UI displays `"Ollama is down"` banner. LLM extraction or document tailoring times out.
- **Root Causes:**
  1. Ollama service not running.
  2. GPU VRAM contention: If high-VRAM applications (games, 3D renderers, or GPU-heavy browsers) are running simultaneously, an RTX 4050 (6 GB VRAM) cannot hold the full 7B model context, causing layers to spill into system RAM over PCIe.
- **Remediation:**
  1. Launch Ollama:
     ```powershell
     ollama serve
     ```
  2. Verify installed models:
     ```powershell
     ollama list
     # Expected: nomic-embed-text:latest, qwen2.5:7b-instruct (or qwen2.5:3b)
     ```
  3. If VRAM is constrained, switch `OLLAMA_CHAT_MODEL` in `.env` to `qwen2.5:3b`. The 3B model fits in under 2 GB of VRAM and runs without memory thrashing.

---

### Scenario B: Database Connection or TLS Warning
- **Symptom:** API logs `ECONNREFUSED` or Node emits `Setting NODE_TLS_REJECT_UNAUTHORIZED='0' makes TLS connections insecure`.
- **Root Causes:**
  1. PostgreSQL service stopped.
  2. Remote Supabase pooler requires SSL certificate negotiation (`sslmode=require`).
- **Remediation:**
  1. If running local Docker PostgreSQL:
     ```powershell
     docker compose up -d
     ```
  2. For Supabase or cloud PostgreSQL, verify network access and ensure `DATABASE_URL` in `.env` includes SSL query parameters. Test with:
     ```powershell
     npm run check:env
     ```

---

### Scenario C: Assisted Apply Form Stops at CAPTCHA
- **Symptom:** Playwright window pauses on an ATS application form and logs `CAPTCHA present - please solve it yourself`.
- **Expected Behaviour:** **This is by design.** JobPilot AI strictly adheres to zero-evasion ethics. It never bypasses CAPTCHAs, never spoofs human biometric fingerprints, and never clicks Submit.
- **Remediation:**
  1. Solve the CAPTCHA in the visible browser window.
  2. Review the pre-filled fields (Name, Email, Phone, Resume upload).
  3. Answer any employer-specific legal attestations yourself.
  4. Click Submit manually and close the browser window.

---

### Scenario D: Deny-List Blocks Job URL
- **Symptom:** Attempting assisted apply on a link fails with `Automation on LinkedIn/Indeed/Naukri is forbidden by design`.
- **Expected Behaviour:** **This is intentional.** To safeguard your professional accounts against bans, JobPilot completely disallows automated interaction with these aggregator portals.
- **Remediation:**
  - Apply to the posting directly in your standard browser.
  - Track the application status manually or by pasting the employer's direct ATS URL.

---

### Scenario E: Emergency Kill Switch
- **Symptom:** A remote source changes or misbehaves, or you need all outbound requests halted immediately.
- **Action:**
  1. In the Web UI, navigate to **Settings** > click **Enable Kill Switch**.
  2. Alternatively, via API:
     ```bash
     curl -X POST http://127.0.0.1:4000/api/v1/settings/kill-switch \
          -H "x-jobpilot-token: <YOUR_API_TOKEN>" \
          -H "Content-Type: application/json" \
          -d '{"enabled": true}'
     ```
  3. When enabled, all discovery runs, email polling, and outbound network fetches immediately abort without making external requests.

---

## 4. Maintenance & Operations

### 4.1 Daily Workflow
1. **08:00 Scheduled Run:** Worker discovers new jobs, prefilters early-career roles, normalizes, embeds, and computes matches.
2. **Review:** Open `http://localhost:5173` to see new matches scored >= 60.
3. **Draft & Approve:** Click "Tailor Resume" for target roles. Review guard output. Human approval is mandatory before PDF/DOCX export.
4. **Apply:** Click "Assisted Apply" for Greenhouse/Lever/Ashby postings. Review and submit manually.

### 4.2 Backup Runbook
Run every week or before migrations:
```powershell
powershell -ExecutionPolicy Bypass -File scripts/backup.ps1
```
- Creates an encrypted dump of PostgreSQL schema & data.
- Archives resume PDFs, tailored documents, and settings from `DATA_DIR`.
- Saves to `data/backups/backup_<timestamp>.zip`.

### 4.3 Restore Runbook
To restore a backup into a fresh database:
```powershell
powershell -ExecutionPolicy Bypass -File scripts/restore.ps1 -BackupPath "data/backups/backup_<timestamp>.zip"
```
Verify restored state:
```powershell
npm run verify
```

### 4.4 Data Retention Cleanup
Automated nightly retention job (scheduled at 02:00 in `pg-boss`):
- Purges raw email bodies older than 14 days (retains only snippets).
- Purges stale search runs and raw HTTP error logs older than 90 days.
- Retains all applications, documents, notes, and audits permanently unless manually deleted.
- Manual trigger in Web UI: **Settings** > **Run Retention Purge**.

### 4.5 Complete Reset ("Delete Everything")
If you wish to completely wipe your personal data from the system:
1. In Web UI: **Settings** > **Danger Zone** > **Delete All Data**.
2. Requires typing the confirmation phrase `DELETE ALL MY DATA`.
3. Truncates all profile tables, resumes, applications, documents, matches, and logs, and purges all files from `DATA_DIR`.
