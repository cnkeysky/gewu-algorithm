import assert from "node:assert/strict";
import test from "node:test";
import { buildAcceptanceTask } from "./review-template.js";

test("acceptance task embeds the problem and every pre-review finding", () => {
  const task = buildAcceptanceTask(
    "Detect a cycle in a directed graph.",
    JSON.stringify({ id: "graph.cycle", practice: {} }),
    [
      { role: "algorithm_correctness", verdict: "pass", report: { findings: [{ rule_id: "CORRECT-001", severity: "minor", path: "code/python.py", problem: "Missing type hints", evidence: "def solve()", suggested_change: "Add type hints" }] } },
      { role: "learning_design", verdict: "needs_revision", report: { findings: [{ rule_id: "LEARN-002", severity: "major", path: "unit.json", problem: "No trade-off prompt", evidence: "reasoning_recall empty", suggested_change: "Add trade_off item" }] } },
    ],
    [{ path: "code/python.py", content: "def solve(): ..." }, { path: "tests/python_test.py", content: "import solve" }],
  );
  assert.match(task.instruction, /Detect a cycle in a directed graph/);
  assert.match(task.instruction, /graph\.cycle/);
  assert.match(task.instruction, /\[algorithm_correctness\] minor CORRECT-001/);
  assert.match(task.instruction, /\[learning_design\] major LEARN-002/);
  assert.match(task.instruction, /publication gate/);
  assert.match(task.instruction, /--- code\/python\.py ---/);
  assert.match(task.instruction, /def solve\(\)/);
  assert.match(task.instruction, /validation\.content_review\/transfer_review fields are stamped after this gate passes/);
  assert.equal(task.taskId, "algorithm-unit-acceptance");
  assert.equal(task.taskVersion, "acceptance-v1");
});

test("acceptance task tolerates drafts without findings", () => {
  const task = buildAcceptanceTask("Problem text", "{}", [{ role: "algorithm_correctness", verdict: "pass", report: { findings: [] } }]);
  assert.match(task.instruction, /No findings/);
});
