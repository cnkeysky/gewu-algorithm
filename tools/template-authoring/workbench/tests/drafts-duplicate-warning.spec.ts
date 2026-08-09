import { expect, test } from "playwright/test";

test("submitting a duplicate problem warns before creating another draft", async ({ page }) => {
  const existing = {
    id: "draft-0",
    title: "Existing",
    problem: "Given an array of integers and a target, return the indices of the two numbers that add up to target.",
    provider: "relay",
    model: "deepseek-v4-flash",
    language: "python",
    variants: 0,
    modes: ["shadow_typing"],
    assistance: [],
    status: "generated",
    createdAt: "2026-08-08T08:30:00.000Z",
  };
  await page.route("**/api/drafts", async (route) => {
    if (route.request().method() === "POST") {
      await route.fulfill({ status: 201, json: { draft: { ...existing, id: "draft-new" } } });
    } else {
      await route.fulfill({ json: { drafts: [existing] } });
    }
  });
  await page.route("**/api/reviews", (route) => route.fulfill({ json: { reviews: [] } }));
  await page.goto("/");
  // Wait for the initial API sync so localStorage holds the seeded draft
  // before submitting (the duplicate check reads local drafts).
  await page.getByRole("button", { name: /^Drafts/ }).click();
  await expect(page.locator("#drafts-count")).toHaveText("1");
  await page.getByRole("button", { name: "Authoring", exact: true }).click();

  await page.locator("#problem").fill("Given   an array of integers and a target, return   the   indices of the two numbers that add up to target.");
  await page.locator('input[name="mode"][value="shadow_typing"]').check();
  await page.locator("#submit-draft").click();

  await expect(page.locator("#confirm-dialog")).toBeVisible();
  await expect(page.locator("#confirm-title")).toHaveText("Duplicate draft?");
  await page.locator("#confirm-cancel").click();
  await expect(page.locator("#confirm-dialog")).toBeHidden();

  await page.locator("#submit-draft").click();
  await expect(page.locator("#confirm-dialog")).toBeVisible();
  await page.locator("#confirm-ok").click();
  await expect(page.locator("#confirm-dialog")).toBeHidden();
  await expect(page.locator("#app-toast")).toContainText("saved");
});
