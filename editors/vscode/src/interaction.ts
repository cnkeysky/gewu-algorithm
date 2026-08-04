/** Pure editor transaction types. No VS Code API objects cross this boundary. */

export type SessionStatus = "active" | "completed" | "stopped" | "disposed";
export type ChangeKind = "insert" | "paste" | "delete" | "replace";
export type HostEditReason = "user" | "undo" | "redo" | "format" | "external";

export interface TextRange {
  readonly start: number;
  readonly end: number;
}

export interface EditorChange {
  readonly range: TextRange;
  readonly text: string;
  readonly kind: ChangeKind;
}

export interface EditorTransaction {
  /** Text before and after the host editor event, normalized to LF by the adapter. */
  readonly beforeText: string;
  readonly afterText: string;
  readonly changes: readonly EditorChange[];
  readonly selectionCount: number;
  readonly reason: HostEditReason;
}

/** VS Code reports offsets in UTF-16 code units; the core contract uses scalars. */
export interface HostTextChange {
  readonly rangeOffset: number;
  readonly rangeLength: number;
  readonly text: string;
  readonly kind: ChangeKind;
}

export interface HostEditorTransaction {
  readonly beforeText: string;
  readonly afterText: string;
  readonly changes: readonly HostTextChange[];
  readonly selectionCount: number;
  readonly reason: HostEditReason;
}

export interface PracticeAttemptFacts {
  readonly acceptedInputCount: number;
  readonly rejectedInputCount: number;
  readonly correctionCount: number;
  readonly targetCharacterCount: number;
  readonly terminalReason: "completed" | "stopped";
}

export interface DecorationState {
  readonly accepted: TextRange;
  readonly remaining: TextRange;
  readonly guidanceText: string;
  readonly mismatch?: TextRange;
}

export type TransactionAction = "accept" | "restore" | "ignore";

export interface TransactionResult {
  readonly action: TransactionAction;
  readonly status: SessionStatus;
  readonly acceptedText: string;
  readonly message?: string;
  readonly mismatchOffset?: number;
  readonly decorations: DecorationState;
}

export type PracticeEvent =
  | { readonly type: "insert"; readonly text: string }
  | { readonly type: "delete"; readonly range: TextRange }
  | {
      readonly type: "replace";
      readonly range: TextRange;
      readonly text: string;
    };

export function normalizeLineEndings(text: string): string {
  return text.replace(/\r\n?/g, "\n");
}

export function characterLength(text: string): number {
  return Array.from(text).length;
}

export function utf16OffsetToScalar(
  text: string,
  offset: number,
): number | undefined {
  if (!Number.isInteger(offset) || offset < 0 || offset > text.length)
    return undefined;
  let utf16 = 0;
  let scalar = 0;
  for (let index = 0; index < text.length;) {
    if (utf16 === offset) return scalar;
    const isCrLf = text[index] === "\r" && text[index + 1] === "\n";
    const unitLength = isCrLf
      ? 2
      : (text.codePointAt(index) ?? 0) > 0xffff
        ? 2
        : 1;
    utf16 += unitLength;
    scalar += 1;
    index += unitLength;
    if (utf16 > offset) return undefined;
  }
  return utf16 === offset ? scalar : undefined;
}

export function translateHostTransaction(
  transaction: HostEditorTransaction,
): EditorTransaction | undefined {
  const changes: EditorChange[] = [];
  for (const change of transaction.changes) {
    const start = utf16OffsetToScalar(
      transaction.beforeText,
      change.rangeOffset,
    );
    const end = utf16OffsetToScalar(
      transaction.beforeText,
      change.rangeOffset + change.rangeLength,
    );
    if (start === undefined || end === undefined) return undefined;
    changes.push({
      range: { start, end },
      text: change.text,
      kind: change.kind,
    });
  }
  return {
    beforeText: normalizeLineEndings(transaction.beforeText),
    afterText: normalizeLineEndings(transaction.afterText),
    changes,
    selectionCount: transaction.selectionCount,
    reason: transaction.reason,
  };
}

export function characterSlice(
  text: string,
  range: TextRange,
): string | undefined {
  const characters = Array.from(text);
  if (
    !Number.isInteger(range.start) ||
    !Number.isInteger(range.end) ||
    range.start < 0 ||
    range.end < range.start ||
    range.end > characters.length
  ) {
    return undefined;
  }
  return characters.slice(range.start, range.end).join("");
}

export function replaceCharacterRange(
  text: string,
  range: TextRange,
  replacement: string,
): string | undefined {
  const characters = Array.from(text);
  if (
    !Number.isInteger(range.start) ||
    !Number.isInteger(range.end) ||
    range.start < 0 ||
    range.end < range.start ||
    range.end > characters.length
  ) {
    return undefined;
  }
  characters.splice(
    range.start,
    range.end - range.start,
    ...Array.from(replacement),
  );
  return characters.join("");
}

export function transactionEvent(
  transaction: EditorTransaction,
): PracticeEvent | undefined {
  const change = transaction.changes[0];
  if (
    transaction.changes.length !== 1 ||
    transaction.selectionCount !== 1 ||
    change === undefined
  ) {
    return undefined;
  }
  if (change.kind === "insert" || change.kind === "paste") {
    const autoIndentedNewline =
      change.kind === "paste" &&
      change.range.start === change.range.end &&
      /^\n[ \t]+$/.test(normalizeLineEndings(change.text));
    const autoClosedPair =
      change.kind === "paste" && change.range.start === change.range.end
        ? (
            { "()": "(", "[]": "[", "{}": "{", '""': '"', "''": "'" } as Record<
              string,
              string
            >
          )[change.text]
        : undefined;
    return {
      type: "insert",
      text: autoIndentedNewline ? "\n" : (autoClosedPair ?? change.text),
    };
  }
  if (change.kind === "delete") {
    return { type: "delete", range: change.range };
  }
  return { type: "replace", range: change.range, text: change.text };
}

export function decorationsFor(
  acceptedText: string,
  target: string,
  mismatch?: number,
): DecorationState {
  const accepted = characterLength(acceptedText);
  const total = characterLength(target);
  const remainingText = Array.from(target).slice(accepted).join("");
  const nextLine = remainingText.split("\n", 1)[0] ?? "";
  const indentation = compactIndentationGuidance(nextLine);
  return {
    accepted: { start: 0, end: accepted },
    remaining: { start: accepted, end: total },
    guidanceText:
      indentation.length > 0
        ? indentation
        : nextLine.length > 0
          ? nextLine
          : remainingText.startsWith("\n")
            ? "Enter"
            : "",
    ...(mismatch === undefined
      ? {}
      : { mismatch: { start: mismatch, end: mismatch + 1 } }),
  };
}

function compactIndentationGuidance(line: string): string {
  const indentation = line.match(/^[ \t]+/)?.[0] ?? "";
  if (indentation.length === 0) return "";
  const spaces = Array.from(indentation).filter(
    (character) => character === " ",
  ).length;
  const tabs = Array.from(indentation).filter(
    (character) => character === "\t",
  ).length;
  const tokens: string[] = [];
  if (spaces > 0) tokens.push(`${spaces}sp`);
  if (tabs > 0) tokens.push(tabs === 1 ? "Tab" : `${tabs}Tab`);
  return tokens.join(" ");
}

/**
 * Deterministic policy for the native editor adapter. It treats every host
 * transaction as atomic and asks the adapter to restore the expected prefix
 * when host behavior cannot be represented by the strict MVP contract.
 */
export class ShadowTypingEditorSession {
  readonly #target: string;
  #acceptedText = "";
  #status: SessionStatus = "active";
  #acceptedInputCount = 0;
  #rejectedInputCount = 0;
  #correctionCount = 0;
  #mismatchOffset: number | undefined;

  public constructor(target: string) {
    const normalized = normalizeLineEndings(target);
    if (normalized.length === 0) {
      throw new Error("practice target must not be empty");
    }
    this.#target = normalized;
  }

  public get target(): string {
    return this.#target;
  }
  public get acceptedText(): string {
    return this.#acceptedText;
  }
  public get status(): SessionStatus {
    return this.#status;
  }
  public get facts(): PracticeAttemptFacts | undefined {
    if (this.#status !== "completed" && this.#status !== "stopped")
      return undefined;
    return {
      acceptedInputCount: this.#acceptedInputCount,
      rejectedInputCount: this.#rejectedInputCount,
      correctionCount: this.#correctionCount,
      targetCharacterCount: characterLength(this.#target),
      terminalReason: this.#status === "completed" ? "completed" : "stopped",
    };
  }

  public apply(transaction: EditorTransaction): TransactionResult {
    if (this.#status === "disposed")
      return this.result("ignore", "session disposed");
    if (this.#status !== "active")
      return this.result("restore", "session is terminal");
    const before = normalizeLineEndings(transaction.beforeText);
    const after = normalizeLineEndings(transaction.afterText);
    if (before !== this.#acceptedText)
      return this.restore("editor state diverged from practice state");
    if (transaction.reason !== "user")
      return this.restore(`${transaction.reason} is an external mutation`);
    const event = transactionEvent(transaction);
    if (event === undefined)
      return this.restore(
        "multi-cursor and multi-change edits are unsupported",
      );

    const change = transaction.changes[0]!;
    const observedCandidate = replaceCharacterRange(
      this.#acceptedText,
      change.range,
      normalizeLineEndings(change.text),
    );
    if (observedCandidate === undefined)
      return this.restore("invalid editor range");
    if (observedCandidate !== after)
      return this.restore(
        "transaction text does not match its declared change",
      );
    if (
      event.type === "insert" &&
      (change.range.start !== characterLength(this.#acceptedText) ||
        change.range.end !== change.range.start)
    ) {
      return this.restore("insert must occur at the accepted prefix cursor");
    }

    // Prefer the literal host text when it is already canonical. Auto-closing
    // and auto-indentation have the same event shape as an intentional paste.
    const rawEvent = rawEventFor(event, change);
    const rawCandidate = this.#candidateFor(rawEvent);
    const effectiveEvent =
      rawCandidate !== undefined && this.#target.startsWith(rawCandidate)
        ? rawEvent
        : event;
    const candidate = this.#candidateFor(effectiveEvent);
    if (candidate === undefined) return this.restore("invalid editor range");
    const inputText =
      effectiveEvent.type === "delete"
        ? ""
        : normalizeLineEndings(effectiveEvent.text);
    const inputCharacters = characterLength(inputText);
    if (candidate === this.#target) {
      this.#acceptedText = candidate;
      this.#acceptedInputCount += inputCharacters;
      if (effectiveEvent.type !== "insert") this.#correctionCount += 1;
      this.#status = "completed";
      return this.result("accept");
    }
    if (this.#target.startsWith(candidate)) {
      this.#acceptedText = candidate;
      this.#acceptedInputCount += inputCharacters;
      if (effectiveEvent.type !== "insert") this.#correctionCount += 1;
      this.#mismatchOffset = undefined;
      return this.result("accept");
    }
    const offset = firstMismatch(candidate, this.#target);
    this.#rejectedInputCount += inputCharacters > 0 ? inputCharacters : 1;
    this.#mismatchOffset = offset;
    return {
      ...this.result("restore", "input does not match the canonical target"),
      mismatchOffset: offset,
    };
  }

  public restart(): void {
    if (this.#status === "disposed") return;
    this.#acceptedText = "";
    this.#mismatchOffset = undefined;
    this.#status = "active";
  }

  public stop(): void {
    if (this.#status === "active") this.#status = "stopped";
  }

  public dispose(): void {
    this.#status = "disposed";
  }

  public decorations(): DecorationState {
    return decorationsFor(
      this.#acceptedText,
      this.#target,
      this.#mismatchOffset,
    );
  }

  #candidateFor(event: PracticeEvent): string | undefined {
    if (event.type === "insert")
      return `${this.#acceptedText}${normalizeLineEndings(event.text)}`;
    if (event.type === "delete")
      return characterSlice(this.#acceptedText, {
        start: 0,
        end: event.range.start,
      });
    return replaceCharacterRange(
      this.#acceptedText,
      event.range,
      normalizeLineEndings(event.text),
    );
  }

  private restore(message: string): TransactionResult {
    return this.result("restore", message);
  }
  private result(
    action: TransactionAction,
    message?: string,
  ): TransactionResult {
    return {
      action,
      status: this.#status,
      acceptedText: this.#acceptedText,
      ...(message === undefined ? {} : { message }),
      decorations: this.decorations(),
    };
  }
}

function rawEventFor(
  event: PracticeEvent,
  change: EditorChange,
): PracticeEvent {
  if (event.type === "delete") return event;
  return event.type === "insert"
    ? { type: "insert", text: change.text }
    : { type: "replace", range: event.range, text: change.text };
}

function firstMismatch(candidate: string, target: string): number {
  const candidateChars = Array.from(candidate);
  const targetChars = Array.from(target);
  const limit = Math.min(candidateChars.length, targetChars.length);
  for (let index = 0; index < limit; index += 1) {
    if (candidateChars[index] !== targetChars[index]) return index;
  }
  return limit;
}

export interface Disposable {
  dispose(): void;
}

export class DisposableStore implements Disposable {
  #disposed = false;
  readonly #items: Disposable[] = [];
  public add<T extends Disposable>(item: T): T {
    if (this.#disposed) {
      item.dispose();
      return item;
    }
    this.#items.push(item);
    return item;
  }
  public dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    for (const item of this.#items.splice(0).reverse()) item.dispose();
  }
  public get size(): number {
    return this.#items.length;
  }
}

export interface PracticeDocumentHost {
  createUntitled(
    uri: string,
    text: string,
  ): Disposable & {
    readonly uri: string;
    replace(text: string): void;
    close(): void;
  };
  onChange(listener: (transaction: EditorTransaction) => void): Disposable;
  setDecorations(state: DecorationState): void;
  notifyComplete(actions: CompletionActions): void;
}

export interface CompletionActions {
  close(): void;
  restart(): void;
}

/** Owns a dedicated in-memory document and all subscriptions for one session. */
export class PracticeDocumentController implements Disposable {
  readonly #resources = new DisposableStore();
  readonly #host: PracticeDocumentHost;
  #session: ShadowTypingEditorSession;
  readonly #document: ReturnType<PracticeDocumentHost["createUntitled"]>;
  #stopped = false;
  #completionPrompted = false;

  public constructor(
    host: PracticeDocumentHost,
    sessionId: string,
    target: string,
  ) {
    this.#host = host;
    this.#session = new ShadowTypingEditorSession(target);
    this.#document = host.createUntitled(
      `untitled:gewu-practice/${sessionId}.txt`,
      "",
    );
    this.#resources.add(
      host.onChange((transaction) => this.#onChange(transaction)),
    );
    host.setDecorations(this.#session.decorations());
  }

  public get documentUri(): string {
    return this.#document.uri;
  }
  public get session(): ShadowTypingEditorSession {
    return this.#session;
  }
  public stop(): void {
    if (this.#stopped) return;
    this.#session.stop();
    this.#closeResources();
  }
  public dispose(): void {
    this.#session.dispose();
    this.#closeResources();
  }
  public restart(): void {
    if (this.#stopped) return;
    this.#session = new ShadowTypingEditorSession(this.#session.target);
    this.#completionPrompted = false;
    this.#document.replace("");
    this.#host.setDecorations(this.#session.decorations());
  }
  #onChange(transaction: EditorTransaction): void {
    const result = this.#session.apply(transaction);
    this.#host.setDecorations(result.decorations);
    if (
      result.action === "restore" ||
      normalizeLineEndings(transaction.afterText) !== result.acceptedText
    )
      this.#document.replace(result.acceptedText);
    if (result.status === "completed" && !this.#completionPrompted) {
      this.#completionPrompted = true;
      this.#host.notifyComplete({
        close: () => this.#closeResources(),
        restart: () => this.restart(),
      });
    }
  }
  #closeResources(): void {
    if (this.#stopped) return;
    this.#stopped = true;
    this.#document.close();
    this.#resources.dispose();
  }
}

/** Minimal command/session owner used to prove repeated starts are leak-free. */
export class PracticeSessionManager implements Disposable {
  #current: PracticeDocumentController | undefined;

  public start(
    host: PracticeDocumentHost,
    sessionId: string,
    target: string,
  ): PracticeDocumentController {
    this.#current?.stop();
    const controller = new PracticeDocumentController(host, sessionId, target);
    this.#current = controller;
    return controller;
  }

  public stop(): void {
    this.#current?.stop();
    this.#current = undefined;
  }

  public dispose(): void {
    this.#current?.dispose();
    this.#current = undefined;
  }
}
