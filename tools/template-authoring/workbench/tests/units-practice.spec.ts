import { expect, test } from "playwright/test";

test.beforeEach(async ({ request }) => {
  // Reset the Core so the practice view starts from a clean session.
  const rpc = async (method: string, params: unknown = {}) => request.post("/core/rpc", {
    data: { jsonrpc: "2.0", id: Date.now(), method, params },
  });
  await rpc("gewu/handshake", { protocol_min: 2, protocol_max: 2, client_name: "gewu-playwright-units", client_version: "0.1.0" });
  const checkpoints = await rpc("gewu/listCheckpoints");
  const payload = await checkpoints.json() as { result?: { checkpoints?: Array<{ id: string }> } };
  for (const checkpoint of payload.result?.checkpoints ?? []) await rpc("gewu/discardCheckpoint", { checkpoint_id: checkpoint.id });
});

test("Practice on a ledger-sourced unit opens practice with the unit selected", async ({ page }) => {
  // No local draft: the unit row comes only from the published ledger
  // (/api/published-units), which is the path that previously resolved the
  // click by draft id and silently did nothing.
  await page.route("**/api/drafts", (route) => route.fulfill({ json: { drafts: [] } }));
  await page.route("**/api/published-units", (route) => route.fulfill({
    json: {
      units: [{ id: "graph.bfs", title: "Graph BFS", language: "python", revision: 1, modes: ["shadow_typing", "flow_recall"], updatedAt: new Date().toISOString() }],
    },
  }));

  await page.goto("/");
  await page.getByRole("button", { name: "Units" }).click();
  const practiceButton = page.locator("[data-unit-practice-id='graph.bfs']");
  await expect(practiceButton).toBeEnabled();
  await practiceButton.click();

  await expect(page.locator("#practice-connection")).toContainText("Core connected");
  await expect(page.locator("#practice-unit")).toHaveValue("graph.bfs");
});
