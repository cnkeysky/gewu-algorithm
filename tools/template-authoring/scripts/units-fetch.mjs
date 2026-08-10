#!/usr/bin/env node
// Downloads the latest published-units release artifact and extracts it into
// the local content root (gitignored), so practice works after a fresh clone.
// The committed ledger units/index.json is enough for batch dedup; this fetch
// brings the actual content.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { contentRootDefault, repoRoot } from "../../../scripts/gewu-paths.mjs";

const contentRoot = process.env.GEWU_PUBLISHED_ROOT
  ? resolve(repoRoot, process.env.GEWU_PUBLISHED_ROOT)
  : contentRootDefault;
const tag = process.env.GEWU_UNITS_TAG ?? "";

function gh(args) {
  return execFileSync("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
}

try {
  const releases = JSON.parse(gh(["release", "list", "--limit", "10", "--json", "tagName,isDraft,isPrerelease"]));
  const release = releases.find((item) => item.tagName === tag)
    ?? releases.find((item) => !item.isDraft)
    ?? releases[0];
  if (!release) throw new Error("no GitHub release found");
  const assets = JSON.parse(gh(["release", "view", release.tagName, "--json", "assets"]));
  const asset = assets.assets.find((item) => /gewu-units-.*\.tar\.gz$/.test(item.name));
  if (!asset) throw new Error(`no units artifact in release ${release.tagName}`);
  console.log(`downloading ${asset.name} from release ${release.tagName}...`);
  const tmp = join(repoRoot, ".gewu-dev", "units.tar.gz");
  mkdirSync(dirname(tmp), { recursive: true });
  execFileSync("gh", ["release", "download", release.tagName, "--pattern", asset.name, "--clobber", "--output", tmp], { stdio: "inherit" });
  rmSync(contentRoot, { recursive: true, force: true });
  mkdirSync(contentRoot, { recursive: true });
  execFileSync("tar", ["-xzf", tmp, "-C", contentRoot], { stdio: "inherit" });
  rmSync(tmp, { force: true });
  console.log(`published units extracted to ${contentRoot}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  console.error("fetching the units pack needs gh authentication; see https://cli.github.com");
  process.exit(1);
}
