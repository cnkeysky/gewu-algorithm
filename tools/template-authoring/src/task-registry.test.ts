import assert from "node:assert/strict";
import test from "node:test";
import { builtinTaskRegistry, TaskRegistry } from "./task-registry.js";

test("registry resolves a supported task without API-specific branching", () => {
  const definition = builtinTaskRegistry.resolve(undefined, "Implement Kahn topological sorting.");
  assert.equal(definition.taskId, "algorithm-unit-topological-sort-kahn");
});

test("registry resolves the independent binary-search contract", () => {
  const definition = builtinTaskRegistry.resolve(undefined, "Build an iterative binary search.");
  assert.equal(definition.taskId, "algorithm-unit-binary-search");
  const task = definition.buildTask("Build an iterative binary search.", {
    practice_modes: ["shadow_typing"],
    code_recall_assistance: [],
    implementation_languages: ["python"],
    implementation_variants: 1,
  });
  assert.match(task.instruction, /sorted ascending list/);
  assert.equal(task.taskVersion, "1");
});

test("registry falls back to the general contract for a new category", () => {
  assert.equal(builtinTaskRegistry.resolve(undefined, "Implement a red-black tree.").taskId, "algorithm-unit-v1");
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
