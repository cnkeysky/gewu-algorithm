import { expect, test } from "playwright/test";

function draft(status: string, index: number) {
  return {
    id: `d-${index}`,
    title: `Draft ${index}`,
    problem: "P.",
    provider: "deepseek",
    model: "deepseek-v4-flash",
    language: "python",
    variants: 1,
    modes: ["shadow_typing"],
    assistance: [],
    status,
    artifactPath: `artifacts/d-${index}`,
    createdAt: new Date(Date.UTC(2026, 7, 5, 9, index)).toISOString(),
  };
}

test("artifact inspector is read-only from history and View artifact, editable on Revise artifact", async ({ page }) => {
  const drafts = [draft("needs_revision", 0), draft("validated", 1)];
  const reviews = [{ id: "review-0", draftId: "d-0", role: "learning_design", verdict: "needs_revision", artifactHash: "hash-0", createdAt: "2026-08-05T08:31:00.000Z" }];
  await page.route("**/api/drafts", (route) => route.fulfill({ json: { drafts } }));
  await page.route("**/api/reviews", (route) => route.fulfill({ json: { reviews } }));
  const artifact = (status: string) => ({ draft: { ...draft(status, 0), id: "d-0" }, files: { "unit.json": "{}", "code/python.py": "def solve():\n    pass\n" }, reviews: [] });
  await page.route("**/api/drafts/d-0/artifact", (route) => route.fulfill({ json: artifact("needs_revision") }));
  await page.route("**/api/drafts/d-1/artifact", (route) => route.fulfill({ json: artifact("validated") }));
  await page.goto("/");

  // Drafts: needs_revision row -> Revise artifact -> editable.
  await page.getByRole("button", { name: /^Drafts/ }).click();
  await page.locator(".draft-row", { hasText: "Draft 0" }).locator("[data-view-artifact-id]").click();
  await expect(page.locator("#save-artifact")).toBeVisible();
  await expect(page.locator("#artifact-manifest")).toBeEditable();
  await page.locator("#close-artifact").click();

  // Drafts: validated row -> View artifact -> read-only.
  await page.locator(".draft-row", { hasText: "Draft 1" }).locator("[data-view-artifact-id]").click();
  await expect(page.locator("#save-artifact")).toBeHidden();
  await expect(page.locator("#artifact-meta")).toContainText("Read-only view");
  await page.locator("#close-artifact").click();

  // Review history -> View report -> read-only.
  await page.getByRole("button", { name: /^Review history/ }).click();
  await page.locator("#history-view [data-view-artifact-id]").first().click();
  await expect(page.locator("#save-artifact")).toBeHidden();
  await expect(page.locator("#artifact-meta")).toContainText("Read-only view");
});
