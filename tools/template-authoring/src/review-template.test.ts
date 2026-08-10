import assert from "node:assert/strict";
import test from "node:test";
import { acceptanceArtifactHash, acceptanceContextReviews, buildAcceptanceTask, shouldRecheckAcceptance } from "./review-template.js";

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

test("acceptance gate never reads its own previous verdicts", () => {
  const reviews = [
    { draftId: "a", role: "algorithm_correctness" },
    { draftId: "a", role: "learning_design" },
    { draftId: "a", role: "llm_acceptance" },
    { draftId: "b", role: "llm_acceptance" },
    { draftId: "b", role: "provenance_safety" },
  ];
  const context = acceptanceContextReviews(reviews, "a");
  assert.deepEqual(context.map((review) => review.role), ["algorithm_correctness", "learning_design"]);
});

test("a single unconfirmed gate rejection gets one fresh re-read", () => {
  const reviews = [
    { draftId: "a", role: "algorithm_correctness", artifactHash: "h1" },
  ];
  // Deterministic validation passed and no prior gate verdict for this hash.
  assert.equal(shouldRecheckAcceptance(true, reviews, "a", "h1"), true);
  // Not deterministically validated -> no re-read.
  assert.equal(shouldRecheckAcceptance(false, reviews, "a", "h1"), false);
  // The gate already judged this artifact hash -> no re-read (respect it).
  assert.equal(
    shouldRecheckAcceptance(true, [...reviews, { draftId: "a", role: "llm_acceptance", artifactHash: "h1" }], "a", "h1"),
    false,
  );
  // A different artifact hash (repaired artifact) is a fresh judgment.
  assert.equal(
    shouldRecheckAcceptance(true, [...reviews, { draftId: "a", role: "llm_acceptance", artifactHash: "h1" }], "a", "h2"),
    true,
  );
});

test("acceptance artifact hash falls back to a deterministic path hash when unreviewed", () => {
  // Pre-review hash wins when present.
  const reviews = [{ draftId: "a", role: "algorithm_correctness", artifactHash: "h1" }];
  assert.equal(acceptanceArtifactHash(reviews, "a", "/tmp/artifact-a"), "h1");
  // Batch drafts reach the gate without pre-reviews: the path hash is stable
  // per artifact, so the gate still records and de-duplicates its judgments.
  const pathHash = acceptanceArtifactHash([], "a", "/tmp/artifact-a");
  assert.match(pathHash ?? "", /^[0-9a-f]{64}$/);
  assert.equal(acceptanceArtifactHash([], "a", "/tmp/artifact-a"), pathHash);
  assert.equal(acceptanceArtifactHash([], "a", "/tmp/artifact-b") === pathHash, false);
  // No reviews and no path -> no identity (recheck stays disabled).
  assert.equal(acceptanceArtifactHash([], "a"), null);
});
