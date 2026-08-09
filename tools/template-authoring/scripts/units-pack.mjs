#!/usr/bin/env node
// Packages the published units (content root) into a release artifact and
// regenerates the committed ledger units/index.json.
//
// Flow: publish locally (content lands in the content root, gitignored) ->
// run `npm run units:pack` (writes units/index.json + a tar.gz) -> commit
// units/index.json -> `gh release upload <tag> <tarball>`.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
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
  const unitPath = join(unitDir, revision, "unit.json");
  if (!existsSync(unitPath)) continue;
  const manifest = JSON.parse(readFileSync(unitPath, "utf8"));
  const practice = manifest.practice ?? {};
  const sha256 = createHash("sha256").update(readFileSync(unitPath)).digest("hex").slice(0, 16);
  units.push({
    id: typeof manifest.id === "string" ? manifest.id : entry.name,
    title: typeof manifest.title === "string" ? manifest.title : entry.name,
    language: typeof manifest.language === "string" && manifest.language ? manifest.language : "python",
    revision,
    modes: Object.keys(practice),
    updatedAt: statSync(unitDir).mtime.toISOString(),
    sha256,
  });
}
units.sort((a, b) => a.id.localeCompare(b.id));

mkdirSync(dirname(indexPath), { recursive: true });
writeFileSync(indexPath, `${JSON.stringify({ generatedAt: new Date().toISOString(), units }, null, 2)}\n`);
console.log(`ledger written to ${resolve(repoRoot, "units/index.json")} (${units.length} units)`);

// tar the content root (excluding the ledger and the generated pack manifest)
mkdirSync(dirname(tarball), { recursive: true });
const args = ["-czf", tarball, "-C", contentRoot, "--exclude", "index.json", "--exclude", "pack.json", "."];
execFileSync("tar", args, { stdio: "inherit" });
console.log(`artifact written to ${tarball}`);
console.log(`next: git add units/index.json && git commit; gh release upload <tag> ${tarball}`);
