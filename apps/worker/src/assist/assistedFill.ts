// apps/worker/src/assist/assistedFill.ts
// Human-in-the-loop form filling for EMPLOYER ATS pages only. It NEVER clicks Submit.
import { chromium } from "playwright";

const ALLOWED = new Set(["boards.greenhouse.io", "job-boards.greenhouse.io", "jobs.lever.co", "jobs.ashbyhq.com"]);
const FORBIDDEN = /(^|\.)(linkedin|indeed|naukri)\.com$/i;

export interface FillInput {
  applyUrl: string;
  resumePdf: string;
  first: string;
  last: string;
  email: string;
  phone: string;
}

export interface FillOptions {
  waitForClose?: boolean;
  timeout?: number;
}

export interface FillResult {
  filled: boolean;
  captchaDetected: boolean;
}

export async function assistedFill(
  i: FillInput,
  userDataDir: string,
  options?: FillOptions,
): Promise<FillResult> {
  const host = new URL(i.applyUrl).hostname;
  if (FORBIDDEN.test(host)) throw new Error("Automation on LinkedIn/Indeed/Naukri is forbidden by design.");
  const isLocalAllowed =
    (process.env.NODE_ENV === "test" || process.env.ALLOW_LOCAL_ATS === "true") &&
    (host === "localhost" || host === "127.0.0.1");
  if (!ALLOWED.has(host) && !isLocalAllowed) {
    throw new Error(`Host ${host} is not on the assisted-fill allow-list.`);
  }

  // Visible browser + persistent profile: YOU stay logged in, YOU see everything.
  const isHeadless = process.env.HEADLESS_ASSIST === "true";
  const ctx = await chromium.launchPersistentContext(userDataDir, {
    headless: isHeadless,
    slowMo: isHeadless ? 0 : 120,
  });
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  await page.goto(i.applyUrl, { waitUntil: "domcontentloaded" });

  const fill = async (label: RegExp, value: string) => {
    const el = page.getByLabel(label).first();
    if (await el.count()) await el.fill(value);
  };
  await fill(/first name/i, i.first);
  await fill(/last name/i, i.last);
  await fill(/^email/i, i.email);
  await fill(/phone/i, i.phone);
  const file = page.locator('input[type="file"]').first();
  if (await file.count()) await file.setInputFiles(i.resumePdf);

  // A CAPTCHA is a human checkpoint. We detect it and stop; we never try to solve it.
  let captchaDetected = false;
  if (await page.locator('iframe[src*="recaptcha"], iframe[src*="hcaptcha"], .g-recaptcha, .h-captcha').count()) {
    captchaDetected = true;
    console.log("CAPTCHA present - please solve it yourself.");
  }
  console.log("Form pre-filled. Review every field and press Submit yourself. Close the window when done.");
  if (options?.waitForClose !== false) {
    await page.waitForEvent("close", { timeout: options?.timeout ?? 0 }); // wait for the human
  }
  await ctx.close();
  return { filled: true, captchaDetected };
}
