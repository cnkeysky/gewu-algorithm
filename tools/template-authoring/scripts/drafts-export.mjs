#!/usr/bin/env node
// Exports the authoring store (all drafts + reviews, dates preserved) to a
// portable JSON file — for backup, migration, or collaborative review of the
// work-in-progress review queue. Published units ship separately via the
// content pack; this covers the local authoring state.
import { writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { dbPath, repoRoot } from "../../../scripts/gewu-paths.mjs";

const outPath = process.argv[2] ? resolve(process.cwd(), process.argv[2]) : join(repoRoot, "tools", "template-authoring", "drafts-export.json");

const db = new DatabaseSync(dbPath, { readOnly: true });
const drafts = db.prepare("SELECT * FROM drafts").all();
const reviews = db.prepare("SELECT * FROM reviews").all();
db.close();

const payload = {
  schema: "gewu-drafts-v1",
  exportedAt: new Date().toISOString(),
  draftCount: drafts.length,
  reviewCount: reviews.length,
  drafts,
  reviews,
};
writeFileSync(outPath, `${JSON.stringify(payload, null, 2)}\n`);
console.log(`exported ${drafts.length} drafts and ${reviews.length} reviews to ${outPath}`);
