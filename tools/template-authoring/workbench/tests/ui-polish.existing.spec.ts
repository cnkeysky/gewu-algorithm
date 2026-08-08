import { expect, test, type Page } from "playwright/test";

test.skip(!process.env.GEWU_E2E_EXISTING, "requires an existing dev stack");

const DRAFTS_KEY = "gewu.authoring.drafts.v1";

function worstCaseDraft(index: number) {
  return {
    id: `worst-${index}`,
    title: "Course Schedule with a long prerequisite chain and Kahn topological ordering implementation",
    problem: "Given numCourses courses and prerequisites pairs, decide whether all courses can be completed using a topological ordering.",
    provider: "deepseek",
    model: "deepseek-v4-flash",
    language: "python",
    variants: 2,
    modes: ["shadow_typing", "flow_recall", "code_recall", "reasoning_recall", "transfer_practice"],
    assistance: ["comments", "cloze"],
    status: "needs_revision",
    artifactPath: `artifacts/${index}`,
    createdAt: new Date(Date.UTC(2026, 7, 5, 9, index)).toISOString(),
  };
}

async function openDrafts(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByRole("button", { name: /^Drafts/ }).click();
}

async function areaMetrics(page: Page): Promise<Record<string, unknown>> {
  const area = page.locator(".draft-list .paged-scroll");
  return area.evaluate((el) => {
    const items = [...el.querySelectorAll(".draft-row")];
    const last = items[items.length - 1];
    return {
      areaHeight: el.clientHeight,
      lastRowBottom: Math.round(last.getBoundingClientRect().bottom - el.getBoundingClientRect().top),
      rowHeights: items.map((row) => Math.round(row.getBoundingClientRect().height)),
    };
  });
}

test("real drafts: six rows fit the fixed area and pagination keeps its height", async ({ page }) => {
  await openDrafts(page);
  const area = page.locator(".draft-list .paged-scroll");
  await expect(area.locator(".draft-row")).toHaveCount(6);
  const metrics = await areaMetrics(page);
  console.log(`REAL_METRICS=${JSON.stringify(metrics)}`);
  expect(metrics.lastRowBottom as number).toBeLessThanOrEqual(metrics.areaHeight as number);
  await page.locator(".draft-list [data-page-next='drafts']").click();
  await expect(area.locator(".draft-row").first()).toBeVisible();
  const nextHeight = await area.evaluate((el) => el.clientHeight);
  expect(nextHeight).toBe(metrics.areaHeight);
});

test("worst-case rows fit the fixed area", async ({ page }) => {
  const drafts = Array.from({ length: 6 }, (_, index) => worstCaseDraft(index));
  await page.route("**/api/drafts", (route) => route.fulfill({ json: { drafts } }));
  await openDrafts(page);
  const area = page.locator(".draft-list .paged-scroll");
  await expect(area.locator(".draft-row")).toHaveCount(6);
  const metrics = await areaMetrics(page);
  console.log(`WORST_METRICS=${JSON.stringify(metrics)}`);
  expect(metrics.lastRowBottom as number).toBeLessThanOrEqual(metrics.areaHeight as number);
});

test("empty state fills the same fixed area", async ({ page }) => {
  await page.route("**/api/drafts", (route) => route.fulfill({ json: { drafts: [] } }));
  await openDrafts(page);
  const empty = page.locator(".draft-list .empty-state");
  await expect(empty).toBeVisible();
  const emptyHeight = await empty.evaluate((el) => el.clientHeight);
  console.log(`EMPTY_HEIGHT=${emptyHeight}`);
  expect(emptyHeight).toBeGreaterThanOrEqual(400);
});

test("capture screenshots for polish", async ({ page }) => {
  const fs = await import("node:fs");
  fs.mkdirSync("/tmp/gewu-shots", { recursive: true });
  await openDrafts(page);
  await page.screenshot({ path: "/tmp/gewu-shots/drafts.png", fullPage: true });
  await page.getByRole("button", { name: "Home", exact: true }).click();
  await page.screenshot({ path: "/tmp/gewu-shots/home.png", fullPage: true });
  await page.getByRole("button", { name: "Authoring", exact: true }).click();
  await page.screenshot({ path: "/tmp/gewu-shots/authoring.png", fullPage: true });
  await page.getByRole("button", { name: "Practice", exact: true }).click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: "/tmp/gewu-shots/practice.png", fullPage: true });
  await page.getByRole("button", { name: "Review history", exact: true }).click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: "/tmp/gewu-shots/history.png", fullPage: true });
});

test("no horizontal overflow on any view", async ({ page }) => {
  page.on("console", (msg) => { if (msg.type() === "error") console.log(`PAGE_ERROR=${msg.text()}`); });
  await page.goto("/");
  const dataViews: Record<string, string> = { Home: "home", Practice: "practice", Units: "units", Authoring: "new", Drafts: "drafts", "Review history": "history" };
  for (const view of ["Home", "Practice", "Units", "Authoring", "Drafts", "Review history"]) {
    const target = page.locator(`.nav-item[data-view="${dataViews[view]}"]`);
    console.log(`NAV_PAGE_BODY=${view}:${(await page.locator("body").innerText()).slice(0, 120).replace(/\n/g, " | ")}`);
    await target.waitFor({ state: "visible", timeout: 8000 });
    console.log(`NAV_CLICK=${view}`);
    await target.click();
    await page.waitForTimeout(300);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    console.log(`NAV_OVERFLOW=${view}:${overflow}`);
    expect(overflow).toBeLessThanOrEqual(0);
  }
});
