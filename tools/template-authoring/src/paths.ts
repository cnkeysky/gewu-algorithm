/**
 * Single source of truth for the repository layout. Compiled modules live in
 * `dist/`, so the repo root is derived from this module's URL; scripts that
 * are not compiled use `scripts/gewu-paths.mjs` (same values). Never scatter
 * literal `../..` depths across the codebase.
 */
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url)); // dist/ at runtime

export const repoRoot = resolve(here, "../../..");
export const toolsRoot = join(repoRoot, "tools", "template-authoring");
export const draftsRoot = join(toolsRoot, "drafts");
export const storageRoot = join(toolsRoot, "drafts", ".workbench");
export const rulesRoot = join(toolsRoot, "rules");
export const dbPath = join(storageRoot, "authoring.sqlite");
export const ledgerPath = join(repoRoot, "units", "index.json");
export const devPidsDir = join(repoRoot, ".gewu-dev", "pids");
