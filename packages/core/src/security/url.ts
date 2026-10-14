// packages/core/src/security/url.ts  - SSRF guard for "import job by URL"
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export function isPrivateIp(ip: string): boolean {
  if (ip.startsWith("::ffff:")) return isPrivateIp(ip.slice(7));
  if (isIP(ip) === 6) {
    const l = ip.toLowerCase();
    return l === "::1" || l === "::" || l.startsWith("fc") || l.startsWith("fd") || l.startsWith("fe8") ||
           l.startsWith("fe9") || l.startsWith("fea") || l.startsWith("feb");
  }
  const [a, b] = ip.split(".").map(Number) as [number, number];
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
         (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
}

export async function assertPublicHttpUrl(raw: string): Promise<URL> {
  const u = new URL(raw);
  if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error("Only http(s) URLs are allowed");
  if (u.username || u.password) throw new Error("Credentials in URLs are not allowed");
  const addrs = isIP(u.hostname) ? [{ address: u.hostname }] : await lookup(u.hostname, { all: true });
  if (addrs.some((a) => isPrivateIp(a.address))) throw new Error("URL resolves to a private address");
  return u;
}
