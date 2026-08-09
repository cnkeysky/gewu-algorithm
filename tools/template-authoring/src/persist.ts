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

export function upsertDraft(database: DatabaseSync, draft: PersistedDraft): void {
  database.prepare(`INSERT INTO drafts (id, task_id, slug, title, problem, provider, model, language, variants, modes_json, assistance_json, status, created_at, unit_id, artifact_path, published_path, error) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET task_id=excluded.task_id, slug=excluded.slug, title=excluded.title, problem=excluded.problem, provider=excluded.provider, model=excluded.model, language=excluded.language, variants=excluded.variants, modes_json=excluded.modes_json, assistance_json=excluded.assistance_json, status=excluded.status, created_at=excluded.created_at, unit_id=excluded.unit_id, artifact_path=excluded.artifact_path, published_path=excluded.published_path, error=excluded.error`)
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
    );
}

export function upsertReview(database: DatabaseSync, review: PersistedReview): void {
  database.prepare(`INSERT INTO reviews (id, draft_id, role, verdict, artifact_hash, report_path, rationale, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET draft_id=excluded.draft_id, role=excluded.role, verdict=excluded.verdict, artifact_hash=excluded.artifact_hash, report_path=excluded.report_path, rationale=excluded.rationale, created_at=excluded.created_at`)
    .run(review.id, review.draftId, review.role, review.verdict, review.artifactHash, review.reportPath ?? null, review.rationale ?? null, review.createdAt);
}
