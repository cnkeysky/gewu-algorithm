import { expect, test } from "playwright/test";

function draft(title: string, status: string, index: number, error?: string) {
  return {
    id: `draft-${index}`,
    title,
    problem: "Given an array of integers and a target, return indices.",
    provider: "relay",
    model: "deepseek-v4-flash",
    language: "python",
    variants: 0,
    modes: ["shadow_typing", "flow_recall", "code_recall", "reasoning_recall", "transfer_practice"],
    assistance: ["comments", "cloze"],
    status,
    createdAt: new Date(Date.UTC(2026, 7, 6, 8, 30, index)).toISOString(),
    ...(error ? { error } : {}),
  };
}

async function openDrafts(page: import("playwright/test").Page): Promise<void> {
  await page.goto("/");
  await page.getByRole("button", { name: /^Drafts/ }).click();
}

test("failed drafts show the stored error with Retry and Delete actions", async ({ page }) => {
  const drafts = [
    draft("Broken unit", "failed", 0, "Pi-ai model not found: relay/no-such-model"),
    draft("Healthy unit", "generated", 1),
  ];
  await page.route("**/api/drafts", (route) => route.fulfill({ json: { drafts } }));
  await page.route("**/api/reviews", (route) => route.fulfill({ json: { reviews: [] } }));
  await openDrafts(page);

  const failedRow = page.locator(".draft-row", { hasText: "Broken unit" });
  await expect(failedRow).toContainText("Generation failed");
  await expect(failedRow).toContainText("Pi-ai model not found: relay/no-such-model");
  await expect(failedRow.getByRole("button", { name: "Retry generation" })).toBeVisible();
  await expect(failedRow.getByRole("button", { name: "Delete" })).toBeVisible();
  await expect(failedRow.getByRole("button", { name: "Generate template" })).toHaveCount(0);

  const healthyRow = page.locator(".draft-row", { hasText: "Healthy unit" });
  await expect(healthyRow).toContainText("Generated");
  await expect(healthyRow.getByRole("button", { name: "Generate template" })).toHaveCount(0);
});

test("failed drafts are counted and shown under the attention filter", async ({ page }) => {
  const drafts = [
    draft("Failed one", "failed", 0, "generation rejected"),
    draft("Failed two", "failed", 1, "validation rejected"),
    draft("In progress", "generated", 2),
  ];
  await page.route("**/api/drafts", (route) => route.fulfill({ json: { drafts } }));
  await page.route("**/api/reviews", (route) => route.fulfill({ json: { reviews: [] } }));
  await openDrafts(page);

  const attentionPill = page.locator("#draft-filters .filter-pill", { hasText: "Needs attention" });
  await expect(attentionPill).toContainText("2");
  await attentionPill.click();
  await expect(page.locator(".draft-row")).toHaveCount(2);
  await expect(page.locator(".draft-row", { hasText: "In progress" })).toHaveCount(0);
});
