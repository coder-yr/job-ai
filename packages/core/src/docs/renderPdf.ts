// packages/core/src/docs/renderPdf.ts  - HTML -> ATS-friendly PDF with Playwright (free, offline)
import { chromium, type Browser } from "playwright";
import type { TailoredResume } from "@jobpilot/shared";

let browser: Browser | null = null;
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export function resumeHtml(
  p: { fullName: string; email?: string | null; phone?: string | null; location?: string | null },
  t: TailoredResume,
  titles: Map<string, { heading: string; sub?: string }>,   // sourceId -> heading line
): string {
  const sections = t.sections.map((s) => {
    const h = titles.get(s.sourceId);
    return `<h3>${esc(h?.heading ?? "")}<span>${esc(h?.sub ?? "")}</span></h3>
            <ul>${s.bullets.map((b) => `<li>${esc(b.text)}</li>`).join("")}</ul>`;
  }).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    body{font:10.5pt/1.35 Arial,Helvetica,sans-serif;color:#111;margin:0}
    h1{font-size:20pt;margin:0}h2{font-size:11pt;border-bottom:1px solid #999;margin:14px 0 4px;text-transform:uppercase}
    h3{font-size:10.5pt;margin:8px 0 2px;display:flex;justify-content:space-between}h3 span{font-weight:normal}
    ul{margin:2px 0 0 18px;padding:0}li{margin:1px 0}
  </style></head><body>   <!-- single column, real text, no tables/images: parses cleanly in ATS -->
    <h1>${esc(p.fullName)}</h1>
    <div>${[p.email, p.phone, p.location].filter(Boolean).map((x) => esc(x!)).join(" | ")}</div>
    <h2>Summary</h2><p>${esc(t.summary)}</p>
    <h2>Skills</h2><p>${t.skills.map(esc).join(", ")}</p>
    <h2>Experience &amp; Projects</h2>${sections}
  </body></html>`;
}

export async function renderPdf(html: string, outPath: string): Promise<void> {
  browser ??= await chromium.launch();
  const page = await browser.newPage();
  try {
    await page.setContent(html, { waitUntil: "load" });
    await page.pdf({ path: outPath, format: "A4", printBackground: true,
                     margin: { top: "14mm", bottom: "14mm", left: "14mm", right: "14mm" } });
  } finally { await page.close(); }
}
