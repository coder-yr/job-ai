# JobPilot AI (v1.0.0)

> **Local-first, zero-cost, human-in-the-loop job-search assistant.**  
> Built for engineers entering the tech industry. Preserves privacy, adheres strictly to platform terms of service, and keeps the human in complete control of every application.

Comprehensive design & architecture blueprint: [`docs/JobPilot_AI_Blueprint.pdf`](file:///f:/yash/projects/job_ai/docs/JobPilot_AI_Blueprint.pdf)

---

## Features

- **Local Discovery Engine:** Fetches jobs only from permitted, public candidate-facing ATS endpoints (Greenhouse, Lever, Ashby, SmartRecruiters) and direct career page JSON-LD with strict robots.txt adherence.
- **Privacy & Deny-Lists:** Strictly forbids automated web scraping or login automation on LinkedIn, Indeed, and Naukri. Safely digests your personal job alert emails over read-only IMAP.
- **Deterministic & LLM Matching:** Multi-stage ranking combining title match, skill overlap, experience bounds, embedding cosine similarity (`nomic-embed-text`), and an optional bounded LLM judge.
- **Truthfulness Guard:** Tailored resumes cannot invent skills, exaggerate numbers, or fabricate bullets. Every generated claim links to your primary resume provenance.
- **Mandatory Approval Gates:** Documents cannot be exported to PDF or DOCX without explicit human approval. Any subsequent edit immediately resets approval status.
- **Human-in-the-Loop Assisted Apply:** Headed browser assist that pre-fills standard contact details and attaches your resume on employer ATS pages. **Never clicks Submit and yields at all CAPTCHAs.**
- **Robust Background Automation:** Postgres-backed queues with `pg-boss` 12, catch-up scheduling for sleeping laptops, and desktop/SSE notifications.
- **Security by Default:** Loopback-only binding (`127.0.0.1`), timing-safe API token authentication, AES-256-GCM secrets encryption, SSRF protection, and emergency kill switch.

---

## Prerequisites

| Component | Requirement | Check Command |
|---|---|---|
| **Operating System** | Windows 10/11 (or Linux / macOS) | `cmd.exe /c ver` |
| **Node.js** | `>= 22.12.0` (LTS recommended) | `node --version` |
| **PostgreSQL** | `16` or `17` (Local Docker or Supabase) | `psql --version` |
| **Ollama** | Local LLM runtime | `ollama --version` |
| **Local Models** | `qwen2.5:7b-instruct` (or `qwen2.5:3b`) & `nomic-embed-text` | `ollama list` |

---

## 1. Installation

### Step 1: Clone and install dependencies
```powershell
git clone <repo-url> job_ai
cd job_ai
npm ci
```

### Step 2: Configure environment variables
Copy `.env.example` to `.env`:
```powershell
Copy-Item .env.example .env
```
Update `.env` with your settings:
- `DATABASE_URL`: Connection string for PostgreSQL (e.g. `postgresql://user:pass@localhost:5432/jobpilot`).
- `API_TOKEN`: 32+ character random secret (generate via `node -e "console.log(crypto.randomBytes(32).toString('hex'))"`).
- `OLLAMA_CHAT_MODEL`: `qwen2.5:7b-instruct` (or `qwen2.5:3b` for systems with <6 GB free VRAM).
- `OLLAMA_EMBED_MODEL`: `nomic-embed-text`.

### Step 3: Verify toolchain
```powershell
npm run check:env
```
All checks must pass.

### Step 4: Setup Database & Seed
```powershell
npm run db:generate
npm run db:migrate -- --name init
npm run db:seed
```

### Step 5: Verify Build & Tests
```powershell
npm run verify
```
Runs full TypeScript typecheck and Vitest test suite across all packages.

---

## 2. Running JobPilot

### Development Mode (All Services)
Runs the API server (`:4000`), the background worker, and the React Web UI (`:5173`) concurrently:
```powershell
npm run dev
```
Open **`http://localhost:5173`** in your browser.

### Headless Daily Runner (API + Worker)
```powershell
npm run start
```

### Windows Scheduled Task (Automatic 08:00 Run)
To install JobPilot as a daily scheduled task on Windows:
```powershell
powershell -ExecutionPolicy Bypass -File scripts/install-task.ps1
```
To remove the task:
```powershell
powershell -ExecutionPolicy Bypass -File scripts/uninstall-task.ps1
```

---

## 3. Backup and Disaster Recovery

### Creating a Backup
JobPilot includes an automated PowerShell script that takes a complete snapshot of your database and stored documents:
```powershell
powershell -ExecutionPolicy Bypass -File scripts/backup.ps1
```
- Archives all PostgreSQL tables into an encrypted SQL dump.
- Copies uploaded resumes, tailored documents, and SQLite/data files into `data/backups/backup_<timestamp>.zip`.
- Calculates SHA-256 integrity checksums.

### Restoring from Backup
To restore data into a clean database:
```powershell
powershell -ExecutionPolicy Bypass -File scripts/restore.ps1 -BackupPath "data/backups/backup_<timestamp>.zip"
```

---

## 4. Upgrade Guide

When updating to a newer release:
1. Stop running processes (`Ctrl+C` or stop the Windows Task).
2. Create a safety backup:
   ```powershell
   powershell -ExecutionPolicy Bypass -File scripts/backup.ps1
   ```
3. Pull the latest code and install dependencies:
   ```powershell
   git pull
   npm ci
   ```
4. Apply any new Prisma database migrations:
   ```powershell
   npm run db:deploy
   ```
5. Run verification tests:
   ```powershell
   npm run verify
   ```
6. Restart services (`npm run start` or `npm run dev`).

---

## 5. Security & Legal Compliance

- **No Unauthorized Scraping:** JobPilot enforces a strict domain deny-list (`linkedin.com`, `indeed.com`, `naukri.com`) within all automation modules.
- **Human In The Loop:** Assisted Apply halts at all CAPTCHAs and never clicks Submit. All document exports require explicit candidate approval.
- **Quarterly Compliance Checklist:** See [`docs/COMPLIANCE.md`](file:///f:/yash/projects/job_ai/docs/COMPLIANCE.md).
- **Incident & Failure Triage:** See [`docs/RUNBOOK.md`](file:///f:/yash/projects/job_ai/docs/RUNBOOK.md).
- **Phase Architecture Notes & Deviations:** See [`docs/PHASE_NOTES.md`](file:///f:/yash/projects/job_ai/docs/PHASE_NOTES.md).
