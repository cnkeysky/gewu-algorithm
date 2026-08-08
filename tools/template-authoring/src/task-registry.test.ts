import assert from "node:assert/strict";
import test from "node:test";
import { builtinTaskRegistry, TaskRegistry } from "./task-registry.js";

test("registry resolves every problem to the single generic authoring task", () => {
  const definition = builtinTaskRegistry.resolve(undefined, "Implement Kahn topological sorting.");
  assert.equal(definition.taskId, "algorithm-unit-v2");
  assert.equal(builtinTaskRegistry.resolve(undefined, "Build an iterative binary search.").taskId, "algorithm-unit-v2");
  const task = definition.buildTask("Build an iterative binary search.", {
    practice_modes: ["shadow_typing"],
    code_recall_assistance: [],
    code_recall_layouts: [],
    implementation_languages: ["python"],
    implementation_variants: 1,
  });
  assert.doesNotMatch(task.instruction, /binary_search\(|sorted ascending|Kahn|topological_order/i);
  assert.match(task.instruction, /infer .* from the (problem text|text)/i);
  assert.match(task.instruction, /Algorithm problem:/);
  assert.equal(task.taskVersion, "1");
});

test("registry rejects duplicate task ids and supports any problem", () => {
  assert.equal(builtinTaskRegistry.resolve(undefined, "Implement a red-black tree.").taskId, "algorithm-unit-v2");
  assert.throws(() => new TaskRegistry([{
    taskId: "duplicate", label: "one", taskVersion: "1", supports: () => true,
    buildTask: () => { throw new Error("unused"); },
    validateArtifact: () => undefined,
  }, {
    taskId: "duplicate", label: "two", taskVersion: "1", supports: () => true,
    buildTask: () => { throw new Error("unused"); },
    validateArtifact: () => undefined,
  }]), /duplicate authoring task/);
});

test("requested cloze generation carries the executable slot contract", () => {
  const definition = builtinTaskRegistry.resolve(undefined, "Implement Kahn topological sorting.");
  const task = definition.buildTask("Implement Kahn topological sorting.", {
    practice_modes: ["code_recall"],
    code_recall_assistance: ["cloze"],
    code_recall_layouts: ["cloze"],
    implementation_languages: ["python"],
    implementation_variants: 1,
  });
  assert.match(task.instruction, /source_template/);
  assert.match(task.instruction, /expected code that appears verbatim in code\/python\.py/);
  assert.match(task.instruction, /server derives the source_template/);
});

test("requested comment layouts carry their distinct executable contracts", () => {
  const definition = builtinTaskRegistry.resolve(undefined, "Implement a red-black tree.");
  const task = definition.buildTask("Implement a red-black tree.", {
    practice_modes: ["code_recall"],
    code_recall_assistance: ["comments"],
    code_recall_layouts: ["comment_guided", "comment_to_code"],
    implementation_languages: ["python"],
    implementation_variants: 1,
  });
  assert.match(task.instruction, /concise nonempty reviewed cue/);
  assert.match(task.instruction, /expected code appears verbatim in code\/python\.py/);
  assert.match(task.instruction, /ordered scaffold of reviewed algorithm-operation comments/);
});
