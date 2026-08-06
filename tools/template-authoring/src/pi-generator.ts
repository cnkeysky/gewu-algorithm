import { Type, type Context, type Tool } from "@earendil-works/pi-ai";
import { builtinModels } from "@earendil-works/pi-ai/providers/all";
import { validateToolCall } from "@earendil-works/pi-ai";

export type PracticeModeSelection =
  | "shadow_typing"
  | "flow_recall"
  | "code_recall"
  | "reasoning_recall"
  | "transfer_practice";

export type CodeRecallAssistanceSelection = "skeleton" | "comments" | "keywords" | "cloze" | "none";
export type CodeRecallLayoutSelection = "full_recall" | "comment_guided" | "comment_to_code" | "cloze";

/** Selects practice projections for one algorithm unit; it does not duplicate the unit. */
export interface GenerationProfile {
  readonly practice_modes: PracticeModeSelection[];
  readonly code_recall_assistance: CodeRecallAssistanceSelection[];
  readonly code_recall_layouts: CodeRecallLayoutSelection[];
  readonly implementation_languages: string[];
  readonly implementation_variants: number;
}

export function validateGenerationProfile(profile: GenerationProfile): void {
  if (profile.practice_modes.length === 0) throw new Error("at least one practice mode is required");
  if (profile.implementation_languages.length === 0 || !Number.isInteger(profile.implementation_variants) || profile.implementation_variants < 1) {
    throw new Error("at least one implementation language and variant are required");
  }
  if (!profile.practice_modes.includes("code_recall") && profile.code_recall_assistance.length > 0) {
    throw new Error("code recall assistance requires the code_recall mode");
  }
  if (!profile.practice_modes.includes("code_recall") && profile.code_recall_layouts.length > 0) {
    throw new Error("code recall layouts require the code_recall mode");
  }
  if (profile.code_recall_layouts.some((layout) => layout === "comment_guided" || layout === "comment_to_code") && !profile.code_recall_assistance.includes("comments")) {
    throw new Error("comment-based layouts require comments assistance");
  }
  if (profile.code_recall_layouts.includes("cloze") && !profile.code_recall_assistance.includes("cloze")) {
    throw new Error("cloze layout requires cloze assistance");
  }
}

export interface DraftTask {
  readonly taskId: string;
  readonly taskVersion: string;
  readonly selectedInputHash: string;
  readonly instruction: string;
  readonly outputSchema: Record<string, unknown>;
  readonly profile?: GenerationProfile;
  readonly validate?: (artifact: unknown) => void;
}

export interface DraftArtifact {
  readonly taskId: string;
  readonly taskVersion: string;
  readonly selectedInputHash: string;
  readonly provider: string;
  readonly model: string;
  readonly manifest: Record<string, unknown>;
  readonly review: "pending";
}

export interface PiGeneratorOptions {
  readonly provider: string;
  readonly model: string;
  readonly maxTokens?: number;
  readonly timeoutMs?: number;
  readonly maxAttempts?: number;
  readonly maxStructuredAttempts?: number;
}

/** Reads non-secret selection settings. Provider credentials stay in Pi-ai's env/auth layer. */
export function optionsFromEnvironment(
  environment: Record<string, string | undefined> = process.env,
): PiGeneratorOptions {
  return {
    provider: environment.GEWU_LLM_PROVIDER ?? "deepseek",
    model: environment.GEWU_LLM_MODEL ?? "deepseek-v4-flash",
    maxTokens: parsePositiveInteger(environment.GEWU_LLM_MAX_TOKENS) ?? 16_384,
    timeoutMs: parsePositiveInteger(environment.GEWU_LLM_TIMEOUT_MS) ?? 120_000,
    maxAttempts: parsePositiveInteger(environment.GEWU_LLM_MAX_ATTEMPTS) ?? 2,
    maxStructuredAttempts: parsePositiveInteger(environment.GEWU_LLM_MAX_STRUCTURED_ATTEMPTS) ?? 3,
  };
}

export class PiGenerator {
  readonly #models = builtinModels();
  readonly #options: PiGeneratorOptions;

  constructor(options: PiGeneratorOptions) {
    this.#options = options;
  }

  async generate(task: DraftTask): Promise<DraftArtifact> {
    if (!task.taskId || !task.taskVersion || !task.selectedInputHash)
      throw new Error("task identity and selected input hash are required");
    if (task.profile) validateGenerationProfile(task.profile);

    const model = this.#models.getModel(this.#options.provider, this.#options.model);
    if (!model)
      throw new Error(`Pi-ai model not found: ${this.#options.provider}/${this.#options.model}`);

    const tool: Tool = {
      name: "emit_structured_output",
      description: "Return the requested GEWU artifact or review report as structured data.",
      parameters: Type.Unsafe(task.outputSchema),
      constrainedSampling: { type: "json_schema", strict: "prefer" },
    };
    const context: Context = {
      messages: [
        {
          role: "user",
          content: `${task.instruction}\n\nRequested generation profile:\n${JSON.stringify(task.profile ?? null)}\n\nReturn JSON matching this schema:\n${JSON.stringify(task.outputSchema)}`,
          timestamp: Date.now(),
        },
      ],
      tools: [tool],
    };
    const structuredAttempts = this.#options.maxStructuredAttempts ?? 1;
    for (let structuredAttempt = 1; structuredAttempt <= structuredAttempts; structuredAttempt += 1) {
      const maxAttempts = this.#options.maxAttempts ?? 1;
      let response;
      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        response = await this.#models.complete(model, context, {
          maxTokens: this.#options.maxTokens,
          temperature: 0,
          toolChoice: { type: "function", function: { name: tool.name } },
          signal: AbortSignal.timeout(this.#options.timeoutMs ?? 60_000),
        });
        if (response.stopReason !== "error" || attempt === maxAttempts) break;
      }
      if (!response) throw new Error("Pi-ai returned no response");
      const toolCall = response.content.find((block) => block.type === "toolCall");
      if (!toolCall || toolCall.type !== "toolCall") {
        const detail = response.errorMessage ? `: ${redactSecretLikeText(response.errorMessage)}` : "";
        throw new Error(
          `Pi-ai did not return the required structured tool call (stop reason ${response.stopReason})${detail}`,
        );
      }
      try {
        const manifest = validateToolCall([tool], toolCall) as unknown;
        if (!isRecord(manifest)) throw new Error("structured tool arguments must be an object");
        await task.validate?.(manifest);
        return {
          taskId: task.taskId,
          taskVersion: task.taskVersion,
          selectedInputHash: task.selectedInputHash,
          provider: this.#options.provider,
          model: this.#options.model,
          manifest,
          review: "pending",
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : "unknown validation error";
        if (structuredAttempt === structuredAttempts)
          throw new Error(`Pi-ai returned invalid structured tool arguments: ${message}`);
        context.messages.push(response, {
          role: "toolResult",
          toolCallId: toolCall.id,
          toolName: toolCall.name,
          content: [{
            type: "text",
            text: `Your structured arguments failed validation. Correct only the arguments and call the same tool again. Validation error: ${message}`,
          }],
          isError: true,
          timestamp: Date.now(),
        });
      }
    }
    throw new Error("Pi-ai structured generation attempts were exhausted");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parsePositiveInteger(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

export function redactSecretLikeText(value: string): string {
  return value.replace(/\b(?:sk-|key-)[A-Za-z0-9_-]{8,}\b/gi, "[REDACTED]");
}
