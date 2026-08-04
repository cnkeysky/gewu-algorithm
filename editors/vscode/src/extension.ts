import * as vscode from "vscode";

import { PracticeSessionManager } from "./interaction.js";
import { openPracticeDocument, VsCodePracticeHost } from "./vscode-host.js";

const SAMPLE_TARGET = "def solve(values):\n    return values\n";

let manager: PracticeSessionManager | undefined;
let activeHost: VsCodePracticeHost | undefined;

export function activate(context: vscode.ExtensionContext): void {
  manager = new PracticeSessionManager();
  context.subscriptions.push(
    vscode.commands.registerCommand("gewuAlgorithm.startShadowTyping", () =>
      startShadowTyping(),
    ),
    vscode.commands.registerCommand("gewuAlgorithm.stopShadowTyping", () =>
      stopShadowTyping(),
    ),
    { dispose: () => stopShadowTyping() },
  );
}

export function deactivate(): void {
  stopShadowTyping();
}

async function startShadowTyping(): Promise<void> {
  if (manager === undefined) return;
  stopShadowTyping();
  const selection =
    vscode.window.activeTextEditor?.document.getText(
      vscode.window.activeTextEditor.selection,
    ) ?? "";
  const target = selection.length > 0 ? selection : SAMPLE_TARGET;
  const sessionId = String(Date.now());
  activeHost = await openPracticeDocument(
    sessionId,
    selection.length > 0 ? vscode.ViewColumn.Beside : vscode.ViewColumn.Active,
  );
  manager.start(activeHost, sessionId, target);
  vscode.window.showInformationMessage(
    selection.length > 0
      ? "GEWU Shadow Typing started from the selected text."
      : "GEWU Shadow Typing started with the built-in sample.",
  );
}

function stopShadowTyping(): void {
  manager?.stop();
  activeHost?.dispose();
  activeHost = undefined;
}
