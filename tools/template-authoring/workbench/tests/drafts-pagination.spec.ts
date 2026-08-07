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

test("human revision moves a needs_revision draft to a directly publishable state", async ({ page }) => {
  const id = "rev-flow-1";
  const baseDraft = {
    id,
    title: "Revision flow draft",
    problem: "Return the maximum value from a non-empty list.",
    provider: "deepseek",
    model: "deepseek-v4-flash",
    language: "python",
    variants: 1,
    modes: ["shadow_typing"],
    assistance: [],
    status: "needs_revision",
    artifactPath: `artifacts/${id}`,
    createdAt: "2026-08-07T08:00:00.000Z",
  };
  const needReview = { id: "rev-1", draftId: id, role: "algorithm_correctness", verdict: "needs_revision", artifactHash: "hash-1", createdAt: "2026-08-07T08:01:00.000Z" };
  const humanReview = { id: "rev-2", draftId: id, role: "human_revision", verdict: "pass", artifactHash: null, createdAt: "2026-08-07T08:02:00.000Z" };
  let saved = false;
  const draftAt = () => ({ ...baseDraft, status: saved ? "validated" : "needs_revision" });
  await page.route("**/api/drafts", (route) => route.fulfill({ json: { drafts: [draftAt()] } }));
  await page.route("**/api/reviews", (route) => route.fulfill({ json: { reviews: saved ? [humanReview] : [needReview] } }));
  await page.route("**/api/drafts/rev-flow-1/artifact", (route) => {
    if (route.request().method() === "PUT") {
      saved = true;
      return route.fulfill({ json: { status: "validated", draft: draftAt() } });
    }
    return route.fulfill({
      json: {
        draft: draftAt(),
        files: {
          "unit.json": JSON.stringify({ schema_version: "1", id: "unit.revision-flow", statement: "Return the maximum value." }),
          "code/python.py": "def maximum(items):\n    return max(items)\n",
          "code/__pycache__/python.cpython-310.pyc": "binary-garbage",
        },
        reviews: [needReview],
      },
    });
  });

  await openDrafts(page);
  const row = page.locator(`.draft-row[data-draft-id="${id}"]`);
  await expect(row.locator(".draft-status")).toHaveText("Needs revision");
  await expect(row.locator("[data-view-artifact-id]")).toHaveText("Revise artifact");
  await expect(row.locator("[data-accept-id]")).toBeVisible();

  await row.locator("[data-view-artifact-id]").click();
  await expect(page.locator("#artifact-inspector")).toBeVisible();
  const fileNames = await page.locator(".artifact-file summary").allTextContents();
  expect(fileNames.some((name) => name.includes(".pyc"))).toBe(false);
  await page.locator("#save-artifact").click();
  await page.waitForTimeout(400);
  await page.locator("#close-artifact").click();

  await expect(row.locator(".draft-status")).toHaveText("Contract valid");
  await expect(row.locator("[data-review-id]")).toBeVisible();
  await expect(row.locator("[data-accept-id]")).toBeVisible();
});

test("requesting a revision keeps the page, the row, and shows a toast", async ({ page }) => {
  const base = (index: number) => ({
    id: `rollback-${index}`,
    title: `Rollback draft ${index}`,
    problem: "Return the maximum value.",
    provider: "deepseek",
    model: "deepseek-v4-flash",
    language: "python",
    variants: 1,
    modes: ["shadow_typing"],
    assistance: [],
    status: index === 1 ? "generated" : "queued",
    artifactPath: index === 1 ? "artifacts/rollback-1" : undefined,
    createdAt: new Date(Date.UTC(2026, 7, 5, 8, index)).toISOString(),
  });
  let rolled = false;
  // Rollback target is last so it lands on page 2 (8 drafts, 6 per page).
  const draftsAt = () => {
    const ordered = Array.from({ length: 8 }, (_, index) => ({ ...base(index + 2), status: "queued" }));
    ordered[7] = { ...base(1), status: rolled ? "revision_requested" : "generated", artifactPath: rolled ? undefined : base(1).artifactPath };
    return ordered;
  };
  await page.route("**/api/drafts", (route) => route.fulfill({ json: { drafts: draftsAt() } }));
  await page.route("**/api/reviews", (route) => route.fulfill({ json: { reviews: [] } }));
  await page.route("**/api/drafts/rollback-1/rollback", (route) => { rolled = true; return route.fulfill({ json: { status: "revision_requested" } }); });

  await openDrafts(page);
  await expect(page.locator(".draft-row")).toHaveCount(6);
  await page.locator(".draft-list [data-page-next='drafts']").click();
  await expect(page.locator(".draft-row")).toHaveCount(2);
  const row = page.locator('.draft-row[data-draft-id="rollback-1"]');
  await expect(row).toBeVisible();
  const rowY = await row.evaluate((el) => el.getBoundingClientRect().y);
  await row.locator("[data-rollback-id]").click();
  await expect(page.locator("#app-toast")).toContainText("Revision requested");
  await expect(row).toBeVisible();
  await expect(row.locator(".draft-status")).toHaveText("Revision requested");
  const pageInfo = await page.locator(".draft-list .pagination-info").textContent();
  expect(pageInfo).toContain("7–8 of 8");
  const afterY = await row.evaluate((el) => el.getBoundingClientRect().y);
  expect(Math.abs(afterY - rowY)).toBeLessThanOrEqual(2);
});
