import assert from "node:assert/strict";
import test from "node:test";
import { buildReviewSummary, normalizeSupersedes, qualifyUnitId } from "./publish.js";

test("a first revision can never supersede itself", () => {
  const supersedes = normalizeSupersedes([{ revision: 1, reason: "fix" }], 1);
  assert.equal(supersedes, undefined);
});

test("supersedes keeps only strictly earlier revisions", () => {
  const supersedes = normalizeSupersedes(
    [
      { revision: 1, reason: "kept" },
      { revision: 2, reason: "dropped (self)" },
      { revision: 3, reason: "dropped (future)" },
    ],
    2,
  ) as Array<{ revision: number }>;
  assert.deepEqual(supersedes.map((entry) => entry.revision), [1]);
});

test("invalid supersedes entries are dropped", () => {
  const supersedes = normalizeSupersedes(
    [
      { revision: 0, reason: "dropped (non-positive)" },
      { reason: "dropped (missing revision)" },
      { revision: 1.5, reason: "dropped (non-integer)" },
    ],
    2,
  );
  assert.equal(supersedes, undefined);
});

test("non-array supersedes passes through untouched", () => {
  assert.equal(normalizeSupersedes(undefined, 1), undefined);
  assert.equal(normalizeSupersedes("nope", 1), "nope");
});

test("qualifyUnitId appends the language segment exactly once", () => {
  assert.equal(qualifyUnitId("array.two-sum", "python"), "array.two-sum.python");
  assert.equal(qualifyUnitId("array.two-sum.python", "python"), "array.two-sum.python");
  assert.equal(qualifyUnitId("two-sum", "java"), "two-sum.java");
});

test("qualifyUnitId falls back for invalid base or language", () => {
  assert.equal(qualifyUnitId(undefined, "python"), "unit.python");
  assert.equal(qualifyUnitId("NOT A SLUG", "python"), "unit.python");
  assert.equal(qualifyUnitId("array.two-sum", "Py Thon"), "array.two-sum.python");
});

test("buildReviewSummary picks the final acceptance and the revision history", () => {
  const reviews = [
    { role: "algorithm_correctness", verdict: "needs_revision", rationale: "wrong bound", at: "t1" },
    { role: "llm_acceptance", verdict: "needs_revision", rationale: "placeholder source", at: "t2" },
    { role: "llm_acceptance", verdict: "pass", rationale: "fixed and complete", at: "t3" },
  ];
  const summary = buildReviewSummary(reviews);
  assert.deepEqual(summary.acceptance, { role: "llm_acceptance", verdict: "pass", rationale: "fixed and complete", at: "t3" });
  assert.equal(summary.history.length, 2);
  assert.deepEqual(summary.history[0], { role: "algorithm_correctness", verdict: "needs_revision", rationale: "wrong bound", at: "t1" });
  assert.deepEqual(summary.history[1], { role: "llm_acceptance", verdict: "needs_revision", rationale: "placeholder source", at: "t2" });
});

test("buildReviewSummary tolerates reviews without an acceptance yet", () => {
  const summary = buildReviewSummary([{ role: "algorithm_correctness", verdict: "needs_revision", rationale: "x" }]);
  assert.equal(summary.acceptance, undefined);
  assert.equal(summary.history.length, 1);
});
