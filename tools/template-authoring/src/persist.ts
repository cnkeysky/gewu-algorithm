import type { DatabaseSync } from "node:sqlite";

/**
 * Shared per-row upserts so a state save only touches its own rows:
 * concurrent requests (or a stale process) can never clobber another row's
 * accepted status or resurrect unrelated rows (the DELETE-all + re-insert
 * race fix).
 */

export interface PersistedDraft {
  id: string;
  taskId?: string;
  slug?: string;
  title: string;
  problem: string;
  provider: string;
  model: string;
  language: string;
  variants: number;
  modes: string[];
  assistance: string[];
  status: string;
  createdAt: string;
  unitId?: string;
  artifactPath?: string;
  publishedPath?: string;
  error?: string;
  /** Consecutive failed generate/validate attempts (circuit-breaker count).
   * Reset to 0 on success or an explicit human retry. */
  failureCount: number;
}

export interface PersistedReview {
  id: string;
  draftId: string;
  role: string;
  verdict: string;
  artifactHash: string | null;
  reportPath?: string;
  rationale?: string;
  createdAt: string;
}

/** A lease on one LLM-backed operation (generate / acceptance / review
 * role). The primary key is (draft_id, operation, role), so acquiring is an
 * atomic compare-and-set across processes: only one worker can hold the same
 * claim at a time, and a crashed worker's claim is reclaimed after expiry. */
export interface DraftClaim {
  draftId: string;
  operation: string;
  role?: string;
  leaseMs?: number;
}

const DEFAULT_CLAIM_LEASE_MS = 150 * 60_000;

export function tryAcquireClaim(database: DatabaseSync, claim: DraftClaim, now = Date.now()): boolean {
  const role = claim.role ?? "";
  const leaseMs = claim.leaseMs ?? Number(process.env.GEWU_CLAIM_LEASE_MS ?? DEFAULT_CLAIM_LEASE_MS);
  const nowIso = new Date(now).toISOString();
  // Reap an expired lease for this exact key first (crashed worker), then
  // insert — the UNIQUE primary key is the CAS that refuses a second holder.
  database.prepare("DELETE FROM claims WHERE draft_id = ? AND operation = ? AND role = ? AND expires_at <= ?")
    .run(claim.draftId, claim.operation, role, nowIso);
  try {
    database.prepare("INSERT INTO claims (draft_id, operation, role, claimed_at, expires_at) VALUES (?, ?, ?, ?, ?)")
      .run(claim.draftId, claim.operation, role, nowIso, new Date(now + leaseMs).toISOString());
    return true;
  } catch {
    return false;
  }
}

export function releaseClaim(database: DatabaseSync, draftId: string, operation: string, role = ""): void {
  database.prepare("DELETE FROM claims WHERE draft_id = ? AND operation = ? AND role = ?").run(draftId, operation, role);
}

export function upsertDraft(database: DatabaseSync, draft: PersistedDraft): void {
  database.prepare(`INSERT INTO drafts (id, task_id, slug, title, problem, provider, model, language, variants, modes_json, assistance_json, status, created_at, unit_id, artifact_path, published_path, error, failure_count) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET task_id=excluded.task_id, slug=excluded.slug, title=excluded.title, problem=excluded.problem, provider=excluded.provider, model=excluded.model, language=excluded.language, variants=excluded.variants, modes_json=excluded.modes_json, assistance_json=excluded.assistance_json, status=excluded.status, created_at=excluded.created_at, unit_id=excluded.unit_id, artifact_path=excluded.artifact_path, published_path=excluded.published_path, error=excluded.error, failure_count=excluded.failure_count`)
    .run(
      draft.id,
      draft.taskId ?? null,
      draft.slug ?? null,
      draft.title,
      draft.problem,
      draft.provider,
      draft.model,
      draft.language,
      draft.variants,
      JSON.stringify(draft.modes),
      JSON.stringify(draft.assistance),
      draft.status,
      draft.createdAt,
      draft.unitId ?? null,
      draft.artifactPath ?? null,
      draft.publishedPath ?? null,
      draft.error ?? null,
      draft.failureCount ?? 0,
    );
}

/**
 * Compare-and-set draft update: applies only when the row's current status
 * matches `expectedStatus`, returning whether the update was applied. This is
 * the optimistic-concurrency primitive for the reuse/reset transition: two
 * concurrent writers can never both pass, regardless of which process or
 * stale snapshot they came from.
 */
export function casUpsertDraft(database: DatabaseSync, draft: PersistedDraft, expectedStatus: string): boolean {
  const result = database.prepare(`UPDATE drafts SET task_id=?, slug=?, title=?, problem=?, provider=?, model=?, language=?, variants=?, modes_json=?, assistance_json=?, status=?, created_at=?, unit_id=?, artifact_path=?, published_path=?, error=?, failure_count=? WHERE id=? AND status=?`)
    .run(
      draft.taskId ?? null,
      draft.slug ?? null,
      draft.title,
      draft.problem,
      draft.provider,
      draft.model,
      draft.language,
      draft.variants,
      JSON.stringify(draft.modes),
      JSON.stringify(draft.assistance),
      draft.status,
      draft.createdAt,
      draft.unitId ?? null,
      draft.artifactPath ?? null,
      draft.publishedPath ?? null,
      draft.error ?? null,
      draft.failureCount ?? 0,
      draft.id,
      expectedStatus,
    );
  return result.changes === 1;
}

export function upsertReview(database: DatabaseSync, review: PersistedReview): void {
  database.prepare(`INSERT INTO reviews (id, draft_id, role, verdict, artifact_hash, report_path, rationale, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET draft_id=excluded.draft_id, role=excluded.role, verdict=excluded.verdict, artifact_hash=excluded.artifact_hash, report_path=excluded.report_path, rationale=excluded.rationale, created_at=excluded.created_at`)
    .run(review.id, review.draftId, review.role, review.verdict, review.artifactHash, review.reportPath ?? null, review.rationale ?? null, review.createdAt);
}
