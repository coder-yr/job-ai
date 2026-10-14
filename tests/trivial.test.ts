// tests/trivial.test.ts - Phase 0 smoke test
import { describe, expect, it } from "vitest";

describe("Phase 0 toolchain smoke test", () => {
  it("verifies the test runner and assertions work", () => {
    expect(true).toBe(true);
  });

  it("verifies Node runtime version is >= 22.12", () => {
    const [maj, min] = process.versions.node.split(".").map(Number);
    const valid = (maj! > 22) || (maj === 22 && (min ?? 0) >= 12);
    expect(valid).toBe(true);
  });
});
