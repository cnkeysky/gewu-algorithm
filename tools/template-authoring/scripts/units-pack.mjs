#!/usr/bin/env node
// Packages the published units (content root) into a release artifact and
// regenerates the committed ledger units/index.json.
//
// Flow: publish locally (content lands in the content root, gitignored) ->
// run `npm run units:pack` (writes units/index.json + a tar.gz) -> commit
// units/index.json -> `gh release upload <tag> <tarball>`.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../..");
const contentRoot = process.env.GEWU_PUBLISHED_ROOT
  ? resolve(repoRoot, process.env.GEWU_PUBLISHED_ROOT)
  : join(repoRoot, "tools", "template-authoring", "drafts", ".workbench", "published");
const indexPath = join(repoRoot, "units", "index.json");
const version = process.env.GEWU_UNITS_VERSION ?? "latest";
const tarball = join(repoRoot, "tools", "template-authoring", `gewu-units-${version}.tar.gz`);
const dbPath = join(repoRoot, "tools", "template-authoring", "drafts", ".workbench", "authoring.sqlite");

function reviewSummary(reviews) {
  const acceptance = [...reviews].reverse().find((r) => (r.role === "llm_acceptance" || r.role === "human_acceptance") && r.verdict === "pass");
  const history = reviews.filter((r) => r.verdict === "needs_revision" || r.verdict === "reject");
  return { acceptance, history };
}

/** Backfills the review record for units published before the pack carried
 * reviews: copies the artifact's reports and writes reviews/summary.json from
 * the local store. Idempotent (skips units that already have a summary). */
function backfillReviews(unitDir, unitId) {
  const revision = latestRevisionDir(unitDir);
  const unitReviews = join(unitDir, revision, "reviews");
  if (existsSync(join(unitReviews, "summary.json")) && existsSync(join(unitDir, revision, "published.json"))) return;
  if (!existsSync(dbPath)) return;
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const draft = db.prepare("SELECT id, artifact_path FROM drafts WHERE unit_id = ? AND status = 'accepted' ORDER BY created_at DESC LIMIT 1").get(unitId);
    if (!draft?.artifact_path) return;
    // Backfill the true publish timestamp (the store's accept time) so the
    // ledger and frontend show the real date even for pre-fix units.
    if (!existsSync(join(unitDir, revision, "published.json"))) {
      const created = db.prepare("SELECT created_at FROM drafts WHERE id = ?").get(draft.id)?.created_at;
      if (typeof created === "string") {
        writeFileSync(join(unitDir, revision, "published.json"), `${JSON.stringify({ publishedAt: created, revision: Number(revision.slice(1)) }, null, 2)}\n`);
      }
    }
    const artifactReviews = join(repoRoot, String(draft.artifact_path), "reviews");
    if (existsSync(artifactReviews)) {
      mkdirSync(unitReviews, { recursive: true });
      for (const file of readdirSync(artifactReviews)) {
        if (!existsSync(join(unitReviews, file))) {
          copyFileSync(join(artifactReviews, file), join(unitReviews, file));
        }
      }
    }
    const reviews = db.prepare("SELECT role, verdict, rationale, created_at AS at FROM reviews WHERE draft_id = ? ORDER BY created_at").all(draft.id);
    writeFileSync(join(unitReviews, "summary.json"), `${JSON.stringify(reviewSummary(reviews), null, 2)}\n`);
  } finally {
    db.close();
  }
}

function latestRevisionDir(unitDir) {
  let latest = "";
  let latestN = 0;
  for (const entry of readdirSync(unitDir, { withFileTypes: true })) {
    const match = /^r(\d+)$/.exec(entry.name);
    if (entry.isDirectory() && match && Number(match[1]) > latestN) {
      latestN = Number(match[1]);
      latest = entry.name;
    }
  }
  return latest;
}

function unitUpdatedAt(unitDir, revision) {
  try {
    const published = JSON.parse(readFileSync(join(unitDir, revision, "published.json"), "utf8"));
    if (typeof published.publishedAt === "string" && published.publishedAt) return published.publishedAt;
  } catch {
    // Fall back below.
  }
  return statSync(unitDir).mtime.toISOString();
}

if (!existsSync(contentRoot)) {
  console.error(`no published content at ${contentRoot}; publish units or run npm run units:fetch first`);
  process.exit(1);
}

const units = [];
for (const entry of readdirSync(contentRoot, { withFileTypes: true })) {
  if (!entry.isDirectory() || entry.name === "index.json") continue;
  const unitDir = join(contentRoot, entry.name);
  const revision = latestRevisionDir(unitDir);
  if (!revision) continue;
  backfillReviews(unitDir, entry.name);
  const unitPath = join(unitDir, revision, "unit.json");
  if (!existsSync(unitPath)) continue;
  const manifest = JSON.parse(readFileSync(unitPath, "utf8"));
  const practice = manifest.practice ?? {};
  const sha256 = createHash("sha256").update(readFileSync(unitPath)).digest("hex").slice(0, 16);
  units.push({
    id: typeof manifest.id === "string" ? manifest.id : entry.name,
    title: typeof manifest.title === "string" ? manifest.title : entry.name,
    language: typeof manifest.language === "string" && manifest.language ? manifest.language : "python",
    revision: Number(revision.slice(1)),
    modes: Object.keys(practice),
    updatedAt: unitUpdatedAt(unitDir, revision),
    sha256,
  });
}
units.sort((a, b) => a.id.localeCompare(b.id));

mkdirSync(dirname(indexPath), { recursive: true });
// Deterministic ledger (no volatile generatedAt): only the per-unit checksum
// metadata, so committing it only changes when a unit actually changes.
writeFileSync(indexPath, `${JSON.stringify({ units }, null, 2)}\n`);
console.log(`ledger written to ${resolve(repoRoot, "units/index.json")} (${units.length} units)`);

// tar the content root (excluding the ledger and the generated pack manifest)
mkdirSync(dirname(tarball), { recursive: true });
const args = ["-czf", tarball, "-C", contentRoot, "--exclude", "index.json", "--exclude", "pack.json", "."];
execFileSync("tar", args, { stdio: "inherit" });
console.log(`artifact written to ${tarball}`);
console.log(`next: git add units/index.json && git commit; gh release upload <tag> ${tarball}`);
