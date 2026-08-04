import { CoreEvent, CoreSession, Elapsed } from "../src/core-client.js";
import { CorePracticeDocumentController } from "../src/core-session.js";
import {
  CompletionActions,
  Disposable,
  EditorTransaction,
  PracticeDocumentHost,
} from "../src/interaction.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

class FakeDocument implements Disposable {
  public readonly uri = "untitled:gewu-practice/test.txt";
  public text: string;
  public closed = false;

  public constructor(text: string) {
    this.text = text;
  }

  public replace(text: string): void {
    this.text = text;
  }

  public close(): void {
    this.closed = true;
  }

  public dispose(): void {
    this.close();
  }
}

class FakeHost implements PracticeDocumentHost {
  public readonly document = new FakeDocument("");
  public listener: ((transaction: EditorTransaction) => void) | undefined;
  public completionActions: CompletionActions | undefined;

  public createUntitled(_uri: string, text: string): FakeDocument {
    this.document.text = text;
    return this.document;
  }

  public onChange(
    listener: (transaction: EditorTransaction) => void,
  ): Disposable {
    this.listener = listener;
    return { dispose: () => (this.listener = undefined) };
  }

  public setDecorations(): void {}

  public notifyComplete(actions: CompletionActions): void {
    this.completionActions = actions;
  }

  public emit(transaction: EditorTransaction): void {
    this.listener?.(transaction);
  }
}

class DeferredCoreClient {
  public readonly calls: Array<{ event: CoreEvent; elapsed: Elapsed }> = [];
  public readonly restartCalls: string[] = [];
  readonly #pending: Array<(session: CoreSession) => void> = [];
  readonly #restartPending: Array<(session: CoreSession) => void> = [];

  public applyEvent(
    _sessionId: string,
    event: CoreEvent,
    elapsed: Elapsed,
  ): Promise<CoreSession> {
    this.calls.push({ event, elapsed });
    return new Promise((resolve) => this.#pending.push(resolve));
  }

  public stopSession(
    _sessionId: string,
    _elapsed: Elapsed,
  ): Promise<CoreSession> {
    return Promise.resolve(session("", "stopped"));
  }

  public restartSession(sessionId: string): Promise<CoreSession> {
    this.restartCalls.push(sessionId);
    return new Promise((resolve) => this.#restartPending.push(resolve));
  }

  public resolveNext(value: CoreSession): void {
    const resolve = this.#pending.shift();
    assert(resolve !== undefined, "pending core request");
    resolve(value);
  }

  public resolveRestart(value: CoreSession): void {
    const resolve = this.#restartPending.shift();
    assert(resolve !== undefined, "pending core restart request");
    resolve(value);
  }
}

function session(
  acceptedText: string,
  status: CoreSession["status"] = "active",
  elapsed = 0,
): CoreSession {
  return {
    session_id: "session-1",
    unit_id: "graph.bfs",
    unit_title: "Breadth-First Search",
    problem_question: "How should the frontier be expanded?",
    revision: 1,
    mode: "shadow_typing",
    status,
    accepted_text: acceptedText,
    target_text: "ab",
    current_prompt: null,
    completed_prompts: [],
    completed_steps: 0,
    total_steps: 0,
    accepted_input_count: acceptedText.length,
    rejected_input_count: 0,
    correction_count: 0,
    prompt_count: 0,
    active_ms: elapsed,
    wall_ms: elapsed,
    terminal_reason: status === "completed" ? "completed" : null,
  };
}

function insert(beforeText: string, text: string): EditorTransaction {
  return {
    beforeText,
    afterText: `${beforeText}${text}`,
    changes: [
      {
        range: { start: beforeText.length, end: beforeText.length },
        text,
        kind: "insert",
      },
    ],
    selectionCount: 1,
    reason: "user",
  };
}

function nextTurn(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

async function main(): Promise<void> {
  const host = new FakeHost();
  const client = new DeferredCoreClient();
  const controller = new CorePracticeDocumentController(
    host,
    client,
    session(""),
  );

  host.emit(insert("", "a"));
  host.emit(insert("a", "b"));
  await nextTurn();
  assert(client.calls.length === 1, "only one RPC request is in flight");

  client.resolveNext(session("a"));
  await nextTurn();
  const queuedCallCount: number = client.calls.length;
  assert(queuedCallCount === 2, "the second edit is queued");

  client.resolveNext(session("ab", "completed"));
  await nextTurn();
  assert(host.completionActions !== undefined, "queued completion is reported");

  host.completionActions.restart();
  await nextTurn();
  assert(
    client.restartCalls.length === 1,
    "completion restart uses fresh session",
  );
  client.resolveRestart({ ...session(""), session_id: "session-2" });
  await nextTurn();
  assert(host.document.text === "", "restart clears the practice document");

  controller.dispose();

  const resumedHost = new FakeHost();
  const resumedClient = new DeferredCoreClient();
  const resumed = new CorePracticeDocumentController(
    resumedHost,
    resumedClient,
    session("", "active", 500),
  );
  await new Promise((resolve) => setTimeout(resolve, 10));
  resumedHost.emit(insert("", "a"));
  await nextTurn();
  assert(
    (resumedClient.calls[0]?.elapsed.active_ms ?? 0) > 500,
    "resumed timing adds the prior elapsed baseline",
  );
  resumedClient.resolveNext(session("a", "active", 511));
  await nextTurn();
  resumed.dispose();

  const indentationHost = new FakeHost();
  const indentationClient = new DeferredCoreClient();
  const indentationSession = {
    ...session("a\n"),
    target_text: "a\n        return value",
  };
  const indentationController = new CorePracticeDocumentController(
    indentationHost,
    indentationClient,
    indentationSession,
  );
  indentationHost.emit(insert("a\n", "    "));
  await nextTurn();
  assert(
    indentationClient.calls[0]?.event.type === "insert_text" &&
      indentationClient.calls[0].event.text === "    ",
    "one host Tab submits one editor indentation width",
  );
  indentationClient.resolveNext({
    ...indentationSession,
    accepted_text: "a\n    ",
  });
  await nextTurn();
  indentationHost.emit(insert("a\n    ", "    "));
  await nextTurn();
  assert(
    indentationClient.calls[1]?.event.type === "insert_text" &&
      indentationClient.calls[1].event.text === "    ",
    "a second Tab completes eight-space indentation",
  );
  indentationClient.resolveNext({
    ...indentationSession,
    accepted_text: "a\n        ",
  });
  await nextTurn();
  indentationController.dispose();

  const spacesHost = new FakeHost();
  const spacesClient = new DeferredCoreClient();
  const spacesSession = {
    ...session("a\n"),
    target_text: "a\n            return value",
  };
  const spacesController = new CorePracticeDocumentController(
    spacesHost,
    spacesClient,
    spacesSession,
  );
  spacesHost.emit(insert("a\n", "    "));
  await nextTurn();
  assert(
    spacesClient.calls[0]?.event.type === "insert_text" &&
      spacesClient.calls[0].event.text === "    ",
    "twelve-space indentation remains incremental",
  );
  spacesClient.resolveNext({
    ...spacesSession,
    accepted_text: "a\n    ",
  });
  await nextTurn();
  spacesController.dispose();

  console.log("PASS queues core-backed edits and preserves resumed timing");
}

void main().catch((error: unknown) => {
  console.error("FAIL core-backed editor session");
  console.error(error);
  process.exitCode = 1;
});
