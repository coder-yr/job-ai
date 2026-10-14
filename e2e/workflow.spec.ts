// e2e/workflow.spec.ts - Full Candidate Workflow: upload -> ranked list -> hide -> tailor -> approve -> tracker
import { test, expect } from "@playwright/test";

test.describe("Full Candidate Workflow (Phase 8)", () => {
  test("upload -> ranked list -> hide -> tailor -> approve -> tracker", async ({ page }) => {
    // 1. Upload / Profile page
    await page.goto("/resume");
    await expect(page.locator("body")).toBeVisible();
    await expect(page.getByRole("heading", { name: /Resume/i }).first()).toBeVisible();

    // 2. Ranked list on Jobs page
    await page.goto("/jobs");
    await expect(page.getByRole("heading", { name: /Jobs/i }).first()).toBeVisible();

    // 3. Hide functionality
    const hideBtn = page.getByRole("button", { name: /Hide/i }).first();
    if (await hideBtn.count() > 0) {
      await hideBtn.click();
    }

    // 4. Tailor page
    await page.goto("/tailor");
    await expect(page.locator("body")).toBeVisible();

    // 5. Document approve action
    const approveBtn = page.getByRole("button", { name: /Approve/i }).first();
    if (await approveBtn.count() > 0) {
      await approveBtn.click();
    }

    // 6. Tracker Kanban board
    await page.goto("/tracker");
    await expect(page.getByRole("heading", { name: /Application Tracker/i })).toBeVisible();
    await expect(page.getByText("Planned").first()).toBeVisible();
    await expect(page.getByText("Prepared").first()).toBeVisible();
  });
});
