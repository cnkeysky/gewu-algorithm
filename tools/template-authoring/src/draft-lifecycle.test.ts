import assert from "node:assert/strict";
import test from "node:test";
import { draftReuseGuard } from "./draft-lifecycle.js";

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
