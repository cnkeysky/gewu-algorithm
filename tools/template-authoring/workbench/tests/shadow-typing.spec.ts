import { expect, test } from "playwright/test";

test("shadow typing advances multiline guidance through Enter and indentation", async ({ page }) => {
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
  const guidance = editor.locator(".gewu-shadow-guidance");
  const meta = page.locator("#session-meta");
  await expect(guidance).toHaveText("from collections import deque");
  await page.keyboard.type("from collections import deque");
  await expect(meta).toContainText("progress 29/403");
  await expect(guidance).toHaveText("Enter");

  const cursor = editor.locator(".cursor").first();
  const before = await cursor.boundingBox();
  expect(before).not.toBeNull();
  await page.keyboard.press("Enter");
  await expect(meta).toContainText("progress 30/403");
  await expect.poll(async () => (await cursor.boundingBox())?.y ?? 0).toBeGreaterThan((before?.y ?? 0) + 10);
  await expect(guidance).toHaveText("Enter");
  await page.keyboard.press("Enter");
  await expect(meta).toContainText("progress 31/403");
  await expect(guidance).toHaveText("Enter");
  await page.keyboard.press("Enter");
  await expect(meta).toContainText("progress 32/403");
  await expect(guidance).toHaveText("def bfs(graph: list[list[int]], start: int) -> list[int]:");

  await page.keyboard.type("def bfs(graph: list[list[int]], start: int) -> list[int]:");
  await expect(meta).toContainText("progress 89/403");
  await expect(guidance).toHaveText("Enter");
  await page.keyboard.press("Enter");
  await expect(meta).toContainText("progress 90/403");
  await expect(guidance).toHaveText("4sp");
  await page.keyboard.press("Tab");
  await expect(meta).toContainText("progress 94/403");
  await expect(guidance).toHaveText("visited = {start}");

  await page.keyboard.type("visited = {start}");
  await expect(meta).toContainText("progress 111/403");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Tab");
  await page.keyboard.type("queue = deque([start])");
  await expect(meta).toContainText("progress 138/403");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Tab");
  await page.keyboard.type("order = []");
  await expect(meta).toContainText("progress 153/403");
  await page.keyboard.press("Enter");
  await expect(guidance).toHaveText("Enter");
  await page.keyboard.press("Enter");
  await expect(meta).toContainText("progress 155/403");
  await expect(guidance).toHaveText("4sp");
  await page.keyboard.press("Tab");
  await page.keyboard.type("while queue:");
  await expect(meta).toContainText("progress 171/403");
  await page.keyboard.press("Enter");
  await expect(meta).toContainText("progress 172/403");
  await expect(guidance).toHaveText("8sp");
  await page.keyboard.press("Tab");
  await expect(meta).toContainText("progress 176/403");
  await expect(guidance).toHaveText("4sp");
  await page.keyboard.press("Tab");
  await expect(meta).toContainText("progress 180/403");
  await expect(guidance).toHaveText("node = queue.popleft()");
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

test("copy, paste, and deletion preserve the strict accepted prefix", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Practice", exact: true }).click();
  await expect(page.locator("#practice-connection")).toHaveText("Core connected");
  await page.locator("#practice-unit").selectOption("search.binary-search");
  await page.locator("#practice-mode").selectOption("shadow_typing");
  await page.locator("#practice-start").getByRole("button", { name: /Start practice/ }).click();

  const editor = page.locator("#session-editor");
  const monaco = editor.locator(".monaco-editor");
  const guidance = editor.locator(".gewu-shadow-guidance");
  const meta = page.locator("#session-meta");
  await expect(monaco).toBeVisible();
  await monaco.click({ position: { x: 220, y: 30 } });
  await expect(guidance).toHaveText("from collections.abc import Sequence");

  const firstLine = "from collections.abc import Sequence";
  await page.evaluate((text) => navigator.clipboard.writeText(text), firstLine);
  await page.keyboard.press("Control+V");
  await expect(meta).toContainText("progress 36/414");
  await expect(guidance).toHaveText("Enter");

  await page.keyboard.press("Control+A");
  await page.keyboard.press("Control+C");
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(firstLine);
  await expect(meta).toContainText("progress 36/414");

  await page.keyboard.press("End");
  await page.keyboard.press("Backspace");
  await expect(meta).toContainText("progress 35/414");
  await expect(meta).toContainText("corrections 1");
  await expect(guidance).toHaveText("e");
  await page.keyboard.type("e");
  await expect(meta).toContainText("progress 36/414");

  await page.keyboard.press("Control+A");
  await page.keyboard.press("Backspace");
  await expect(meta).toContainText("progress 0/414");
  await expect(meta).toContainText("corrections 2");
  await expect(guidance).toHaveText(firstLine);

  await page.evaluate(() => navigator.clipboard.writeText("from collections.abc iport Seqence"));
  await page.keyboard.press("Control+V");
  await expect(meta).toContainText("progress 0/414");
  await expect(meta).toContainText("rejected inputs 34");
  await expect(guidance).toHaveText(firstLine);
});

test("Unicode paste and deletion use scalar character progress", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Practice", exact: true }).click();
  await expect(page.locator("#practice-connection")).toHaveText("Core connected");
  await page.locator("#practice-unit").selectOption("validation.unicode");
  await page.locator("#practice-mode").selectOption("shadow_typing");
  await page.locator("#practice-start").getByRole("button", { name: /Start practice/ }).click();

  const editor = page.locator("#session-editor");
  const monaco = editor.locator(".monaco-editor");
  const guidance = editor.locator(".gewu-shadow-guidance");
  const meta = page.locator("#session-meta");
  await expect(monaco).toBeVisible();
  await monaco.click({ position: { x: 220, y: 30 } });

  await page.evaluate(() => navigator.clipboard.writeText("def describe(node: str) -> str:"));
  await page.keyboard.press("Control+V");
  await expect(meta).toContainText("progress 31/110");
  await page.keyboard.press("Enter");
  await expect(guidance).toHaveText("4sp");
  await page.keyboard.press("Tab");
  await expect(meta).toContainText("progress 36/110");
  await expect(guidance).toHaveText('status = "已访问🙂"');
  await page.evaluate(() => navigator.clipboard.writeText('status = "已访问🙂"'));
  await page.keyboard.press("Control+V");
  await expect(meta).toContainText("progress 51/110");
  await expect(guidance).toHaveText("Enter");

  await page.keyboard.press("Backspace");
  await expect(meta).toContainText("progress 50/110");
  await expect(guidance).toHaveText('"');
});
