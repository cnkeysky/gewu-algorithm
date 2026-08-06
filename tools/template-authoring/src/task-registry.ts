import { createHash } from "node:crypto";
import { assertGeneratedTemplate, task as kahnTask } from "./generate-template.js";
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
    ? ` For each cloze projection, declare layout "cloze", a source_template containing each {{slot-id}} marker exactly once, and nonempty slots with lowercase slug ids and expected code. Replacing every marker must exactly reconstruct the canonical implementation. Select algorithm decisions, not punctuation or arbitrary syntax.`
    : "";
  const commentGuided = profile.code_recall_layouts.includes("comment_guided")
    ? ` For each comment_guided projection, use assistance "comments", declare a source_template and nonempty slots, give every slot a concise reviewed cue describing the algorithm operation without revealing its code, and ensure marker replacement exactly reconstructs the canonical implementation.`
    : "";
  const commentToCode = profile.code_recall_layouts.includes("comment_to_code")
    ? ` For each comment_to_code projection, use assistance "comments", omit source_template and slots, and provide an ordered scaffold of reviewed algorithm-operation comments from which the learner reconstructs the complete canonical implementation.`
    : "";
  return `\n\nRequested Code Recall layouts: ${requested}.${cloze}${commentGuided}${commentToCode}`;
}

const kahnDefinition: AuthoringTaskDefinition = {
  taskId: kahnTask.taskId,
  label: "AlgorithmUnit · Kahn topological sort",
  taskVersion: kahnTask.taskVersion,
  supports: (problem) => /kahn/i.test(problem) && /topological/i.test(problem),
  buildTask: (problem, profile) => ({
    ...kahnTask,
    selectedInputHash: inputHash(problem),
    instruction: `${kahnTask.instruction}${codeRecallLayoutInstruction(profile)}\n\nAuthor problem supplied by the workbench:\n${problem}`,
    profile,
  }),
  validateArtifact: (value) => assertGeneratedTemplate(value),
};

const BINARY_SEARCH_SCHEMA: Record<string, unknown> = {
  type: "object", additionalProperties: false, required: ["manifest", "sources"],
  properties: {
    manifest: {
      type: "object", additionalProperties: false,
      required: ["schema_version", "id", "revision", "status", "title", "tags", "position", "problem", "understanding", "implementations", "patterns", "relationships", "practice", "validation", "provenance", "supersedes"],
      properties: {
        schema_version: { const: "2" }, id: { type: "string" }, revision: { type: "integer", minimum: 1 }, status: { const: "draft" }, title: { type: "string" }, tags: { type: "array", items: { type: "string" } },
        position: { type: "object" }, problem: { type: "object", additionalProperties: false, required: ["question", "statement", "scope", "out_of_scope"], properties: { question: { type: "string" }, statement: { type: "string", minLength: 20 }, scope: { type: "array" }, out_of_scope: { type: "array" } } }, understanding: { type: "object" }, implementations: { type: "array", minItems: 1 }, patterns: { type: "array" }, relationships: { type: "array" }, practice: { type: "object" }, validation: { type: "object" }, provenance: { type: "object" }, supersedes: { type: "array" },
      },
    },
    sources: { type: "object", minProperties: 2, additionalProperties: { type: "string", minLength: 1 } },
  },
};

const BINARY_SEARCH_INSTRUCTION = `Create a GEWU AlgorithmUnit for binary search over a sorted ascending list of integers.
The implementation must expose Python function binary_search(values: list[int], target: int) -> int,
returning the index of target or -1 when absent. State the sorted-input precondition, duplicate-value
behavior, empty-list behavior, and the inclusive/exclusive interval invariant. Use an iterative midpoint
calculation that cannot overflow in fixed-width integer languages. Include shadow typing, flow recall,
code recall with an explicit requested layout, reasoning recall, and transfer practice. A cloze layout must target midpoint, interval-update, or termination decisions rather than punctuation or incidental syntax. Return only one JSON object with manifest and sources:
{"manifest": <complete AlgorithmUnit manifest>, "sources": {"code/python.py": <Python source>, "tests/python_test.py": <pytest source>}}
Use schema_version "2", status "draft", lowercase ids/tags, pending validation fields, and provenance.generated_by.
The problem.statement field is required and must be the complete learner-facing problem statement in Markdown (not a summary). Preserve formulas with $...$, $$...$$, \\(...\\), or \\[...\\] delimiters; do not use raw HTML, scripts, answer keys, or implementation details that reveal the solution.
The implementation key must be "python-teaching", source "code/python.py", and test_references must include
"tests/python_test.py". Do not include markdown or unknown fields.`;

function assertBinaryArtifact(value: unknown): asserts value is { manifest: Record<string, unknown>; sources: Record<string, unknown> } {
  if (!isRecord(value) || !isRecord(value.manifest) || !isRecord(value.sources)) throw new Error("binary-search artifact must contain manifest and sources");
  const manifest = value.manifest;
  if (manifest.schema_version !== "2" || manifest.status !== "draft" || typeof manifest.id !== "string") throw new Error("binary-search manifest lifecycle or id is invalid");
  if (!isRecord(manifest.problem) || typeof manifest.problem.statement !== "string" || manifest.problem.statement.trim().length < 20) throw new Error("binary-search problem statement is missing");
  if (!Array.isArray(manifest.implementations) || manifest.implementations.length < 1) throw new Error("binary-search implementation is missing");
  const implementation = manifest.implementations[0];
  if (!isRecord(implementation) || implementation.key !== "python-teaching" || implementation.source !== "code/python.py" || !Array.isArray(implementation.test_references) || !implementation.test_references.includes("tests/python_test.py")) throw new Error("binary-search implementation contract is invalid");
  for (const path of ["code/python.py", "tests/python_test.py"]) if (typeof value.sources[path] !== "string" || (value.sources[path] as string).trim() === "") throw new Error(`binary-search source is missing: ${path}`);
  if (!isRecord(manifest.validation) || manifest.validation.schema !== "pending" || manifest.validation.code !== "pending") throw new Error("binary-search validation must remain pending");
}

const binarySearchDefinition: AuthoringTaskDefinition = {
  taskId: "algorithm-unit-binary-search",
  label: "AlgorithmUnit · Binary search",
  taskVersion: "1",
  supports: (problem) => /binary\s+search/i.test(problem),
  buildTask: (problem, profile) => ({
    taskId: "algorithm-unit-binary-search",
    taskVersion: "1",
    selectedInputHash: inputHash(problem),
    instruction: `${BINARY_SEARCH_INSTRUCTION}${codeRecallLayoutInstruction(profile)}\n\nAuthor problem supplied by the workbench:\n${problem}`,
    outputSchema: BINARY_SEARCH_SCHEMA,
    profile,
  }),
  validateArtifact: assertBinaryArtifact,
};

const genericDefinition: AuthoringTaskDefinition = {
  taskId: "algorithm-unit-v2",
  label: "AlgorithmUnit · General authoring",
  taskVersion: "1",
  supports: () => true,
  buildTask: (problem, profile) => ({
    taskId: "algorithm-unit-v2",
    taskVersion: "1",
    selectedInputHash: inputHash(problem),
    instruction: `Create a GEWU AlgorithmUnit for the following algorithm problem. Infer its domain, category, prerequisites, implementation strategy, complexity, assumptions, tests, patterns, relationships, and all selected practice projections from the problem. The problem.statement field is required and must contain the complete learner-facing problem statement in Markdown, not a summary. Preserve formulas with $...$, $$...$$, \\(...\\), or \\[...\\] delimiters; do not use raw HTML, scripts, answer keys, or solution-leaking implementation details. Every code_recall item must declare one requested layout. full_recall reconstructs the complete canonical implementation. cloze and comment_guided use reviewed structured slots; comment_to_code presents ordered algorithm comments while the learner reconstructs the complete implementation. Keep layout separate from optional assistance. Preserve the exact contract fields and pending lifecycle claims. Return only the structured artifact requested by the schema; do not invent unknown fields.${codeRecallLayoutInstruction(profile)}\n\nAlgorithm problem:\n${problem}`,
    outputSchema: kahnTask.outputSchema,
    profile,
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

export const builtinTaskRegistry = new TaskRegistry([kahnDefinition, binarySearchDefinition, genericDefinition]);
