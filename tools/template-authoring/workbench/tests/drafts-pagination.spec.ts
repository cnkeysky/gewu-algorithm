import { expect, test, type Page } from "playwright/test";

const DRAFTS_KEY = "gewu.authoring.drafts.v1";

function draft(title: string, status: string, index: number) {
  return {
    id: `draft-${index}`,
    title,
    problem: "Given an array of integers and a target, return the indices of the two numbers that add up to target.",
    provider: "deepseek",
    model: "deepseek-v4-flash",
    language: "python",
    variants: 1,
    modes: ["shadow_typing", "flow_recall", "code_recall", "reasoning_recall", "transfer_practice"],
    assistance: ["comments", "cloze"],
    status,
    createdAt: new Date(Date.UTC(2026, 7, 5, 8, 30, index)).toISOString(),
  };
}

async function seedDrafts(page: Page, count: number, status = "generated"): Promise<void> {
  const drafts = Array.from({ length: count }, (_, index) => draft(`Algorithm draft ${index + 1}`, status, index));
  await page.route("**/api/drafts", (route) => route.fulfill({ json: { drafts } }));
}

async function openDrafts(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByRole("button", { name: /^Drafts/ }).click();
}

test("drafts list keeps a fixed height that fits six rows without clipping", async ({ page }) => {
  await seedDrafts(page, 6);
  await openDrafts(page);
  const area = page.locator(".draft-list .paged-scroll");
  const rows = area.locator(".draft-row");
  await expect(rows).toHaveCount(6);
  const metrics = await area.evaluate((el) => {
    const items = [...el.querySelectorAll(".draft-row")];
    const last = items[items.length - 1];
    return {
      areaHeight: el.clientHeight,
      lastRowBottom: last.getBoundingClientRect().bottom - el.getBoundingClientRect().top,
    };
  });
  expect(metrics.lastRowBottom).toBeLessThanOrEqual(metrics.areaHeight);
  await expect(page.locator(".draft-list .list-pagination")).toBeHidden();
  console.log(`DRAFT_AREA_HEIGHT=${metrics.areaHeight}`);
});

test("pagination keeps the fixed height across pages", async ({ page }) => {
  await seedDrafts(page, 7);
  await openDrafts(page);
  const area = page.locator(".draft-list .paged-scroll");
  const firstHeight = await area.evaluate((el) => el.clientHeight);
  await expect(area.locator(".draft-row")).toHaveCount(6);
  await page.locator(".draft-list [data-page-next='drafts']").click();
  await expect(area.locator(".draft-row")).toHaveCount(1);
  const secondHeight = await area.evaluate((el) => el.clientHeight);
  expect(secondHeight).toBe(firstHeight);
});

test("empty state fills the same fixed height", async ({ page }) => {
  await seedDrafts(page, 0);
  await openDrafts(page);
  const empty = page.locator(".draft-list .empty-state");
  await expect(empty).toBeVisible();
  const emptyHeight = await empty.evaluate((el) => el.clientHeight);
  expect(emptyHeight).toBeGreaterThanOrEqual(400);
});

test("delete confirmation dialog can be cancelled", async ({ page }) => {
  await seedDrafts(page, 6);
  await openDrafts(page);
  await page.locator("[data-delete-id]").first().click();
  await expect(page.locator("#confirm-dialog")).toBeVisible();
  await page.locator("#confirm-cancel").click();
  await expect(page.locator("#confirm-dialog")).toBeHidden();
  await expect(page.locator(".draft-list .draft-row")).toHaveCount(6);
});
