#!/usr/bin/env node
// Backfills the acceptance-gate review record into published units that were
// published without one (stale-writer clobber + prune cycles lost the audit
// trail). Re-runs the decisive LLM acceptance gate on the published artifact
// and writes reviews/llm_acceptance.json + reviews/summary.json, so the
// content pack and the web Units page carry the feedback again.
// Idempotent: units that already carry a review are skipped unless --force.
// Pass --dry-run to list what would be backfilled. Requires dist/ (npm run
// build) and the LLM configuration from .env.local.
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PiGenerator, optionsFromEnvironment } from "../dist/pi-generator.js";
import { buildAcceptanceTask } from "../dist/review-template.js";
import { buildReviewSummary } from "../dist/publish.js";

const toolsRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const publishedRoot = join(toolsRoot, "drafts", ".workbench", "published");
const dryRun = process.argv.includes("--dry-run");
const force = process.argv.includes("--force");

const targets = [];
for (const name of readdirSync(publishedRoot)) {
  const dir = join(publishedRoot, name);
  if (!statSync(dir).isDirectory()) continue;
  const revisions = readdirSync(dir)
    .filter((entry) => /^r\d+$/.test(entry))
    .sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));
  if (revisions.length === 0) continue;
  const revisionDir = join(dir, revisions[revisions.length - 1]);
  const reviewsDir = join(revisionDir, "reviews");
  const hasReviews = existsSync(reviewsDir) && readdirSync(reviewsDir).some((entry) => entry.endsWith(".json") && readFileSync(join(reviewsDir, entry), "utf8").trim().length > 0);
  if (hasReviews && !force) continue;
  targets.push({ name, revisionDir, reviewsDir });
}

if (dryRun) {
  console.log(`[dry-run] would backfill acceptance reviews for ${targets.length} published unit(s):`);
  for (const target of targets) console.log(`  - ${target.name}/${target.revisionDir.split(/[\\/]/).pop()}`);
  process.exit(0);
}
if (targets.length === 0) {
  console.log("no published units need review backfill");
  process.exit(0);
}

const generator = new PiGenerator(optionsFromEnvironment());
for (const target of targets) {
  const unitPath = join(target.revisionDir, "unit.json");
  const unitJson = readFileSync(unitPath, "utf8");
  const manifest = JSON.parse(unitJson);
  const problem = [manifest.problem?.question, manifest.problem?.statement].filter(Boolean).join("\n\n");
  const sources = [];
  for (const relativePath of ["code/python.py", "tests/python_test.py"]) {
    try {
      sources.push({ path: relativePath, content: readFileSync(join(target.revisionDir, relativePath), "utf8") });
    } catch {
      // Optional file; the gate can flag a genuinely missing source.
    }
  }
  const task = buildAcceptanceTask(problem, unitJson, [], sources);
  try {
    const artifact = await generator.generate(task);
    const verdict = artifact.manifest.verdict === "pass" ? "pass" : "needs_revision";
    const rationale = typeof artifact.manifest.rationale === "string" ? artifact.manifest.rationale : "";
    const report = {
      rubric_version: "acceptance-v1",
      role: "llm_acceptance",
      provider: artifact.provider,
      model: artifact.model,
      verdict,
      rationale,
      findings: Array.isArray(artifact.manifest.findings) ? artifact.manifest.findings : [],
    };
    mkdirSync(target.reviewsDir, { recursive: true });
    writeFileSync(join(target.reviewsDir, "llm_acceptance.json"), `${JSON.stringify(report, null, 2)}\n`);
    const summary = buildReviewSummary([{ role: "llm_acceptance", verdict, rationale, at: new Date().toISOString() }]);
    writeFileSync(join(target.reviewsDir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
    console.log(`backfilled ${target.name} (${verdict})`);
  } catch (error) {
    console.error(`failed ${target.name}: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
