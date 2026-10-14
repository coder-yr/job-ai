// packages/core/src/sources/discovery.ts - Discovery engine for permitted job sources
import { prisma } from "@jobpilot/db";
import { greenhouse } from "./greenhouse.js";
import { lever } from "./lever.js";
import { jsonLd } from "./jsonld.js";
import { ashby } from "./ashby.js";
import { smartRecruiters } from "./smartrecruiters.js";
import { canonicalUrl, dedupeHash, normalizeCompany, normalizeTitle } from "./normalize.js";
import { classifySeniority, isEarlyCareer, parseYears } from "../matching/seniority.js";
import { sseBus } from "../notifications/events.js";
import { createNotification } from "../notifications/service.js";
import type { JobSourceAdapter } from "./types.js";

export const ADAPTERS: Record<string, JobSourceAdapter> = {
  ATS_GREENHOUSE: greenhouse,
  ATS_LEVER: lever,
  CAREER_PAGE_JSONLD: jsonLd,
  ATS_ASHBY: ashby,
  ATS_SMARTRECRUITERS: smartRecruiters,
};

export async function runDiscovery(trigger: "SCHEDULED" | "MANUAL" | "CATCHUP") {
  // Check kill switch: stops all outbound fetching immediately
  const killSwitch = await prisma.appSetting.findUnique({ where: { key: "kill_switch_enabled" } });
  const isKillSwitch = killSwitch ? Boolean((killSwitch.value as { enabled?: boolean })?.enabled) : false;
  if (isKillSwitch) {
    const run = await prisma.searchRun.create({
      data: {
        trigger,
        status: "CANCELLED",
        startedAt: new Date(),
        finishedAt: new Date(),
        stats: { fetched: 0, new: 0, dupes: 0, filtered: 0, errors: ["Outbound fetching blocked: kill switch is active"] },
        error: "Kill switch is active",
      },
    });
    sseBus.broadcast("run.progress", { runId: run.id, trigger, status: "CANCELLED", fetched: 0, new: 0 });
    return { runId: run.id, newJobIds: [] };
  }

  const run = await prisma.searchRun.create({ data: { trigger, status: "RUNNING", startedAt: new Date() } });
  sseBus.broadcast("run.progress", { runId: run.id, trigger, status: "RUNNING", fetched: 0, new: 0 });

  const newJobIds: string[] = [];
  const stats = { fetched: 0, new: 0, dupes: 0, filtered: 0, errors: [] as string[] };
  const prefs = await prisma.searchPreference.findMany({ where: { enabled: true } });
  const exclude = prefs.flatMap((p) => p.excludeKeywords.map((k) => k.toLowerCase()));

  const sources = await prisma.jobSource.findMany({ where: { enabled: true, kind: { in: Object.keys(ADAPTERS) as never[] } } });
  for (const src of sources) {
    // respect per-source minimum interval so a manual re-run never hammers a host
    if (src.lastRunAt && Date.now() - src.lastRunAt.getTime() < src.minIntervalMin * 60_000) continue;
    try {
      const raws = await ADAPTERS[src.kind]!.fetchJobs(src.config as Record<string, unknown>);
      stats.fetched += raws.length;
      for (const r of raws) {
        const seniority = classifySeniority(r.title, r.descriptionText);
        const hay = `${r.title} ${r.descriptionText.slice(0, 2000)}`.toLowerCase();
        if (!isEarlyCareer(seniority) || exclude.some((k) => hay.includes(k))) { stats.filtered++; continue; }

        const hash = dedupeHash(r.company, r.title, r.location);
        if (await prisma.job.findUnique({ where: { dedupeHash: hash }, select: { id: true } })) {
          await prisma.job.update({ where: { dedupeHash: hash }, data: { lastSeenAt: new Date(), status: "ACTIVE" } });
          stats.dupes++; continue;
        }
        const company = await prisma.company.upsert({
          where: { normalizedName: normalizeCompany(r.company) },
          update: {}, create: { name: r.company, normalizedName: normalizeCompany(r.company) },
        });
        const yrs = parseYears(r.descriptionText);
        const created = await prisma.job.create({ select: { id: true }, data: {
          sourceId: src.id, companyId: company.id, searchRunId: run.id, externalId: r.externalId,
          title: r.title, normalizedTitle: normalizeTitle(r.title), descriptionText: r.descriptionText,
          descriptionHtml: r.descriptionHtml, location: r.location, seniority,
          workMode: r.remote ? "REMOTE" : "UNKNOWN", minYears: yrs.min, maxYears: yrs.max,
          postedAt: r.postedAt, applyUrl: r.applyUrl, canonicalUrl: canonicalUrl(r.applyUrl),
          dedupeHash: hash, embedding: [],
        } });
        newJobIds.push(created.id);
        stats.new++;
      }
      const conf = (src.config && typeof src.config === "object" ? src.config : {}) as Record<string, unknown>;
      await prisma.jobSource.update({
        where: { id: src.id },
        data: {
          lastRunAt: new Date(),
          config: { ...conf, consecutiveFailures: 0 },
        },
      });
    } catch (e) {
      const errMessage = e instanceof Error ? e.message : String(e);
      stats.errors.push(`${src.name}: ${errMessage}`); // one bad source never kills the run

      const conf = (src.config && typeof src.config === "object" ? src.config : {}) as Record<string, unknown>;
      const currentFailures = (typeof conf.consecutiveFailures === "number" ? conf.consecutiveFailures : 0) + 1;
      await prisma.jobSource.update({
        where: { id: src.id },
        data: {
          config: { ...conf, consecutiveFailures: currentFailures, lastError: errMessage },
        },
      });

      if (currentFailures >= 3) {
        const existingNotif = await prisma.notification.findFirst({
          where: {
            kind: "source_failing",
            refType: "job_source",
            refId: src.id,
            readAt: null,
          },
        });
        if (!existingNotif) {
          await createNotification({
            kind: "source_failing",
            title: `Source failing: ${src.name}`,
            body: `Job source "${src.name}" has failed for ${currentFailures} consecutive runs: ${errMessage}`,
            refType: "job_source",
            refId: src.id,
          });
        }
      }
    }
  }

  const runStatus = stats.errors.length ? (stats.fetched ? "PARTIAL" : "FAILED") : "SUCCEEDED";
  await prisma.searchRun.update({
    where: { id: run.id },
    data: {
      status: runStatus,
      finishedAt: new Date(),
      stats,
    },
  });

  sseBus.broadcast("run.progress", {
    runId: run.id,
    trigger,
    status: runStatus,
    fetched: stats.fetched,
    new: stats.new,
  });

  if (newJobIds.length > 0) {
    await createNotification({
      kind: "new_matches",
      title: `${newJobIds.length} new roles found`,
      body: `Daily search discovered ${newJobIds.length} new matching job opportunities.`,
      refType: "search_run",
      refId: run.id,
    });
    sseBus.broadcast("matches.new", { count: newJobIds.length, runId: run.id });
  } else if (runStatus === "FAILED") {
    await createNotification({
      kind: "run_failed",
      title: "Daily search failed",
      body: `Search run failed: ${stats.errors.join("; ")}`,
      refType: "search_run",
      refId: run.id,
    });
  }

  return { runId: run.id, newJobIds };
}
