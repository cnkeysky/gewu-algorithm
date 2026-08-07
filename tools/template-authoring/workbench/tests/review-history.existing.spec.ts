import { expect, test } from "playwright/test";

test.skip(!process.env.GEWU_E2E_EXISTING, "requires an existing dev stack");

test("audit trail verdicts are color-coded with readable labels and paginate", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Review history", exact: true }).click();
  await expect(page.locator("#history-view .history-row").first()).toBeVisible();
  const statuses = page.locator("#history-view .history-status");
  const classes = await statuses.evaluateAll((nodes) => nodes.map((node) => node.className));
  expect(classes.some((value) => value.includes("verdict-pass"))).toBe(true);
  expect(classes.some((value) => value.includes("verdict-reject") || value.includes("verdict-pending"))).toBe(true);
  const firstText = await statuses.first().textContent();
  expect(firstText?.includes("_")).toBe(false);
  const rows = await page.locator("#history-view .history-row").count();
  if (rows > 6) {
    await expect(page.locator("#history-view .list-pagination")).toBeVisible();
    await expect(page.locator("#history-view .pagination-info")).toContainText("Showing 1–6 of");
    const listHeight = await page.locator("#history-view .history-paged").evaluate((el) => el.getBoundingClientRect().height);
    await page.locator("#history-view [data-page-next='history']").click();
    await page.waitForTimeout(200);
    const nextHeight = await page.locator("#history-view .history-paged").evaluate((el) => el.getBoundingClientRect().height);
    expect(nextHeight).toBe(listHeight);
  }
});

test("View feedback opens the artifact modal from Review history", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Review history", exact: true }).click();
  const button = page.locator("#history-view [data-view-artifact-id]").first();
  await expect(button).toBeVisible();
  await button.click();
  await expect(page.locator("#artifact-inspector")).toBeVisible();
  await expect(page.locator("#artifact-title")).not.toBeEmpty();
  await expect(page.locator("#artifact-manifest")).toBeVisible();
  const files = await page.locator(".artifact-file summary").allTextContents();
  expect(files.some((path) => path.includes(".pyc") || path.includes("__pycache__"))).toBe(false);
  await page.locator("#close-artifact").click();
  await expect(page.locator("#artifact-inspector")).toBeHidden();
});

test("LLM pre-review findings render as severity cards with standard pagination", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Review history", exact: true }).click();
  // Prefer a review that carries findings (needs_revision rows do).
  const feedbackRow = page.locator("#history-view .history-row", { hasText: "needs revision" }).first();
  if (await feedbackRow.count() === 0) {
    await page.locator("#history-view [data-view-artifact-id]").first().click();
  } else {
    await feedbackRow.locator("[data-view-artifact-id]").click();
  }
  await expect(page.locator("#artifact-inspector")).toBeVisible();
  await expect(page.locator(".finding-card").first()).toBeVisible();
  await expect(page.locator(".severity-chip").first()).toBeVisible();
  const pagination = page.locator(".finding-pagination");
  if (await pagination.count()) {
    await expect(pagination.locator(".pagination-info")).toContainText(/Showing \d+–\d+ of \d+/);
    const gridHeight = await page.locator(".finding-grid").evaluate((el) => el.getBoundingClientRect().height);
    await page.locator(".finding-pagination [data-review-page-next]").click();
    await page.waitForTimeout(200);
    const nextHeight = await page.locator(".finding-grid").evaluate((el) => el.getBoundingClientRect().height);
    expect(nextHeight).toBe(gridHeight);
  }
});

test("verdict filters group the audit trail with live counts", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Review history", exact: true }).click();
  await expect(page.locator("#history-filters .filter-pill").first()).toBeVisible();
  const passPill = page.locator("#history-filters .filter-pill", { hasText: /^Pass/ });
  const count = Number((await passPill.locator(".filter-count").textContent()) ?? "0");
  expect(count).toBeGreaterThan(0);
  await passPill.click();
  await expect(page.locator("#history-view .history-row").first()).toBeVisible();
  const verdicts = await page.locator("#history-view .history-status").allTextContents();
  expect(verdicts.every((value) => value.trim() === "pass")).toBe(true);
  const rejectPill = page.locator("#history-filters .filter-pill", { hasText: /^Reject/ });
  await rejectPill.click();
  const rejectCount = Number((await rejectPill.locator(".filter-count").textContent()) ?? "0");
  if (rejectCount === 0) {
    await expect(page.locator("#history-view .empty-state")).toContainText("No matching reports");
  } else {
    const verdictsAfter = await page.locator("#history-view .history-status").allTextContents();
    expect(verdictsAfter.every((value) => value.trim() === "reject")).toBe(true);
  }
});
