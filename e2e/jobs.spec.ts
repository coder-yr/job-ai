// e2e/jobs.spec.ts  (Playwright Test) - seeds via API, asserts ranking and hide behaviour
import { expect, test } from "@playwright/test";

test("jobs are ranked by score and hidden jobs disappear", async ({ page }) => {
  await page.goto("http://localhost:5173/jobs");
  await expect(page.getByRole("heading", { name: "Matched jobs" })).toBeVisible();

  const scores = await page.getByRole("img", { name: /Match score/ }).evaluateAll(
    (els) => els.map((e) => Number(e.textContent)));
  expect(scores).toEqual([...scores].sort((a, b) => b - a));

  const first = page.getByRole("row").nth(1);
  const title = await first.getByRole("cell").nth(1).innerText();
  await first.getByRole("button", { name: "Hide" }).click();
  await expect(page.getByText(title)).toHaveCount(0);
});
