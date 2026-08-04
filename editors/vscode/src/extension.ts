import * as vscode from "vscode";
import * as path from "node:path";

import { GewuCoreClient, PracticeMode, CoreSession } from "./core-client.js";
import { CorePracticeDocumentController } from "./core-session.js";
import { FlowRecallPanel } from "./flow-panel.js";
import { openPracticeDocument, VsCodePracticeHost } from "./vscode-host.js";

const STOP_CONFIRMATION = "Stop practice?";
const CONFIRM_ACTION = "Confirm";

let activeHost: VsCodePracticeHost | undefined;
let activeController: CorePracticeDocumentController | undefined;
let client: GewuCoreClient | undefined;
let context: vscode.ExtensionContext | undefined;
let activeFlow: CoreSession | undefined;
let activeFlowPanel: FlowRecallPanel | undefined;
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
      submitFlowRecallFromCommand(),
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
  const core = await ensureClient();
  const checkpointAction = await resolveCheckpointBeforeStart(core);
  if (checkpointAction === "resume" || checkpointAction === "cancel") return;
  closeActivePracticeUi();
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
  openFlowPanel(session);
}

async function submitFlowRecallFromCommand(): Promise<void> {
  if (activeFlow === undefined) return;
  const answer = await vscode.window.showInputBox({
    prompt: `Flow Recall ${activeFlow.completed_steps + 1}/${activeFlow.total_steps}`,
    ignoreFocusOut: true,
  });
  if (answer !== undefined) await submitFlowAnswer(answer);
}

async function stopShadowTyping(): Promise<void> {
  if (activeController === undefined) return;
  const answer = await vscode.window.showWarningMessage(
    STOP_CONFIRMATION,
    { modal: true },
    CONFIRM_ACTION,
  );
  if (answer !== CONFIRM_ACTION) return;
  const controller = activeController;
  try {
    await controller.stop();
    activeController = undefined;
    activeHost = undefined;
    vscode.window.showInformationMessage("GEWU: Practice stopped.");
  } catch {
    vscode.window.showErrorMessage("GEWU: Could not stop practice.");
  }
}

async function stopPractice(): Promise<void> {
  if (activeController !== undefined) {
    await stopShadowTyping();
    return;
  }
  if (activeFlow === undefined) return;
  const answer = await vscode.window.showWarningMessage(
    STOP_CONFIRMATION,
    { modal: true },
    CONFIRM_ACTION,
  );
  if (answer !== CONFIRM_ACTION) return;
  const core = await ensureClient();
  await core.stopSession(activeFlow.session_id, elapsed());
  activeFlowPanel?.dispose();
  activeFlowPanel = undefined;
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
  activeFlow = await core.restartSession(activeFlow.session_id);
  setFlowClock(activeFlow);
  activeFlowPanel?.update(activeFlow, {
    revealed: false,
    message:
      "Practice restarted. Reconstruct the first step in your own words.",
  });
}

async function revealFlowPrompt(): Promise<void> {
  if (activeFlow === undefined) return;
  if (activeFlowPanel?.promptRevealed === true) {
    activeFlowPanel.hidePrompt();
    return;
  }
  const core = await ensureClient();
  activeFlow = await core.applyEvent(
    activeFlow.session_id,
    { type: "reveal_prompt" },
    elapsed(),
  );
  activeFlowPanel?.reveal();
  activeFlowPanel?.update(activeFlow, { revealed: true });
}

async function submitFlowAnswer(answer: string): Promise<void> {
  if (activeFlow === undefined) return;
  const previous = activeFlow;
  const core = await ensureClient();
  activeFlow = await core.applyEvent(
    previous.session_id,
    { type: "submit_answer", answer },
    elapsed(),
  );
  if (activeFlow.status === "completed") {
    activeFlowPanel?.update(activeFlow, {
      message: "Flow Recall complete.",
      revealed: false,
    });
    vscode.window.showInformationMessage("GEWU: Flow Recall complete.");
    return;
  }
  activeFlowPanel?.update(activeFlow, {
    revealed: false,
    message:
      activeFlow.completed_steps === previous.completed_steps
        ? "Answer not accepted. Try again or choose Reveal."
        : "Accepted. Reconstruct the next step in your own words.",
  });
}

async function resumePractice(): Promise<void> {
  const core = await ensureClient();
  const session = await confirmCheckpoint(core, "resume");
  if (session === undefined) return;
  closeActivePracticeUi();
  if (session.session.mode === "flow_recall") {
    activeFlow = session.session;
    setFlowClock(session.session);
    openFlowPanel(session.session);
    return;
  }
  activeHost = await openPracticeDocument(
    session.session.session_id,
    vscode.ViewColumn.Active,
    session.session.accepted_text,
  );
  activeController = new CorePracticeDocumentController(
    activeHost,
    core,
    session.session,
  );
  vscode.window.showInformationMessage(
    `GEWU: Resumed Shadow Typing for ${session.session.unit_id}.`,
  );
}

async function discardCheckpoint(): Promise<void> {
  const core = await ensureClient();
  const session = await confirmCheckpoint(core, "discard");
  if (session === undefined) return;
  await core.discardCheckpoint();
  vscode.window.showInformationMessage("GEWU: Interrupted practice discarded.");
}

async function confirmCheckpoint(
  core: GewuCoreClient,
  action: "resume" | "discard",
): Promise<import("./core-client.js").CheckpointResume | undefined> {
  const checkpoint = await core.resumeCheckpoint();
  if (checkpoint === undefined) {
    vscode.window.showInformationMessage(
      action === "resume"
        ? "GEWU: No interrupted practice session to resume."
        : "GEWU: No interrupted practice session to discard.",
    );
    return undefined;
  }
  const session = checkpoint.session;
  const verb = action === "resume" ? "Resume" : "Discard";
  const selected = await vscode.window.showQuickPick(
    [checkpointItem(checkpoint)],
    {
      title: `${verb} Interrupted Practice`,
      placeHolder: `${verb} the selected checkpoint`,
    },
  );
  if (selected === undefined) return undefined;
  return checkpoint;
}

async function resolveCheckpointBeforeStart(
  core: GewuCoreClient,
): Promise<"resume" | "discard" | "cancel"> {
  const checkpoint = await core.resumeCheckpoint();
  if (checkpoint === undefined) return "discard";
  const choice = await vscode.window.showQuickPick(
    [
      {
        label: "$(debug-continue) Resume interrupted practice",
        description: checkpointDescription(checkpoint),
        detail: checkpointDetail(checkpoint),
        action: "resume" as const,
      },
      {
        label: "$(trash) Discard checkpoint",
        description: checkpointDescription(checkpoint),
        detail: checkpointDetail(checkpoint),
        action: "discard" as const,
      },
    ],
    {
      title: "Interrupted Practice",
      placeHolder: "Resolve the checkpoint before starting another practice",
    },
  );
  if (choice?.action === "resume") {
    const session = checkpoint.session;
    closeActivePracticeUi();
    if (session.mode === "flow_recall") {
      activeFlow = session;
      setFlowClock(session);
      openFlowPanel(session);
    } else {
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
    }
    return "resume";
  }
  if (choice?.action === "discard") {
    await core.discardCheckpoint();
    return "discard";
  }
  return "cancel";
}

function checkpointItem(
  checkpoint: import("./core-client.js").CheckpointResume,
): vscode.QuickPickItem {
  return {
    label: checkpoint.session.unit_title,
    description: checkpointDescription(checkpoint),
    detail: checkpointDetail(checkpoint),
  };
}

function checkpointDescription(
  checkpoint: import("./core-client.js").CheckpointResume,
): string {
  const session = checkpoint.session;
  return `${displayMode(session.mode)} | ${session.unit_id} r${session.revision}`;
}

function checkpointDetail(
  checkpoint: import("./core-client.js").CheckpointResume,
): string {
  return `${progress(checkpoint.session)} | saved ${formatLocalDate(checkpoint.savedAt)}`;
}

function progress(session: CoreSession): string {
  if (session.mode === "flow_recall")
    return `${session.completed_steps}/${session.total_steps} steps`;
  return `${Array.from(session.accepted_text).length}/${Array.from(session.target_text).length} characters`;
}

function openFlowPanel(session: CoreSession): void {
  activeFlowPanel?.dispose();
  activeFlowPanel = new FlowRecallPanel(session, {
    submit: submitFlowAnswer,
    reveal: revealFlowPrompt,
    restart: restartPractice,
    stop: stopPractice,
    close: () => {
      activeFlowPanel?.dispose();
      activeFlowPanel = undefined;
      activeFlow = undefined;
    },
    dispose: () => {
      activeFlowPanel = undefined;
    },
  });
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
      detail: attemptDetail(attempt),
    })),
    { placeHolder: "Recent local GEWU attempts" },
  );
}

async function deleteHistory(): Promise<void> {
  const core = await ensureClient();
  const attempts = await core.recentAttempts();
  if (attempts.length === 0) {
    vscode.window.showInformationMessage("GEWU: No local practice attempts.");
    return;
  }
  const selected = await vscode.window.showQuickPick(
    attempts.map((attempt) => ({
      label: `${attempt.mode} ${attempt.terminal_reason}`,
      description: `${attempt.unit_id} r${attempt.revision}`,
      detail: attemptDetail(attempt),
      id: attempt.id,
    })),
    { canPickMany: true, placeHolder: "Select attempts to delete" },
  );
  if (selected === undefined || selected.length === 0) return;
  const deleted = await core.deleteAttempts(
    selected.map((attempt) => attempt.id),
  );
  vscode.window.showInformationMessage(
    `GEWU: Deleted ${deleted} local attempts.`,
  );
}

function formatLocalDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function attemptDetail(
  attempt: import("./core-client.js").AttemptSummary,
): string {
  return `${formatLocalDate(attempt.created_at)} | accepted ${attempt.accepted_input_count} | rejected ${attempt.rejected_input_count} | prompts ${attempt.prompt_count}`;
}

function displayMode(mode: PracticeMode): string {
  return mode === "shadow_typing" ? "Shadow Typing" : "Flow Recall";
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
  activeFlowPanel?.dispose();
  activeFlowPanel = undefined;
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
