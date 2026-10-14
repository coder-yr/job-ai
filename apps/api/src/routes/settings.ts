// apps/api/src/routes/settings.ts - Settings for Mailbox (encrypted IMAP), schedule, and preferences
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { ImapFlow } from "imapflow";
import { prisma, type Prisma } from "@jobpilot/db";
import { encryptSecret, decryptSecret } from "@jobpilot/core/security/crypto.js";
import { pollAlerts, type AlertLink } from "@jobpilot/core/email/alerts.js";
import { ApiError, parseWith } from "../errors.js";

const MailboxConfigSchema = z.object({
  host: z.string().trim().min(1),
  user: z.string().trim().email(),
  appPassword: z.string().min(1),
  senders: z.array(z.string().trim().email()).min(1),
});

export const settingRoutes: FastifyPluginAsync = async (app) => {
  // GET /api/v1/settings/mailbox - get current mailbox settings (password omitted)
  app.get("/mailbox", async () => {
    const setting = await prisma.appSetting.findUnique({ where: { key: "mailbox_config" } });
    if (!setting) {
      return { data: null };
    }
    const val = setting.value as { host?: string; user?: string; senders?: string[]; encryptedPassword?: string };
    return {
      data: {
        host: val.host ?? "",
        user: val.user ?? "",
        senders: val.senders ?? [],
        hasPassword: Boolean(val.encryptedPassword),
      },
    };
  });

  // PUT /api/v1/settings/mailbox - save mailbox config (encrypts password)
  app.put("/mailbox", async (req) => {
    const body = parseWith(MailboxConfigSchema, req.body);
    const passphrase = process.env.SECRETS_PASSPHRASE || "jobpilot-default-secrets-key-2026";
    const encryptedPassword = encryptSecret(body.appPassword, passphrase);

    const setting = await prisma.appSetting.upsert({
      where: { key: "mailbox_config" },
      update: {
        value: {
          host: body.host,
          user: body.user,
          senders: body.senders,
          encryptedPassword,
        } as Prisma.InputJsonValue,
      },
      create: {
        key: "mailbox_config",
        value: {
          host: body.host,
          user: body.user,
          senders: body.senders,
          encryptedPassword,
        } as Prisma.InputJsonValue,
      },
    });

    return {
      data: {
        host: body.host,
        user: body.user,
        senders: body.senders,
        hasPassword: true,
      },
      success: true,
    };
  });

  // POST /api/v1/settings/mailbox/test - test IMAP credentials
  app.post("/mailbox/test", async () => {
    const setting = await prisma.appSetting.findUnique({ where: { key: "mailbox_config" } });
    if (!setting) throw new ApiError(400, "MAILBOX_NOT_CONFIGURED", "Mailbox has not been configured yet");

    const val = setting.value as { host: string; user: string; encryptedPassword?: string };
    if (!val.encryptedPassword) throw new ApiError(400, "MISSING_PASSWORD", "No app password stored");

    const passphrase = process.env.SECRETS_PASSPHRASE || "jobpilot-default-secrets-key-2026";
    let appPassword = "";
    try {
      appPassword = decryptSecret(val.encryptedPassword, passphrase);
    } catch {
      throw new ApiError(400, "DECRYPT_FAILED", "Could not decrypt app password (passphrase mismatch)");
    }

    const client = new ImapFlow({
      host: val.host,
      port: 993,
      secure: true,
      auth: { user: val.user, pass: appPassword },
      logger: false,
    });

    try {
      await client.connect();
      await client.logout();
      return { ok: true, message: "IMAP connection successful" };
    } catch (err) {
      throw new ApiError(502, "IMAP_LOGIN_FAILED", `IMAP authentication failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  });

  // POST /api/v1/email/poll - trigger email poll immediately
  app.post("/email/poll", async () => {
    // Check kill switch: stop all outbound fetching
    const killSwitch = await prisma.appSetting.findUnique({ where: { key: "kill_switch_enabled" } });
    if (killSwitch && (killSwitch.value as { enabled?: boolean })?.enabled) {
      return { ok: true, stopped: true, reason: "Kill switch is active - outbound fetching stopped" };
    }

    const setting = await prisma.appSetting.findUnique({ where: { key: "mailbox_config" } });
    if (!setting) throw new ApiError(400, "MAILBOX_NOT_CONFIGURED", "Mailbox not configured");

    const val = setting.value as { host: string; user: string; senders: string[]; encryptedPassword?: string };
    if (!val.encryptedPassword) throw new ApiError(400, "MISSING_PASSWORD", "No app password stored");

    const passphrase = process.env.SECRETS_PASSPHRASE || "jobpilot-default-secrets-key-2026";
    const appPassword = decryptSecret(val.encryptedPassword, passphrase);

    const since = new Date(Date.now() - 24 * 3600_000); // past 24 hours
    const results = await pollAlerts({
      host: val.host,
      user: val.user,
      appPassword,
      senders: val.senders,
      since,
    });

    return {
      ok: true,
      messagesProcessed: results.length,
      linksFound: results.flatMap((r: { links: AlertLink[] }) => r.links).length,
    };
  });

  // GET /api/v1/settings/schedule - retrieve schedule and kill switch config
  app.get("/schedule", async () => {
    const [schedSetting, killSetting] = await Promise.all([
      prisma.appSetting.findUnique({ where: { key: "schedule_config" } }),
      prisma.appSetting.findUnique({ where: { key: "kill_switch_enabled" } }),
    ]);
    const sched = (schedSetting?.value as { hour?: number; minute?: number; timezone?: string; catchUpEnabled?: boolean } | null) ?? {};
    const killSwitch = (killSetting?.value as { enabled?: boolean } | null) ?? {};
    return {
      data: {
        hour: typeof sched.hour === "number" ? sched.hour : 8,
        minute: typeof sched.minute === "number" ? sched.minute : 0,
        timezone: sched.timezone ?? "Asia/Kolkata",
        catchUpEnabled: sched.catchUpEnabled !== false,
        killSwitchEnabled: Boolean(killSwitch.enabled),
      },
    };
  });

  // PUT /api/v1/settings/schedule - update schedule and kill switch config
  app.put("/schedule", async (req) => {
    const ScheduleConfigSchema = z.object({
      hour: z.number().int().min(0).max(23).optional(),
      minute: z.number().int().min(0).max(59).optional(),
      timezone: z.string().trim().min(1).optional(),
      catchUpEnabled: z.boolean().optional(),
      killSwitchEnabled: z.boolean().optional(),
    });
    const body = parseWith(ScheduleConfigSchema, req.body);
    const current = await prisma.appSetting.findUnique({ where: { key: "schedule_config" } });
    const currentVal = (current?.value as Record<string, unknown> | null) ?? {};

    const updatedSched = {
      hour: body.hour ?? currentVal.hour ?? 8,
      minute: body.minute ?? currentVal.minute ?? 0,
      timezone: body.timezone ?? currentVal.timezone ?? "Asia/Kolkata",
      catchUpEnabled: body.catchUpEnabled !== undefined ? body.catchUpEnabled : (currentVal.catchUpEnabled !== false),
    };

    await prisma.appSetting.upsert({
      where: { key: "schedule_config" },
      update: { value: updatedSched as unknown as Prisma.InputJsonValue },
      create: { key: "schedule_config", value: updatedSched as unknown as Prisma.InputJsonValue },
    });

    if (body.killSwitchEnabled !== undefined) {
      await prisma.appSetting.upsert({
        where: { key: "kill_switch_enabled" },
        update: { value: { enabled: body.killSwitchEnabled } as unknown as Prisma.InputJsonValue },
        create: { key: "kill_switch_enabled", value: { enabled: body.killSwitchEnabled } as unknown as Prisma.InputJsonValue },
      });
    }

    const killSetting = await prisma.appSetting.findUnique({ where: { key: "kill_switch_enabled" } });
    const killSwitch = (killSetting?.value as { enabled?: boolean } | null) ?? {};

    return {
      data: {
        ...updatedSched,
        killSwitchEnabled: Boolean(killSwitch.enabled),
      },
      success: true,
    };
  });

  // POST /api/v1/settings/kill-switch - emergency toggle to stop all outbound fetching
  app.post("/kill-switch", async (req) => {
    const KillSwitchSchema = z.object({ enabled: z.boolean() });
    const body = parseWith(KillSwitchSchema, req.body);
    await prisma.appSetting.upsert({
      where: { key: "kill_switch_enabled" },
      update: { value: { enabled: body.enabled } as unknown as Prisma.InputJsonValue },
      create: { key: "kill_switch_enabled", value: { enabled: body.enabled } as unknown as Prisma.InputJsonValue },
    });
    return { success: true, enabled: body.enabled };
  });

  // GET /api/v1/settings/assist-cap - get assisted apply daily cap (default 10)
  app.get("/assist-cap", async () => {
    const setting = await prisma.appSetting.findUnique({ where: { key: "assist_daily_cap" } });
    const dailyCap = typeof setting?.value === "number" ? setting.value : 10;
    return { data: { dailyCap } };
  });

  // PUT /api/v1/settings/assist-cap - update assisted apply daily cap
  app.put("/assist-cap", async (req) => {
    const AssistCapSchema = z.object({ dailyCap: z.number().int().min(1).max(100) });
    const body = parseWith(AssistCapSchema, req.body);
    await prisma.appSetting.upsert({
      where: { key: "assist_daily_cap" },
      update: { value: body.dailyCap },
      create: { key: "assist_daily_cap", value: body.dailyCap },
    });
    return { data: { dailyCap: body.dailyCap }, success: true };
  });
};

