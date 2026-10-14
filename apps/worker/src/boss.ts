// apps/worker/src/boss.ts  - Postgres-backed queue + cron (pg-boss 12, Node >= 22.12). No Redis.
import { PgBoss } from "pg-boss";
import { prisma } from "@jobpilot/db";
import { processJob } from "./jobs/process.js";

export const Q = {
  discover: "discover.run",        // fan-out over enabled sources
  process: "jobs.process",         // normalise -> extract -> embed -> score
  email: "email.poll",             // mailbox poller for job alerts
  followups: "followups.check",    // daily check for application follow-up deadlines
  retention: "retention.run",      // Section 6.5 data retention cleanup
} as const;

export interface CatchUpSender {
  send(queue: string, data: object, options?: object): Promise<string | null>;
}

export async function checkAndEnqueueCatchUp(
  boss: CatchUpSender,
  now: Date = new Date(),
): Promise<boolean> {
  const schedSetting = await prisma.appSetting.findUnique({ where: { key: "schedule_config" } });
  const sched = (schedSetting?.value as { catchUpEnabled?: boolean } | null) ?? {};
  if (sched.catchUpEnabled === false) return false;

  const last = await prisma.searchRun.findFirst({
    where: { status: { in: ["SUCCEEDED", "PARTIAL"] } },
    orderBy: { finishedAt: "desc" },
  });

  const twentyHoursMs = 20 * 3600_000;
  if (!last?.finishedAt || now.getTime() - last.finishedAt.getTime() > twentyHoursMs) {
    await boss.send(Q.discover, { trigger: "CATCHUP" }, { singletonKey: "catchup", singletonSeconds: 3600 });
    return true;
  }
  return false;
}

export async function startQueues(options?: {
  boss?: PgBoss;
  connectionString?: string;
  skipCatchUp?: boolean;
}) {
  const url = options?.connectionString ?? process.env.DATABASE_URL!;
  const isRemote = Boolean(url && (url.includes("supabase") || url.includes("sslmode=")));
  const boss = options?.boss ?? new PgBoss({
    connectionString: url,
    ssl: isRemote ? { rejectUnauthorized: false } : undefined,
  });
  boss.on("error", (e) => console.error("[pg-boss]", e));
  if (!options?.boss) {
    await boss.start();
  }

  for (const name of Object.values(Q)) {
    await boss.createQueue(name, { retryLimit: 2, retryDelay: 60, retryBackoff: true });
  }

  // Load schedule configuration (or defaults: 08:00 Asia/Kolkata)
  const schedSetting = await prisma.appSetting.findUnique({ where: { key: "schedule_config" } });
  const sched = (schedSetting?.value as {
    hour?: number;
    minute?: number;
    timezone?: string;
    catchUpEnabled?: boolean;
  } | null) ?? {};

  const tz = sched.timezone || "Asia/Kolkata";
  const hour = typeof sched.hour === "number" ? sched.hour : 8;
  const minute = typeof sched.minute === "number" ? sched.minute : 0;
  const cronTime = `${minute} ${hour} * * *`;

  // Daily search, mailbox poll every 30m, followups at 09:00, retention at 02:00
  await boss.schedule(Q.discover, cronTime, { trigger: "SCHEDULED" }, { tz });
  await boss.schedule(Q.email, "*/30 * * * *", {}, { tz });
  await boss.schedule(Q.followups, "0 9 * * *", {}, { tz });
  await boss.schedule(Q.retention, "0 2 * * *", {}, { tz });

  // Laptops sleep. If the last good run is older than 20 h, run a CATCHUP now.
  if (!options?.skipCatchUp) {
    await checkAndEnqueueCatchUp(boss);
  }

  // Handlers receive an ARRAY of jobs in pg-boss >= 10 (default batchSize 1).
  // 1. Discover handler
  await boss.work<{ trigger: "SCHEDULED" | "MANUAL" | "CATCHUP" }>(Q.discover, async ([job]) => {
    const { runDiscovery } = await import("./jobs/discover.js");
    const { newJobIds } = await runDiscovery(job!.data.trigger);
    const resume = await prisma.resume.findFirst({ where: { isPrimary: true } });
    if (!resume) return;                                    // nothing to match against yet
    for (const jobId of newJobIds) {
      await boss.send(Q.process, { jobId, profileId: resume.profileId, resumeId: resume.id },
                      { singletonKey: jobId });             // never process the same job twice at once
    }
  });

  // 2. Process job handler
  await boss.work<{ jobId: string; profileId: string; resumeId: string }>(Q.process, async ([job]) => {
    const { jobId, profileId, resumeId } = job!.data;
    await processJob(jobId, profileId, resumeId, true);
  });

  // 3. Email poll handler
  await boss.work(Q.email, async () => {
    const killSwitch = await prisma.appSetting.findUnique({ where: { key: "kill_switch_enabled" } });
    if (killSwitch && (killSwitch.value as { enabled?: boolean })?.enabled) return;

    const setting = await prisma.appSetting.findUnique({ where: { key: "mailbox_config" } });
    if (!setting) return;
    const val = setting.value as { host?: string; user?: string; senders?: string[]; encryptedPassword?: string };
    if (!val?.host || !val?.user || !val?.encryptedPassword || !val?.senders?.length) return;

    const passphrase = process.env.SECRETS_PASSPHRASE || "jobpilot-default-secrets-key-2026";
    let appPassword = "";
    try {
      const { decryptSecret } = await import("@jobpilot/core/security/crypto.js");
      appPassword = decryptSecret(val.encryptedPassword, passphrase);
    } catch {
      return;
    }

    const { pollAlerts } = await import("./email/alerts.js");
    await pollAlerts({
      host: val.host,
      user: val.user,
      appPassword,
      senders: val.senders,
      since: new Date(Date.now() - 24 * 3600_000),
    });
  });

  // 4. Follow-up checker handler
  await boss.work(Q.followups, async () => {
    const { checkFollowUps } = await import("@jobpilot/core/followups/checker.js");
    await checkFollowUps();
  });

  // 5. Data retention cleanup handler
  await boss.work(Q.retention, async () => {
    const { runRetentionCleanup } = await import("@jobpilot/core/retention/cleanup.js");
    await runRetentionCleanup();
  });

  return boss;
}
