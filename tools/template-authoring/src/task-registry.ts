import { createHash } from "node:crypto";
import { task as kahnTask } from "./generate-template.js";
import type { DraftTask, GenerationProfile } from "./pi-generator.js";

export interface AuthoringTaskDefinition {
  readonly taskId: string;
  readonly label: string;
  readonly taskVersion: string;
  readonly supports: (problem: string) => boolean;
  readonly buildTask: (problem: string, profile: GenerationProfile) => DraftTask;
}

function inputHash(problem: string): string {
  return `sha256:${createHash("sha256").update(problem).digest("hex")}`;
}

const kahnDefinition: AuthoringTaskDefinition = {
  taskId: kahnTask.taskId,
  label: "AlgorithmUnit · Kahn topological sort",
  taskVersion: kahnTask.taskVersion,
  supports: (problem) => /kahn/i.test(problem) && /topological/i.test(problem),
  buildTask: (problem, profile) => ({
    ...kahnTask,
    selectedInputHash: inputHash(problem),
    instruction: `${kahnTask.instruction}\n\nAuthor problem supplied by the workbench:\n${problem}`,
    profile,
  }),
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

export const builtinTaskRegistry = new TaskRegistry([kahnDefinition]);
