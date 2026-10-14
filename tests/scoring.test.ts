// tests/scoring.test.ts  (Vitest)
import { describe, expect, it } from "vitest";
import { cosine, experienceScore, finalScore, scoreJob, skillScore } from "../packages/core/src/matching/scoring.js";
import { classifySeniority, parseYears } from "../packages/core/src/matching/seniority.js";

describe("seniority", () => {
  it("parses year ranges", () => expect(parseYears("Requires 0-2 years of experience")).toEqual({ min: 0, max: 2 }));
  it("parses minimums", () => expect(parseYears("minimum 5 years in Java").min).toBe(5));
  it("flags senior titles", () => expect(classifySeniority("Senior Backend Engineer", "")).toBe("SENIOR"));
  it("flags freshers", () => expect(classifySeniority("Graduate Engineer Trainee", "")).toBe("FRESHER"));
});

describe("scoring", () => {
  it("cosine of identical vectors is 1", () => expect(cosine([1, 2, 3], [1, 2, 3])).toBeCloseTo(1));
  it("required skills outweigh preferred", () => {
    const r = skillScore(new Set(["react"]), ["react", "node"], ["docker"]);
    expect(r.value).toBeCloseTo(1 / 2.5);
    expect(r.missing).toEqual(["node"]);
  });
  it("senior roles score 0 on experience", () => expect(experienceScore(1, 5, null, "SENIOR")).toBe(0));
  it("LLM adjustment is bounded", () => expect(finalScore(95, 50)).toBe(100));
  it("is deterministic", () => {
    const p = { skills: new Set(["react", "typescript"]), embedding: [1, 0], yearsExperience: 0,
                targetRoles: ["frontend developer"], locations: ["pune"], acceptsRemote: true };
    const j = { title: "Frontend Developer", requiredSkills: ["react", "typescript"], preferredSkills: [],
                embedding: [1, 0], minYears: 0, maxYears: 2, seniority: "FRESHER" as const,
                location: "Pune", workMode: "HYBRID" as const };
    expect(scoreJob(p, j)).toEqual(scoreJob(p, j));
    expect(scoreJob(p, j).score).toBeGreaterThan(90);
  });
});
