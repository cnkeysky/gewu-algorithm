import { createHash } from "node:crypto";
import { GENERIC_INSTRUCTION, OUTPUT_SCHEMA, validateGeneratedShape } from "./generate-template.js";
import type { DraftTask, GenerationProfile } from "./pi-generator.js";

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export interface AuthoringTaskDefinition {
  readonly taskId: string;
  readonly label: string;
  readonly taskVersion: string;
  readonly supports: (problem: string) => boolean;
  readonly buildTask: (problem: string, profile: GenerationProfile) => DraftTask;
  readonly validateArtifact: (value: unknown) => void;
}

function inputHash(problem: string): string {
  return `sha256:${createHash("sha256").update(problem).digest("hex")}`;
}

function codeRecallLayoutInstruction(profile: GenerationProfile): string {
  if (!profile.practice_modes.includes("code_recall")) return "";
  const requested = profile.code_recall_layouts.join(", ") || "full_recall";
  const cloze = profile.code_recall_layouts.includes("cloze")
    ? ` For each cloze projection, declare layout "cloze", nonempty slots with lowercase slug ids, and expected code that appears verbatim in code/python.py. The server derives the source_template from those slots, so never invent expected text that is not in the implementation. Select algorithm decisions, not punctuation or arbitrary syntax.`
    : "";
  const commentGuided = profile.code_recall_layouts.includes("comment_guided")
    ? ` For each comment_guided projection, use assistance "comments", declare nonempty slots with lowercase slug ids, give every slot a concise nonempty reviewed cue describing the algorithm operation without revealing its code, and ensure every slot's expected code appears verbatim in code/python.py.`
    : "";
  const commentToCode = profile.code_recall_layouts.includes("comment_to_code")
    ? ` For each comment_to_code projection, use assistance "comments", omit source_template and slots, and provide an ordered scaffold of reviewed algorithm-operation comments from which the learner reconstructs the complete canonical implementation.`
    : "";
  return `\n\nRequested Code Recall layouts: ${requested}.${cloze}${commentGuided}${commentToCode} The manifest id must be a dotted lowercase identifier with at least one dot, such as graph.course-schedule; never use a bare hyphenated id. Use exactly code/python.py as the implementation source and tests/python_test.py as its test_references path, and return both files in sources.`;
}

const genericDefinition: AuthoringTaskDefinition = {
  taskId: "algorithm-unit-v2",
  label: "AlgorithmUnit · General authoring",
  taskVersion: "1",
  supports: () => true,
  buildTask: (problem, profile) => ({
    taskId: "algorithm-unit-v2",
    taskVersion: "1",
    selectedInputHash: inputHash(problem),
    instruction: `${GENERIC_INSTRUCTION}${codeRecallLayoutInstruction(profile)}\n\nAlgorithm problem:\n${problem}`,
    outputSchema: OUTPUT_SCHEMA,
    profile,
    validate: validateGeneratedShape,
  }),
  validateArtifact: (value) => {
    if (!isRecord(value) || !isRecord(value.manifest) || !isRecord(value.sources)) throw new Error("AlgorithmUnit artifact must contain manifest and sources");
    if (value.manifest.schema_version !== "2" || value.manifest.status !== "draft") throw new Error("AlgorithmUnit lifecycle is invalid");
    if (!isRecord(value.manifest.problem) || typeof value.manifest.problem.statement !== "string" || value.manifest.problem.statement.trim().length < 20) throw new Error("AlgorithmUnit problem statement is missing");
    if (typeof value.manifest.id !== "string" || !Array.isArray(value.manifest.implementations) || value.manifest.implementations.length === 0) throw new Error("AlgorithmUnit identity or implementation is missing");
  },
};

export class TaskRegistry {
  readonly #definitions: Map<string, AuthoringTaskDefinition>;

  constructor(definitions: readonly AuthoringTaskDefinition[]) {
    this.#definitions = new Map();
    for (const definition of definitions) {
      if (this.#definitions.has(definition.taskId)) throw new Error(`duplicate authoring task: ${definition.taskId}`);
      this.#definitions.set(definition.taskId, definition);
    }
  }

  list(): AuthoringTaskDefinition[] { return [...this.#definitions.values()]; }

  resolve(taskId: string | undefined, problem: string): AuthoringTaskDefinition {
    if (taskId) {
      const definition = this.#definitions.get(taskId);
      if (!definition) throw new Error(`unknown authoring task: ${taskId}`);
      if (!definition.supports(problem)) throw new Error(`problem does not satisfy the ${taskId} task contract`);
      return definition;
    }
    const definition = this.list().find((candidate) => candidate.supports(problem));
    if (!definition) throw new Error("no registered authoring task supports this problem");
    return definition;
  }
}

export const builtinTaskRegistry = new TaskRegistry([genericDefinition]);
