import { expect, test } from "playwright/test";

test.skip(!process.env.GEWU_E2E_EXISTING, "requires an explicitly selected existing development server");

test("existing BFS import checkpoint accepts one Enter", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Practice", exact: true }).click();
  await expect(page.locator("#practice-connection")).toContainText("Core connected");
  await page.locator("#practice-unit").selectOption("graph.bfs");
  await page.locator("#practice-mode").selectOption("shadow_typing");
  await page.locator("#practice-start").getByRole("button", { name: /Start practice/ }).click();

  const editor = page.locator("#session-editor");
  const monaco = editor.locator(".monaco-editor");
  const meta = page.locator("#session-meta");
  await expect(monaco).toBeVisible();
  await expect(meta).toContainText("progress 29/403");
  await monaco.click({ position: { x: 220, y: 30 } });
  const cursor = editor.locator(".cursor").first();
  const before = await cursor.boundingBox();
  expect(before).not.toBeNull();

  await page.keyboard.press("Enter");
  await expect(meta).toContainText("progress 30/403");
  await expect.poll(async () => (await cursor.boundingBox())?.y ?? 0).toBeGreaterThan((before?.y ?? 0) + 10);
});
