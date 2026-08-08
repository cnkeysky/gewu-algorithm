import { expect, test } from "playwright/test";

function draft(title: string, language: string, index: number) {
  return {
    id: `draft-${index}`,
    title,
    problem: "Given an array of integers and a target, return indices.",
    provider: "deepseek",
    model: "deepseek-v4-flash",
    language,
    variants: 0,
    modes: ["shadow_typing", "flow_recall", "code_recall", "reasoning_recall", "transfer_practice"],
    assistance: ["comments", "cloze"],
    status: "generated",
    createdAt: new Date(Date.UTC(2026, 7, 5, 8, 30, index)).toISOString(),
  };
}

test("practice language selector defaults to a concrete catalog language", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Practice", exact: true }).click();
  await expect(page.locator("#practice-connection")).toContainText("Core connected");
  await expect(page.locator("#practice-language")).toHaveValue("python");
});

test("drafts language filter narrows rows without reordering the status pills", async ({ page }) => {
  const drafts = [
    draft("Python one", "python", 0),
    draft("Python two", "python", 1),
    draft("Java one", "java", 2),
    draft("Java two", "java", 3),
  ];
  await page.route("**/api/drafts", (route) => route.fulfill({ json: { drafts } }));
  await page.route("**/api/reviews", (route) => route.fulfill({ json: { reviews: [] } }));
  await page.goto("/");
  await page.getByRole("button", { name: /^Drafts/ }).click();

  const rows = page.locator(".draft-row");
  const pills = page.locator("#draft-filters .filter-pill");
  await expect(rows).toHaveCount(4);
  const pillsBefore = await pills.allTextContents();

  await page.locator("#draft-language").selectOption("java");
  await expect(rows).toHaveCount(2);
  await expect(rows.first()).toContainText("Java one");
  expect(await pills.allTextContents()).toEqual(pillsBefore);

  await page.locator("#draft-language").selectOption("all");
  await expect(rows).toHaveCount(4);
});

test("review history language filter joins drafts for labels and narrowing", async ({ page }) => {
  const drafts = [draft("Python unit", "python", 0), draft("Java unit", "java", 1)];
  const reviews = [
    { id: "review-0", draftId: "draft-0", role: "algorithm_correctness", verdict: "pass", artifactHash: "hash-0", createdAt: "2026-08-05T08:30:00.000Z" },
    { id: "review-1", draftId: "draft-1", role: "learning_design", verdict: "needs_revision", artifactHash: "hash-1", createdAt: "2026-08-05T08:31:00.000Z" },
  ];
  await page.route("**/api/drafts", (route) => route.fulfill({ json: { drafts } }));
  await page.route("**/api/reviews", (route) => route.fulfill({ json: { reviews } }));
  await page.goto("/");
  await page.getByRole("button", { name: /^Review history/ }).click();

  const rows = page.locator(".history-row");
  await expect(rows).toHaveCount(2);
  await expect(rows.first()).toContainText("python");

  await page.locator("#history-language").selectOption("java");
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText("Java unit");
  await expect(rows.first()).toContainText("java");
});
