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
  if (expectedStatus !== undefined && draft.status !== expectedStatus) {
    return `draft state changed since it was loaded (expected ${expectedStatus}, found ${draft.status}); reload and retry`;
  }
  return undefined;
}
