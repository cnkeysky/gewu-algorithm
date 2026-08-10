#!/usr/bin/env node
// Reconciles draft rows with the published unit root. A draft whose unit was
// accepted and published, but whose row was later clobbered back to a
// non-accepted status (stale-writer divergence), is restored to `accepted`
// with its published path. Only `failed` drafts whose slug+language match a
// published unit are touched (batch drafts derive their slug and unit id from
// the catalog identity, so this is the stable join key); the dry-run lists
// every candidate for review so an unrelated variant sharing a slug is
// spotted before writing. Idempotent; pass --dry-run to preview.
import { DatabaseSync } from "node:sqlite";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const toolsRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(toolsRoot, "../..");
const publishedRoot = join(toolsRoot, "drafts", ".workbench", "published");
const dbPath = join(toolsRoot, "drafts", ".workbench", "authoring.sqlite");
const dryRun = process.argv.includes("--dry-run");

if (!existsSync(publishedRoot) || !existsSync(dbPath)) {
  console.error("published root or authoring store not found; nothing to reconcile");
  process.exit(1);
}

/** slug.language -> { revisionDir, title } of the latest published revision. */
const units = new Map();
for (const name of readdirSync(publishedRoot)) {
  const dir = join(publishedRoot, name);
  if (!statSync(dir).isDirectory()) continue;
  const revisions = readdirSync(dir)
    .filter((entry) => /^r\d+$/.test(entry))
    .sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));
  if (revisions.length === 0) continue;
  const revisionDir = join(dir, revisions[revisions.length - 1]);
  units.set(name, { revisionDir });
}

const db = new DatabaseSync(dbPath);
// Idempotent schema backfill: the authoring API adds this column on startup;
// running the reconcile before the first new-API start must not fail on it.
try {
  db.exec("ALTER TABLE drafts ADD COLUMN failure_count INTEGER NOT NULL DEFAULT 0");
} catch {
  // Column already exists.
}
const rows = db.prepare("SELECT id, slug, title, language, status, unit_id FROM drafts WHERE status = 'failed'").all();
const candidates = [];
for (const row of rows) {
  if (typeof row.slug !== "string" || !row.slug) continue;
  const key = `${row.slug}.${row.language}`;
  const unit = units.get(key);
  if (!unit) continue;
  const publishedPath = relative(repoRoot, unit.revisionDir);
  candidates.push({ id: row.id, title: row.title, key, publishedPath, unitId: row.unit_id ?? key });
}

if (dryRun) {
  console.log(`[dry-run] would restore ${candidates.length} failed draft(s) to accepted:`);
  for (const candidate of candidates) console.log(`  - ${candidate.title} -> ${candidate.key} (${candidate.publishedPath})`);
  process.exit(0);
}

db.exec("BEGIN");
let restored = 0;
try {
  const update = db.prepare("UPDATE drafts SET status = 'accepted', error = NULL, failure_count = 0, unit_id = ?, published_path = ? WHERE id = ? AND status = 'failed'");
  for (const candidate of candidates) {
    if (update.run(candidate.unitId, candidate.publishedPath, candidate.id).changes === 1) restored += 1;
  }
  db.exec("COMMIT");
} catch (error) {
  db.exec("ROLLBACK");
  throw error;
}
console.log(`reconciled ${restored} failed draft(s) to accepted (from ${rows.length} failed draft(s), ${units.size} published unit(s))`);
