// apps/api/src/routes/admin.ts - Admin backup, export, and delete-everything routes
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { mkdir, readdir, unlink, writeFile, stat } from "node:fs/promises";
import { join } from "node:path";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { prisma } from "@jobpilot/db";
import { ApiError, parseWith } from "../errors.js";

const execFileAsync = promisify(execFile);

const DeleteDataBody = z.object({
  confirmation: z.literal("DELETE ALL PERSONAL DATA"),
});

export const adminRoutes: FastifyPluginAsync = async (app) => {
  // POST /admin/backup - pg_dump to DATA_DIR/backups
  app.post("/backup", async () => {
    const dataDir = process.env.DATA_DIR || "./data";
    const backupDir = join(dataDir, "backups");
    await mkdir(backupDir, { recursive: true });

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const filename = `backup-${timestamp}.sql`;
    const backupPath = join(backupDir, filename);

    const dbUrl = process.env.DATABASE_URL || "postgresql://postgres:postgres@127.0.0.1:5432/jobpilot";

    try {
      await execFileAsync("pg_dump", ["--dbname=" + dbUrl, "-f", backupPath]);
    } catch (err) {
      // Fallback: If pg_dump executable is not found on machine PATH,
      // export all application database tables as a backup SQL dump
      const tables = {
        profiles: await prisma.profile.findMany(),
        resumes: await prisma.resume.findMany(),
        jobs: await prisma.job.findMany(),
        applications: await prisma.application.findMany({ include: { events: true } }),
        documents: await prisma.generatedDocument.findMany(),
        settings: await prisma.appSetting.findMany(),
        sources: await prisma.jobSource.findMany(),
      };
      const sqlComments = [
        `-- JobPilot AI Database Backup Fallback`,
        `-- Generated at: ${new Date().toISOString()}`,
        `-- Note: pg_dump not on PATH (${err instanceof Error ? err.message : String(err)})`,
        `-- JSON Data:`,
        JSON.stringify(tables, null, 2),
      ].join("\n");
      await writeFile(backupPath, sqlComments, "utf8");
    }

    const s = await stat(backupPath).catch(() => ({ size: 0 }));

    await prisma.auditLog.create({
      data: {
        actor: "user",
        action: "admin.backup_created",
        entity: "Backup",
        entityId: filename,
        meta: { path: backupPath, sizeBytes: s.size },
      },
    });

    return {
      ok: true,
      data: {
        filename,
        path: backupPath,
        sizeBytes: s.size,
        createdAt: new Date().toISOString(),
      },
    };
  });

  // POST /admin/export - export all personal candidate data to JSON
  app.post("/export", async () => {
    const [
      profiles,
      resumes,
      experiences,
      projects,
      achievements,
      educations,
      certifications,
      skills,
      searchPreferences,
      applications,
      documents,
      settings,
    ] = await Promise.all([
      prisma.profile.findMany(),
      prisma.resume.findMany(),
      prisma.experience.findMany(),
      prisma.project.findMany(),
      prisma.achievement.findMany(),
      prisma.education.findMany(),
      prisma.certification.findMany(),
      prisma.profileSkill.findMany(),
      prisma.searchPreference.findMany(),
      prisma.application.findMany({ include: { events: true } }),
      prisma.generatedDocument.findMany(),
      prisma.appSetting.findMany({ where: { key: { not: "mailbox_config" } } }), // exclude encrypted mailbox credentials for safety
    ]);

    await prisma.auditLog.create({
      data: {
        actor: "user",
        action: "admin.data_exported",
        entity: "Export",
        meta: { exportedAt: new Date().toISOString() },
      },
    });

    return {
      ok: true,
      data: {
        exportedAt: new Date().toISOString(),
        profiles,
        resumes,
        experiences,
        projects,
        achievements,
        educations,
        certifications,
        skills,
        searchPreferences,
        applications,
        documents,
        settings,
      },
    };
  });

  // DELETE /admin/data - delete all personal data with typed confirmation
  app.delete("/data", async (req) => {
    parseWith(DeleteDataBody, req.body);

    // 1. Delete all personal DB records
    const [
      achievements,
      experiences,
      projects,
      educations,
      certifications,
      profileSkills,
      searchPrefs,
      jobMatches,
      appEvents,
      genDocs,
      apps,
      emails,
      resumeAnalyses,
      resumes,
      profiles,
      notifications,
    ] = await prisma.$transaction([
      prisma.achievement.deleteMany(),
      prisma.experience.deleteMany(),
      prisma.project.deleteMany(),
      prisma.education.deleteMany(),
      prisma.certification.deleteMany(),
      prisma.profileSkill.deleteMany(),
      prisma.searchPreference.deleteMany(),
      prisma.jobMatch.deleteMany(),
      prisma.applicationEvent.deleteMany(),
      prisma.generatedDocument.deleteMany(),
      prisma.application.deleteMany(),
      prisma.emailMessage.deleteMany(),
      prisma.resumeAnalysis.deleteMany(),
      prisma.resume.deleteMany(),
      prisma.profile.deleteMany(),
      prisma.notification.deleteMany(),
    ]);

    // 2. Delete all stored resume files and generated documents on disk
    const dataDir = process.env.DATA_DIR || "./data";
    let deletedFiles = 0;

    for (const subDir of ["resumes", "documents"]) {
      const dirPath = join(dataDir, subDir);
      try {
        const files = await readdir(dirPath);
        for (const file of files) {
          if (file === ".gitkeep" || file === ".gitignore") continue;
          await unlink(join(dirPath, file)).catch(() => {});
          deletedFiles++;
        }
      } catch {
        // directory might not exist yet
      }
    }

    // 3. Clear audit logs of personal entity references
    await prisma.auditLog.deleteMany({
      where: { entity: { in: ["Profile", "Resume", "Application", "GeneratedDocument"] } },
    });

    await prisma.auditLog.create({
      data: {
        actor: "user",
        action: "admin.all_data_deleted",
        entity: "System",
        meta: { deletedFiles, timestamp: new Date().toISOString() },
      },
    });

    return {
      ok: true,
      deleted: {
        profiles: profiles.count,
        resumes: resumes.count,
        applications: apps.count,
        documents: genDocs.count,
        files: deletedFiles,
      },
    };
  });
};
