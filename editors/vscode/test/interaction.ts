import {
  DisposableStore,
  Disposable,
  EditorChange,
  EditorTransaction,
  CompletionActions,
  PracticeDocumentController,
  PracticeDocumentHost,
  PracticeSessionManager,
  ShadowTypingEditorSession,
  TextRange,
  transactionEvent,
  translateHostTransaction,
} from "../src/interaction.js";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function equal<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected)
    throw new Error(
      `${message}: expected ${String(expected)}, got ${String(actual)}`,
    );
}

function change(
  beforeText: string,
  afterText: string,
  edit: EditorChange,
  overrides: Partial<EditorTransaction> = {},
): EditorTransaction {
  return {
    beforeText,
    afterText,
    changes: [edit],
    selectionCount: 1,
    reason: "user",
    ...overrides,
  };
}

function insert(
  beforeText: string,
  text: string,
  kind: "insert" | "paste" = "insert",
): EditorTransaction {
  return change(beforeText, `${beforeText}${text}`, {
    range: { start: beforeText.length, end: beforeText.length },
    text,
    kind,
  });
}

function run(name: string, test: () => void): void {
  try {
    test();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

run("shares the v2 handshake golden request with Rust", () => {
  const fixture = readFileSync(
    resolve(process.cwd(), "../../fixtures/protocol/v2-handshake.ndjson"),
    "utf8",
  );
  const request = JSON.parse(fixture.split("\n")[0] ?? "") as {
    jsonrpc?: string;
    method?: string;
    params?: {
      protocol_min?: number;
      protocol_max?: number;
      client_version?: string;
    };
  };
  equal(request.jsonrpc, "2.0", "golden JSON-RPC version");
  equal(request.method, "gewu/handshake", "golden handshake method");
  equal(request.params?.protocol_min, 2, "golden minimum protocol version");
  equal(request.params?.protocol_max, 2, "golden maximum protocol version");
  equal(request.params?.client_version, "0.1.0", "golden client version");
});

run("accepts exact inserts and exposes decorations", () => {
  const session = new ShadowTypingEditorSession("ab");
  equal(session.decorations().guidanceText, "ab", "initial guidance");
  const first = session.apply(insert("", "a"));
  equal(first.action, "accept", "first insert");
  equal(first.decorations.accepted.end, 1, "accepted decoration");
  equal(first.decorations.guidanceText, "b", "remaining guidance");
  const complete = session.apply(insert("a", "b"));
  equal(complete.status, "completed", "terminal status");
  assert(session.facts !== undefined, "terminal facts");
});

run("guidance advances one line at a time", () => {
  const session = new ShadowTypingEditorSession("first\n  second");
  equal(session.decorations().guidanceText, "first", "first line guidance");
  session.apply(insert("", "first"));
  equal(session.decorations().guidanceText, "Enter", "newline guidance");
  session.apply(insert("first", "\n"));
  equal(
    session.decorations().guidanceText,
    "2sp",
    "second line indentation guidance",
  );
});

run("guidance summarizes leading indentation before showing line text", () => {
  const spaces = new ShadowTypingEditorSession("    value");
  equal(spaces.decorations().guidanceText, "4sp", "space indentation guidance");
  equal(
    spaces.apply(insert("", "    ")).action,
    "accept",
    "space indentation input",
  );
  equal(
    spaces.decorations().guidanceText,
    "value",
    "line text after indentation",
  );

  const tabs = new ShadowTypingEditorSession("\t\tvalue");
  equal(tabs.decorations().guidanceText, "2Tab", "tab indentation guidance");
});

run("rejects mismatch atomically and asks host to restore", () => {
  const session = new ShadowTypingEditorSession("abc");
  const result = session.apply(insert("", "x", "paste"));
  equal(result.action, "restore", "mismatch action");
  equal(result.acceptedText, "", "accepted prefix remains empty");
  equal(result.mismatchOffset, 0, "mismatch offset");
  equal(session.facts, undefined, "session remains active");
});

run("normalizes an editor auto-closed bracket pair", () => {
  const session = new ShadowTypingEditorSession("fn(");
  equal(session.apply(insert("", "fn")).action, "accept", "function prefix");
  const transaction = change("fn", "fn()", {
    range: { start: 2, end: 2 },
    text: "()",
    kind: "paste",
  });
  const event = transactionEvent(transaction);
  assert(event !== undefined, "auto-closed pair event");
  assert(event.type === "insert", "auto-closed pair insert event");
  const result = session.apply(transaction);
  equal(result.action, "accept", "auto-closed opening bracket");
  equal(result.acceptedText, "fn(", "canonical prefix");
});

run("preserves literal pastes that resemble host auto-edits", () => {
  const pair = new ShadowTypingEditorSession("()");
  equal(
    pair.apply(
      change("", "()", {
        range: { start: 0, end: 0 },
        text: "()",
        kind: "paste",
      }),
    ).status,
    "completed",
    "literal bracket pair paste",
  );

  const indented = new ShadowTypingEditorSession("\n  ");
  equal(
    indented.apply(
      change("", "\n  ", {
        range: { start: 0, end: 0 },
        text: "\n  ",
        kind: "paste",
      }),
    ).status,
    "completed",
    "literal indented newline paste",
  );
});

run("normalizes editor auto-indentation to one newline", () => {
  const transaction = change("line", "line\n    ", {
    range: { start: 4, end: 4 },
    text: "\n    ",
    kind: "paste",
  });
  const event = transactionEvent(transaction);
  assert(event !== undefined, "auto-indented newline event");
  assert(event.type === "insert", "auto-indented newline insert event");
  equal(event.text, "\n", "canonical newline");
});

run("supports Unicode scalar offsets, deletion and replacement", () => {
  const session = new ShadowTypingEditorSession("界🙂a");
  equal(
    session.apply(
      change("", "界🙂", {
        range: { start: 0, end: 0 },
        text: "界🙂",
        kind: "paste",
      }),
    ).action,
    "accept",
    "unicode paste",
  );
  const deletion = session.apply(
    change("界🙂", "界", {
      range: { start: 1, end: 2 },
      text: "",
      kind: "delete",
    }),
  );
  equal(deletion.action, "accept", "delete");
  equal(deletion.acceptedText, "界", "deleted scalar");
  const replacement = session.apply(
    change("界", "界🙂a", {
      range: { start: 1, end: 1 },
      text: "🙂a",
      kind: "replace",
    }),
  );
  equal(replacement.status, "completed", "replacement completion");
  equal(session.facts?.correctionCount, 2, "correction count");
});

run("deleting earlier text rewinds the accepted suffix", () => {
  const session = new ShadowTypingEditorSession("first\nsecond\nthird");
  equal(
    session.apply(insert("", "first\nsecond\n")).action,
    "accept",
    "initial prefix",
  );
  const deletion = session.apply(
    change("first\nsecond\n", "fist\nsecond\n", {
      range: { start: 2, end: 3 },
      text: "",
      kind: "delete",
    }),
  );
  equal(deletion.action, "accept", "earlier deletion accepted");
  equal(deletion.acceptedText, "fi", "suffix rewound");
});

run("rejects multi-cursor, format, undo and redo as external mutations", () => {
  const session = new ShadowTypingEditorSession("ab");
  const multi = session.apply(
    change(
      "",
      "a",
      { range: { start: 0, end: 0 }, text: "a", kind: "insert" },
      { selectionCount: 2 },
    ),
  );
  equal(multi.action, "restore", "multi-cursor policy");
  equal(
    session.apply(
      change(
        "",
        "",
        { range: { start: 0, end: 0 }, text: "", kind: "insert" },
        { reason: "undo" },
      ),
    ).action,
    "restore",
    "undo policy",
  );
  equal(
    session.apply(
      change(
        "",
        "",
        { range: { start: 0, end: 0 }, text: "", kind: "insert" },
        { reason: "redo" },
      ),
    ).action,
    "restore",
    "redo policy",
  );
  equal(
    session.apply(
      change(
        "",
        "",
        { range: { start: 0, end: 0 }, text: "", kind: "insert" },
        { reason: "format" },
      ),
    ).action,
    "restore",
    "format policy",
  );
});

run("validates host text and insertion position before accepting input", () => {
  const session = new ShadowTypingEditorSession("ab");
  session.apply(insert("", "a"));
  equal(
    session.apply(
      change("a", "ba", {
        range: { start: 0, end: 0 },
        text: "b",
        kind: "insert",
      }),
    ).action,
    "restore",
    "insert away from canonical cursor",
  );
  equal(session.acceptedText, "a", "mispositioned insert leaves state intact");

  equal(
    session.apply(
      change("a", "x", {
        range: { start: 1, end: 1 },
        text: "b",
        kind: "insert",
      }),
    ).action,
    "restore",
    "inconsistent host after text",
  );
  equal(
    session.acceptedText,
    "a",
    "inconsistent transaction leaves state intact",
  );
});

run("normalizes CRLF at the editor boundary", () => {
  const session = new ShadowTypingEditorSession("a\r\nb");
  equal(
    session.apply(
      change("", "a\r\n", {
        range: { start: 0, end: 0 },
        text: "a\r\n",
        kind: "paste",
      }),
    ).action,
    "accept",
    "CRLF prefix",
  );
  equal(session.acceptedText, "a\n", "canonical LF text");
});

run("translates VS Code UTF-16 offsets to scalar offsets", () => {
  const transaction = translateHostTransaction({
    beforeText: "界🙂",
    afterText: "界x",
    changes: [{ rangeOffset: 1, rangeLength: 2, text: "x", kind: "replace" }],
    selectionCount: 1,
    reason: "user",
  });
  assert(transaction !== undefined, "valid UTF-16 boundary");
  equal(transaction.changes[0]?.range.start, 1, "scalar start");
  equal(transaction.changes[0]?.range.end, 2, "scalar end");
  equal(
    translateHostTransaction({
      beforeText: "界🙂",
      afterText: "界?🙂",
      changes: [{ rangeOffset: 2, rangeLength: 0, text: "?", kind: "insert" }],
      selectionCount: 1,
      reason: "user",
    }),
    undefined,
    "rejects surrogate split",
  );
  const crlf = translateHostTransaction({
    beforeText: "a\r\nb",
    afterText: "a\r\n",
    changes: [{ rangeOffset: 3, rangeLength: 1, text: "", kind: "delete" }],
    selectionCount: 1,
    reason: "user",
  });
  assert(crlf !== undefined, "CRLF boundary conversion");
  equal(crlf.changes[0]?.range.start, 2, "CRLF scalar start");
  equal(crlf.changes[0]?.range.end, 3, "CRLF scalar end");
});

run("restart and stop are explicit lifecycle transitions", () => {
  const session = new ShadowTypingEditorSession("ab");
  session.apply(insert("", "a"));
  session.stop();
  equal(session.status, "stopped", "stop status");
  assert(session.facts !== undefined, "stopped facts");
  session.restart();
  equal(session.status, "active", "restart status");
  equal(session.acceptedText, "", "restart prefix");
});

class FakeDocument implements Disposable {
  public readonly uri: string;
  public text: string;
  public closed = false;
  public replaced = 0;
  public constructor(uri: string, text: string) {
    this.uri = uri;
    this.text = text;
  }
  public replace(text: string): void {
    this.text = text;
    this.replaced += 1;
  }
  public close(): void {
    this.closed = true;
  }
  public dispose(): void {
    this.close();
  }
}

class FakeHost implements PracticeDocumentHost {
  public readonly documents: FakeDocument[] = [];
  public readonly listeners: Array<(transaction: EditorTransaction) => void> =
    [];
  public decorationsCount = 0;
  public completionNotifications = 0;
  public completionActions: CompletionActions | undefined;
  public createUntitled(uri: string, text: string): FakeDocument {
    const document = new FakeDocument(uri, text);
    this.documents.push(document);
    return document;
  }
  public onChange(
    listener: (transaction: EditorTransaction) => void,
  ): Disposable {
    this.listeners.push(listener);
    return {
      dispose: () => {
        const index = this.listeners.indexOf(listener);
        if (index >= 0) this.listeners.splice(index, 1);
      },
    };
  }
  public setDecorations(): void {
    this.decorationsCount += 1;
  }
  public notifyComplete(actions: CompletionActions): void {
    this.completionNotifications += 1;
    this.completionActions = actions;
  }
  public emit(transaction: EditorTransaction): void {
    for (const listener of [...this.listeners]) listener(transaction);
  }
}

run("controller owns the dedicated document and disposes listeners", () => {
  const host = new FakeHost();
  const controller = new PracticeDocumentController(host, "one", "ab");
  equal(
    host.documents[0]?.uri,
    "untitled:gewu-practice/one.txt",
    "dedicated URI",
  );
  equal(host.listeners.length, 1, "one listener");
  host.emit(insert("", "a"));
  equal(controller.session.acceptedText, "a", "host transaction");
  controller.stop();
  equal(host.listeners.length, 0, "listener disposed");
  equal(host.documents[0]?.closed, true, "practice document closed");
  controller.dispose();
  equal(host.listeners.length, 0, "dispose idempotence");
});

run("completion waits for close before disposing the document", () => {
  const host = new FakeHost();
  const controller = new PracticeDocumentController(host, "complete", "a");
  host.emit(insert("", "a"));
  equal(controller.session.status, "completed", "completion status");
  equal(host.listeners.length, 1, "completed session remains owned");
  equal(host.documents[0]?.closed, false, "completed document remains visible");
  equal(host.completionNotifications, 1, "short completion notification");
  host.completionActions?.close();
  equal(host.listeners.length, 0, "close disposes listener");
  equal(host.documents[0]?.closed, true, "close closes document");
});

run("completion restart reuses one controlled document", () => {
  const host = new FakeHost();
  const controller = new PracticeDocumentController(host, "restart", "a");
  host.emit(insert("", "a"));
  host.completionActions?.restart();
  equal(controller.session.status, "active", "restart status");
  equal(controller.session.acceptedText, "", "restart clears progress");
  equal(host.documents[0]?.text, "", "restart clears document");
  equal(host.documents[0]?.closed, false, "restart keeps document open");
  equal(host.listeners.length, 1, "restart keeps one listener");
  host.emit(insert("", "a"));
  equal(
    controller.session.facts?.acceptedInputCount,
    1,
    "restart resets attempt facts",
  );
});

run("final trailing newline remains required before completion", () => {
  const host = new FakeHost();
  const controller = new PracticeDocumentController(host, "newline", "a\n");
  host.emit(insert("", "a"));
  equal(controller.session.status, "active", "text before final newline");
  equal(
    controller.session.decorations().guidanceText,
    "Enter",
    "final enter guidance",
  );
  host.emit(insert("a", "\n"));
  equal(
    controller.session.status,
    "completed",
    "completion after final newline",
  );
  equal(host.completionNotifications, 1, "completion is announced once");
});

run("final newline removes host indentation before completion", () => {
  const host = new FakeHost();
  const controller = new PracticeDocumentController(host, "indent", "a\n");
  host.emit(insert("", "a"));
  host.emit(
    change("a", "a\n    ", {
      range: { start: 1, end: 1 },
      text: "\n    ",
      kind: "paste",
    }),
  );
  equal(controller.session.status, "completed", "completion status");
  equal(host.completionNotifications, 1, "completion notification");
  equal(host.documents[0]?.text, "a\n", "auto-indentation removed");
});

run("manager replaces repeated sessions without leaking listeners", () => {
  const host = new FakeHost();
  const manager = new PracticeSessionManager();
  manager.start(host, "one", "a");
  manager.start(host, "two", "b");
  equal(host.listeners.length, 1, "only current listener remains");
  equal(host.documents[0]?.closed, true, "previous document closed");
  equal(host.documents[1]?.closed, false, "current document open");
  manager.dispose();
  equal(host.listeners.length, 0, "manager disposal");
  equal(host.documents[1]?.closed, true, "current document closed");
});

run("disposable store disposes newly-added resources after disposal", () => {
  const store = new DisposableStore();
  let disposed = 0;
  store.add({
    dispose: () => {
      disposed += 1;
    },
  });
  store.dispose();
  store.add({
    dispose: () => {
      disposed += 1;
    },
  });
  equal(disposed, 2, "resource disposal");
});

console.log("VS Code interaction spike tests passed");
