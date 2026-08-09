import assert from "node:assert/strict";
import test from "node:test";
import { CONTENT_TRANSITIONS, applyContentTransition, assertPublishable } from "./manifest-lifecycle.js";

function draftManifest() {
  return {
    id: "array.two-sum.python",
    status: "draft",
    validation: { schema: "pending", code: "pending", content_review: "pending", transfer_review: "pending", last_validated_at: null },
  };
}

test("deterministic validation stamps schema/code and leaves status draft", () => {
  const stamped = applyContentTransition(draftManifest(), "deterministic_validation", "2026-08-09T00:00:00.000Z");
  const validation = stamped.validation as Record<string, string | null>;
  assert.equal(stamped.status, "draft");
  assert.equal(validation.schema, "passed");
  assert.equal(validation.code, "passed");
  assert.equal(validation.content_review, "pending");
  assert.equal(validation.last_validated_at, "2026-08-09T00:00:00.000Z");
});

test("acceptance gate pass completes content and transfer review (status reviewed)", () => {
  const stamped = applyContentTransition(draftManifest(), "acceptance_gate_pass");
  const validation = stamped.validation as Record<string, string>;
  assert.equal(stamped.status, "reviewed");
  assert.equal(validation.content_review, "passed");
  assert.equal(validation.transfer_review, "passed");
});

test("every content transition is defined; publish finalizes to validated", () => {
  assert.deepEqual(Object.keys(CONTENT_TRANSITIONS).sort(), ["acceptance_gate_pass", "deterministic_validation", "publish"]);
  const reviewed = applyContentTransition(applyContentTransition(draftManifest(), "deterministic_validation"), "acceptance_gate_pass");
  assert.equal(reviewed.status, "reviewed");
  const stamped = applyContentTransition(reviewed, "publish");
  assert.equal(stamped.status, "validated");
});

test("applyContentTransition fails hard on a non-object manifest", () => {
  assert.throws(() => applyContentTransition(null, "publish"), /must be an object/);
});

test("assertPublishable refuses unstamped or draft manifests", () => {
  assert.throws(() => assertPublishable(draftManifest()), /status is draft/);
  const onlyCode = applyContentTransition(draftManifest(), "deterministic_validation");
  assert.throws(() => assertPublishable(onlyCode), /status is draft/);
  const reviewed = applyContentTransition(applyContentTransition(draftManifest(), "deterministic_validation"), "acceptance_gate_pass");
  // Reviewed alone is not publishable; the strict chain requires validated.
  assert.throws(() => assertPublishable(reviewed), /status is reviewed/);
  const published = applyContentTransition(reviewed, "publish");
  assert.doesNotThrow(() => assertPublishable(published));
  const validatedButPendingReview = { ...published, validation: { ...(published.validation as Record<string, unknown>), content_review: "pending" } };
  assert.throws(() => assertPublishable(validatedButPendingReview), /content_review is pending/);
});
