// packages/core/src/matching/process.ts - normalise -> extract -> embed -> score -> (judge) -> store
import { prisma, type Prisma } from "@jobpilot/db";
import { JobExtractSchema, MatchJudgeSchema } from "@jobpilot/shared";
import { embed, generateJson } from "../llm/ollama.js";
import { PROMPTS, wrapUntrusted } from "../llm/prompts.js";
import { buildAliasMap, canonSkills } from "../resume/skills.js";
import { finalScore, scoreJob, SCORING_VERSION, type ProfileFeatures } from "./scoring.js";

export async function loadProfileFeatures(profileId: string): Promise<ProfileFeatures> {
  const p = await prisma.profile.findUniqueOrThrow({
    where: { id: profileId },
    include: { skills: { include: { skill: true } } },
  });
  return {
    skills: new Set(p.skills.map((s) => s.skill.name)),
    embedding: p.embedding,
    yearsExperience: p.yearsExperience,
    targetRoles: p.targetRoles,
    locations: p.preferredCities,
    acceptsRemote: p.acceptsRemote,
  };
}

export async function processJob(jobId: string, profileId: string, resumeId: string, judge: boolean) {
  const job = await prisma.job.findUniqueOrThrow({ where: { id: jobId }, include: { company: true } });
  const aliases = buildAliasMap(await prisma.skill.findMany({ select: { name: true, aliases: true } }));

  // 1. LLM extraction (only for jobs that passed the cheap deterministic filters)
  let ex;
  try {
    ex = job.extracted
      ? JobExtractSchema.parse(job.extracted)
      : await generateJson({
          purpose: "jd_extract",
          promptVersion: PROMPTS.jdExtract.version,
          system: PROMPTS.jdExtract.system,
          user: `Title: ${job.title}\n${wrapUntrusted("job_posting", job.descriptionText.slice(0, 8000))}`,
          schema: JobExtractSchema,
        });
  } catch {
    // Graceful fallback: rule-based skills extraction from aliases
    const words = job.descriptionText.toLowerCase();
    const foundSkills: string[] = [];
    for (const [alias, canonical] of aliases.entries()) {
      if (alias.length >= 3 && words.includes(alias) && !foundSkills.includes(canonical)) {
        foundSkills.push(canonical);
      }
    }
    ex = {
      roleTitle: job.title,
      seniority: job.seniority,
      minYears: job.minYears,
      maxYears: job.maxYears,
      requiredSkills: foundSkills.slice(0, 10),
      preferredSkills: [],
      responsibilities: [],
      workMode: job.workMode,
      jobType: job.jobType,
      locations: job.location ? [job.location] : [],
      isFresherFriendly: true,
      redFlags: [],
    };
  }

  const required = canonSkills(ex.requiredSkills, aliases);
  const preferred = canonSkills(ex.preferredSkills, aliases).filter((s) => !required.includes(s));

  // 2. Persist skills (catalog grows automatically)
  for (const [names, req] of [[required, true], [preferred, false]] as const) {
    for (const name of names) {
      const skill = await prisma.skill.upsert({
        where: { name },
        update: {},
        create: { name, display: name, aliases: [] },
      });
      await prisma.jobSkill.upsert({
        where: { jobId_skillId: { jobId, skillId: skill.id } },
        update: { required: req },
        create: { jobId, skillId: skill.id, required: req },
      });
    }
  }

  // 3. Embedding
  let vec: number[] = job.embedding;
  if (!vec || vec.length === 0) {
    try {
      const [newVec] = await embed([`${job.title}\n${required.join(", ")}\n${job.descriptionText.slice(0, 3000)}`]);
      if (newVec && newVec.length > 0) vec = newVec;
    } catch {
      // Ollama not reachable; proceed with empty vector
    }
  }

  await prisma.job.update({
    where: { id: jobId },
    data: {
      embedding: vec ?? [],
      extracted: ex as Prisma.InputJsonValue,
      seniority: ex.seniority,
      workMode: ex.workMode,
      jobType: ex.jobType,
      minYears: ex.minYears ?? job.minYears,
      maxYears: ex.maxYears ?? job.maxYears,
    },
  });

  // 4. Deterministic score
  const pf = await loadProfileFeatures(profileId);
  const base = scoreJob(pf, {
    title: job.title,
    requiredSkills: required,
    preferredSkills: preferred,
    embedding: vec ?? [],
    minYears: ex.minYears,
    maxYears: ex.maxYears,
    seniority: ex.seniority,
    location: job.location,
    workMode: ex.workMode,
  });

  // 5. Optional bounded LLM judge (top candidates only)
  let adj = 0;
  let explanation: string | null = null;
  if (judge && base.score >= 55) {
    try {
      const j = await generateJson({
        purpose: "match_judge",
        promptVersion: PROMPTS.matchJudge.version,
        system: PROMPTS.matchJudge.system,
        user:
          `Candidate matched skills: ${base.matchedSkills.join(", ")}\nMissing: ${base.missingSkills.join(", ")}\n` +
          `Years of experience: ${pf.yearsExperience}\n${wrapUntrusted("job_posting", job.descriptionText.slice(0, 4000))}`,
        schema: MatchJudgeSchema,
      });
      adj = j.adjustment;
      explanation = j.summary;
    } catch {
      // If LLM judge is unavailable, rely on deterministic explanation
      explanation = `Matched skills: ${base.matchedSkills.join(", ") || "none"}. Missing: ${base.missingSkills.join(", ") || "none"}.`;
    }
  }

  const data = {
    score: finalScore(base.score, adj),
    breakdown: base.breakdown as Prisma.InputJsonValue,
    matchedSkills: base.matchedSkills,
    missingSkills: base.missingSkills,
    llmAdjustment: adj,
    explanation,
    scoringVersion: SCORING_VERSION,
    resumeId,
  };

  return prisma.jobMatch.upsert({
    where: { profileId_jobId: { profileId, jobId } },
    update: data,
    create: { profileId, jobId, ...data },
  });
}
