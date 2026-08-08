import assert from "node:assert/strict";
import test from "node:test";
import { buildStageTask, coreStageInstruction, mergeStage, validateCoreStage, validateStageArtifact } from "./staged-generation.js";
import type { GenerationProfile } from "./pi-generator.js";

const PROFILE: GenerationProfile = {
  practice_modes: ["shadow_typing", "flow_recall", "code_recall", "reasoning_recall", "transfer_practice"],
  code_recall_assistance: ["comments", "cloze"],
  code_recall_layouts: ["full_recall", "comment_guided", "comment_to_code", "cloze"],
  implementation_languages: ["python"],
  implementation_variants: 1,
};

const CONTEXT = {
  problem: "Detect a cycle in a directed graph.",
  implementations: [{ key: "python-teaching", strategy: "Three-color DFS over an adjacency list." }],
  code: "def solve():\n    return True\n",
  patterns: [{ id: "cycle-detection", summary: "Detect directed cycles with DFS." }],
};

test("core stage instruction keeps practice extras empty", () => {
  assert.match(coreStageInstruction("base", 1), /CORE stage/);
  assert.match(coreStageInstruction("base", 1), /leave practice\.code_recall/);
  assert.match(coreStageInstruction("base", 1), /exactly one implementation strategy/);
  assert.match(coreStageInstruction("base", 0), /There is no fixed variant count/);
  assert.match(coreStageInstruction("base", 0), /never produce variants that differ only cosmetically/);
  assert.match(coreStageInstruction("base", 2), /exactly 2 distinct implementation strategies/);
  assert.match(coreStageInstruction("base", 2), /bind to the canonical first-declared implementation/);
});

test("code recall stage embeds the canonical code and enforces verbatim slots", () => {
  const task = buildStageTask({ mode: "code_recall", layout: "cloze" }, PROFILE, CONTEXT);
  assert.match(task.instruction, /canonical implementation/);
  assert.match(task.instruction, /def solve\(\)/);
  const good: Record<string, any> = { practice: { code_recall: [{ id: "recall-return", implementation: "python-teaching", layout: "cloze", assistance: "cloze", prompt: "Fill the return", scaffold: ["decide the return"], slots: [{ id: "return-value", expected: "return True" }] }] } };
  validateStageArtifact({ mode: "code_recall", layout: "cloze" }, good, CONTEXT);
  assert.equal(good.practice.code_recall[0].source_template, "def solve():\n    {{return-value}}\n");
  const bad: Record<string, any> = { practice: { code_recall: [{ id: "recall-return", implementation: "python-teaching", layout: "cloze", assistance: "cloze", prompt: "Fill the return", scaffold: ["decide the return"], slots: [{ id: "return-value", expected: "return 42" }] }] } };
  assert.throws(() => validateStageArtifact({ mode: "code_recall", layout: "cloze" }, bad, CONTEXT), /does not appear verbatim/);
});

test("transfer stage requires a declared pattern", () => {
  const task = buildStageTask({ mode: "transfer_practice" }, PROFILE, CONTEXT);
  assert.match(task.instruction, /cycle-detection/);
  const good = { practice: { transfer_practice: [{ id: "undirected-cycle", pattern: "cycle-detection", new_case: "Undirected graph", prompt: "Adapt the pattern", concepts: ["dfs"], transfers: ["reuse"], differences: ["parent edge"], boundaries: ["skip parent"] }] } };
  validateStageArtifact({ mode: "transfer_practice" }, good, CONTEXT);
  const bad = { practice: { transfer_practice: [{ id: "undirected-cycle", pattern: "missing-pattern", new_case: "Undirected graph", prompt: "Adapt the pattern", concepts: ["dfs"], transfers: ["reuse"], differences: ["parent edge"], boundaries: ["skip parent"] }] } };
  assert.throws(() => validateStageArtifact({ mode: "transfer_practice" }, bad, CONTEXT), /must reference a declared pattern/);
});

test("merge stage replaces only the selected mode", () => {
  const manifest = { practice: { shadow_typing: [], flow_recall: { steps: [] }, code_recall: [], reasoning_recall: [], transfer_practice: [] } };
  mergeStage({ mode: "reasoning_recall" }, manifest, { practice: { reasoning_recall: [{ id: "invariant", aspect: "invariant", prompt: "State the invariant", concepts: ["acyclic"], aliases: [] }] } });
  mergeStage({ mode: "code_recall", layout: "cloze" }, manifest, { practice: { code_recall: [{ id: "cloze-1", implementation: "python-teaching", layout: "cloze", assistance: "cloze", prompt: "Fill", scaffold: ["guide"], slots: [{ id: "s1", expected: "x" }] }] } });
  assert.equal(manifest.practice.code_recall.length, 1);
  assert.equal(manifest.practice.reasoning_recall.length, 1);
});

test("core stage rejects extra practice projections", () => {
  const core: Record<string, any> = {
    manifest: {
      schema_version: "2", status: "draft", id: "graph.cycle", problem: { statement: "Detect a directed cycle in a graph given as an adjacency list." },
      implementations: [{ key: "python-teaching", language: "python", source: "code/python.py", purpose: "teaching", strategy: "dfs", complexity: { time: "O(V+E)", space: "O(V+E)" }, assumptions: [], test_references: ["tests/python_test.py"], normalization: { line_endings: "lf", trailing_newline: true, whitespace: "strict" } }],
      practice: { shadow_typing: [{ implementation: "python-teaching", strict: true }], flow_recall: { steps: [{ id: "start", prompt: "Begin", concepts: ["frontier"], aliases: [] }] }, code_recall: [], reasoning_recall: [], transfer_practice: [] },
    },
    sources: { "code/python.py": "def solve():\n    return True\n", "tests/python_test.py": "def test_solve():\n    assert solve()\n" },
  };
  validateCoreStage(core);
  core.manifest.practice.code_recall = [{ id: "extra", implementation: "python-teaching", layout: "full_recall", assistance: "none", prompt: "nope", scaffold: [] }];
  assert.throws(() => validateCoreStage(core), /core stage must leave practice\.code_recall/);
});
