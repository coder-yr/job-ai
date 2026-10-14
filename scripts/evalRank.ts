// scripts/evalRank.ts - Ranking evaluation harness: npm run eval:rank
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { scoreJob, type ProfileFeatures, type JobFeatures } from "@jobpilot/core/matching/scoring.js";
import type { Seniority } from "@jobpilot/core/matching/seniority.js";

interface LabelledJob {
  id: string;
  title: string;
  company: string;
  seniority: Seniority;
  workMode: "ONSITE" | "HYBRID" | "REMOTE" | "UNKNOWN";
  location: string | null;
  minYears: number | null;
  maxYears: number | null;
  requiredSkills: string[];
  preferredSkills: string[];
  relevant: boolean;
  embedding?: number[];
}

interface GoldenFile {
  profile: {
    targetRoles: string[];
    skills: string[];
    yearsExperience: number;
    locations: string[];
    acceptsRemote: boolean;
    embedding?: number[];
  };
  jobs: LabelledJob[];
}

async function runEval() {
  const dir = "eval/jobs";
  const files = (await readdir(dir)).filter((f) => f.endsWith(".json"));

  if (files.length === 0) {
    console.error("No golden job dataset found in eval/jobs/*.json");
    process.exit(1);
  }

  for (const filename of files) {
    const content = await readFile(join(dir, filename), "utf8");
    const data: GoldenFile = JSON.parse(content);

    const profile: ProfileFeatures = {
      skills: new Set(data.profile.skills.map((s) => s.toLowerCase())),
      embedding: data.profile.embedding ?? [],
      yearsExperience: data.profile.yearsExperience,
      targetRoles: data.profile.targetRoles,
      locations: data.profile.locations.map((l) => l.toLowerCase()),
      acceptsRemote: data.profile.acceptsRemote,
    };

    const scored = data.jobs.map((j) => {
      const jf: JobFeatures = {
        title: j.title,
        requiredSkills: j.requiredSkills.map((s) => s.toLowerCase()),
        preferredSkills: j.preferredSkills.map((s) => s.toLowerCase()),
        embedding: j.embedding ?? [],
        minYears: j.minYears,
        maxYears: j.maxYears,
        seniority: j.seniority,
        location: j.location,
        workMode: j.workMode,
      };
      const res = scoreJob(profile, jf);
      return {
        id: j.id,
        title: j.title,
        company: j.company,
        relevant: j.relevant,
        score: res.score,
        matchedSkills: res.matchedSkills.join(", "),
        missingSkills: res.missingSkills.join(", "),
      };
    });

    // Rank jobs by score descending
    scored.sort((a, b) => b.score - a.score);

    const top10 = scored.slice(0, 10);
    const relevantInTop10 = top10.filter((j) => j.relevant).length;
    const precisionAt10 = relevantInTop10 / Math.min(10, top10.length || 1);

    console.log(`\n======================================================`);
    console.log(`Evaluation results for: ${filename}`);
    console.log(`Total jobs: ${scored.length} | Top-10 evaluated`);
    console.log(`======================================================`);

    const tableRows = scored.map((item, idx) => ({
      Rank: idx + 1,
      Title: item.title,
      Company: item.company,
      Score: item.score,
      Label: item.relevant ? "RELEVANT" : "IRRELEVANT",
      InTop10: idx < 10 ? "YES" : "NO",
      Hit: idx < 10 && item.relevant ? "TRUE POS" : idx < 10 && !item.relevant ? "FALSE POS" : "-",
    }));

    console.table(tableRows);

    console.log(`\nPrecision@10: ${(precisionAt10 * 100).toFixed(1)}% (${relevantInTop10}/10 relevant jobs in top 10)`);

    const gate = precisionAt10 >= 0.6;
    console.log(`Quality gate (precision@10 >= 0.60): ${gate ? "PASSED" : "FAILED"}\n`);

    if (!gate) {
      process.exitCode = 1;
    }
  }
}

runEval().catch((err) => {
  console.error("Evaluation error:", err);
  process.exit(1);
});
