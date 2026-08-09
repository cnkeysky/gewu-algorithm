import assert from "node:assert/strict";
import test from "node:test";
import { DRAFT_TRANSITIONS, assertDraftTransition, createInFlightGuard, draftReuseGuard, type DraftStatus } from "./draft-lifecycle.js";

test("accepted drafts are terminal and cannot be reset", () => {
  const error = draftReuseGuard({ id: "d1", status: "accepted" });
  assert.ok(error && /accepted.*terminal/i.test(error));
  assert.ok(draftReuseGuard({ id: "d1", status: "accepted" }, "accepted"));
});

test("expectedStatus mismatch rejects stale clients", () => {
  const error = draftReuseGuard({ id: "d1", status: "validated" }, "queued");
  assert.ok(error && /state changed/i.test(error));
});

test("matching expectedStatus allows reuse", () => {
  assert.equal(draftReuseGuard({ id: "d1", status: "failed" }, "failed"), undefined);
  assert.equal(draftReuseGuard({ id: "d1", status: "queued" }, "queued"), undefined);
});

test("without expectedStatus only accepted is rejected", () => {
  for (const status of ["draft", "queued", "generated", "validated", "llm_reviewed", "needs_revision", "revision_requested", "failed"]) {
    assert.equal(draftReuseGuard({ id: "d1", status }), undefined, status);
  }
});

test("state machine allows exactly the documented transitions", () => {
  const statuses: DraftStatus[] = ["draft", "queued", "generated", "validated", "llm_reviewed", "needs_revision", "revision_requested", "accepted", "failed"];
  for (const event of Object.keys(DRAFT_TRANSITIONS) as (keyof typeof DRAFT_TRANSITIONS)[]) {
    for (const status of statuses) {
      const allowed = DRAFT_TRANSITIONS[event].includes(status);
      if (allowed) assert.equal(assertDraftTransition(status, event), undefined, `${status} -> ${event} should be allowed`);
      else assert.ok(assertDraftTransition(status, event)?.includes("does not allow"), `${status} -> ${event} should be refused`);
    }
  }
});

test("pre_review allows all three roles to complete after one fails", () => {
  // A failing role flips to needs_revision; the remaining roles must still be
  // accepted from that state so the review report stays whole.
  assert.equal(assertDraftTransition("validated", "pre_review"), undefined);
  assert.equal(assertDraftTransition("needs_revision", "pre_review"), undefined);
});

test("in-flight guard serializes the same key but not distinct keys", () => {
  const guard = createInFlightGuard();
  assert.equal(guard.tryAcquire("d1:review:algorithm_correctness"), true);
  assert.equal(guard.tryAcquire("d1:review:algorithm_correctness"), false);
  // The three review roles run concurrently on the same draft.
  assert.equal(guard.tryAcquire("d1:review:learning_design"), true);
  assert.equal(guard.tryAcquire("d1:review:provenance_safety"), true);
  guard.release("d1:review:algorithm_correctness");
  assert.equal(guard.tryAcquire("d1:review:algorithm_correctness"), true);
});
