import { expect, test } from "playwright/test";

test("shadow typing Enter advances the accepted text and cursor", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Practice", exact: true }).click();
  await expect(page.locator("#practice-connection")).toHaveText("Core connected");
  await page.locator("#practice-unit").selectOption("graph.bfs");
  await page.locator("#practice-mode").selectOption("shadow_typing");
  await page.locator("#practice-start").getByRole("button", { name: /Start practice/ }).click();

  const editor = page.locator("#session-editor");
  await expect(editor).toBeVisible();
  const monaco = editor.locator(".monaco-editor");
  await expect(monaco).toBeVisible();
  await monaco.click({ position: { x: 220, y: 30 } });
  await page.keyboard.type("from collections import deque");
  await expect(page.locator("#session-meta")).toContainText("progress 29/403");

  const cursor = editor.locator(".cursor").first();
  const before = await cursor.boundingBox();
  expect(before).not.toBeNull();
  await page.keyboard.press("Enter");
  await expect(page.locator("#session-meta")).toContainText("progress 30/403");
  await expect.poll(async () => (await cursor.boundingBox())?.y ?? 0).toBeGreaterThan((before?.y ?? 0) + 10);
});

test("mouse wheel leaves Monaco when the editor cannot scroll further", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Practice", exact: true }).click();
  await expect(page.locator("#practice-connection")).toHaveText("Core connected");
  await page.locator("#practice-unit").selectOption("graph.bfs");
  await page.locator("#practice-mode").selectOption("shadow_typing");
  await page.locator("#practice-start").getByRole("button", { name: /Start practice/ }).click();

  const editor = page.locator("#session-editor");
  await expect(editor).toBeVisible();
  await expect(editor.locator(".monaco-editor")).toBeVisible();
  await editor.evaluate((element) => window.scrollTo(0, element.getBoundingClientRect().top + window.scrollY - 80));
  const box = await editor.boundingBox();
  expect(box).not.toBeNull();
  const before = await page.evaluate(() => window.scrollY);
  await page.mouse.move((box?.x ?? 0) + 200, (box?.y ?? 0) + 200);
  await page.mouse.wheel(0, 700);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(before);
});
