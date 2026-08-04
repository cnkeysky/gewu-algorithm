import { ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import * as readline from "node:readline";

export type PracticeMode = "shadow_typing" | "flow_recall";
export type SessionStatus = "active" | "completed" | "stopped";

export interface CoreSession {
  readonly session_id: string;
  readonly unit_id: string;
  readonly unit_title: string;
  readonly problem_question: string;
  readonly revision: number;
  readonly mode: PracticeMode;
  readonly status: SessionStatus;
  readonly accepted_text: string;
  readonly target_text: string;
  readonly current_prompt: string | null;
  readonly completed_prompts: readonly string[];
  readonly completed_steps: number;
  readonly total_steps: number;
  readonly accepted_input_count: number;
  readonly rejected_input_count: number;
  readonly correction_count: number;
  readonly prompt_count: number;
  readonly active_ms: number;
  readonly wall_ms: number;
  readonly terminal_reason: "completed" | "stopped" | null;
}

export type CoreEvent =
  | { readonly type: "insert_text"; readonly text: string }
  | {
      readonly type: "delete_range";
      readonly start: number;
      readonly end: number;
    }
  | {
      readonly type: "replace_range";
      readonly start: number;
      readonly end: number;
      readonly text: string;
    }
  | {
      readonly type: "reveal_hint";
      readonly start: number;
      readonly end: number;
    }
  | { readonly type: "restart" }
  | { readonly type: "submit_answer"; readonly answer: string }
  | { readonly type: "reveal_prompt" };

interface RpcResponse {
  readonly jsonrpc: string;
  readonly id: number;
  readonly result?: unknown;
  readonly error?: {
    readonly code: number;
    readonly message: string;
    readonly data?: { readonly kind?: string };
  };
}

/** JSON-RPC stdio client. It validates untrusted core frames before use. */
export class GewuCoreClient {
  readonly #process: ChildProcessWithoutNullStreams;
  readonly #pending = new Map<
    number,
    {
      resolve(value: unknown): void;
      reject(reason: Error): void;
      timeout: NodeJS.Timeout;
    }
  >();
  #nextId = 1;
  #disposed = false;

  private constructor(process: ChildProcessWithoutNullStreams) {
    this.#process = process;
    process.stderr.resume();
    const lines = readline.createInterface({ input: process.stdout });
    lines.on("line", (line) => this.#onLine(line));
    process.once("error", (error) => this.#rejectAll(error));
    process.once("exit", (code) =>
      this.#rejectAll(new Error(`GEWU core process exited with code ${code}`)),
    );
  }

  public static async start(options: {
    readonly cargoPath: string;
    readonly workspaceRoot: string;
    readonly contentRoot: string;
    readonly dataRoot: string;
  }): Promise<GewuCoreClient> {
    const process = spawn(
      options.cargoPath,
      [
        "run",
        "--quiet",
        "--package",
        "gewu-cli",
        "--",
        "stdio",
        "--content-root",
        options.contentRoot,
        "--data-root",
        options.dataRoot,
      ],
      { cwd: options.workspaceRoot, stdio: "pipe" },
    );
    const client = new GewuCoreClient(process);
    await client.request("gewu/handshake", {
      protocol_min: 1,
      protocol_max: 1,
      client_name: "vscode",
      client_version: "0.1.0",
    });
    return client;
  }

  public async listUnits(): Promise<readonly UnitSummary[]> {
    const result = await this.request("gewu/listUnits", {});
    if (!Array.isArray(result) || !result.every(isUnitSummary))
      throw new Error("GEWU core returned an invalid unit list");
    return result;
  }

  public async startSession(
    unitId: string,
    mode: PracticeMode,
    implementation?: string,
  ): Promise<CoreSession> {
    const result = await this.request("gewu/startSession", {
      unit_id: unitId,
      mode,
      ...(implementation === undefined ? {} : { implementation }),
    });
    return sessionFromResult(result);
  }

  public async applyEvent(
    sessionId: string,
    event: CoreEvent,
    elapsed: Elapsed,
  ): Promise<CoreSession> {
    return sessionFromResult(
      await this.request("gewu/applyEvent", {
        session_id: sessionId,
        event,
        elapsed,
      }),
    );
  }

  public async stopSession(
    sessionId: string,
    elapsed: Elapsed,
  ): Promise<CoreSession> {
    return sessionFromResult(
      await this.request("gewu/stopSession", {
        session_id: sessionId,
        elapsed,
      }),
    );
  }

  public async restartSession(sessionId: string): Promise<CoreSession> {
    return sessionFromResult(
      await this.request("gewu/restartSession", { session_id: sessionId }),
    );
  }

  public async resumeCheckpoint(): Promise<CheckpointResume | undefined> {
    const result = await this.request("gewu/resumeCheckpoint", {});
    if (!isObject(result))
      throw new Error("GEWU core returned an invalid resume result");
    if (result.session === null) return undefined;
    return isCoreSession(result.session) && typeof result.saved_at === "string"
      ? { session: result.session, savedAt: result.saved_at }
      : (() => {
          throw new Error("GEWU core returned an invalid checkpoint session");
        })();
  }

  public async discardCheckpoint(): Promise<void> {
    await this.request("gewu/discardCheckpoint", {});
  }

  public async recentAttempts(): Promise<readonly AttemptSummary[]> {
    const result = await this.request("gewu/recentAttempts", { limit: 20 });
    if (!isObject(result) || !Array.isArray(result.attempts))
      throw new Error("GEWU core returned invalid attempt history");
    return result.attempts.filter(isAttemptSummary);
  }

  public async deleteHistory(): Promise<number> {
    const result = await this.request("gewu/deleteHistory", {});
    if (!isObject(result) || typeof result.deleted_attempts !== "number")
      throw new Error("GEWU core returned an invalid history deletion result");
    return result.deleted_attempts;
  }

  public async deleteAttempts(ids: readonly string[]): Promise<number> {
    const result = await this.request("gewu/deleteAttempts", { ids });
    if (!isObject(result) || typeof result.deleted_attempts !== "number")
      throw new Error("GEWU core returned an invalid deletion result");
    return result.deleted_attempts;
  }

  public dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#rejectAll(new Error("GEWU core client was disposed"));
    this.#process.kill();
  }

  private request(method: string, params: object): Promise<unknown> {
    if (this.#disposed)
      return Promise.reject(new Error("GEWU core is unavailable"));
    const id = this.#nextId++;
    return new Promise<unknown>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error(`GEWU core request timed out: ${method}`));
      }, 30_000);
      this.#pending.set(id, { resolve, reject, timeout });
      this.#process.stdin.write(
        `${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`,
        (error) => {
          if (error !== null) {
            const pending = this.#pending.get(id);
            if (pending !== undefined) clearTimeout(pending.timeout);
            this.#pending.delete(id);
            reject(error);
          }
        },
      );
    });
  }

  #onLine(line: string): void {
    let response: RpcResponse;
    try {
      response = JSON.parse(line) as RpcResponse;
    } catch {
      this.#rejectAll(new Error("GEWU core emitted an invalid JSON frame"));
      return;
    }
    if (response.jsonrpc !== "2.0" || !Number.isInteger(response.id)) return;
    const pending = this.#pending.get(response.id);
    if (pending === undefined) return;
    this.#pending.delete(response.id);
    clearTimeout(pending.timeout);
    if (response.error !== undefined) {
      const kind = response.error.data?.kind ?? String(response.error.code);
      pending.reject(new Error(`GEWU core ${kind}: ${response.error.message}`));
    } else {
      pending.resolve(response.result);
    }
  }

  #rejectAll(error: Error): void {
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.#pending.clear();
  }
}

export interface Elapsed {
  readonly active_ms: number;
  readonly wall_ms: number;
}
export interface CheckpointResume {
  readonly session: CoreSession;
  readonly savedAt: string;
}
export interface UnitSummary {
  readonly id: string;
  readonly revision: number;
  readonly title: string;
  readonly modes: readonly PracticeMode[];
}
export interface AttemptSummary {
  readonly id: string;
  readonly created_at: string;
  readonly unit_id: string;
  readonly revision: number;
  readonly mode: PracticeMode;
  readonly terminal_reason: "completed" | "stopped";
  readonly accepted_input_count: number;
  readonly rejected_input_count: number;
  readonly correction_count: number;
  readonly prompt_count: number;
  readonly active_ms: number;
  readonly wall_ms: number;
}

function sessionFromResult(result: unknown): CoreSession {
  if (!isObject(result) || !isCoreSession(result.session))
    throw new Error("GEWU core returned an invalid session result");
  return result.session;
}
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
function isCoreSession(value: unknown): value is CoreSession {
  if (!isObject(value)) return false;
  return (
    typeof value.session_id === "string" &&
    typeof value.unit_id === "string" &&
    typeof value.unit_title === "string" &&
    typeof value.problem_question === "string" &&
    typeof value.revision === "number" &&
    (value.mode === "shadow_typing" || value.mode === "flow_recall") &&
    (value.status === "active" ||
      value.status === "completed" ||
      value.status === "stopped") &&
    typeof value.accepted_text === "string" &&
    typeof value.target_text === "string" &&
    (typeof value.current_prompt === "string" ||
      value.current_prompt === null) &&
    Array.isArray(value.completed_prompts) &&
    value.completed_prompts.every((prompt) => typeof prompt === "string") &&
    typeof value.completed_steps === "number" &&
    typeof value.total_steps === "number" &&
    typeof value.accepted_input_count === "number" &&
    typeof value.rejected_input_count === "number" &&
    typeof value.correction_count === "number" &&
    typeof value.prompt_count === "number" &&
    typeof value.active_ms === "number" &&
    typeof value.wall_ms === "number" &&
    (value.terminal_reason === "completed" ||
      value.terminal_reason === "stopped" ||
      value.terminal_reason === null)
  );
}
function isUnitSummary(value: unknown): value is UnitSummary {
  return (
    isObject(value) &&
    typeof value.id === "string" &&
    typeof value.revision === "number" &&
    typeof value.title === "string" &&
    Array.isArray(value.modes) &&
    value.modes.every(
      (mode) => mode === "shadow_typing" || mode === "flow_recall",
    )
  );
}
function isAttemptSummary(value: unknown): value is AttemptSummary {
  return (
    isObject(value) &&
    typeof value.id === "string" &&
    typeof value.created_at === "string" &&
    typeof value.unit_id === "string" &&
    typeof value.revision === "number" &&
    (value.mode === "shadow_typing" || value.mode === "flow_recall") &&
    (value.terminal_reason === "completed" ||
      value.terminal_reason === "stopped") &&
    typeof value.accepted_input_count === "number" &&
    typeof value.rejected_input_count === "number" &&
    typeof value.correction_count === "number" &&
    typeof value.prompt_count === "number" &&
    typeof value.active_ms === "number" &&
    typeof value.wall_ms === "number"
  );
}
