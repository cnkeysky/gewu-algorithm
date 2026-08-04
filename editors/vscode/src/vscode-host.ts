import * as vscode from "vscode";

import {
  DecorationState,
  CompletionActions,
  Disposable,
  EditorTransaction,
  HostEditorTransaction,
  PracticeDocumentHost,
  TextRange,
  translateHostTransaction,
} from "./interaction.js";

const PRACTICE_SCHEME = "untitled";

/**
 * The only module that imports VS Code types. It owns the document snapshot,
 * change subscription, restoration edit, and decorations for one session.
 */
export class VsCodePracticeHost implements PracticeDocumentHost, Disposable {
  readonly #document: vscode.TextDocument;
  readonly #editor: vscode.TextEditor;
  readonly #decorationType: vscode.TextEditorDecorationType;
  readonly #guidanceDecorationType: vscode.TextEditorDecorationType;
  #snapshot: string;
  #listener: vscode.Disposable | undefined;
  #restoring = false;
  #closed = false;

  public constructor(document: vscode.TextDocument, editor: vscode.TextEditor) {
    if (document.uri.scheme !== PRACTICE_SCHEME) {
      throw new Error("practice host requires an untitled document");
    }
    this.#document = document;
    this.#editor = editor;
    this.#snapshot = document.getText();
    this.#decorationType = vscode.window.createTextEditorDecorationType({
      overviewRulerColor: new vscode.ThemeColor("charts.green"),
      backgroundColor: new vscode.ThemeColor("editor.rangeHighlightBackground"),
      isWholeLine: false,
    });
    this.#guidanceDecorationType = vscode.window.createTextEditorDecorationType(
      {
        after: {
          color: new vscode.ThemeColor("editorGhostText.foreground"),
          fontStyle: "italic",
        },
      },
    );
  }

  public createUntitled(
    uri: string,
    text: string,
  ): Disposable & {
    readonly uri: string;
    replace(nextText: string): void;
    close(): void;
  } {
    const actualUri = this.#document.uri.toString();
    if (!uri.startsWith(`${PRACTICE_SCHEME}:`) || text !== this.#snapshot) {
      throw new Error(
        "practice document host was initialized with unexpected content",
      );
    }
    return {
      uri: actualUri,
      replace: (nextText) => this.replace(nextText),
      close: () => this.close(),
      dispose: () => this.dispose(),
    };
  }

  public onChange(
    listener: (transaction: EditorTransaction) => void,
  ): Disposable {
    if (this.#listener !== undefined)
      throw new Error("practice host listener already registered");
    this.#listener = vscode.workspace.onDidChangeTextDocument((event) => {
      if (event.document.uri.toString() !== this.#document.uri.toString())
        return;
      const beforeText = this.#snapshot;
      const afterText = event.document.getText();
      this.#snapshot = afterText;
      if (this.#restoring) {
        this.#restoring = false;
        return;
      }
      const transaction: HostEditorTransaction = {
        beforeText,
        afterText,
        changes: event.contentChanges.map((change) => ({
          rangeOffset: change.rangeOffset,
          rangeLength: change.rangeLength,
          text: change.text,
          kind:
            change.rangeLength === 0
              ? change.text.length > 1
                ? "paste"
                : "insert"
              : change.text.length === 0
                ? "delete"
                : "replace",
        })),
        selectionCount: this.#editor.selections.length,
        reason: this.#reason(event.reason),
      };
      const translated = translateHostTransaction(transaction);
      if (translated === undefined) {
        // A split surrogate or another untranslatable range cannot be safely
        // evaluated by the scalar-based policy, so discard the host mutation.
        this.replace(beforeText);
        return;
      }
      listener(translated);
    });
    return {
      dispose: () => {
        this.#listener?.dispose();
        this.#listener = undefined;
      },
    };
  }

  public setDecorations(state: DecorationState): void {
    if (this.#closed) return;
    const accepted = this.#range(state.accepted);
    const mismatch =
      state.mismatch === undefined ? [] : [this.#range(state.mismatch)];
    this.#editor.setDecorations(this.#decorationType, [accepted, ...mismatch]);
    const cursor = this.#range({
      start: state.accepted.end,
      end: state.accepted.end,
    });
    this.#editor.setDecorations(
      this.#guidanceDecorationType,
      state.guidanceText.length === 0
        ? []
        : [
            {
              range: cursor,
              renderOptions: { after: { contentText: state.guidanceText } },
            },
          ],
    );
  }

  public notifyComplete(actions: CompletionActions): void {
    void vscode.window
      .showInformationMessage("GEWU: Complete", "Close", "Restart")
      .then((choice) => {
        if (choice === "Close") actions.close();
        if (choice === "Restart") actions.restart();
      });
  }

  public replace(text: string): void {
    if (this.#closed) return;
    this.#restoring = true;
    const fullRange = new vscode.Range(
      this.#document.positionAt(0),
      this.#document.positionAt(this.#document.getText().length),
    );
    void this.#editor
      .edit((edit) => edit.replace(fullRange, text))
      .then(
        () => {
          if (this.#snapshot === this.#document.getText())
            this.#restoring = false;
        },
        () => {
          this.#restoring = false;
        },
      );
  }

  public close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#editor.setDecorations(this.#decorationType, []);
    this.#editor.setDecorations(this.#guidanceDecorationType, []);
    this.#decorationType.dispose();
    this.#guidanceDecorationType.dispose();
    this.#listener?.dispose();
    this.#listener = undefined;
    const active = vscode.window.activeTextEditor;
    if (active?.document.uri.toString() === this.#document.uri.toString()) {
      void vscode.commands.executeCommand(
        "workbench.action.revertAndCloseActiveEditor",
      );
    }
  }

  public dispose(): void {
    this.close();
  }

  #range(range: TextRange): vscode.Range {
    const textLength = this.#document.getText().length;
    const start = Math.min(textLength, this.#scalarToUtf16(range.start));
    const end = Math.min(textLength, this.#scalarToUtf16(range.end));
    return new vscode.Range(
      this.#document.positionAt(start),
      this.#document.positionAt(end),
    );
  }

  #scalarToUtf16(offset: number): number {
    let scalar = 0;
    let utf16 = 0;
    for (const character of this.#document.getText()) {
      if (scalar >= offset) break;
      scalar += 1;
      utf16 += character.length;
    }
    return utf16;
  }

  #reason(
    reason: vscode.TextDocumentChangeReason | undefined,
  ): HostEditorTransaction["reason"] {
    if (reason === vscode.TextDocumentChangeReason.Undo) return "undo";
    if (reason === vscode.TextDocumentChangeReason.Redo) return "redo";
    return "user";
  }
}

export async function openPracticeDocument(
  sessionId: string,
  viewColumn: vscode.ViewColumn = vscode.ViewColumn.Active,
): Promise<VsCodePracticeHost> {
  // VS Code allocates the untitled URI; the logical session ID remains in the
  // controller URI/diagnostic path until a production URI policy is defined.
  void sessionId;
  const document = await vscode.workspace.openTextDocument({
    language: "plaintext",
    content: "",
  });
  const editor = await vscode.window.showTextDocument(document, {
    viewColumn,
    preserveFocus: false,
    preview: false,
  });
  return new VsCodePracticeHost(document, editor);
}
