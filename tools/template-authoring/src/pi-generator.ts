import { type Context } from "@earendil-works/pi-ai";
import { builtinModels } from "@earendil-works/pi-ai/providers/all";

export interface DraftTask {
  readonly taskId: string;
  readonly taskVersion: string;
  readonly selectedInputHash: string;
  readonly instruction: string;
  readonly outputSchema: Record<string, unknown>;
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
}

/** Reads non-secret selection settings. Provider credentials stay in Pi-ai's env/auth layer. */
export function optionsFromEnvironment(
  environment: Record<string, string | undefined> = process.env,
): PiGeneratorOptions {
  return {
    provider: environment.GEWU_LLM_PROVIDER ?? "deepseek",
    model: environment.GEWU_LLM_MODEL ?? "deepseek-chat",
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

    const model = this.#models.getModel(this.#options.provider, this.#options.model);
    if (!model)
      throw new Error(`Pi-ai model not found: ${this.#options.provider}/${this.#options.model}`);

    const context: Context = {
      messages: [
        {
          role: "user",
          content: `${task.instruction}\n\nReturn JSON matching this schema:\n${JSON.stringify(task.outputSchema)}`,
          timestamp: Date.now(),
        },
      ],
    };
    const response = await this.#models.complete(model, context);
    const text = response.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("");
    const manifest = JSON.parse(text) as unknown;
    if (!isRecord(manifest)) throw new Error("Pi-ai returned a non-object draft");
    return {
      taskId: task.taskId,
      taskVersion: task.taskVersion,
      selectedInputHash: task.selectedInputHash,
      provider: this.#options.provider,
      model: this.#options.model,
      manifest,
      review: "pending",
    };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
