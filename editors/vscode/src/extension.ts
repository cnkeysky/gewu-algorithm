import * as vscode from "vscode";
import * as path from "node:path";

import {
  CheckpointSummary,
  checkpointProgressPercentage,
  checkpointStartActions,
  CoreSession,
  GewuCoreClient,
  PracticeMode,
} from "./core-client.js";
import { CorePracticeDocumentController } from "./core-session.js";
import { FlowRecallPanel } from "./flow-panel.js";
import { openPracticeDocument, VsCodePracticeHost } from "./vscode-host.js";

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
    { dispose: () => void disposeWithoutTerminalAttempt() },
  );
}

export async function deactivate(): Promise<void> {
  await disposeWithoutTerminalAttempt();
}

async function startPractice(mode: PracticeMode): Promise<void> {
  const core = await ensureClient();
  const checkpointAction = await resolveCheckpointBeforeStart(core, mode);
  if (checkpointAction === "resume" || checkpointAction === "cancel") return;
  const units = await core.listUnits();
  const checkpoints = await core.listCheckpoints();
  const choices = units
    .filter(
      (unit) =>
        unit.modes.includes(mode) &&
        !checkpoints.some(
          (checkpoint) =>
            checkpoint.unit_id === unit.id &&
            checkpoint.revision === unit.revision &&
            checkpoint.mode === mode,
        ),
    )
    .map((unit) => ({ label: unit.title, description: unit.id, unit }));
  if (choices.length === 0) {
    vscode.window.showInformationMessage(
      `GEWU: Every available ${displayMode(mode)} task already has an interrupted checkpoint.`,
    );
    return;
  }
  const selected = await vscode.window.showQuickPick(choices, {
    placeHolder:
      mode === "shadow_typing"
        ? "Choose a local unit for Shadow Typing"
        : "Choose a local unit for Flow Recall",
  });
  if (selected === undefined) return;
  await closeActivePracticeUi();
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
    `Stop Shadow Typing for ${activeController.unitTitle}?`,
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
    `Stop Flow Recall for ${activeFlow.unit_title}?`,
    { modal: true },
    CONFIRM_ACTION,
  );
  if (answer !== CONFIRM_ACTION) return;
  await stopFlowPractice();
}

async function stopFlowPractice(): Promise<void> {
  if (activeFlow === undefined) return;
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
  const checkpoint = await confirmCheckpoint(core);
  if (checkpoint === undefined) return;
  const resumed = await core.resumeCheckpoint(checkpoint.id);
  if (resumed === undefined) {
    vscode.window.showInformationMessage(
      "GEWU: That interrupted practice is no longer available.",
    );
    return;
  }
  await activateResumedSession(core, resumed.session);
}

async function discardCheckpoint(): Promise<void> {
  const core = await ensureClient();
  const checkpoints = await core.listCheckpoints();
  if (checkpoints.length === 0) {
    vscode.window.showInformationMessage(
      "GEWU: No interrupted practice session to discard.",
    );
    return;
  }
  const selected = await vscode.window.showQuickPick(
    checkpoints.map(checkpointItem),
    {
      canPickMany: true,
      title: "Discard Interrupted Practice",
      placeHolder: "Select interrupted practices to discard",
    },
  );
  if (selected === undefined || selected.length === 0) return;
  for (const checkpoint of selected) {
    await discardSelectedCheckpoint(core, checkpoint.id);
  }
  vscode.window.showInformationMessage(
    `GEWU: Discarded ${selected.length} interrupted ${selected.length === 1 ? "practice" : "practices"}.`,
  );
}

async function confirmCheckpoint(
  core: GewuCoreClient,
): Promise<CheckpointSummary | undefined> {
  const checkpoints = await core.listCheckpoints();
  if (checkpoints.length === 0) {
    vscode.window.showInformationMessage(
      "GEWU: No interrupted practice session to resume.",
    );
    return undefined;
  }
  return vscode.window.showQuickPick(checkpoints.map(checkpointItem), {
    title: "Resume Interrupted Practice",
    placeHolder: "Resume the selected checkpoint",
  });
}

async function resolveCheckpointBeforeStart(
  core: GewuCoreClient,
  requestedMode: PracticeMode,
): Promise<"resume" | "discard" | "cancel"> {
  const checkpoints = (await core.listCheckpoints()).filter(
    (checkpoint) => checkpoint.mode === requestedMode,
  );
  if (checkpoints.length === 0) return "discard";
  const checkpointChoices = checkpointStartActions(checkpoints, requestedMode)
    .filter((choice) => choice.action !== "start")
    .map((choice) => {
      const checkpoint = checkpoints.find(
        (value) => value.id === choice.checkpoint_id,
      );
      if (checkpoint === undefined) throw new Error("checkpoint disappeared");
      return {
        label:
          choice.action === "resume"
            ? `$(play) Resume ${displayMode(checkpoint.mode)}`
            : `$(trash) Discard and start new ${displayMode(requestedMode)}`,
        description: checkpointDescription(checkpoint),
        detail: checkpointDetail(checkpoint),
        action: choice.action,
        checkpoint,
      };
    });
  const choice = await vscode.window.showQuickPick(
    [
      {
        label: `$(add) Start new ${displayMode(requestedMode)}`,
        description: `Keep ${checkpoints.length} interrupted practice ${checkpoints.length === 1 ? "checkpoint" : "checkpoints"}`,
        action: "start" as const,
      },
      ...checkpointChoices,
    ],
    {
      title: `Start ${displayMode(requestedMode)}`,
      placeHolder: `Choose a checkpoint or start a new ${displayMode(requestedMode)} session`,
    },
  );
  if (choice?.action === "resume") {
    const resumed = await core.resumeCheckpoint(choice.checkpoint.id);
    if (resumed === undefined) {
      vscode.window.showInformationMessage(
        "GEWU: That interrupted practice is no longer available.",
      );
      return "cancel";
    }
    await activateResumedSession(core, resumed.session);
    return "resume";
  }
  if (choice?.action === "discard") {
    await discardSelectedCheckpoint(core, choice.checkpoint.id);
    return "discard";
  }
  if (choice?.action === "start") return "discard";
  return "cancel";
}

function checkpointItem(
  checkpoint: CheckpointSummary,
): CheckpointSummary & vscode.QuickPickItem {
  return {
    ...checkpoint,
    label: checkpoint.unit_title,
    description: checkpointDescription(checkpoint),
    detail: checkpointDetail(checkpoint),
  };
}

function checkpointDescription(checkpoint: CheckpointSummary): string {
  return `${displayMode(checkpoint.mode)} | ${checkpoint.unit_id} r${checkpoint.revision}`;
}

function checkpointDetail(checkpoint: CheckpointSummary): string {
  return `${checkpointProgress(checkpoint)} | saved ${formatLocalDate(checkpoint.saved_at)}`;
}

function checkpointProgress(checkpoint: CheckpointSummary): string {
  return `${checkpointProgressPercentage(checkpoint)}% complete`;
}

async function activateResumedSession(
  core: GewuCoreClient,
  session: CoreSession,
): Promise<void> {
  await closeActivePracticeUi();
  if (session.mode === "flow_recall") {
    activeFlow = session;
    setFlowClock(session);
    openFlowPanel(session);
    return;
  }
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
    `GEWU: Resumed Shadow Typing for ${session.unit_id}.`,
  );
}

async function discardSelectedCheckpoint(
  core: GewuCoreClient,
  checkpointId: string,
): Promise<void> {
  await core.discardCheckpoint(checkpointId);
  if (activeCheckpointId() === checkpointId) await closeActivePracticeUi();
}

function activeCheckpointId(): string | undefined {
  const sessionId = activeController?.sessionId ?? activeFlow?.session_id;
  return sessionId === undefined ? undefined : `checkpoint-${sessionId}`;
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
    stop: stopFlowPractice,
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
      label: `${displayMode(attempt.mode)} | ${displayTerminalReason(attempt.terminal_reason)}`,
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
  if (attempt.mode === "shadow_typing") {
    return `${formatLocalDate(attempt.created_at)} | accepted ${attempt.accepted_input_count} characters | rejected ${attempt.rejected_input_count} characters`;
  }
  return `${formatLocalDate(attempt.created_at)} | completed ${attempt.accepted_input_count} steps | rejected ${attempt.rejected_input_count} answers | prompts ${attempt.prompt_count}`;
}

function displayMode(mode: PracticeMode): string {
  return mode === "shadow_typing" ? "Shadow Typing" : "Flow Recall";
}

function displayTerminalReason(reason: "completed" | "stopped"): string {
  return reason === "completed" ? "Completed" : "Stopped";
}

async function disposeWithoutTerminalAttempt(): Promise<void> {
  await closeActivePracticeUi();
  client?.dispose();
  client = undefined;
}

async function closeActivePracticeUi(): Promise<void> {
  const host = activeHost;
  activeController?.dispose();
  activeController = undefined;
  activeHost?.dispose();
  activeHost = undefined;
  activeFlowPanel?.dispose();
  activeFlowPanel = undefined;
  activeFlow = undefined;
  await host?.closeEditor();
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
