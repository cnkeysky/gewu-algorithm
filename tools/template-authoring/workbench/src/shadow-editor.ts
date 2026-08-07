import * as monaco from "monaco-editor/esm/vs/editor/editor.api.js";
import "monaco-editor/esm/vs/basic-languages/python/python.contribution";

export type ShadowEdit = { start: number; end: number; text: string };
export type ShadowEditResult = { acceptedText: string };

export type ShadowEditorController = {
  update: (acceptedText: string, targetText: string, language: string, readOnly: boolean, showGuidance: boolean, force?: boolean, resetActivation?: boolean) => void;
  flush: () => Promise<void>;
  focus: () => void;
  setFontSize: (fontSize: number) => void;
  dispose: () => void;
};

export function mountShadowEditor(
  container: HTMLElement,
  acceptedText: string,
  targetText: string,
  language: string,
  readOnly: boolean,
  showGuidance: boolean,
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
    quickSuggestions: false,
    suggestOnTriggerCharacters: false,
    acceptSuggestionOnEnter: "off",
    tabCompletion: "off",
    parameterHints: { enabled: false },
    wordBasedSuggestions: "off",
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
  let fontSize = 13;
  const setFontSize = (next: number) => {
    fontSize = Math.max(11, Math.min(20, next));
    editor.updateOptions({ fontSize, lineHeight: Math.round(fontSize * 1.7) });
  };
  let syncing = false;
  let locked = readOnly;
  let flushTimer: number | undefined;
  type PendingTransaction = { sequence: number; generation: number; afterText: string };
  let nextSequence = 1;
  let generation = 0;
  let localText = acceptedText;
  let confirmedText = acceptedText;
  let guidanceEnabled = showGuidance;
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
    if (!guidanceEnabled) return "";
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
    const edit = diff(confirmedText, transaction.afterText);
    if (!edit) {
      pump();
      return;
    }
    inFlight = { ...transaction };
    void onEdit(edit).then((result) => {
      if (transaction.generation !== generation) return;
      const accepted = result.acceptedText;
      confirmedText = accepted;
      if (accepted !== transaction.afterText) {
        // A rejected transaction invalidates optimistic edits after it. The
        // Core-confirmed snapshot is the only safe recovery boundary.
        pending.length = 0;
        syncing = true;
        model.setValue(accepted);
        editor.setPosition(model.getPositionAt(accepted.length));
        paintGhost(accepted);
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
    if (value === localText) return;
    const transaction = { sequence: nextSequence++, generation, afterText: value };
    localText = value;
    pending.push(transaction);
    pump();
  };
  const waitForIdle = async (): Promise<void> => {
    if (!inFlight && pending.length === 0) return;
    await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
    return waitForIdle();
  };
  const subscription = editor.onDidChangeModelContent(() => {
    if (syncing || locked) return;
    // Repaint the guidance immediately from the local value while it is still
    // a valid target prefix (deletions and corrections). A wrong character
    // breaks the prefix, so the ghost keeps showing the correct hint instead
    // of disappearing during the Core rejection roundtrip.
    const value = model.getValue();
    if (targetText.startsWith(value)) paintGhost(value);
    // Enqueue every change immediately. Per-keystroke transactions keep each
    // character isolated, so a wrong character is rejected on its own while
    // the correctly typed prefix stays accepted; a large wrong paste is still
    // one atomic rejection. Disk pressure is covered by Core's throttled
    // checkpoint writes, so the old batching window is no longer needed.
    enqueue();
  });
  const insertNewline = () => {
    if (syncing || locked || !activated) return;
    const currentModel = editor.getModel();
    if (!currentModel) return;
    const value = currentModel.getValue();
    // Local newline gate: only insert when the target actually expects a
    // newline at the accepted boundary. A held/repeated Enter at a single
    // marker is silently ignored instead of stacking newlines that Core would
    // reject and roll back (which previously read as a broken Enter).
    if (Array.from(targetText)[Array.from(value).length] !== "\n") return;
    // Insert at the accepted boundary (end of the optimistic value) rather
    // than at the cursor, so the model always stays a strict prefix extension
    // of the target and the insert can never be rejected for positioning.
    editor.pushUndoStop();
    const boundary = currentModel.getPositionAt(value.length);
    editor.executeEdits("gewu-shadow-enter", [{
      range: new monaco.Range(boundary.lineNumber, boundary.column, boundary.lineNumber, boundary.column),
      text: "\n",
      forceMoveMarkers: true,
    }]);
    // Set the cursor after the model edit. This is deliberately local and
    // synchronous; Core confirmation must never be responsible for it.
    editor.setPosition(currentModel.getPositionAt(value.length + 1));
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
  const blockHistoryShortcuts = (event: KeyboardEvent) => {
    // Undo/redo would let Monaco's local history bypass Core's accepted
    // prefix state machine. Copy, paste, selection and deletion remain
    // native edits and are still validated by Core.
    if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
    if (event.key.toLowerCase() !== "z" && event.key.toLowerCase() !== "y") return;
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  container.addEventListener("keydown", captureEnter, true);
  container.addEventListener("keydown", blockHistoryShortcuts, true);
  const activate = () => {
    if (locked || activated) return;
    activated = true;
    editor.updateOptions({ readOnly: false });
    editor.focus();
  };
  const activateSubscription = editor.onMouseDown(activate);
  container.addEventListener("mousedown", activate, true);
  const focusSubscription = editor.onDidFocusEditorText(() => {
    if (!activated && !locked) editor.getDomNode()?.blur();
  });
  paintGhost(acceptedText);
  return {
    update: (value, target, nextLanguage, readOnlyNext, showGuidanceNext, force = false, resetActivation = false) => {
      if (resetActivation) {
        activated = false;
        generation += 1;
        pending.length = 0;
        inFlight = undefined;
        if (flushTimer !== undefined) {
          window.clearTimeout(flushTimer);
          flushTimer = undefined;
        }
      }
      syncing = true;
      const responseMatchesInFlight = inFlight?.afterText === value;
      confirmedText = value;
      const replaceModel = force || readOnlyNext || (!responseMatchesInFlight && !inFlight && pending.length === 0);
      if (replaceModel) model.setValue(value);
      monaco.editor.setModelLanguage(model, nextLanguage.toLowerCase() === "python" ? "python" : "plaintext");
      locked = readOnlyNext;
      guidanceEnabled = showGuidanceNext;
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
    flush: async () => {
      if (flushTimer !== undefined) {
        window.clearTimeout(flushTimer);
        flushTimer = undefined;
      }
      enqueue();
      await waitForIdle();
    },
    focus: () => {
      if (!locked) {
        activated = true;
        editor.updateOptions({ readOnly: false });
      }
      editor.focus();
    },
    setFontSize,
    dispose: () => { subscription.dispose(); activateSubscription.dispose(); focusSubscription.dispose(); container.removeEventListener("mousedown", activate, true); container.removeEventListener("keydown", captureEnter, true); container.removeEventListener("keydown", blockHistoryShortcuts, true); if (flushTimer !== undefined) window.clearTimeout(flushTimer); editor.removeContentWidget(guidanceWidget); editor.dispose(); model.dispose(); },
  };
}
