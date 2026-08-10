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
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import readline from "node:readline";
import { authoringApiPorts } from "./gewu-services.mjs";

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
const portFile = join(pidDir, `${apiName}.port`);

const log = (message) => console.log(`\x1b[36m>>\x1b[0m ${message}`);
const die = (message) => {
  cleanupApi();
  console.error(`\x1b[31merror:\x1b[0m ${message}`);
  process.exit(1);
};
/** First line of an error, with any embedded HTML fragment removed. */
function shortError(value, limit = 96) {
  if (!value) return "";
  let line = String(value).split("\n")[0].trim();
  const htmlAt = line.search(/<!doctype/i);
  if (htmlAt >= 0) line = line.slice(0, htmlAt).trim();
  return line.length > limit ? `${line.slice(0, limit).trimEnd()}\u2026` : line;
}
/** Prints actionable items grouped by status + (short) error, with titles. */
function logActionableItems(items) {
  const groups = new Map();
  for (const item of items) {
    const detail = shortError(item.error ?? item.reason);
    const key = `${item.status}${detail ? `\u0000${detail}` : ""}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item.title ?? "");
  }
  for (const [key, titles] of groups) {
    const [status, detail] = key.split("\u0000");
    const shown = titles.slice(0, 8);
    log(`  ${status} ${titles.length} · ${shown.join(", ")}${titles.length > shown.length ? ` … (+${titles.length - shown.length} more)` : ""}${detail ? ` — ${detail}` : ""}`);
  }
}
let startedApi = false;
function cleanupApi() {
  if (!startedApi) return;
  startedApi = false;
  stopApi();
  log("stopped the authoring API started by this run");
}

function usage() {
  console.log(`usage: gewu-batch <command> [flags]

commands:
  run      run batch authoring (interactive menu when no command and a TTY)
  status   show the authoring API health and the last batch report summary
          (default: the actionable failed/needs-review or live non-accepted
           items; add --results for the full per-item results of the last run)
  stop     stop the authoring API started by this script
  help     show this help

flags:
  --problems FILE   problems file (JSON array or TSV) — required for 'run'
  --api-port N      authoring API port (default: last used port, else 4174,
                    env GEWU_WORKBENCH_PORT). The chosen port is remembered in
                    .gewu-dev/pids/batch-api.port so status/stop reuse it; if
                    the port is occupied, the runner tries the next ports.
  --steps LIST      default draft,generate,validate,accept (the LLM gate is the
                    sole reviewer); add 'review' for the three pre-review roles
  --concurrency N   parallel problems (default 1)
  --repair-rounds N regenerate from review feedback after needs_revision (default 1)
  --max-failures N    circuit breaker: quarantine a draft for manual review
                      after N failed generate/validate attempts (default 3;
                      --force/--regenerate bypass it)
  --timeout-minutes N per-request timeout for LLM-backed API calls (default 60)
  --request-delay-ms N pause between LLM-backed calls to respect gateway rate
                    limits (default 0; relays behind Cloudflare-style security
                    benefit from e.g. 2000)
  --regenerate LIST force regeneration for the given ids/slugs/titles
  --auto-accept     publish drafts still needing revision after repair rounds
  --llm-approve SPEC run the LLM final approval gate before publishing
                    (provider:model; derived from .env.local or
                    GEWU_LLM_PROVIDER/GEWU_LLM_MODEL, else deepseek:deepseek-v4-flash)
  --creator-models LIST rotate creator models across problems (provider:model,provider:model)
  --force           regenerate problems even when an accepted unit covers them
  --yes             skip duplicate prompts (default when the CLI is not a TTY)
  --select LIST     run only the given ids/slugs/titles (comma list)
  --provider ID     recorded provider metadata (default deepseek)
  --model ID        recorded model metadata (default deepseek-v4-flash)
  --language SLUG   implementation language (default python; overrides the catalog entry, e.g. --language java)
  --variants N      implementation strategy count (default auto: the model decides 1-3 meaningful strategies)
  --modes LIST      practice modes (default all five)
  --assistance LIST code recall assistance (default comments,cloze)
  --report PATH     JSON report output (default tools/template-authoring/batch-report.json)
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
function readStoredPort() {
  try {
    return readFileSync(portFile, "utf8").trim() || undefined;
  } catch {
    return undefined;
  }
}
function writePortFile() {
  mkdirSync(pidDir, { recursive: true });
  writeFileSync(portFile, apiPort);
}
// Bind the port across commands: --api-port wins, then the port this runner
// last used (so status/stop work without repeating it), then the default.
let apiPort = process.env.GEWU_WORKBENCH_PORT ?? readStoredPort() ?? "4174";
let problemsFile;
let steps;
let concurrency = "1";
let repairRounds = "1";
let maxFailures = "3";
let autoAccept = false;
let force = false;
let yes = false;
let llmApprove;
let creatorModels;
let select;
let provider;
let model;
let language = "python";
let languageGiven = false;
let variants = "0";
let variantsGiven = false;
let modes;
let assistance;
let report = "tools/template-authoring/batch-report.json";
let ensureApi = true;
let timeoutMinutes = "60";
let requestDelayMs = "0";
let regenerate;
let showResults = false;

for (let i = 0; i < args.length; i += 1) {
  const arg = args[i];
  if (["run", "status", "stop", "help"].includes(arg)) command = arg;
  else if (arg === "--problems") problemsFile = args[++i];
  else if (arg === "--api-port") apiPort = args[++i];
  else if (arg === "--steps") steps = args[++i];
  else if (arg === "--concurrency") concurrency = args[++i];
  else if (arg === "--repair-rounds") repairRounds = args[++i];
  else if (arg === "--max-failures") maxFailures = args[++i];
  else if (arg === "--timeout-minutes") timeoutMinutes = args[++i];
  else if (arg === "--request-delay-ms") requestDelayMs = args[++i];
  else if (arg === "--regenerate") regenerate = args[++i];
  else if (arg === "--auto-accept") autoAccept = true;
  else if (arg === "--llm-approve") llmApprove = args[++i] ?? "deepseek:deepseek-v4-flash";
  else if (arg === "--creator-models") creatorModels = args[++i];
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
  else if (arg === "--results") showResults = true;
  else die(`unknown argument: ${arg} (run with 'help')`);
}
if (!command) command = isTTY ? "run" : "help";

/** Non-secret provider selection from tools/template-authoring/.env.local,
 * so the relay approver works without exporting environment variables. */
function localEnv() {
  const envFile = join(toolsDir, ".env.local");
  if (!existsSync(envFile)) return {};
  const entries = {};
  for (const line of readFileSync(envFile, "utf8").split("\n")) {
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line.trim());
    if (match && !(match[1] in entries)) entries[match[1]] = match[2];
  }
  return entries;
}
const envFile = localEnv();
if (!llmApprove) {
  const approverProvider = process.env.GEWU_LLM_PROVIDER ?? envFile.GEWU_LLM_PROVIDER;
  const approverModel = process.env.GEWU_LLM_MODEL ?? envFile.GEWU_LLM_MODEL;
  if (approverProvider && approverModel) llmApprove = `${approverProvider}:${approverModel}`;
}
if (!steps) steps = "draft,generate,validate,accept";
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

async function fetchOk(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(2500) });
    return response.ok;
  } catch {
    return false;
  }
}

/** Expected build id: hash of every runtime module of the compiled API
 * bundle, matching workbench-api's BUILD_ID so any source change is detected
 * and a stale API process is restarted instead of reused. */
function apiBuild() {
  const files = [
    "workbench-api.js", "pi-generator.js", "generate-template.js", "review-template.js",
    "staged-generation.js", "persist.js", "draft-lifecycle.js", "manifest-lifecycle.js",
    "publish.js", "task-registry.js", "rule-dedup.js",
  ];
  const parts = [];
  for (const file of files) {
    const path = join(toolsDir, "dist", file);
    if (!existsSync(path)) return undefined;
    parts.push(readFileSync(path).toString("base64"));
  }
  return createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 12);
}

async function fetchHealth(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(2500) });
    if (!response.ok) return { ok: false, build: undefined };
    const body = await response.json().catch(() => ({}));
    return { ok: true, build: typeof body?.build === "string" ? body.build : undefined };
  } catch {
    return { ok: false, build: undefined };
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
  // Never kill the current process or its parent: a stale pid file whose pid
  // was reused (or belongs to another pid namespace) must not take down the
  // runner itself.
  if (pid === process.pid || pid === process.ppid) return;
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
  const bySs = spawnSync("ss", ["-ltnp"], { encoding: "utf8" });
  for (const line of (bySs.stdout ?? "").split("\n")) {
    if (!line.includes(`:${port}`)) continue;
    const match = line.match(/pid=(\d+)/);
    if (match) return [match[1]];
  }
  const lsof = spawnSync("lsof", ["-ti", `tcp:${port}`], { encoding: "utf8" });
  return lsof.stdout.trim().split("\n").filter(Boolean);
}

function stopApi() {
  // The API records its own pid on startup (api-<port>.pid), so stop works
  // for APIs started outside this runner too; fall back to the runner pid.
  let selfPid = 0;
  try {
    selfPid = Number(readFileSync(join(pidDir, `api-${apiPort}.pid`), "utf8") || 0);
  } catch {
    // No self-recorded pid (e.g. an API started before the feature); the
    // port sweep below still finds it when the process is visible.
  }
  const candidates = [pidOf(apiName), selfPid];
  for (const pid of candidates) {
    if (pid > 0 && alive(pid)) {
      stopPid(pid);
      log(`stopped authoring API (pid ${pid})`);
    }
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
    rmSync(join(pidDir, `api-${apiPort}.pid`), { force: true });
    rmSync(portFile, { force: true });
  } catch {
    // No pid file.
  }
}

/** Stops the remembered/recorded API plus any orphaned GEWU authoring API
 * found by probing localhost for the /api/health signature. */
async function stopAllAuthoringApis() {
  stopApi();
  for (const port of await authoringApiPorts()) {
    if (String(port) === String(apiPort)) continue; // already swept
    log(`found GEWU authoring API on port ${port} (health probe); stopping it`);
    for (const pid of listenersOnPort(port)) {
      try {
        process.kill(Number(pid), "SIGKILL");
      } catch {
        // Already gone.
      }
    }
  }
}

async function ensureApiRunning() {
  const candidates = [apiPort, ...Array.from({ length: 5 }, (_, index) => String(Number(apiPort) + 10 * (index + 1)))];
  for (const candidate of candidates) {
    apiPort = candidate;
    const health = await fetchHealth(`http://127.0.0.1:${apiPort}/api/health`);
    if (health.ok) {
      const expected = apiBuild();
      if (expected && health.build && health.build !== expected) {
        // A healthy but stale API (old code) must not be silently reused:
        // restart it so the state-machine guards and build match this tree.
        log(`authoring API on port ${apiPort} runs an older build (${health.build} vs ${expected}); restarting it`);
        stopApi();
      } else {
        log(`authoring API already healthy at ${apiUrl()}${health.build ? ` (build ${health.build})` : ""}`);
        writePortFile();
        return;
      }
    }
    if (!ensureApi) die(`authoring API is not running at ${apiUrl()} (--no-ensure-api)`);
    log(`authoring API is down at ${apiUrl()}; starting it`);
    const pid = startApi();
    startedApi = true;
    const deadline = Date.now() + 45_000;
    let earlyExit = false;
    while (Date.now() < deadline) {
      if (!alive(pid)) {
        earlyExit = true;
        break;
      }
      if (await fetchOk(apiUrl())) {
        log(`authoring API ready (pid ${pid}) on port ${apiPort}`);
        writePortFile();
        return;
      }
      await new Promise((resolveWait) => setTimeout(resolveWait, 1000));
    }
    // The candidate port is occupied by a wedged process (EADDRINUSE) or the
    // API failed to become healthy: stop this attempt and try the next port.
    stopPid(pid);
    startedApi = false;
    log(earlyExit ? `port ${candidate} unavailable; trying the next port` : `port ${candidate} did not become healthy; trying the next port`);
  }
  die(`could not start the authoring API on any candidate port; see ${logDir}/${apiName}.log`);
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

  if (isTTY) steps = (await ask(`Steps (comma list) [${steps}]`, steps)) || steps;
  if (concurrency === "1" && isTTY) concurrency = (await ask("Concurrency [1]", "1")) || "1";
  if (repairRounds === "1" && isTTY) repairRounds = (await ask("Repair rounds [1]", "1")) || "1";

  const extraArgs = [
    "--problems", problemsPath,
    "--api", `http://127.0.0.1:${apiPort}`,
    "--concurrency", concurrency,
    "--repair-rounds", repairRounds,
    "--max-failures", maxFailures,
    "--timeout-minutes", timeoutMinutes,
    "--request-delay-ms", requestDelayMs,
    "--report", resolve(repo, report),
  ];
  extraArgs.push("--steps", steps);
  if (autoAccept) extraArgs.push("--auto-accept");
  if (llmApprove) extraArgs.push("--llm-approve", llmApprove);
  if (creatorModels) extraArgs.push("--creator-models", creatorModels);
  if (force) extraArgs.push("--force");
  if (yes) extraArgs.push("--yes");
  if (select) extraArgs.push("--select", select);
  if (regenerate) extraArgs.push("--regenerate", regenerate);
  if (provider) extraArgs.push("--provider", provider);
  if (model) extraArgs.push("--model", model);
  if (languageGiven) extraArgs.push("--language", language);
  if (variantsGiven) extraArgs.push("--variants", variants);
  if (modes) extraArgs.push("--modes", modes);
  if (assistance) extraArgs.push("--assistance", assistance);

  log(`running batch authoring for ${problemsPath}`);
  runBatchCli(extraArgs);
  log(`batch finished; report written to ${relative(repo, resolve(repo, report))}`);
}

async function doStatus() {
  let liveDrafts = [];
  // Run state: the batch CLI writes batch-run.lock (pid) and batch-run.json
  // (pid + startedAt + problem count) while running. Alive pid = in progress;
  // dead pid = interrupted (leftover drafts are reused by the next run); no
  // lock = no batch run (the report below is the last finished result).
  const lockPath = join(pidDir, "batch-run.lock");
  const runStatePath = join(pidDir, "batch-run.json");
  const lockPid = existsSync(lockPath) ? Number(readFileSync(lockPath, "utf8")) : 0;
  let runMeta = {};
  try {
    runMeta = JSON.parse(readFileSync(runStatePath, "utf8"));
  } catch {
    // No run state recorded yet.
  }
  let lockAlive = false;
  if (lockPid > 0) {
    try {
      process.kill(lockPid, 0);
      lockAlive = true;
    } catch {
      // The pid is gone: the run was interrupted.
    }
  }
  // Heartbeat liveness: the CLI refreshes batch-run.json every 60s, so a
  // fresh lastHeartbeat proves the run is alive even when the pid is not
  // visible (different pid namespace) or has been reused.
  const heartbeatFresh = typeof runMeta.lastHeartbeat === "string"
    && Date.now() - new Date(runMeta.lastHeartbeat).getTime() < 3 * 60_000;
  if (lockAlive || heartbeatFresh) {
    const started = runMeta.startedAt ? ` started ${new Date(runMeta.startedAt).toLocaleTimeString()}` : "";
    const count = runMeta.problems ? `, ${runMeta.problems} problems` : "";
    log(`batch run: in progress (pid ${lockPid || "?"}${started}${count}) — generation has not finished`);
  } else if (lockPid > 0 || typeof runMeta.pid === "number") {
    log(`batch run: interrupted earlier (pid ${lockPid} is not alive) — leftover drafts will be reused by the next run`);
  } else {
    log("batch run: not running (the report below is the last finished batch)");
  }
  const health = await fetchHealth(`http://127.0.0.1:${apiPort}/api/health`);
  const healthy = health.ok;
  log(`authoring API ${healthy ? `healthy (build ${health.build ?? "unknown"})` : "down"} at ${apiUrl()}`);
  if (healthy) {
    writePortFile();
    try {
      const response = await fetch(apiUrl(), { signal: AbortSignal.timeout(5000) });
      const body = await response.json();
      const drafts = Array.isArray(body.drafts) ? body.drafts : [];
      const by = new Map();
      for (const draft of drafts) by.set(draft.status ?? "unknown", (by.get(draft.status ?? "unknown") ?? 0) + 1);
      const counts = [...by.entries()].map(([status, count]) => `${status} ${count}`).join(", ");
      log(`live drafts: ${drafts.length} — ${counts || "none"}`);
      liveDrafts = drafts;
    } catch {
      log("could not read live draft counts from the authoring API");
    }
  }
  const reportCandidates = [resolve(repo, report), join(toolsDir, report)];
  let reportPath;
  let reportTime = 0;
  for (const candidate of reportCandidates) {
    if (!existsSync(candidate)) continue;
    const mtime = statSync(candidate).mtimeMs;
    if (mtime > reportTime) {
      reportTime = mtime;
      reportPath = candidate;
    }
  }
  if (!reportPath) {
    log(`no finished batch report found (${reportCandidates.join(" or ")})`);
    return;
  }
  const summary = JSON.parse(readFileSync(reportPath, "utf8"));
  log(`last finished batch (${relative(repo, reportPath)}): ${summary.total} problems — ${summary.accepted} accepted, ${summary.needsReview} need review, ${summary.failed} failed, ${summary.skipped} skipped`);
  const newestDraftAt = liveDrafts.reduce((latest, draft) => (draft.createdAt && draft.createdAt > latest ? draft.createdAt : latest), "");
  const reportIsCurrent = !newestDraftAt || (typeof summary.generatedAt === "string" && summary.generatedAt >= newestDraftAt);
  if (reportIsCurrent) {
    log("actionable items:");
    logActionableItems((summary.results ?? []).filter((item) => item.status === "failed" || item.status === "needs_review"));
    if (showResults) {
      log("full results of the last finished batch:");
      for (const item of summary.results ?? []) {
        log(`  ${item.status}  ${item.title}${shortError(item.error ?? item.reason) ? ` — ${shortError(item.error ?? item.reason)}` : ""}`);
      }
    }
  } else {
    log(`newer drafts exist than the last report (${newestDraftAt} > ${summary.generatedAt}) — live non-accepted drafts:`);
    logActionableItems(liveDrafts.filter((draft) => draft.status !== "accepted"));
    if (showResults) {
      log("previous (last finished) batch items:");
      for (const item of summary.results ?? []) {
        if (item.status === "failed" || item.status === "needs_review") {
          log(`  ${item.status}  ${item.title}${shortError(item.error ?? item.reason) ? ` — ${shortError(item.error ?? item.reason)}` : ""}`);
        }
      }
    }
  }
}

async function menu() {
  const options = [
    ["Run batch authoring", doRun],
    ["Status", doStatus],
    ["Stop authoring API", async () => { await stopAllAuthoringApis(); }],
  ];
  for (; ;) {
    console.log("\nGEWU batch authoring:");
    options.forEach(([label], index) => console.log(`  ${index + 1}) ${label}`));
    console.log("  0) Exit");
    const choice = (await ask("Choose", "1")).trim() || "1";
    if (choice === "0") { cleanupApi(); return; }
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
  doRun().then(cleanupApi).catch((error) => die(error instanceof Error ? error.message : String(error)));
} else if (command === "status") {
  doStatus().catch((error) => die(error instanceof Error ? error.message : String(error)));
} else {
  stopAllAuthoringApis().catch((error) => die(error instanceof Error ? error.message : String(error)));
}
process.on("SIGINT", () => { cleanupApi(); process.exit(130); });
process.on("SIGTERM", () => { cleanupApi(); process.exit(143); });
