import * as monaco from "monaco-editor/esm/vs/editor/editor.api.js";
import "monaco-editor/esm/vs/basic-languages/python/python.contribution";

export type ShadowEdit = { start: number; end: number; text: string };
export type ShadowEditResult = { acceptedText: string };

export type ShadowEditorController = {
  update: (acceptedText: string, targetText: string, language: string, readOnly: boolean, force?: boolean) => void;
  focus: () => void;
  dispose: () => void;
};

export function mountShadowEditor(
  container: HTMLElement,
  acceptedText: string,
  targetText: string,
  language: string,
  readOnly: boolean,
  onEdit: (edit: ShadowEdit) => Promise<ShadowEditResult>,
): ShadowEditorController {
  const languageId = language.toLowerCase() === "python" ? "python" : "plaintext";
  const model = monaco.editor.createModel(acceptedText, languageId);
  const editor = monaco.editor.create(container, {
    model,
    automaticLayout: true,
    minimap: { enabled: false },
    padding: { top: 16, bottom: 16 },
    fontSize: 13,
    lineHeight: 22,
    tabSize: 4,
    insertSpaces: true,
    wordWrap: "off",
    autoIndent: "none",
    formatOnType: false,
    autoClosingBrackets: "never",
    autoClosingQuotes: "never",
    scrollBeyondLastLine: false,
    renderLineHighlight: "line",
    // Let the document continue scrolling once Monaco reaches its own edge.
    scrollbar: { vertical: "visible", horizontal: "auto", verticalScrollbarSize: 10, horizontalScrollbarSize: 10, alwaysConsumeMouseWheel: false },
    ariaLabel: "Shadow Typing code editor",
    // Practice becomes editable only after the user explicitly activates the
    // editor surface. This prevents the start button or a stale focus from
    // sending text into the session immediately.
    readOnly: true,
    theme: "vs-light",
  });
  let syncing = false;
  let locked = readOnly;
  let flushTimer: number | undefined;
  type PendingTransaction = { sequence: number; edit: ShadowEdit; afterText: string };
  let nextSequence = 1;
  let localText = acceptedText;
  let confirmedText = acceptedText;
  let activated = false;
  const pending: PendingTransaction[] = [];
  let inFlight: PendingTransaction | undefined;
  const guidanceNode = document.createElement("span");
  guidanceNode.className = "gewu-shadow-guidance";
  guidanceNode.setAttribute("aria-hidden", "true");
  const guidanceWidget: monaco.editor.IContentWidget = {
    getId: () => "gewu.shadow.guidance",
    getDomNode: () => guidanceNode,
    getPosition: () => ({
      position: model.getPositionAt(model.getValue().length),
      preference: [monaco.editor.ContentWidgetPositionPreference.EXACT],
    }),
  };
  editor.addContentWidget(guidanceWidget);
  const guidanceFor = (value: string): string => {
    if (!targetText.startsWith(value)) return "";
    const remaining = Array.from(targetText).slice(Array.from(value).length).join("");
    const nextLine = remaining.split("\n", 1)[0] ?? "";
    const indentation = nextLine.match(/^[ \t]+/)?.[0] ?? "";
    if (indentation.length > 0) {
      const spaces = Array.from(indentation).filter((character) => character === " ").length;
      const tabs = Array.from(indentation).filter((character) => character === "\t").length;
      return [spaces > 0 ? `${spaces}sp` : "", tabs > 0 ? (tabs === 1 ? "Tab" : `${tabs}Tab`) : ""].filter(Boolean).join(" ");
    }
    return nextLine.length > 0 ? nextLine : remaining.startsWith("\n") ? "Enter" : "";
  };
  const paintGhost = (value: string) => {
    guidanceNode.textContent = guidanceFor(value);
    editor.layoutContentWidget(guidanceWidget);
  };
  const diff = (from: string, to: string): ShadowEdit | undefined => {
    const oldChars = Array.from(from);
    const newChars = Array.from(to);
    let start = 0;
    while (start < oldChars.length && start < newChars.length && oldChars[start] === newChars[start]) start += 1;
    if (start === oldChars.length && start === newChars.length) return undefined;
    let oldEnd = oldChars.length;
    let newEnd = newChars.length;
    while (oldEnd > start && newEnd > start && oldChars[oldEnd - 1] === newChars[newEnd - 1]) { oldEnd -= 1; newEnd -= 1; }
    return { start, end: oldEnd, text: newChars.slice(start, newEnd).join("") };
  };
  const pump = () => {
    if (syncing || locked || inFlight || pending.length === 0) return;
    const transaction = pending.shift();
    if (!transaction) return;
    inFlight = transaction;
    void onEdit(transaction.edit).then((result) => {
      const accepted = result.acceptedText;
      confirmedText = accepted;
      if (accepted !== transaction.afterText) {
        // A rejected transaction invalidates optimistic edits after it. The
        // Core-confirmed snapshot is the only safe recovery boundary.
        pending.length = 0;
        syncing = true;
        model.setValue(accepted);
        editor.setPosition(model.getPositionAt(accepted.length));
        syncing = false;
        localText = accepted;
      } else {
        localText = model.getValue();
      }
      inFlight = undefined;
      pump();
    }).catch(() => {
      inFlight = undefined;
      pending.length = 0;
      localText = confirmedText;
    });
  };
  const enqueue = () => {
    const value = model.getValue();
    const edit = diff(localText, value);
    if (!edit) return;
    const transaction = { sequence: nextSequence++, edit, afterText: value };
    localText = value;
    pending.push(transaction);
    pump();
  };
  const subscription = editor.onDidChangeModelContent(() => {
    if (syncing || locked) return;
    if (flushTimer !== undefined) window.clearTimeout(flushTimer);
    flushTimer = window.setTimeout(() => {
      flushTimer = undefined;
      enqueue();
    }, 20);
  });
  const insertNewline = () => {
    if (syncing || locked || !activated) return;
    const selection = editor.getSelection();
    const currentModel = editor.getModel();
    if (!selection || !currentModel || selection.isEmpty() === false) return;

    const startOffset = currentModel.getOffsetAt(selection.getStartPosition());
    editor.pushUndoStop();
    editor.executeEdits("gewu-shadow-enter", [{
      range: selection,
      text: "\n",
      forceMoveMarkers: true,
    }]);
    // Set the cursor after the model edit. This is deliberately local and
    // synchronous; Core confirmation must never be responsible for it.
    editor.setPosition(currentModel.getPositionAt(startOffset + 1));
    editor.pushUndoStop();
  };
  // Intercept the DOM event in capture phase. Monaco's built-in `Enter`
  // command is registered at the editor layer and can otherwise win the
  // keybinding race, especially for a held key that repeats rapidly.
  const captureEnter = (event: KeyboardEvent) => {
    if (event.key !== "Enter" || event.isComposing || syncing || locked || !activated) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    insertNewline();
  };
  container.addEventListener("keydown", captureEnter, true);
  const activationSubscription = editor.onMouseDown(() => {
    if (locked || activated) return;
    activated = true;
    editor.updateOptions({ readOnly: false });
    editor.focus();
  });
  const focusSubscription = editor.onDidFocusEditorText(() => {
    if (!activated && !locked) editor.getDomNode()?.blur();
  });
  paintGhost(acceptedText);
  return {
    update: (value, target, nextLanguage, readOnlyNext, force = false) => {
      if (force) activated = false;
      syncing = true;
      const responseMatchesInFlight = inFlight?.afterText === value;
      confirmedText = value;
      const replaceModel = force || readOnlyNext || (!responseMatchesInFlight && !inFlight && pending.length === 0);
      if (replaceModel) model.setValue(value);
      monaco.editor.setModelLanguage(model, nextLanguage.toLowerCase() === "python" ? "python" : "plaintext");
      locked = readOnlyNext;
      editor.updateOptions({ readOnly: locked || !activated });
      targetText = target;
      paintGhost(model.getValue());
      // An accepted edit already left Monaco's native cursor at the right
      // line/column. Only restoration or an external state change needs a
      // deterministic cursor position.
      if (replaceModel) editor.setPosition(model.getPositionAt(value.length));
      else if (responseMatchesInFlight && model.getValue() === value) editor.setPosition(model.getPositionAt(value.length));
      syncing = false;
      if (!readOnlyNext && model.getValue() !== value && !responseMatchesInFlight) enqueue();
    },
    focus: () => editor.focus(),
    dispose: () => { subscription.dispose(); activationSubscription.dispose(); focusSubscription.dispose(); container.removeEventListener("keydown", captureEnter, true); if (flushTimer !== undefined) window.clearTimeout(flushTimer); editor.removeContentWidget(guidanceWidget); editor.dispose(); model.dispose(); },
  };
}
