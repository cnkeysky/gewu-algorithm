import {
  CompletionActions,
  DecorationState,
  Disposable,
  DisposableStore,
  EditorTransaction,
  PracticeDocumentHost,
  decorationsFor,
  normalizeLineEndings,
  transactionEvent,
} from "./interaction.js";
import { CoreEvent, CoreSession, GewuCoreClient } from "./core-client.js";

type PracticeCoreClient = Pick<
  GewuCoreClient,
  "applyEvent" | "restartSession" | "stopSession"
>;

/**
 * Editor adapter for Rust-owned code practice sessions. It translates native
 * transactions and renders the state returned by the core; it never scores.
 */
export class CorePracticeDocumentController implements Disposable {
  readonly #resources = new DisposableStore();
  readonly #host: PracticeDocumentHost;
  readonly #client: PracticeCoreClient;
  readonly #document: ReturnType<PracticeDocumentHost["createUntitled"]>;
  readonly #startedAt = Date.now();
  readonly #baseActiveMs: number;
  readonly #baseWallMs: number;
  #session: CoreSession;
  #closed = false;
  #completionPrompted = false;
  #commandPending = false;
  #transactionTail: Promise<void> = Promise.resolve();

  public constructor(
    host: PracticeDocumentHost,
    client: PracticeCoreClient,
    session: CoreSession,
  ) {
    if (session.mode !== "shadow_typing" && session.mode !== "code_recall")
      throw new Error("native practice document only supports code practice");
    this.#host = host;
    this.#client = client;
    this.#session = session;
    this.#baseActiveMs = session.active_ms;
    this.#baseWallMs = session.wall_ms;
    this.#document = host.createUntitled(
      `untitled:gewu-practice/${session.session_id}.txt`,
      session.accepted_text,
    );
    this.#resources.add(
      host.onChange((transaction) => void this.#onChange(transaction)),
    );
    this.#render();
  }

  public get documentUri(): string {
    return this.#document.uri;
  }

  public get sessionId(): string {
    return this.#session.session_id;
  }

  public get unitTitle(): string {
    return this.#session.unit_title;
  }

  public get mode(): CoreSession["mode"] {
    return this.#session.mode;
  }

  public get currentPrompt(): string | null {
    return this.#session.current_prompt;
  }

  public get visibleScaffold(): readonly string[] {
    return this.#session.visible_scaffold ?? [];
  }

  public async revealPrompt(): Promise<CoreSession> {
    if (this.#closed || this.#session.mode !== "code_recall")
      return this.#session;
    this.#session = await this.#client.applyEvent(
      this.#session.session_id,
      { type: "reveal_prompt" },
      this.#elapsed(),
    );
    return this.#session;
  }

  public async stop(): Promise<void> {
    if (this.#closed || this.#commandPending) return;
    this.#commandPending = true;
    this.#transactionTail = this.#transactionTail.then(async () => {
      if (this.#closed) return;
      await this.#client.stopSession(this.#session.session_id, this.#elapsed());
      this.#close();
    });
    try {
      await this.#transactionTail;
    } catch (error: unknown) {
      this.#commandPending = false;
      this.#restoreWithError(error);
      throw error;
    }
  }

  public restart(): void {
    if (this.#closed || this.#commandPending) return;
    this.#commandPending = true;
    this.#transactionTail = this.#transactionTail
      .then(async () => {
        if (this.#closed) return;
        this.#session = await this.#client.restartSession(
          this.#session.session_id,
        );
        this.#completionPrompted = false;
        this.#document.replace(this.#session.accepted_text);
        this.#render();
      })
      .catch((error: unknown) => this.#restoreWithError(error))
      .finally(() => {
        this.#commandPending = false;
      });
  }

  public dispose(): void {
    // A host shutdown is interruption, not an explicit stop. Events have
    // already checkpointed through the core, so this must not create an attempt.
    this.#close();
  }

  #onChange(transaction: EditorTransaction): void {
    if (this.#closed || this.#commandPending) {
      this.#document.replace(this.#session.accepted_text);
      return;
    }
    this.#transactionTail = this.#transactionTail.then(() =>
      this.#applyTransaction(transaction),
    );
  }

  async #applyTransaction(transaction: EditorTransaction): Promise<void> {
    if (this.#closed) return;
    if (
      transaction.reason !== "user" ||
      transaction.selectionCount !== 1 ||
      transaction.changes.length !== 1 ||
      normalizeLineEndings(transaction.beforeText) !==
        this.#session.accepted_text
    ) {
      this.#document.replace(this.#session.accepted_text);
      return;
    }
    const translated = transactionEvent(transaction);
    const event = translated === undefined ? undefined : coreEvent(translated);
    if (event === undefined) {
      this.#document.replace(this.#session.accepted_text);
      return;
    }
    try {
      const session = await this.#client.applyEvent(
        this.#session.session_id,
        event,
        this.#elapsed(),
      );
      if (this.#closed) return;
      this.#session = session;
      if (normalizeLineEndings(transaction.afterText) !== session.accepted_text)
        this.#document.replace(session.accepted_text);
      this.#render();
      if (session.status === "completed" && !this.#completionPrompted) {
        this.#completionPrompted = true;
        this.#host.notifyComplete({
          close: () => this.#close(),
          restart: () => this.restart(),
        });
      }
    } catch (error: unknown) {
      this.#restoreWithError(error);
    }
  }

  #restoreWithError(_error: unknown): void {
    // Error text may contain local file paths; restore deterministically and
    // keep the user-facing feedback in the extension command boundary.
    this.#document.replace(this.#session.accepted_text);
    this.#render();
  }

  #render(): void {
    this.#host.setDecorations(
      this.#session.mode === "shadow_typing"
        ? decorationsFor(this.#session.accepted_text, this.#session.target_text)
        : decorationsFor(this.#session.accepted_text, ""),
    );
  }

  #close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#document.close();
    this.#resources.dispose();
  }

  #elapsed(): { active_ms: number; wall_ms: number } {
    const localElapsed = Math.max(0, Date.now() - this.#startedAt);
    return {
      active_ms: this.#baseActiveMs + localElapsed,
      wall_ms: this.#baseWallMs + localElapsed,
    };
  }
}

function coreEvent(
  event: ReturnType<typeof transactionEvent>,
): CoreEvent | undefined {
  if (event === undefined) return undefined;
  if (event.type === "insert")
    return {
      type: "insert_text",
      text: event.text,
    };
  if (event.type === "delete")
    return {
      type: "delete_range",
      start: event.range.start,
      end: event.range.end,
    };
  return {
    type: "replace_range",
    start: event.range.start,
    end: event.range.end,
    text: event.text,
  };
}

export function coreDecorations(session: CoreSession): DecorationState {
  return decorationsFor(session.accepted_text, session.target_text);
}
