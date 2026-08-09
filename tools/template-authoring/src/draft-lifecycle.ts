/** Draft statuses in the authoring workflow (mirrors workbench-api). */
export type DraftStatus =
  | "draft"
  | "queued"
  | "generated"
  | "validated"
  | "llm_reviewed"
  | "needs_revision"
  | "revision_requested"
  | "accepted"
  | "failed";

/** State-machine events: every status change goes through the transition
 * table below, so the allowed-move knowledge lives in one place instead of
 * ad-hoc status lists scattered across endpoints. */
export type DraftEvent =
  | "reuse"       // PATCH: reset a non-accepted draft to queued for retry
  | "generate"    // run the LLM generation
  | "validate"    // deterministic Rust contract validation
  | "pre_review"  // LLM pre-review roles (content gate)
  | "acceptance"  // decisive LLM acceptance gate
  | "accept"      // record an acceptance and publish
  | "rollback"    // regenerate with feedback
  | "fork"        // create a new revision draft from an accepted unit
  | "delete";     // remove a non-accepted draft

/** Allowed source statuses per event (single source of truth). */
export const DRAFT_TRANSITIONS: Record<DraftEvent, readonly DraftStatus[]> = {
  reuse: ["draft", "queued", "generated", "validated", "llm_reviewed", "needs_revision", "revision_requested", "failed"],
  generate: ["queued", "revision_requested", "failed"],
  validate: ["generated"],
  pre_review: ["validated", "needs_revision"],
  acceptance: ["validated", "llm_reviewed", "needs_revision"],
  accept: ["validated", "llm_reviewed", "needs_revision"],
  rollback: ["generated", "llm_reviewed", "needs_revision", "failed"],
  fork: ["accepted"],
  delete: ["draft", "queued", "generated", "validated", "llm_reviewed", "needs_revision", "revision_requested", "failed"],
};

/** Returns an error message when the transition is not allowed. */
export function assertDraftTransition(status: string, event: DraftEvent): string | undefined {
  const allowed = DRAFT_TRANSITIONS[event];
  if (allowed.includes(status as DraftStatus)) return undefined;
  return `draft status ${status} does not allow ${event} (allowed from: ${allowed.join(", ")})`;
}

/**
 * Guard for the reuse/reset transition (PATCH /api/drafts/:id -> queued).
 *
 * `accepted` is terminal: reusing a unit must go through `/fork`, never by
 * resetting the accepted draft itself. When the caller states the status it
 * observed (`expectedStatus`), a mismatch means a stale or concurrent client
 * (e.g. an older batch process with an out-of-date index) — refuse instead of
 * clobbering newer state, which previously could turn an accepted/published
 * draft back into a queued one and drop its artifact and reviews.
 */
export function draftReuseGuard(draft: { id: string; status: string }, expectedStatus?: string): string | undefined {
  if (draft.status === "accepted") {
    return "an accepted draft is published and terminal; POST /api/drafts/{id}/fork to create a revision";
  }
  const transitionError = assertDraftTransition(draft.status, "reuse");
  if (transitionError) return transitionError;
  if (expectedStatus !== undefined && draft.status !== expectedStatus) {
    return `draft state changed since it was loaded (expected ${expectedStatus}, found ${draft.status}); reload and retry`;
  }
  return undefined;
}
