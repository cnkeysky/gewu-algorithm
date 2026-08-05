import assert from "node:assert/strict";
import test from "node:test";
import { builtinTaskRegistry, TaskRegistry } from "./task-registry.js";

test("registry resolves a supported task without API-specific branching", () => {
  const definition = builtinTaskRegistry.resolve(undefined, "Implement Kahn topological sorting.");
  assert.equal(definition.taskId, "algorithm-unit-topological-sort-kahn");
});

test("registry rejects unsupported problems explicitly", () => {
  assert.throws(() => builtinTaskRegistry.resolve(undefined, "Implement a red-black tree."), /no registered authoring task/);
  assert.throws(() => new TaskRegistry([{
    taskId: "duplicate", label: "one", taskVersion: "1", supports: () => true,
    buildTask: () => { throw new Error("unused"); },
  }, {
    taskId: "duplicate", label: "two", taskVersion: "1", supports: () => true,
    buildTask: () => { throw new Error("unused"); },
  }]), /duplicate authoring task/);
});
