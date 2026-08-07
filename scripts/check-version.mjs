#!/usr/bin/env node
// Keeps every release-version reference in sync so a release can never ship
// with a stale "internal vX.Y.Z" README line or a missing changelog/release
// record. Run `npm run check:version` before a release; `--fix` rewrites the
// README status line to the package version.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fix = process.argv.includes("--fix");
const read = (path) => readFileSync(join(root, path), "utf8");

const rootVersion = JSON.parse(read("package.json")).version;
const editorVersion = JSON.parse(read("editors/vscode/package.json")).version;
const readme = read("README.md");
const changelog = read("CHANGELOG.md");
const releaseDoc = `docs/development/release-v${rootVersion}.md`;

const problems = [];
if (editorVersion !== rootVersion) problems.push(`editors/vscode/package.json version ${editorVersion} != package.json ${rootVersion}`);

const statusPattern = /internal v(\d+\.\d+\.\d+)(\*\*)? level/;
const statusMatch = readme.match(statusPattern);
if (!statusMatch) problems.push("README is missing the 'internal vX.Y.Z level' status line");
else if (statusMatch[1] !== rootVersion) {
  if (fix) {
    writeFileSync(join(root, "README.md"), readme.replace(statusPattern, (_all, _version, bold) => `internal v${rootVersion}${bold ?? ""} level`));
    console.log(`README status line updated to internal v${rootVersion} level`);
  } else {
    problems.push(`README status line is v${statusMatch[1]}, expected v${rootVersion}`);
  }
}

if (!changelog.includes(`## [${rootVersion}]`)) problems.push(`CHANGELOG.md has no '## [${rootVersion}]' section`);
if (!existsSync(join(root, releaseDoc))) problems.push(`missing ${releaseDoc}`);

if (problems.length) {
  console.error(`Version sync failed for v${rootVersion}:`);
  for (const problem of problems) console.error(`  - ${problem}`);
  console.error("Run `npm run check:version -- --fix` to auto-update the README status line, then complete the CHANGELOG and release record.");
  process.exit(1);
}
console.log(`Version sync OK: v${rootVersion} matches VS Code package, README, CHANGELOG, and ${releaseDoc}`);
