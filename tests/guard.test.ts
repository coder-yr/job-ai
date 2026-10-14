// tests/guard.test.ts
import { describe, expect, it } from "vitest";
import { guardTailoredResume, type ProfileFacts } from "../packages/core/src/docs/guard.js";

const facts: ProfileFacts = {
  skills: new Set(["react", "typescript"]),
  bullets: new Map([["b1", { ownerId: "p1", text: "Built a dashboard in React used by 200 students" }]]),
  skillCatalog: ["react", "typescript", "kubernetes", "python"],
};
const base = { summary: "Fresher developer", skills: ["React"], sections: [] as never[] };

describe("truthfulness guard", () => {
  it("accepts a faithful rewrite", () => {
    const r = guardTailoredResume({ ...base, sections: [{ kind: "project", sourceId: "p1",
      bullets: [{ sourceBulletId: "b1", text: "Developed a React dashboard for 200 students" }] }] }, facts);
    expect(r.ok).toBe(true);
  });
  it("rejects invented numbers", () => {
    const r = guardTailoredResume({ ...base, sections: [{ kind: "project", sourceId: "p1",
      bullets: [{ sourceBulletId: "b1", text: "Built a React dashboard used by 2000 students" }] }] }, facts);
    expect(r.ok).toBe(false);
  });
  it("rejects invented technologies", () => {
    const r = guardTailoredResume({ ...base, sections: [{ kind: "project", sourceId: "p1",
      bullets: [{ sourceBulletId: "b1", text: "Deployed a React dashboard on Kubernetes" }] }] }, facts);
    expect(r.violations.join()).toMatch(/kubernetes/i);
  });
  it("rejects skills the candidate never listed", () => {
    expect(guardTailoredResume({ ...base, skills: ["Python"] }, facts).ok).toBe(false);
  });
});
