// scripts/evalParse.ts  - regression harness: npm run eval:parse  (golden files in eval/resumes)
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseResume } from "@jobpilot/core/resume/parse.js";

interface Golden { skills: string[]; email: string | null; education: number }

const f1 = (pred: string[], gold: string[]) => {
  const p = new Set(pred.map((s) => s.toLowerCase())), g = new Set(gold.map((s) => s.toLowerCase()));
  const tp = [...p].filter((x) => g.has(x)).length;
  const prec = p.size ? tp / p.size : 0, rec = g.size ? tp / g.size : 0;
  return prec + rec ? (2 * prec * rec) / (prec + rec) : 0;
};

const dir = "eval/resumes";
const names = (await readdir(dir)).filter((n) => n.endsWith(".txt"));
let skillF1 = 0, emailOk = 0, eduOk = 0;
for (const n of names) {
  const text = await readFile(join(dir, n), "utf8");
  const gold = JSON.parse(await readFile(join(dir, n.replace(".txt", ".json")), "utf8")) as Golden;
  const got = await parseResume(text);
  skillF1 += f1(got.skills.map((s) => s.name), gold.skills);
  emailOk += got.email === gold.email ? 1 : 0;
  eduOk += got.education.length === gold.education ? 1 : 0;
}
const N = names.length || 1;
console.table({ files: names.length, skillF1: (skillF1 / N).toFixed(2), emailAcc: (emailOk / N).toFixed(2), eduAcc: (eduOk / N).toFixed(2) });
process.exitCode = skillF1 / N >= 0.85 && emailOk / N >= 0.95 ? 0 : 1;      // quality gate
