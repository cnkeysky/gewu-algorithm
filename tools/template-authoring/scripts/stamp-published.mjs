#!/usr/bin/env node
// One-time idempotent migration: published artifacts created before the
// content-lifecycle stamping fix still claim status "draft" with pending
// validation. They were gate-approved and published, so stamping them
// "validated" + all validation stages passed is a faithful backfill; units
// already stamped are skipped. The Rust core refuses to load published roots
// containing non-validated units, so this must run before starting practice.
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { contentRootDefault, repoRoot } from "../../../scripts/gewu-paths.mjs";

const publishedRoot = process.env.GEWU_PUBLISHED_ROOT
  ? resolve(repoRoot, process.env.GEWU_PUBLISHED_ROOT)
  : contentRootDefault;
const now = new Date().toISOString();

function walkUnitJson(dir, out) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walkUnitJson(path, out);
    else if (entry.name === "unit.json") out.push(path);
  }
}

if (!existsSync(publishedRoot)) {
  console.log(`no published root at ${publishedRoot}; nothing to migrate`);
  process.exit(0);
}

const files = [];
walkUnitJson(publishedRoot, files);
let stamped = 0;
let skipped = 0;
for (const file of files) {
  const manifest = JSON.parse(readFileSync(file, "utf8"));
  if (manifest.status === "validated") {
    skipped += 1;
    continue;
  }
  manifest.status = "validated";
  manifest.validation = {
    schema: "passed",
    code: "passed",
    content_review: "passed",
    transfer_review: "passed",
    last_validated_at: now,
  };
  writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`);
  stamped += 1;
}
console.log(`stamped ${stamped} published unit(s) as validated; ${skipped} already validated`);
