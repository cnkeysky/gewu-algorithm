#!/usr/bin/env node
// Restores an authoring-store export (drafts-export.mjs) into the local
// sqlite store. Idempotent: rows are upserted by id, createdAt and every
// review timestamp are preserved. The running authoring API should be stopped
// first; it loads state per request, so restart it after importing.
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../..");
const dbPath = join(repoRoot, "tools", "template-authoring", "drafts", ".workbench", "authoring.sqlite");
const input = process.argv[2];
if (!input) {
  console.error("usage: node scripts/drafts-import.mjs <drafts-export.json>");
  process.exit(1);
}
const payload = JSON.parse(readFileSync(resolve(process.cwd(), input), "utf8"));
if (payload.schema !== "gewu-drafts-v1" || !Array.isArray(payload.drafts) || !Array.isArray(payload.reviews)) {
  console.error("invalid export file (expected schema gewu-drafts-v1)");
  process.exit(1);
}

const db = new DatabaseSync(dbPath);
db.exec("BEGIN");
try {
  const upsertDraft = db.prepare(`INSERT INTO drafts (id, task_id, slug, title, problem, provider, model, language, variants, modes_json, assistance_json, status, created_at, unit_id, artifact_path, published_path, error)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET task_id=excluded.task_id, slug=excluded.slug, title=excluded.title, problem=excluded.problem, provider=excluded.provider, model=excluded.model, language=excluded.language, variants=excluded.variants, modes_json=excluded.modes_json, assistance_json=excluded.assistance_json, status=excluded.status, created_at=excluded.created_at, unit_id=excluded.unit_id, artifact_path=excluded.artifact_path, published_path=excluded.published_path, error=excluded.error`);
  for (const draft of payload.drafts) {
    upsertDraft.run(
      draft.id, draft.task_id ?? null, draft.slug ?? null, draft.title, draft.problem,
      draft.provider, draft.model, draft.language, draft.variants,
      typeof draft.modes_json === "string" ? draft.modes_json : JSON.stringify(draft.modes ?? []),
      typeof draft.assistance_json === "string" ? draft.assistance_json : JSON.stringify(draft.assistance ?? []),
      draft.status, draft.created_at, draft.unit_id ?? null, draft.artifact_path ?? null,
      draft.published_path ?? null, draft.error ?? null,
    );
  }
  const upsertReview = db.prepare(`INSERT INTO reviews (id, draft_id, role, verdict, artifact_hash, report_path, rationale, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET draft_id=excluded.draft_id, role=excluded.role, verdict=excluded.verdict, artifact_hash=excluded.artifact_hash, report_path=excluded.report_path, rationale=excluded.rationale, created_at=excluded.created_at`);
  for (const review of payload.reviews) {
    if (review.role === "all") continue;
    upsertReview.run(review.id, review.draft_id, review.role, review.verdict, review.artifact_hash ?? null, review.report_path ?? null, review.rationale ?? null, review.created_at);
  }
  db.exec("COMMIT");
} catch (error) {
  db.exec("ROLLBACK");
  throw error;
} finally {
  db.close();
}
console.log(`imported ${payload.drafts.length} drafts and ${payload.reviews.length} reviews`);
