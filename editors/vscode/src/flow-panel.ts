import * as vscode from "vscode";

import { CoreSession } from "./core-client.js";
import { renderStatement } from "./statement-renderer.js";

export interface FlowPanelActions {
  submit(answer: string): Promise<void>;
  reveal(): Promise<void>;
  restart(): Promise<void>;
  stop(): Promise<void>;
  close(): void;
  dispose(): void;
}

export class FlowRecallPanel implements vscode.Disposable {
  readonly #panel: vscode.WebviewPanel;
  readonly #actions: FlowPanelActions;
  #session: CoreSession;
  #revealed = false;
  #message = "Reconstruct the next algorithm step in your own words.";
  #disposed = false;

  public constructor(session: CoreSession, actions: FlowPanelActions) {
    this.#session = session;
    this.#actions = actions;
    this.#panel = vscode.window.createWebviewPanel(
      "gewuFlowRecall",
      `Flow Recall: ${session.unit_id}`,
      vscode.ViewColumn.Active,
      { enableScripts: true, retainContextWhenHidden: true },
    );
    this.#panel.webview.onDidReceiveMessage((message: unknown) => {
      void this.#handleMessage(message);
    });
    this.#panel.onDidDispose(() => {
      if (this.#disposed) return;
      this.#disposed = true;
      this.#actions.dispose();
    });
    this.#render();
  }

  public update(
    session: CoreSession,
    options: { revealed?: boolean; message?: string } = {},
  ): void {
    this.#session = session;
    if (options.revealed !== undefined) this.#revealed = options.revealed;
    if (options.message !== undefined) this.#message = options.message;
    this.#render();
  }

  public reveal(): void {
    this.#revealed = true;
    this.#message =
      "Reviewed prompt revealed. It is recorded separately from accuracy.";
    this.#render();
  }

  public get promptRevealed(): boolean {
    return this.#revealed;
  }

  public hidePrompt(): void {
    this.#revealed = false;
    this.#message = "Reviewed prompt hidden.";
    this.#render();
  }

  public dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#panel.dispose();
  }

  async #handleMessage(value: unknown): Promise<void> {
    if (!isMessage(value)) return;
    if (value.type === "submit") {
      const answer = value.answer.trim();
      if (answer.length === 0) return;
      await this.#actions.submit(answer);
      return;
    }
    if (value.type === "reveal") await this.#actions.reveal();
    if (value.type === "restart") await this.#actions.restart();
    if (value.type === "stop") await this.#actions.stop();
    if (value.type === "close") this.#actions.close();
  }

  #render(): void {
    if (this.#disposed) return;
    const session = this.#session;
    const current = Math.min(session.completed_steps + 1, session.total_steps);
    const completed = session.completed_prompts
      .map(
        (step) =>
          `<li><span class="check">&#10003;</span>${escapeHtml(step)}</li>`,
      )
      .join("");
    const prompt = this.#revealed
      ? `<p class="prompt">${escapeHtml(session.current_prompt ?? "No reviewed prompt is available.")}</p>`
      : `<p class="prompt muted">Hidden until you choose Reveal</p>`;
    const nonce = createNonce();
    const completedSession = session.status === "completed";
    const input = completedSession
      ? `<p class="prompt">You reconstructed the complete reviewed flow.</p>`
      : `<textarea id="answer" aria-label="Reconstruct the next algorithm step" autofocus></textarea>
      <div class="actions"><button id="submit">Submit</button><button class="secondary" id="reveal">${this.#revealed ? "Hide" : "Reveal"}</button></div>`;
    const terminalAction = completedSession
      ? `<button class="secondary" id="close">Close</button>`
      : `<button class="secondary" id="stop">Stop</button>`;
    this.#panel.webview.html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; img-src https: data:;">
  <title>Flow Recall</title>
  <style>
    body { padding: 0; color: var(--vscode-foreground); background: var(--vscode-editor-background); font-family: var(--vscode-font-family); }
    header, main, footer { padding: 20px 28px; }
    header { border-bottom: 1px solid var(--vscode-panel-border); display: flex; justify-content: space-between; gap: 16px; align-items: baseline; }
    h1 { margin: 0; font-size: 20px; font-weight: 600; }
    h2 { margin: 0 0 10px; font-size: 14px; font-weight: 600; }
    .progress { color: var(--vscode-descriptionForeground); white-space: nowrap; }
    section { padding: 18px 0; border-bottom: 1px solid var(--vscode-panel-border); }
    ol { margin: 0; padding: 0; list-style: none; display: grid; gap: 6px; }
    li { color: var(--vscode-descriptionForeground); }
    .check { color: var(--vscode-testing-iconPassed); display: inline-block; width: 20px; }
    .prompt { margin: 0; line-height: 1.5; }
    .problem-statement { overflow-wrap: anywhere; }
    .problem-statement img { display: block; max-width: 100%; height: auto; margin: 12px 0; border-radius: 4px; }
    .muted, .message { color: var(--vscode-descriptionForeground); }
    textarea { box-sizing: border-box; width: 100%; min-height: 116px; resize: vertical; padding: 10px; border: 1px solid var(--vscode-input-border); color: var(--vscode-input-foreground); background: var(--vscode-input-background); font: inherit; }
    textarea:focus { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }
    .actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
    button { border: 1px solid transparent; padding: 6px 12px; color: var(--vscode-button-foreground); background: var(--vscode-button-background); font: inherit; cursor: pointer; }
    button:hover { background: var(--vscode-button-hoverBackground); }
    button.secondary { color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); }
    button.secondary:hover { background: var(--vscode-button-secondaryHoverBackground); }
    footer { display: flex; justify-content: flex-end; gap: 8px; }
  </style>
</head>
<body>
  <header><h1>${escapeHtml(session.unit_title)}</h1><span class="progress">Step ${current} of ${session.total_steps}</span></header>
  <main>
    <section><h2>Problem context</h2><div class="prompt problem-statement">${renderStatement(session.problem_statement)}</div></section>
    <section><h2>Completed flow</h2><ol>${completed || '<li class="muted">No steps reconstructed yet</li>'}</ol></section>
    <section><h2>Reviewed prompt</h2>${prompt}</section>
    <section>
      <h2>Your reconstruction</h2>
      ${input}
      <p class="message">${escapeHtml(this.#message)}</p>
    </section>
  </main>
  <footer><button class="secondary" id="restart">Restart</button>${terminalAction}</footer>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const answer = document.getElementById('answer');
    document.getElementById('submit')?.addEventListener('click', () => vscode.postMessage({ type: 'submit', answer: answer.value }));
    document.getElementById('reveal')?.addEventListener('click', () => vscode.postMessage({ type: 'reveal' }));
    document.getElementById('restart').addEventListener('click', () => vscode.postMessage({ type: 'restart' }));
    document.getElementById('stop')?.addEventListener('click', () => vscode.postMessage({ type: 'stop' }));
    document.getElementById('close')?.addEventListener('click', () => vscode.postMessage({ type: 'close' }));
    answer?.addEventListener('keydown', event => {
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
        event.preventDefault();
        vscode.postMessage({ type: 'submit', answer: answer.value });
      }
    });
  </script>
</body>
</html>`;
  }
}

type PanelMessage =
  | { readonly type: "submit"; readonly answer: string }
  | { readonly type: "reveal" | "restart" | "stop" | "close" };

function isMessage(value: unknown): value is PanelMessage {
  if (typeof value !== "object" || value === null || !("type" in value))
    return false;
  const message = value as Record<string, unknown>;
  if (message.type === "submit") return typeof message.answer === "string";
  return (
    message.type === "reveal" ||
    message.type === "restart" ||
    message.type === "stop" ||
    message.type === "close"
  );
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[character] ?? character,
  );
}

function createNonce(): string {
  const alphabet =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  return Array.from(
    { length: 24 },
    () => alphabet[Math.floor(Math.random() * alphabet.length)],
  ).join("");
}
