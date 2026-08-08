import { Type, createProvider, envApiKeyAuth, type Context, type Model, type MutableModels, type Tool } from "@earendil-works/pi-ai";
import { builtinModels } from "@earendil-works/pi-ai/providers/all";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import { validateToolCall } from "@earendil-works/pi-ai";
import { randomUUID } from "node:crypto";

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
  if (profile.implementation_languages.length === 0 || !Number.isInteger(profile.implementation_variants) || profile.implementation_variants < 0) {
    throw new Error("at least one implementation language is required; variants must be 0 (auto) or a positive integer");
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
  /** "forced" pins the structured tool call; "auto" lets the model decide
   * (required for reasoning-mode relays that reject forced tool_choice). */
  readonly toolChoice?: "auto" | "forced";
  /** Optional `reasoning_effort` value injected into relay requests. Some
   * reasoning-mode gateways ignore `thinking: {type:"disabled"}` but honor
   * `reasoning_effort: "none"`, which is the relay default. */
  readonly reasoningEffort?: string;
}

/** Provider id used for a custom OpenAI-compatible relay/proxy endpoint. */
export const RELAY_PROVIDER_ID = "relay";

/** Reads non-secret selection settings. Provider credentials stay in Pi-ai's env/auth layer. */
export function optionsFromEnvironment(
  environment: Record<string, string | undefined> = process.env,
): PiGeneratorOptions {
  const provider = nonEmpty(environment.GEWU_LLM_PROVIDER) ?? "deepseek";
  return {
    provider,
    model: environment.GEWU_LLM_MODEL ?? "deepseek-v4-flash",
    maxTokens: parsePositiveInteger(environment.GEWU_LLM_MAX_TOKENS) ?? 16_384,
    timeoutMs: parsePositiveInteger(environment.GEWU_LLM_TIMEOUT_MS) ?? 120_000,
    maxAttempts: parsePositiveInteger(environment.GEWU_LLM_MAX_ATTEMPTS) ?? 2,
    maxStructuredAttempts: parsePositiveInteger(environment.GEWU_LLM_MAX_STRUCTURED_ATTEMPTS) ?? 3,
    toolChoice: parseToolChoice(environment.GEWU_LLM_TOOL_CHOICE) ?? (provider === RELAY_PROVIDER_ID ? "auto" : "forced"),
    reasoningEffort: nonEmpty(environment.GEWU_LLM_REASONING_EFFORT) ?? (provider === RELAY_PROVIDER_ID ? "none" : undefined),
  };
}

/**
 * Builds the Pi-ai model catalog. When `GEWU_LLM_BASE_URL` is set, registers
 * a custom relay provider (id `relay`) that routes every request to that
 * endpoint, so relay/proxy services can be used without code changes. The
 * relay credential comes from `GEWU_LLM_API_KEY` (with `DEEPSEEK_API_KEY`
 * accepted as a fallback for existing local setups).
 */
export function modelCatalogFromEnvironment(
  environment: Record<string, string | undefined> = process.env,
): MutableModels {
  const models = builtinModels();
  const baseUrl = nonEmpty(environment.GEWU_LLM_BASE_URL);
  if (!baseUrl) return models;
  const modelId = nonEmpty(environment.GEWU_LLM_MODEL) ?? "deepseek-chat";
  const relayModel: Model<"openai-completions"> = {
    id: modelId,
    name: `relay model (${modelId})`,
    api: "openai-completions",
    provider: RELAY_PROVIDER_ID,
    baseUrl,
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128_000,
    maxTokens: 16_384,
    compat: {
      // DeepSeek-style upstreams (thinking mode) reject store/strict fields
      // and use max_tokens; thinkingFormat tells Pi-ai to speak DeepSeek's
      // reasoning_content convention, including multi-turn echoes.
      supportsStore: false,
      maxTokensField: "max_tokens",
      supportsStrictMode: false,
      thinkingFormat: "deepseek",
    },
  };
  models.setProvider(
    createProvider({
      id: RELAY_PROVIDER_ID,
      name: "Relay (custom OpenAI-compatible endpoint)",
      baseUrl,
      auth: { apiKey: envApiKeyAuth("Relay API key", ["GEWU_LLM_API_KEY", "DEEPSEEK_API_KEY"]) },
      models: [relayModel],
      api: openAICompletionsApi(),
    }),
  );
  return models;
}

export class PiGenerator {
  readonly #models: MutableModels;
  readonly #options: PiGeneratorOptions;
  readonly #relaySession = randomUUID();
  #relayRequest = 0;

  constructor(options: PiGeneratorOptions, environment: Record<string, string | undefined> = process.env) {
    this.#options = options;
    this.#models = modelCatalogFromEnvironment(environment);
  }

  /** Some gateways block the OpenAI SDK fingerprint headers; the relay uses a
   * neutral user agent and opencode-style session/request headers instead. */
  readonly #relayFetch: typeof fetch = (input, init) => {
    const headers = new Headers(init?.headers);
    for (const key of [...headers.keys()]) {
      if (key.toLowerCase().startsWith("x-stainless-")) headers.delete(key);
    }
    headers.set("user-agent", "gewu-template-authoring/relay");
    headers.set("x-opencode-session", this.#relaySession);
    this.#relayRequest += 1;
    headers.set("x-opencode-request", String(this.#relayRequest));
    let body = init?.body;
    if (this.#options.reasoningEffort && typeof body === "string" && headers.get("content-type")?.includes("application/json")) {
      try {
        const parsed = JSON.parse(body) as Record<string, unknown>;
        if (!("reasoning_effort" in parsed)) parsed.reasoning_effort = this.#options.reasoningEffort;
        body = JSON.stringify(parsed);
      } catch {
        // Leave the body untouched if it is not parseable JSON.
      }
    }
    return fetch(input, { ...init, headers, body });
  };

  async generate(task: DraftTask): Promise<DraftArtifact> {
    if (!task.taskId || !task.taskVersion || !task.selectedInputHash)
      throw new Error("task identity and selected input hash are required");
    if (task.profile) validateGenerationProfile(task.profile);

    const model = this.#models.getModel(this.#options.provider, this.#options.model);
    if (!model && this.#options.provider === RELAY_PROVIDER_ID)
      throw new Error(
        `Pi-ai relay model not found: ${this.#options.provider}/${this.#options.model} — set GEWU_LLM_PROVIDER=relay, GEWU_LLM_MODEL=<relay model id>, and GEWU_LLM_BASE_URL`,
      );
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
          toolChoice: this.#options.toolChoice === "auto" ? "auto" : { type: "function", function: { name: tool.name } },
          ...(this.#options.provider === RELAY_PROVIDER_ID ? { fetch: this.#relayFetch } : {}),
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

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function parsePositiveInteger(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function parseToolChoice(value: string | undefined): "auto" | "forced" | undefined {
  if (value === "auto") return "auto";
  if (value === "forced") return "forced";
  return undefined;
}

export function redactSecretLikeText(value: string): string {
  return value.replace(/\b(?:sk-|key-)[A-Za-z0-9_-]{8,}\b/gi, "[REDACTED]");
}
