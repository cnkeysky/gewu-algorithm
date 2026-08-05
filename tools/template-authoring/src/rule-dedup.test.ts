import assert from "node:assert/strict";
import test from "node:test";
import { deduplicateRule } from "./rule-dedup.js";

const existing = [{ id: "ALG-COMPLEXITY-001", description: "Declared time and space bounds match the implementation and assumptions." }];

test("rule deduplication catches reordered wording", () => {
  const decision = deduplicateRule({ id: "NEW", description: "The implementation and assumptions match declared space and time bounds." }, existing);
  assert.equal(decision.action, "duplicate");
  assert.equal(decision.duplicateOf, "ALG-COMPLEXITY-001");
});

test("rule deduplication leaves independent rules for review", () => {
  const decision = deduplicateRule({ id: "NEW", description: "Every transfer case states the changed input boundary." }, existing);
  assert.equal(decision.action, "needs_review");
});
