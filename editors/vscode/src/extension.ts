import * as vscode from "vscode";
import * as path from "node:path";

import { GewuCoreClient, PracticeMode, CoreSession } from "./core-client.js";
import { CorePracticeDocumentController } from "./core-session.js";
import { openPracticeDocument, VsCodePracticeHost } from "./vscode-host.js";

let activeHost: VsCodePracticeHost | undefined;
let activeController: CorePracticeDocumentController | undefined;
let client: GewuCoreClient | undefined;
let context: vscode.ExtensionContext | undefined;
let activeFlow: CoreSession | undefined;
let flowStartedAt = 0;
let flowBaseActiveMs = 0;
let flowBaseWallMs = 0;

export function activate(context: vscode.ExtensionContext): void {
  setContext(context);
  context.subscriptions.push(
    vscode.commands.registerCommand("gewuAlgorithm.startShadowTyping", () =>
      startPractice("shadow_typing"),
    ),
    vscode.commands.registerCommand("gewuAlgorithm.startFlowRecall", () =>
      startPractice("flow_recall"),
    ),
    vscode.commands.registerCommand("gewuAlgorithm.submitFlowRecall", () =>
      submitFlowRecall(),
    ),
    vscode.commands.registerCommand("gewuAlgorithm.revealFlowPrompt", () =>
      revealFlowPrompt(),
    ),
    vscode.commands.registerCommand("gewuAlgorithm.stopShadowTyping", () =>
      stopShadowTyping(),
    ),
    vscode.commands.registerCommand("gewuAlgorithm.stopPractice", () =>
      stopPractice(),
    ),
    vscode.commands.registerCommand("gewuAlgorithm.restartPractice", () =>
      restartPractice(),
    ),
    vscode.commands.registerCommand("gewuAlgorithm.resumePractice", () =>
      resumePractice(),
    ),
    vscode.commands.registerCommand("gewuAlgorithm.discardCheckpoint", () =>
      discardCheckpoint(),
    ),
    vscode.commands.registerCommand("gewuAlgorithm.showHistory", () =>
      showHistory(),
    ),
    vscode.commands.registerCommand("gewuAlgorithm.deleteHistory", () =>
      deleteHistory(),
    ),
    { dispose: () => disposeWithoutTerminalAttempt() },
  );
}

export function deactivate(): void {
  disposeWithoutTerminalAttempt();
}

async function startPractice(mode: PracticeMode): Promise<void> {
  disposeWithoutTerminalAttempt();
  const core = await ensureClient();
  const units = await core.listUnits();
  const choices = units
    .filter((unit) => unit.modes.includes(mode))
    .map((unit) => ({ label: unit.title, description: unit.id, unit }));
  const selected = await vscode.window.showQuickPick(choices, {
    placeHolder:
      mode === "shadow_typing"
        ? "Choose a local unit for Shadow Typing"
        : "Choose a local unit for Flow Recall",
  });
  if (selected === undefined) return;
  const session = await core.startSession(selected.unit.id, mode);
  if (mode === "shadow_typing") {
    activeHost = await openPracticeDocument(
      session.session_id,
      vscode.ViewColumn.Active,
      session.accepted_text,
    );
    activeController = new CorePracticeDocumentController(
      activeHost,
      core,
      session,
    );
    vscode.window.showInformationMessage(
      `GEWU: Shadow Typing started for ${selected.unit.title}.`,
    );
    return;
  }
  activeFlow = session;
  setFlowClock(session);
  await showFlowPrompt(session);
}

async function stopShadowTyping(): Promise<void> {
  if (activeController === undefined) return;
  const answer = await vscode.window.showWarningMessage(
    "Stop the current GEWU practice and save a stopped attempt?",
    { modal: true },
    "Stop",
  );
  if (answer !== "Stop") return;
  activeController?.stop();
  activeController = undefined;
  activeHost = undefined;
}

async function stopPractice(): Promise<void> {
  if (activeController !== undefined) {
    await stopShadowTyping();
    return;
  }
  if (activeFlow === undefined) return;
  const answer = await vscode.window.showWarningMessage(
    "Stop the current GEWU practice and save a stopped attempt?",
    { modal: true },
    "Stop",
  );
  if (answer !== "Stop") return;
  const core = await ensureClient();
  await core.stopSession(activeFlow.session_id, elapsed());
  activeFlow = undefined;
  vscode.window.showInformationMessage("GEWU: Practice stopped.");
}

async function restartPractice(): Promise<void> {
  if (activeController !== undefined) {
    activeController.restart();
    return;
  }
  if (activeFlow === undefined) return;
  const core = await ensureClient();
  activeFlow = await core.applyEvent(
    activeFlow.session_id,
    { type: "restart" },
    elapsed(),
  );
  setFlowClock(activeFlow);
  await showFlowPrompt(activeFlow);
}

async function submitFlowRecall(): Promise<void> {
  if (activeFlow === undefined) return;
  const answer = await vscode.window.showInputBox({
    prompt: activeFlow.current_prompt ?? "Flow Recall",
    ignoreFocusOut: true,
  });
  if (answer === undefined) return;
  const core = await ensureClient();
  activeFlow = await core.applyEvent(
    activeFlow.session_id,
    { type: "submit_answer", answer },
    elapsed(),
  );
  await showFlowPrompt(activeFlow);
}

async function revealFlowPrompt(): Promise<void> {
  if (activeFlow === undefined) return;
  const core = await ensureClient();
  activeFlow = await core.applyEvent(
    activeFlow.session_id,
    { type: "reveal_prompt" },
    elapsed(),
  );
  vscode.window.showInformationMessage(
    activeFlow.current_prompt ?? "GEWU: Flow Recall complete.",
  );
}

async function showFlowPrompt(session: CoreSession): Promise<void> {
  if (session.status === "completed") {
    vscode.window.showInformationMessage("GEWU: Flow Recall complete.");
    activeFlow = undefined;
    return;
  }
  const choice = await vscode.window.showInformationMessage(
    `GEWU Flow Recall ${session.completed_steps + 1}/${session.total_steps}: ${session.current_prompt ?? ""}`,
    "Answer",
    "Reveal prompt",
    "Stop",
  );
  if (choice === "Answer") await submitFlowRecall();
  if (choice === "Reveal prompt") await revealFlowPrompt();
  if (choice === "Stop") await stopPractice();
}

async function resumePractice(): Promise<void> {
  const core = await ensureClient();
  const session = await core.resumeCheckpoint();
  if (session === undefined) {
    vscode.window.showInformationMessage(
      "GEWU: No interrupted practice session to resume.",
    );
    return;
  }
  if (session.mode === "flow_recall") {
    activeFlow = session;
    setFlowClock(session);
    await showFlowPrompt(session);
    return;
  }
  closeActivePracticeUi();
  activeHost = await openPracticeDocument(
    session.session_id,
    vscode.ViewColumn.Active,
    session.accepted_text,
  );
  activeController = new CorePracticeDocumentController(
    activeHost,
    core,
    session,
  );
  vscode.window.showInformationMessage(
    "GEWU: Resumed interrupted Shadow Typing.",
  );
}

async function discardCheckpoint(): Promise<void> {
  const answer = await vscode.window.showWarningMessage(
    "Discard the interrupted GEWU practice session?",
    { modal: true },
    "Discard",
  );
  if (answer !== "Discard") return;
  const core = await ensureClient();
  await core.discardCheckpoint();
  vscode.window.showInformationMessage("GEWU: Interrupted practice discarded.");
}

async function showHistory(): Promise<void> {
  const attempts = await (await ensureClient()).recentAttempts();
  if (attempts.length === 0) {
    vscode.window.showInformationMessage("GEWU: No local practice attempts.");
    return;
  }
  await vscode.window.showQuickPick(
    attempts.map((attempt) => ({
      label: `${attempt.mode} ${attempt.terminal_reason}`,
      description: `${attempt.unit_id} r${attempt.revision}`,
      detail: attempt.created_at,
    })),
    { placeHolder: "Recent local GEWU attempts" },
  );
}

async function deleteHistory(): Promise<void> {
  const answer = await vscode.window.showWarningMessage(
    "Delete all local GEWU attempt history? This cannot be undone.",
    { modal: true },
    "Delete",
  );
  if (answer !== "Delete") return;
  const deleted = await (await ensureClient()).deleteHistory();
  vscode.window.showInformationMessage(
    `GEWU: Deleted ${deleted} local attempts.`,
  );
}

function disposeWithoutTerminalAttempt(): void {
  closeActivePracticeUi();
  client?.dispose();
  client = undefined;
}

function closeActivePracticeUi(): void {
  activeController?.dispose();
  activeController = undefined;
  activeHost?.dispose();
  activeHost = undefined;
  activeFlow = undefined;
}

async function ensureClient(): Promise<GewuCoreClient> {
  if (client !== undefined) return client;
  if (context === undefined) throw new Error("GEWU extension is not active");
  const workspaceRoot = path.resolve(context.extensionPath, "../..");
  client = await GewuCoreClient.start({
    cargoPath: vscode.workspace
      .getConfiguration("gewuAlgorithm")
      .get<string>("cargoPath", "cargo"),
    workspaceRoot,
    contentRoot: path.join(
      workspaceRoot,
      "fixtures",
      "algorithm-units",
      "valid",
    ),
    dataRoot: context.globalStorageUri.fsPath,
  });
  return client;
}

function elapsed(): { active_ms: number; wall_ms: number } {
  const localElapsed = Math.max(0, Date.now() - flowStartedAt);
  return {
    active_ms: flowBaseActiveMs + localElapsed,
    wall_ms: flowBaseWallMs + localElapsed,
  };
}

function setFlowClock(session: CoreSession): void {
  flowStartedAt = Date.now();
  flowBaseActiveMs = session.active_ms;
  flowBaseWallMs = session.wall_ms;
}

function setContext(next: vscode.ExtensionContext): void {
  context = next;
}
