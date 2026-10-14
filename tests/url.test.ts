// tests/url.test.ts
import { describe, expect, it } from "vitest";
import { assertPublicHttpUrl, isPrivateIp } from "../packages/core/src/security/url.js";
import { canonicalUrl, dedupeHash } from "../packages/core/src/sources/normalize.js";
import { extractAlertLinks } from "../apps/worker/src/email/alerts.js";
import { decryptSecret, encryptSecret } from "../packages/core/src/security/crypto.js";

describe("ssrf guard", () => {
  it.each(["127.0.0.1", "10.1.2.3", "192.168.0.5", "172.20.1.1", "169.254.169.254", "::1", "fd00::1"])("blocks %s", (ip) => expect(isPrivateIp(ip)).toBe(true));
  it.each(["8.8.8.8", "93.184.216.34"])("allows %s", (ip) => expect(isPrivateIp(ip)).toBe(false));
  it("rejects non-http schemes", async () => { await expect(assertPublicHttpUrl("file:///etc/passwd")).rejects.toThrow(); });
  it("rejects literal private hosts", async () => { await expect(assertPublicHttpUrl("http://127.0.0.1:5432")).rejects.toThrow(); });
});
describe("normalisation", () => {
  it("strips tracking params", () => expect(canonicalUrl("https://x.com/job/1?utm_source=a&id=5#top")).toBe("https://x.com/job/1?id=5"));
  it("dedupes across sources", () =>
    expect(dedupeHash("Acme Pvt. Ltd.", "Junior Developer (Remote)", "Pune, India")).toBe(dedupeHash("ACME", "junior developer", "pune")));
});
describe("alerts + crypto", () => {
  it("extracts job links", () => {
    const html = '<a href="https://www.linkedin.com/comm/jobs/view/123?trk=x">Junior Dev at Acme</a><a href="https://example.com">x</a>';
    expect(extractAlertLinks(html)).toHaveLength(1);
  });
  it("round-trips and detects wrong key", () => {
    const blob = encryptSecret("app-password", "correct horse");
    expect(decryptSecret(blob, "correct horse")).toBe("app-password");
    expect(() => decryptSecret(blob, "wrong")).toThrow();
  });
});
