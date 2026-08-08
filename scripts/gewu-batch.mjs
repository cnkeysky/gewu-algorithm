#!/usr/bin/env node
// One-command batch authoring runner (mirrors gewu-dev.mjs conventions).
// Ensures the authoring API is up, asks the batch questions interactively
// (or takes flags non-interactively), then runs the batch CLI and reports.
import { spawn, spawnSync } from "node:child_process";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import readline from "node:readline";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..");
const toolsDir = join(repo, "tools", "template-authoring");
const devDir = join(repo, ".gewu-dev");
const logDir = join(devDir, "logs");
const pidDir = join(devDir, "pids");
const isWin = process.platform === "win32";
const npm = isWin ? "npm.cmd" : "npm";
const isTTY = Boolean(process.stdin.isTTY);
const apiName = "batch-api";

const log = (message) => console.log(`\x1b[36m>>\x1b[0m ${message}`);
const die = (message) => {
  console.error(`\x1b[31merror:\x1b[0m ${message}`);
  process.exit(1);
};

function usage() {
  console.log(`usage: gewu-batch <command> [flags]

commands:
  run      run batch authoring (interactive menu when no command and a TTY)
  status   show the authoring API health and the last batch report summary
  stop     stop the authoring API started by this script
  help     show this help

flags:
  --problems FILE   problems file (JSON array or TSV) — required for 'run'
  --api-port N      authoring API port (default 4174, env GEWU_WORKBENCH_PORT)
  --steps LIST      draft,generate,validate,review,accept (default all)
  --concurrency N   parallel problems (default 1)
  --repair-rounds N regenerate from review feedback after needs_revision (default 1)
  --auto-accept     publish drafts still needing revision after repair rounds
  --force           regenerate problems even when an accepted unit covers them
  --yes             skip duplicate prompts (default when the CLI is not a TTY)
  --select LIST     run only the given ids/slugs/titles (comma list)
  --provider ID     recorded provider metadata (default deepseek)
  --model ID        recorded model metadata (default deepseek-v4-flash)
  --language SLUG   implementation language (default python; overrides the catalog entry, e.g. --language java)
  --variants N      implementation strategy count (default auto: the model decides 1-3 meaningful strategies)
  --modes LIST      practice modes (default all five)
  --assistance LIST code recall assistance (default comments,cloze)
  --report PATH     JSON report output (default batch-report.json)
  --no-ensure-api   fail instead of starting the authoring API when it is down

The batch CLI defaults to all five practice modes: shadow typing, flow recall,
code recall, reasoning recall, and transfer practice. Code recall expands to
four layouts (full recall, comment guided, comment to code, cloze), so the
default run produces 8 practice kinds — plus one shadow typing item per
implementation strategy. Published units land in
tools/template-authoring/drafts/.workbench/published and become available to a
Core started with that content root.`);
}

const args = process.argv.slice(2);
let command;
let apiPort = process.env.GEWU_WORKBENCH_PORT ?? "4174";
let problemsFile;
let steps;
let concurrency = "1";
let repairRounds = "1";
let autoAccept = false;
let force = false;
let yes = false;
let select;
let provider;
let model;
let language = "python";
let languageGiven = false;
let variants = "0";
let variantsGiven = false;
let modes;
let assistance;
let report = "batch-report.json";
let ensureApi = true;

for (let i = 0; i < args.length; i += 1) {
  const arg = args[i];
  if (["run", "status", "stop", "help"].includes(arg)) command = arg;
  else if (arg === "--problems") problemsFile = args[++i];
  else if (arg === "--api-port") apiPort = args[++i];
  else if (arg === "--steps") steps = args[++i];
  else if (arg === "--concurrency") concurrency = args[++i];
  else if (arg === "--repair-rounds") repairRounds = args[++i];
  else if (arg === "--auto-accept") autoAccept = true;
  else if (arg === "--force") force = true;
  else if (arg === "--yes") yes = true;
  else if (arg === "--select") select = args[++i];
  else if (arg === "--resume") { /* Deduplication is the default; kept for compatibility. */ }
  else if (arg === "--provider") provider = args[++i];
  else if (arg === "--model") model = args[++i];
  else if (arg === "--language") { language = args[++i]; languageGiven = true; }
  else if (arg === "--variants") { variants = args[++i]; variantsGiven = true; }
  else if (arg === "--modes") modes = args[++i];
  else if (arg === "--assistance") assistance = args[++i];
  else if (arg === "--report") report = args[++i];
  else if (arg === "--no-ensure-api") ensureApi = false;
  else die(`unknown argument: ${arg} (run with 'help')`);
}
if (!command) command = isTTY ? "run" : "help";
if (command === "help") {
  usage();
  process.exit(0);
}

const apiUrl = () => `http://127.0.0.1:${apiPort}/api/drafts`;

function ask(question, fallback = "") {
  return new Promise((resolveWait) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(`${question} `, (answer) => {
      rl.close();
      resolveWait(answer.trim() || fallback);
    });
  });
}

async function confirmYes(question, fallback = "n") {
  if (!isTTY) return fallback === "y";
  const answer = (await ask(`${question} [Y/n] `, fallback === "y" ? "y" : "n")).toLowerCase();
  return answer === "y" || answer === "";
}

async function fetchOk(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(2500) });
    return response.ok;
  } catch {
    return false;
  }
}

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function pidOf(name) {
  const path = join(pidDir, `${name}.pid`);
  return existsSync(path) ? Number(readFileSync(path, "utf8")) : 0;
}

function startApi() {
  mkdirSync(logDir, { recursive: true });
  mkdirSync(pidDir, { recursive: true });
  const logPath = join(logDir, `${apiName}.log`);
  const logFd = openSync(logPath, "a");
  const child = spawn(npm, ["run", "workbench:api:local"], {
    cwd: toolsDir,
    detached: true,
    stdio: ["ignore", logFd, logFd],
    shell: isWin,
    env: { ...process.env, GEWU_WORKBENCH_PORT: apiPort },
  });
  closeSync(logFd);
  writeFileSync(join(pidDir, `${apiName}.pid`), String(child.pid));
  child.unref();
  log(`started authoring API (pid ${child.pid}) -> ${logPath}`);
  return child.pid;
}

function stopPid(pid) {
  try {
    if (isWin) process.kill(pid, "SIGKILL");
    else process.kill(-pid, "SIGTERM");
  } catch {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // Already gone.
    }
  }
}

function listenersOnPort(port) {
  if (isWin) {
    const result = spawnSync("netstat", ["-ano"], { encoding: "utf8" });
    return result.stdout.split("\n")
      .filter((line) => line.includes(`:${port}`) && /LISTENING/i.test(line))
      .map((line) => line.trim().split(/\s+/).pop())
      .filter((pid) => pid && pid !== "0");
  }
  const lsof = spawnSync("lsof", ["-ti", `tcp:${port}`], { encoding: "utf8" });
  return lsof.stdout.trim().split("\n").filter(Boolean);
}

function stopApi() {
  const pid = pidOf(apiName);
  if (pid > 0 && alive(pid)) {
    stopPid(pid);
    log(`stopped authoring API (pid ${pid})`);
  }
  const remaining = listenersOnPort(apiPort);
  for (const listener of remaining) {
    try {
      process.kill(Number(listener), "SIGKILL");
    } catch {
      // Already gone.
    }
  }
  try {
    rmSync(join(pidDir, `${apiName}.pid`), { force: true });
  } catch {
    // No pid file.
  }
}

async function ensureApiRunning() {
  if (await fetchOk(apiUrl())) {
    log(`authoring API already healthy at ${apiUrl()}`);
    return;
  }
  if (!ensureApi) die(`authoring API is not running at ${apiUrl()} (--no-ensure-api)`);
  log(`authoring API is down at ${apiUrl()}; starting it`);
  const pid = startApi();
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (!alive(pid)) die(`authoring API exited early; see ${logDir}/${apiName}.log`);
    if (await fetchOk(apiUrl())) {
      log(`authoring API ready (pid ${pid})`);
      return;
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 1000));
  }
  die(`timed out waiting for the authoring API at ${apiUrl()}; see ${logDir}/${apiName}.log`);
}

function runBatchCli(extraArgs) {
  const result = spawnSync(npm, ["run", "batch", "--", ...extraArgs], {
    cwd: toolsDir,
    stdio: "inherit",
    shell: isWin,
  });
  if (result.status !== 0) die(`batch authoring exited with code ${result.status}`);
}

async function doRun() {
  await ensureApiRunning();
  let file = problemsFile;
  if (!file && isTTY) file = await ask("Problems file (JSON or TSV) [tools/template-authoring/hot100.json]", "tools/template-authoring/hot100.json");
  if (!file) die("--problems FILE is required");
  const problemsPath = resolve(repo, file);
  if (!existsSync(problemsPath)) die(`problems file not found: ${problemsPath}`);

  let accept = autoAccept;
  if (!autoAccept && isTTY) accept = await confirmYes("Accept drafts still needing revision after repair rounds (records an explicit audit rationale)?");
  if (!steps && isTTY) steps = await ask("Steps (comma list; empty = all)");
  if (concurrency === "1" && isTTY) concurrency = (await ask("Concurrency [1]", "1")) || "1";
  if (repairRounds === "1" && isTTY) repairRounds = (await ask("Repair rounds [1]", "1")) || "1";

  const extraArgs = [
    "--problems", problemsPath,
    "--concurrency", concurrency,
    "--repair-rounds", repairRounds,
    "--report", resolve(repo, report),
  ];
  if (steps) extraArgs.push("--steps", steps);
  if (accept) extraArgs.push("--auto-accept");
  if (force) extraArgs.push("--force");
  if (yes) extraArgs.push("--yes");
  if (select) extraArgs.push("--select", select);
  if (provider) extraArgs.push("--provider", provider);
  if (model) extraArgs.push("--model", model);
  if (languageGiven) extraArgs.push("--language", language);
  if (variantsGiven) extraArgs.push("--variants", variants);
  if (modes) extraArgs.push("--modes", modes);
  if (assistance) extraArgs.push("--assistance", assistance);

  log(`running batch authoring for ${problemsPath}`);
  runBatchCli(extraArgs);
  log(`batch finished; report written to ${resolve(repo, report)}`);
}

async function doStatus() {
  const healthy = await fetchOk(apiUrl());
  log(`authoring API ${healthy ? "healthy" : "down"} at ${apiUrl()}`);
  const reportPath = resolve(repo, report);
  if (!existsSync(reportPath)) {
    log(`no batch report at ${reportPath} yet`);
    return;
  }
  const summary = JSON.parse(readFileSync(reportPath, "utf8"));
  log(`last batch: ${summary.total} problems — ${summary.accepted} accepted, ${summary.needsReview} need review, ${summary.failed} failed, ${summary.skipped} skipped`);
  for (const item of summary.results ?? []) {
    if (item.status === "failed" || item.status === "needs_review") {
      log(`  ${item.status}  ${item.title}${item.error ? ` — ${item.error}` : ""}`);
    }
  }
}

async function menu() {
  const options = [
    ["Run batch authoring", doRun],
    ["Status", doStatus],
    ["Stop authoring API", () => stopApi()],
  ];
  for (; ;) {
    console.log("\nGEWU batch authoring:");
    options.forEach(([label], index) => console.log(`  ${index + 1}) ${label}`));
    console.log("  0) Exit");
    const choice = (await ask("Choose", "1")).trim() || "1";
    if (choice === "0") return;
    const option = options[Number(choice) - 1];
    if (!option) {
      console.log("invalid choice");
      continue;
    }
    await option[1]();
  }
}

if (command === "run") {
  if (!isTTY && !problemsFile) {
    usage();
    die("--problems FILE is required for non-interactive runs");
  }
  doRun().catch((error) => die(error instanceof Error ? error.message : String(error)));
} else if (command === "status") {
  doStatus().catch((error) => die(error instanceof Error ? error.message : String(error)));
} else {
  stopApi();
}
