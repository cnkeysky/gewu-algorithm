import { expect, test } from "playwright/test";

test.beforeEach(async ({ request }) => {
  const rpc = async (method: string, params: unknown = {}) => request.post("/core/rpc", {
    data: { jsonrpc: "2.0", id: Date.now(), method, params },
  });
  await rpc("gewu/handshake", { protocol_min: 2, protocol_max: 2, client_name: "gewu-playwright-reset", client_version: "0.1.0" });
  const checkpoints = await rpc("gewu/listCheckpoints");
  const payload = await checkpoints.json() as { result?: { checkpoints?: Array<{ id: string }> } };
  for (const checkpoint of payload.result?.checkpoints ?? []) await rpc("gewu/discardCheckpoint", { checkpoint_id: checkpoint.id });
});

test("existing BFS import checkpoint resumes after reload and accepts one Enter", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Practice", exact: true }).click();
  await expect(page.locator("#practice-connection")).toContainText("Core connected");
  await page.locator("#practice-unit").selectOption("graph.bfs");
  await page.locator("#practice-mode").selectOption("shadow_typing");
  await page.locator("#practice-start").getByRole("button", { name: /Start practice/ }).click();

  const editor = page.locator("#session-editor .monaco-editor");
  const meta = page.locator("#session-meta");
  await expect(editor).toBeVisible();
  await expect(meta).toContainText("progress 0/403");
  await editor.click({ position: { x: 220, y: 30 } });
  await page.keyboard.type("from collections import deque");
  await expect(meta).toContainText("progress 29/403");

  // Interrupt by reloading so the host persists the checkpoint.
  await page.reload();
  await page.getByRole("button", { name: "Practice", exact: true }).click();
  await expect(page.locator("#practice-connection")).toContainText("Core connected");
  await page.locator("#practice-unit").selectOption("graph.bfs");
  await page.locator("#practice-mode").selectOption("shadow_typing");
  await page.locator("#refresh-checkpoints").click();
  await page.locator("#practice-checkpoints [data-resume-checkpoint]").first().click();
  await expect(meta).toContainText("progress 29/403");

  await editor.click({ position: { x: 220, y: 30 } });
  const cursor = editor.locator(".cursor").first();
  const before = await cursor.boundingBox();
  expect(before).not.toBeNull();
  await page.keyboard.press("Enter");
  await expect(meta).toContainText("progress 30/403");
  await expect.poll(async () => (await cursor.boundingBox())?.y ?? 0).toBeGreaterThan((before?.y ?? 0) + 10);
});
