// Single source of truth for the repository layout used by the non-compiled
// Node scripts (mirrors tools/template-authoring/src/paths.ts for compiled
// modules). Scripts must not scatter literal `../..` depths.
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const scriptsRoot = dirname(fileURLToPath(import.meta.url));
export const repoRoot = resolve(scriptsRoot, "..");
export const toolsRoot = join(repoRoot, "tools", "template-authoring");
export const draftsRoot = join(toolsRoot, "drafts");
export const storageRoot = join(draftsRoot, ".workbench");
export const dbPath = join(storageRoot, "authoring.sqlite");
export const ledgerPath = join(repoRoot, "units", "index.json");
export const contentRootDefault = join(storageRoot, "published");
