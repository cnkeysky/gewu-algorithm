import { expect, test } from "playwright/test";
import { readFileSync } from "node:fs";

const bfsSource = readFileSync(
  new URL("../../../../fixtures/algorithm-units/valid/graph/bfs/code/python.py", import.meta.url),
  "utf8",
);

test.beforeEach(async ({ request }) => {
  const rpc = async (method: string, params: unknown = {}) => request.post("/core/rpc", {
    data: { jsonrpc: "2.0", id: Date.now(), method, params },
  });
  await rpc("gewu/handshake", { protocol_min: 2, protocol_max: 2, client_name: "gewu-playwright-reset", client_version: "0.1.0" });
  const checkpoints = await rpc("gewu/listCheckpoints");
  const payload = await checkpoints.json() as { result?: { checkpoints?: Array<{ id: string }> } };
  for (const checkpoint of payload.result?.checkpoints ?? []) await rpc("gewu/discardCheckpoint", { checkpoint_id: checkpoint.id });
});

test("shadow typing advances multiline guidance through Enter and indentation", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Practice", exact: true }).click();
  await expect(page.locator("#practice-connection")).toContainText("Core connected");
  await page.locator("#practice-unit").selectOption("graph.bfs");
  await page.locator("#practice-mode").selectOption("shadow_typing");
  await page.locator("#practice-start").getByRole("button", { name: /Start practice/ }).click();
  await expect(page.locator(".session-problem")).toBeVisible();
  await expect(page.locator("#session-question")).toContainText("states");

  const editor = page.locator("#session-editor");
  await expect(editor).toBeVisible();
  const monaco = editor.locator(".monaco-editor");
  await expect(monaco).toBeVisible();
  await monaco.click({ position: { x: 220, y: 30 } });
  const guidance = editor.locator(".gewu-shadow-guidance");
  const meta = page.locator("#session-meta");
  await expect(guidance).toHaveText("from collections import deque");
  await page.keyboard.type("from collections import deque");
  await expect(meta).toContainText("progress 7%");
  await expect(guidance).toHaveText("Enter");

  const cursor = editor.locator(".cursor").first();
  const before = await cursor.boundingBox();
  expect(before).not.toBeNull();
  await page.keyboard.press("Enter");
  await expect(meta).toContainText("progress 7%");
  await expect.poll(async () => (await cursor.boundingBox())?.y ?? 0).toBeGreaterThan((before?.y ?? 0) + 10);
  await expect(guidance).toHaveText("Enter");
  await page.keyboard.press("Enter");
  await expect(meta).toContainText("progress 8%");
  await expect(guidance).toHaveText("Enter");
  await page.keyboard.press("Enter");
  await expect(meta).toContainText("progress 8%");
  await expect(guidance).toHaveText("def bfs(graph: list[list[int]], start: int) -> list[int]:");

  await page.keyboard.type("def bfs(graph: list[list[int]], start: int) -> list[int]:", { delay: 8 });
  await expect(guidance).toHaveText("Enter");
  await expect(meta).toContainText("progress 22%");
  await page.keyboard.press("Enter");
  await expect(meta).toContainText("progress 22%");
  await expect(guidance).toHaveText("4sp");
  await page.keyboard.press("Tab");
  await expect(meta).toContainText("progress 23%");
  await expect(guidance).toHaveText("visited = {start}");

  await page.keyboard.type("visited = {start}");
  await expect(meta).toContainText("progress 28%");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Tab");
  await page.keyboard.type("queue = deque([start])");
  await expect(meta).toContainText("progress 34%");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Tab");
  await page.keyboard.type("order = []");
  await expect(meta).toContainText("progress 38%");
  await page.keyboard.press("Enter");
  await expect(guidance).toHaveText("Enter");
  await page.keyboard.press("Enter");
  await expect(meta).toContainText("progress 38%");
  await expect(guidance).toHaveText("4sp");
  await page.keyboard.press("Tab");
  await page.keyboard.type("while queue:");
  await expect(meta).toContainText("progress 42%");
  await page.keyboard.press("Enter");
  await expect(meta).toContainText("progress 43%");
  await expect(guidance).toHaveText("8sp");
  await page.keyboard.press("Tab");
  await expect(meta).toContainText("progress 44%");
  await expect(guidance).toHaveText("4sp");
  await page.keyboard.press("Tab");
  await expect(meta).toContainText("progress 45%");
  await expect(guidance).toHaveText("node = queue.popleft()");
});

test("problem statement stays bound across modes, restart, and checkpoint resume", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Practice", exact: true }).click();
  await expect(page.locator("#practice-connection")).toContainText("Core connected");
  await page.locator("#practice-unit").selectOption("search.binary-search");
  await page.locator("#practice-mode").selectOption("shadow_typing");
  await page.locator("#practice-start").getByRole("button", { name: /Start practice/ }).click();

  const statement = page.locator("#session-question");
  await expect(statement).toContainText("ascending sorted array");
  const original = await statement.textContent();
  expect(original).toContain("ascending sorted array");
  await expect(statement.locator(".katex")).toHaveCount(2);

  await page.locator("#refresh-checkpoints").click();
  await page.locator("#practice-checkpoints [data-resume-checkpoint]").first().click();
  await expect(statement).toHaveText(original ?? "");
  await expect(statement.locator(".katex")).toHaveCount(2);

  await page.locator("#practice-mode").selectOption("flow_recall");
  await page.locator("#practice-start").getByRole("button", { name: /Start practice/ }).click();
  await expect(statement).toHaveText(original ?? "");
  await expect(statement.locator(".katex")).toHaveCount(2);
  await page.locator("#session-restart").click();
  await expect(statement).toHaveText(original ?? "");
});

test("active session shows template language and keeps the editor scrollbar available", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Practice", exact: true }).click();
  await expect(page.locator("#practice-connection")).toContainText("Core connected");
  await page.locator("#practice-unit").selectOption("graph.bfs");
  await page.locator("#practice-mode").selectOption("shadow_typing");
  await page.locator("#practice-start").getByRole("button", { name: /Start practice/ }).click();
  await expect(page.locator("#session-language")).toHaveText("python");
  await expect(page.locator("#session-stop")).toHaveClass(/danger/);
  await expect(page.locator(".monaco-scrollable-element[role='presentation']")).toBeVisible();
  await expect(page.locator("#session-language")).toHaveText("python");
  const fontSizeBefore = await page.locator("#session-editor .view-lines").evaluate((node) => getComputedStyle(node).fontSize);
  await page.locator("#editor-font-size").selectOption("16");
  await expect.poll(() => page.locator("#session-editor .view-lines").evaluate((node) => getComputedStyle(node).fontSize)).not.toBe(fontSizeBefore);
});

test("comment-to-code exposes reviewed comments and keeps the full-code editor", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Practice", exact: true }).click();
  await expect(page.locator("#practice-connection")).toContainText("Core connected");
  await page.locator("#practice-unit").selectOption("graph.bfs");
  await page.locator("#practice-mode").selectOption("code_recall");
  await page.locator("#practice-id").selectOption("bfs-comments");
  await page.locator("#practice-start").getByRole("button", { name: /Start practice/ }).click();

  await expect(page.locator("#session-editor .monaco-editor")).toBeVisible();
  await expect(page.locator("#session-context")).toContainText("comment to code");
  await expect(page.locator(".gewu-shadow-guidance")).toHaveText("");
  await expect(page.locator("#session-prompt")).toHaveText("Prompt hidden until Reveal");
  await expect(page.locator("#session-reveal")).toHaveText("Reveal prompt");
  await page.locator("#session-reveal").click();
  await expect(page.locator("#session-prompt")).toHaveText("Reconstruct the traversal from the reviewed operation comments.");
  await expect(page.locator("#session-scaffold li")).toHaveCount(3);
  await expect(page.locator("#reveal-scaffold")).toHaveCount(0);
  await page.evaluate((source) => navigator.clipboard.writeText(source), bfsSource);
  await page.locator("#session-editor .monaco-editor").click({ position: { x: 180, y: 30 } });
  await page.keyboard.press("Control+V");
  await expect(page.locator("#session-status")).toHaveText("completed");
});

test("code recall restart keeps the mode and variant bound", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Practice", exact: true }).click();
  await expect(page.locator("#practice-connection")).toContainText("Core connected");
  await page.locator("#practice-unit").selectOption("graph.bfs");
  await page.locator("#practice-mode").selectOption("code_recall");
  await page.locator("#practice-id").selectOption("bfs-comments");
  await page.locator("#practice-start").getByRole("button", { name: /Start practice/ }).click();
  await expect(page.locator("#session-context")).toContainText("practice bfs-comments");
  await page.locator("#session-restart").click();
  await expect(page.locator("#session-editor .monaco-editor")).toBeVisible();
  await expect(page.locator("#session-context")).toContainText("code recall");
  await expect(page.locator("#session-context")).toContainText("practice bfs-comments");
  await expect(page.locator("#session-prompt")).toHaveText("Prompt hidden until Reveal");
});

test("cloze recall renders fixed context and submits the active slot", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Practice", exact: true }).click();
  await expect(page.locator("#practice-connection")).toContainText("Core connected");
  await page.locator("#practice-unit").selectOption("graph.bfs");
  await page.locator("#practice-mode").selectOption("code_recall");
  await page.locator("#practice-id").selectOption("bfs-cloze-frontier");
  await page.locator("#practice-start").getByRole("button", { name: /Start practice/ }).click();
  await expect(page.locator("#session-context")).toContainText("cloze");
  await expect(page.locator("#session-cloze-template")).toBeVisible();
  await expect(page.locator("#session-answer")).toBeVisible();
  await page.locator("#session-answer").fill("queue.popleft()");
  await page.locator("#session-submit").click();
  await expect(page.locator("#session-status")).toHaveText("completed");
  await expect(page.locator("#session-progress")).toContainText("Slot 1 of 1");
});

test("comment-guided recall presents a reviewed cue and scores one code slot", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Practice", exact: true }).click();
  await expect(page.locator("#practice-connection")).toContainText("Core connected");
  await page.locator("#practice-unit").selectOption("graph.bfs");
  await page.locator("#practice-mode").selectOption("code_recall");
  await page.locator("#practice-id").selectOption("bfs-comment-guided-frontier");
  await page.locator("#practice-start").getByRole("button", { name: /Start practice/ }).click();
  await expect(page.locator("#session-context")).toContainText("comment guided");
  await expect(page.locator("#session-scaffold li")).toHaveText("Remove the next FIFO frontier node.");
  await expect(page.locator("#session-cloze-template")).toBeVisible();
  await expect(page.locator("#session-editor-shell")).toBeHidden();
  await page.locator("#session-answer").fill("queue.popleft()");
  await page.locator("#session-submit").click();
  await expect(page.locator("#session-status")).toHaveText("completed");
  await expect(page.locator("#session-progress")).toContainText("Slot 1 of 1");
});

test("reasoning and transfer recall expose step context through the shared answer surface", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Practice", exact: true }).click();
  await expect(page.locator("#practice-connection")).toContainText("Core connected");
  await page.locator("#practice-unit").selectOption("graph.bfs");

  await page.locator("#practice-mode").selectOption("reasoning_recall");
  await page.locator("#practice-id").selectOption("fifo-shortest-distance");
  await page.locator("#practice-start").getByRole("button", { name: /Start practice/ }).click();
  await expect(page.locator("#session-answer")).toBeVisible();
  await expect(page.locator("#session-target")).toBeHidden();
  await expect(page.locator("#session-prompt")).toHaveText("Prompt hidden until Reveal");
  await page.locator("#session-reveal").click();
  await expect(page.locator("#session-prompt")).toHaveText("Why does this frontier order preserve nondecreasing edge distance?");

  await page.locator("#practice-mode").selectOption("transfer_practice");
  await page.locator("#practice-id").selectOption("rotting-oranges");
  await page.locator("#practice-start").getByRole("button", { name: /Start practice/ }).click();
  await expect(page.locator("#session-answer")).toBeVisible();
  await expect(page.locator("#session-progress")).toContainText("Step 1 of 1");
  await expect(page.locator("#session-prompt")).toHaveText("Prompt hidden until Reveal");
});

test("all recall modes keep restart and stop state transitions bound", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Practice", exact: true }).click();
  await expect(page.locator("#practice-connection")).toContainText("Core connected");
  await page.locator("#practice-unit").selectOption("graph.bfs");

  for (const [mode, variant] of [["flow_recall", ""], ["reasoning_recall", "fifo-shortest-distance"], ["transfer_practice", "rotting-oranges"]] as const) {
    await page.locator("#practice-mode").selectOption(mode);
    if (variant) await page.locator("#practice-id").selectOption(variant);
    await page.locator("#practice-start").getByRole("button", { name: /Start practice/ }).click();
    await expect(page.locator("#session-context")).toContainText(mode.replaceAll("_", " "));
    if (variant) await expect(page.locator("#session-context")).toContainText(`practice ${variant}`);
    await page.locator("#session-reveal").click();
    await expect(page.locator("#session-prompt")).not.toHaveText("Prompt hidden until Reveal");
    await page.locator("#session-restart").click();
    await expect(page.locator("#session-prompt")).toHaveText("Prompt hidden until Reveal");
    await page.locator("#session-stop").click();
    await expect(page.locator("#session-status")).toHaveText("stopped");
  }
});

test("practice list cards keep natural height inside equal sections", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Practice", exact: true }).click();
  await expect(page.locator("#practice-connection")).toContainText("Core connected");
  await page.locator("#practice-unit").selectOption("graph.bfs");
  await page.locator("#practice-mode").selectOption("shadow_typing");
  await page.locator("#practice-start").getByRole("button", { name: /Start practice/ }).click();
  await page.locator("#session-editor .monaco-editor").click({ position: { x: 220, y: 30 } });
  await page.keyboard.type("f");
  await page.locator("#refresh-checkpoints").click();
  const card = page.locator("#practice-checkpoints .practice-record").first();
  await expect(card).toBeVisible();
  const cardBox = await card.boundingBox();
  expect(cardBox?.height ?? 999).toBeLessThan(120);
  await expect.poll(async () => {
    const heights = await page.locator(".practice-side section").evaluateAll((sections) => sections.map((section) => Math.round(section.getBoundingClientRect().height)));
    return new Set(heights).size === 1;
  }).toBe(true);
});

test("resume replaces the old session boundary before accepting Enter", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Practice", exact: true }).click();
  await expect(page.locator("#practice-connection")).toContainText("Core connected");
  await page.locator("#practice-unit").selectOption("graph.bfs");
  await page.locator("#practice-mode").selectOption("shadow_typing");
  await page.locator("#practice-start").getByRole("button", { name: /Start practice/ }).click();
  const editor = page.locator("#session-editor .monaco-editor");
  const meta = page.locator("#session-meta");
  await editor.click({ position: { x: 220, y: 30 } });
  await page.keyboard.type("from collections import deque");
  await page.keyboard.press("Enter");
  await expect(meta).toContainText("progress 7%");
  await page.locator("#refresh-checkpoints").click();
  await page.locator("#practice-checkpoints [data-resume-checkpoint]").first().click();
  await expect(meta).toContainText("progress 7%");
  await editor.click({ position: { x: 220, y: 30 } });
  await page.keyboard.press("Enter");
  await expect(meta).toContainText("progress 8%");
});

test("mouse wheel leaves Monaco when the editor cannot scroll further", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Practice", exact: true }).click();
  await expect(page.locator("#practice-connection")).toContainText("Core connected");
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
  await expect(page.locator("#practice-connection")).toContainText("Core connected");
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
  await expect(meta).toContainText("progress 9%");
  await expect(guidance).toHaveText("Enter");

  await page.keyboard.press("Control+A");
  await page.keyboard.press("Control+C");
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(firstLine);
  await expect(meta).toContainText("progress 9%");

  await page.keyboard.press("End");
  await page.keyboard.press("Backspace");
  await expect(meta).toContainText("progress 8%");
  await expect(meta).toContainText("corrections 1");
  await expect(guidance).toHaveText("e");
  await page.keyboard.type("e");
  await expect(meta).toContainText("progress 9%");

  await page.keyboard.press("Control+A");
  await page.keyboard.press("Backspace");
  await expect(meta).toContainText("progress 0%");
  await expect(meta).toContainText("corrections 2");
  await expect(guidance).toHaveText(firstLine);

  await page.evaluate(() => navigator.clipboard.writeText("from collections.abc iport Seqence"));
  await page.keyboard.press("Control+V");
  await expect(meta).toContainText("progress 0%");
  await expect(meta).toContainText("rejected inputs 34");
  await expect(guidance).toHaveText(firstLine);

  // A rejected transaction must not leave Monaco read-only. The next correct
  // character should be accepted without another activation click.
  await page.keyboard.type("f");
  await expect(meta).toContainText("progress 0%");
  await expect(guidance).toHaveText("rom collections.abc import Sequence");
});

test("rapid typing drains transactions in order without rejecting the prefix", async ({ page }) => {
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
  await monaco.click({ position: { x: 220, y: 30 } });
  await page.keyboard.type("from collections import deque", { delay: 0 });
  await expect(meta).toContainText("progress 7%");
  await expect(meta).toContainText("rejected inputs 0");
});

test("history shortcuts cannot bypass the accepted prefix", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Practice", exact: true }).click();
  await expect(page.locator("#practice-connection")).toContainText("Core connected");
  await page.locator("#practice-unit").selectOption("graph.bfs");
  await page.locator("#practice-mode").selectOption("shadow_typing");
  await page.locator("#practice-start").getByRole("button", { name: /Start practice/ }).click();

  const editor = page.locator("#session-editor .monaco-editor");
  const meta = page.locator("#session-meta");
  await editor.click({ position: { x: 220, y: 30 } });
  await page.keyboard.type("from");
  await expect(meta).toContainText("progress 1%");
  await page.keyboard.press("Control+z");
  await expect(meta).toContainText("progress 1%");
});

test("Unicode paste and deletion use scalar character progress", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Practice", exact: true }).click();
  await expect(page.locator("#practice-connection")).toContainText("Core connected");
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
  await expect(meta).toContainText("progress 28%");
  await page.keyboard.press("Enter");
  await expect(guidance).toHaveText("4sp");
  await page.keyboard.press("Tab");
  await expect(meta).toContainText("progress 33%");
  await expect(guidance).toHaveText('status = "已访问🙂"');
  await page.evaluate(() => navigator.clipboard.writeText('status = "已访问🙂"'));
  await page.keyboard.press("Control+V");
  await expect(meta).toContainText("progress 46%");
  await expect(guidance).toHaveText("Enter");

  await page.keyboard.press("Backspace");
  await expect(meta).toContainText("progress 45%");
  await expect(guidance).toHaveText('"');
});

test("practice workspace recovers its Core connection after a transient disconnect", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Practice", exact: true }).click();
  await expect(page.locator("#practice-connection")).toContainText("Core connected");
  await page.route("**/core/rpc", (route) => route.abort());
  await page.locator("#refresh-checkpoints").click();
  await expect(page.locator("#practice-connection")).toContainText("disconnected");
  await page.unroute("**/core/rpc");
  await expect(page.locator("#practice-connection")).toContainText("Core connected", { timeout: 5000 });
});

test("reloading the browser preserves an interrupted practice checkpoint", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Practice", exact: true }).click();
  await page.locator("#practice-unit").selectOption("graph.bfs");
  await page.locator("#practice-mode").selectOption("shadow_typing");
  await page.locator("#practice-start").getByRole("button", { name: /Start practice/ }).click();
  const editor = page.locator("#session-editor .monaco-editor");
  await editor.click({ position: { x: 180, y: 30 } });
  await page.keyboard.type("from");
  await expect(page.locator("#session-meta")).toContainText("progress 1%");

  await page.reload();
  await page.getByRole("button", { name: "Practice", exact: true }).click();
  await expect(page.locator("#practice-checkpoints .practice-record")).toContainText("Breadth-First Search");
  await page.locator("#practice-unit").selectOption("graph.bfs");
  await page.locator("#practice-mode").selectOption("shadow_typing");
  await page.locator("#practice-start").getByRole("button", { name: /Start practice/ }).click();
  await expect(page.locator("#session-meta")).toContainText("progress 1%");
});
