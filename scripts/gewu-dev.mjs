#!/usr/bin/env node
// Cross-platform GEWU dev stack runner (Node 22+; Node is already required).
import { spawn, spawnSync } from "node:child_process";
import {
  chmodSync,
  closeSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import readline from "node:readline";
import { authoringApiPorts, listeningPorts } from "./gewu-services.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..");
const devDir = join(repo, ".gewu-dev");
const logDir = join(devDir, "logs");
const pidDir = join(devDir, "pids");
const envFile = process.env.GEWU_DEV_ENV_FILE ?? join(repo, "tools", "template-authoring", ".env.local");
const envExample = join(repo, "tools", "template-authoring", ".env.example");
const isWin = process.platform === "win32";
const npm = isWin ? "npm.cmd" : "npm";
const cargo = isWin ? "cargo.exe" : "cargo";
const isTTY = Boolean(process.stdin.isTTY);

const args = process.argv.slice(2);
let command;
let corePort = process.env.GEWU_CORE_PORT ?? "4175";
let apiPort = process.env.GEWU_WORKBENCH_PORT ?? "4174";
let webPort = process.env.GEWU_WEB_PORT ?? "5173";
let forceInstall = false;
let installE2e = false;
let keyOverride = false;
let selectedProvider;
let selectedModel;

const PROVIDER_ENV = {
  deepseek: "DEEPSEEK_API_KEY",
  openai: "OPENAI_API_KEY",
  moonshotai: "MOONSHOT_API_KEY",
  xiaomi: "XIAOMI_API_KEY",
  relay: "GEWU_LLM_API_KEY",
};

const FALLBACK_MODELS = {
  deepseek: ["deepseek-v4-flash", "deepseek-v4-pro"],
  openai: ["gpt-4o", "gpt-4o-mini"],
  moonshotai: ["moonshot-v1-8k", "moonshot-v1-32k"],
  xiaomi: ["MiMo-7B-RL"],
  relay: ["deepseek-chat"],
};

const log = (message) => console.log(`\x1b[36m>>\x1b[0m ${message}`);
const die = (message) => {
  console.error(`\x1b[31merror:\x1b[0m ${message}`);
  process.exit(1);
};

function usage() {
  console.log(`usage: gewu-dev <command> [flags]

commands:
  prepare   install dependencies, build the core, and ensure .env.local/key
  start     ensure core + authoring API + web client are running (background)
  stop      stop all started processes
  status    show which services are running and healthy
  restart   stop then start
  menu      interactive action chooser (default when run without arguments)
  help      show this help

flags:
  --core-port N   core HTTP port (default 4175, env GEWU_CORE_PORT)
  --api-port N    authoring API port (default 4174, env GEWU_WORKBENCH_PORT)
  --web-port N    Vite web port (default 5173, env GEWU_WEB_PORT)
  --force-install reinstall npm dependencies even if node_modules exists
  --e2e           also install Playwright chromium (for the e2e suite)
  --key           re-prompt for DEEPSEEK_API_KEY even if already set
  --provider ID   provider id (deepseek|openai|moonshotai|xiaomi)
  --model ID      model id you prepared (catalog is listed when available)

Have your provider and model id ready before the interactive run. The API key
is read after the slow install/build steps, just before services start. Never
pass a key as a CLI argument: use the hidden prompt, or export the provider
key environment variable (for example DEEPSEEK_API_KEY) before running.`);
}

for (let i = 0; i < args.length; i += 1) {
  const arg = args[i];
  if (["prepare", "start", "stop", "restart", "status", "menu", "help"].includes(arg)) command = arg;
  else if (arg === "--core-port") corePort = args[++i];
  else if (arg === "--api-port") apiPort = args[++i];
  else if (arg === "--web-port") webPort = args[++i];
  else if (arg === "--force-install") forceInstall = true;
  else if (arg === "--e2e") installE2e = true;
  else if (arg === "--key") keyOverride = true;
  else if (arg === "--provider") selectedProvider = args[++i];
  else if (arg === "--model") selectedModel = args[++i];
  else die(`unknown argument: ${arg} (run with 'help')`);
}
if (!command) command = isTTY ? "menu" : "start";

function runSync(name, list, options = {}) {
  const result = spawnSync(name, list, { stdio: "inherit", ...options });
  if (result.status !== 0) die(`${name} exited with code ${result.status}`);
}

async function confirmYes(question) {
  if (!isTTY) return true;
  const answer = (await ask(`${question} [Y/n] `, "y")).toLowerCase();
  return answer === "y" || answer === "";
}

function installNeeded() {
  return forceInstall || installE2e
    || !existsSync(join(repo, "tools", "template-authoring", "node_modules"))
    || !existsSync(join(repo, "tools", "template-authoring", "workbench", "node_modules"));
}

async function npmInstall(cwd, force) {
  if (existsSync(join(cwd, "node_modules")) && !force) {
    log(`node_modules present in ${cwd}; skipping npm ci (--force-install to reinstall)`);
    return;
  }
  log(`npm ci in ${cwd}`);
  runSync(npm, ["ci"], { cwd, shell: isWin });
}

function checkPrerequisites() {
  log("[1/5] Checking prerequisites (node, npm, cargo, python3, git)");
  const probes = [["node", "--version"], [npm, "--version"], [cargo, "--version"], ["git", "--version"]];
  for (const [tool, flag] of probes) {
    const probe = spawnSync(tool, [flag], { stdio: "ignore", shell: isWin });
    if (probe.status !== 0) die(`missing required tool: ${tool}`);
  }
  const python = ["python3", "python"].find((candidate) => spawnSync(candidate, ["--version"], { stdio: "ignore" }).status === 0);
  if (!python) die("missing required tool: python3/python");
  if (!isWin && python !== "python3") {
    log(`using ${python} as the Python interpreter`);
  }
}

function npx() {
  return isWin ? "npx.cmd" : "npx";
}

let pipedLines = [];
let pipedReady = false;

async function pipedLine(fallback) {
  if (!pipedReady) {
    pipedReady = true;
    const rl = readline.createInterface({ input: process.stdin, terminal: false });
    for await (const line of rl) pipedLines.push(line);
  }
  const value = pipedLines.shift();
  return value === undefined ? (fallback ?? "") : value;
}

function ask(question, fallback) {
  if (!isTTY) {
    process.stdout.write(question);
    return pipedLine(fallback);
  }
  return new Promise((resolvePrompt) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    let answered = false;
    rl.question(question, (answer) => {
      answered = true;
      rl.close();
      resolvePrompt(answer.trim() || fallback);
    });
    rl.on("SIGINT", () => process.exit(130));
    rl.on("close", () => {
      if (!answered) resolvePrompt(fallback ?? "");
    });
  });
}

async function askHidden(question) {
  if (!isTTY) {
    process.stdout.write(`${question}\n`);
    return pipedLine("");
  }
  return new Promise((resolvePrompt) => {
    let answered = false;
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    let muted = false;
    rl._writeToOutput = (stringToWrite) => {
      if (muted) rl.output.write("*".repeat(String(stringToWrite).length));
      else rl.output.write(stringToWrite);
    };
    rl.question(question, (answer) => {
      answered = true;
      rl.close();
      resolvePrompt(answer.trim());
    });
    rl.on("SIGINT", () => process.exit(130));
    rl.on("close", () => {
      if (!answered) resolvePrompt("");
    });
    muted = true;
  });
}

async function loadModels(provider) {
  try {
    const moduleUrl = pathToFileURL(join(repo, "tools", "template-authoring", "node_modules", "@earendil-works", "pi-ai", "dist", "providers", "all.js")).href;
    const piAi = await import(moduleUrl);
    const models = piAi.builtinModels()?.getModels?.(provider)?.map((model) => model.id) ?? [];
    return models.length ? models : FALLBACK_MODELS[provider] ?? [];
  } catch {
    return FALLBACK_MODELS[provider] ?? [];
  }
}

function writeEnvVar(content, name, value) {
  if (new RegExp(`^#? *${name}=`, "m").test(content)) {
    return content.replace(new RegExp(`^#? *${name}=.*$`, "m"), `${name}=${value}`);
  }
  return `${content.replace(/\n*$/, "\n")}${name}=${value}\n`;
}

function readCurrentConfig() {
  if (!existsSync(envFile)) return { provider: "deepseek", model: "deepseek-v4-flash", hasKey: false };
  const content = readFileSync(envFile, "utf8");
  return {
    provider: /^GEWU_LLM_PROVIDER=(\S+)/m.exec(content)?.[1] ?? "deepseek",
    model: /^GEWU_LLM_MODEL=(\S+)/m.exec(content)?.[1] ?? "deepseek-v4-flash",
    baseUrl: /^GEWU_LLM_BASE_URL=(\S+)/m.exec(content)?.[1] ?? "",
    hasKey: /^[A-Z_]+_API_KEY=[^ \t]+/m.test(content),
  };
}

/** Collects the answers that do not depend on the installed toolchain, then execution runs. */
async function collectConfig(starting) {
  const current = readCurrentConfig();
  if (selectedProvider && !PROVIDER_ENV[selectedProvider]) die(`unsupported provider: ${selectedProvider} (use one of: ${Object.keys(PROVIDER_ENV).join(", ")})`);

  const reconfigure = keyOverride || Boolean(selectedProvider) || Boolean(selectedModel);
  let provider;
  let model;
  let keyMode;

  if (!reconfigure && current.hasKey && isTTY) {
    const keep = await confirmYes(`Keep LLM configuration (provider=${current.provider}, model=${current.model})`);
    if (keep) {
      provider = current.provider;
      model = current.model;
      keyMode = "existing";
      log(`using existing configuration: provider=${current.provider} model=${current.model} (API key present)`);
    } else {
      log("Have your LLM provider and model id ready (e.g., deepseek / deepseek-v4-flash).");
      provider = await ask(`Provider [${Object.keys(PROVIDER_ENV).join("|")}] (default ${current.provider}): `, current.provider);
      if (!PROVIDER_ENV[provider]) die(`unsupported provider: ${provider}`);
      const models = await loadModels(provider);
      const question = models.length
        ? `Model (${models.map((id, index) => `${index + 1}: ${id}`).join(", ")}; default ${current.model}): `
        : `Model id (the id you prepared; default ${current.model}): `;
      const answer = await ask(question, current.model);
      const index = Number(answer);
      model = Number.isInteger(index) && index >= 1 && index <= models.length ? models[index - 1] : answer;
      keyMode = "new";
    }
  } else if (!reconfigure && current.hasKey) {
    provider = current.provider;
    model = current.model;
    keyMode = "existing";
    log(`using existing configuration: provider=${current.provider} model=${current.model} (API key present)`);
  } else {
    log("Have your LLM provider and model id ready (e.g., deepseek / deepseek-v4-flash).");
    provider = selectedProvider ?? (isTTY ? await ask(`Provider [${Object.keys(PROVIDER_ENV).join("|")}] (default ${current.provider}): `, current.provider) : current.provider);
    if (!PROVIDER_ENV[provider]) die(`unsupported provider: ${provider}`);
    if (selectedModel) {
      model = selectedModel;
    } else {
      const models = await loadModels(provider);
      const question = models.length
        ? `Model (${models.map((id, index) => `${index + 1}: ${id}`).join(", ")}; default ${current.model}): `
        : `Model id (the id you prepared; default ${current.model}): `;
      const answer = isTTY ? await ask(question, current.model) : current.model;
      const index = Number(answer);
      model = Number.isInteger(index) && index >= 1 && index <= models.length ? models[index - 1] : answer;
    }
    keyMode = "new";
  }

  let install = true;
  if (isTTY && installNeeded() && !(await confirmYes("Install npm dependencies (may take a while)"))) {
    die("dependencies are required; rerun with --force-install or install manually");
  }

  let core = corePort;
  let api = apiPort;
  let web = webPort;
  if (starting && isTTY) {
    for (;;) {
      if (await confirmYes(`Use ports core=${core} api=${api} web=${web}`)) break;
      core = await ask("core port (default 4175): ", "4175");
      api = await ask("authoring API port (default 4174): ", "4174");
      web = await ask("web port (default 5173): ", "5173");
      for (const value of [core, api, web]) {
        if (!/^\d{1,5}$/.test(value)) die(`invalid port: ${value}`);
      }
    }
  }
  let baseUrl = process.env.GEWU_LLM_BASE_URL ?? current.baseUrl ?? "";
  if (provider === "relay" && !baseUrl && isTTY) {
    baseUrl = await ask("Relay endpoint base URL (e.g. https://api.example.com/v1): ", "");
  }
  if (provider === "relay" && !baseUrl) {
    die("relay provider requires GEWU_LLM_BASE_URL (set it in .env.local or pass it via the environment)");
  }
  return { provider, model, baseUrl, keyMode, install, corePort: core, apiPort: api, webPort: web };
}

function writeConfig(config) {
  if (!existsSync(envFile)) {
    copyFileSync(envExample, envFile);
    log(`Created ${envFile} from .env.example`);
  }
  const envVar = PROVIDER_ENV[config.provider];
  let content = readFileSync(envFile, "utf8");
  content = writeEnvVar(content, "GEWU_LLM_PROVIDER", config.provider);
  content = writeEnvVar(content, "GEWU_LLM_MODEL", config.model);
  if (config.baseUrl) content = writeEnvVar(content, "GEWU_LLM_BASE_URL", config.baseUrl);
  if (config.key) content = writeEnvVar(content, envVar, config.key);
  writeFileSync(envFile, content, { mode: 0o600 });
  if (!isWin) chmodSync(envFile, 0o600);
  log(config.key
    ? `${envVar} and GEWU_LLM_PROVIDER/MODEL written to .env.local (mode 600)`
    : `GEWU_LLM_PROVIDER/MODEL updated; existing API key preserved`);
}

function resolveKey(provider) {
  const envVar = PROVIDER_ENV[provider];
  if (process.env[envVar]) return { key: process.env[envVar], source: `environment (${envVar})` };
  if (process.env.GEWU_DEV_API_KEY) return { key: process.env.GEWU_DEV_API_KEY, source: "environment (GEWU_DEV_API_KEY)" };
  return null;
}

function killTree(pid) {
  if (isWin) {
    spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore" });
    return;
  }
  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // Already gone.
    }
  }
}

function listenersOnPort(port) {
  const pids = [];
  if (isWin) {
    const out = spawnSync("netstat", ["-ano"], { encoding: "utf8" });
    for (const line of (out.stdout ?? "").split(/\r?\n/)) {
      const match = line.match(new RegExp(`TCP\\s+[^:]+:${port}\\s+\\S+\\s+LISTENING\\s+(\\d+)`, "i"));
      if (match) pids.push(Number(match[1]));
    }
    return pids;
  }
  let out = spawnSync("ss", ["-ltnp"], { encoding: "utf8" });
  for (const line of (out.stdout ?? "").split("\n")) {
    if (!line.includes(`:${port}`)) continue;
    const match = line.match(/pid=(\d+)/);
    if (match) pids.push(Number(match[1]));
  }
  if (pids.length) return pids;
  out = spawnSync("lsof", ["-tiTCP:" + port, "-sTCP:LISTEN"], { encoding: "utf8" });
  for (const line of (out.stdout ?? "").split(/\s+/)) {
    const pid = Number(line);
    if (Number.isInteger(pid) && pid > 0) pids.push(pid);
  }
  return pids;
}

/** Every GEWU-owned port: the dev stack's configured ports plus any port the
 * batch runner or an API instance recorded in the shared pids directory
 * (`*.port` files and `api-<port>.pid` names), so a stop sweeps services it
 * did not start itself. */
function managedPorts() {
  const ports = new Set([corePort, apiPort, webPort]);
  if (existsSync(pidDir)) {
    for (const name of readdirSync(pidDir)) {
      if (name.endsWith(".port")) {
        const port = Number(readFileSync(join(pidDir, name), "utf8").trim());
        if (Number.isInteger(port) && port > 0) ports.add(String(port));
      }
      const apiPid = /^api-(\d+)\.pid$/.exec(name);
      if (apiPid) ports.add(apiPid[1]);
    }
  }
  return [...ports];
}

async function stopAllSync() {
  log("Stopping GEWU dev processes");
  const targets = new Set();
  if (existsSync(pidDir)) {
    for (const name of readdirSync(pidDir)) {
      // Only `.pid` files hold pids; `.port` files hold ports and must not be
      // interpreted as process ids (that killed an unrelated pid before).
      if (!name.endsWith(".pid")) continue;
      const pid = Number(readFileSync(join(pidDir, name), "utf8"));
      if (Number.isInteger(pid) && pid > 0) {
        targets.add(pid);
        killTree(pid);
      }
    }
  }
  const ports = new Set(managedPorts());
  for (const port of await authoringApiPorts()) {
    ports.add(port);
    log(`found GEWU authoring API on port ${port} (health probe)`);
  }
  for (const port of ports) {
    for (const pid of listenersOnPort(port)) {
      if (targets.has(pid)) continue;
      log(`stopping process ${pid} listening on port ${port}`);
      targets.add(pid);
      killTree(pid);
    }
  }
  if (existsSync(pidDir)) {
    for (const name of readdirSync(pidDir)) rmSync(join(pidDir, name), { force: true });
  }
}

async function stopAll() {
  await stopAllSync();
  await new Promise((resolveWait) => setTimeout(resolveWait, 1500));
  const ports = new Set(managedPorts());
  for (const port of await authoringApiPorts()) ports.add(port);
  for (const port of ports) {
    for (const pid of listenersOnPort(port)) {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        // Already gone.
      }
    }
  }
}

async function waitFor(url, label, pid) {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (!alive(pid)) die(`${label} exited early; see ${logDir}`);
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (response.ok) {
        log(`${label} ready at ${url}`);
        return;
      }
    } catch {
      // Still starting.
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  die(`timed out waiting for ${label} at ${url}; see ${logDir}`);
}

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function startOne(name, list, options) {
  mkdirSync(logDir, { recursive: true });
  mkdirSync(pidDir, { recursive: true });
  const logPath = join(logDir, `${name}.log`);
  const logFd = openSync(logPath, "a");
  const child = spawn(list[0], list.slice(1), {
    cwd: repo,
    detached: true,
    stdio: ["ignore", logFd, logFd],
    ...options,
  });
  closeSync(logFd);
  writeFileSync(join(pidDir, `${name}.pid`), String(child.pid));
  child.unref();
  log(`started ${name} (pid ${child.pid}) -> ${logPath}`);
  return child.pid;
}

async function prepare() {
  checkPrerequisites();
  const config = await collectConfig(false);
  log("[2/5] Installing npm dependencies");
  await npmInstall(join(repo, "tools", "template-authoring"), forceInstall);
  await npmInstall(join(repo, "tools", "template-authoring", "workbench"), forceInstall);
  if (installE2e) {
    log("Installing Playwright chromium (for e2e)");
    runSync(npx(), ["playwright", "install", "chromium"], { cwd: join(repo, "tools", "template-authoring", "workbench"), shell: isWin });
  }
  log("[3/5] Building the Rust core");
  runSync(cargo, ["build", "-p", "gewu-cli"], { cwd: repo });
  log("[4/5] Writing LLM configuration");
  const resolved = config.keyMode === "new" ? resolveKey(config.provider) : null;
  const key = resolved ? resolved.key : config.keyMode === "new" ? await askHidden(`${PROVIDER_ENV[config.provider]} (input hidden): `) : undefined;
  if (config.keyMode === "new" && !key) die("API key cannot be empty");
  if (resolved) log(`API key read from ${resolved.source}; it is not echoed or logged`);
  writeConfig({ ...config, key });
  log("[5/5] Setup complete");
}

function pidOf(name) {
  const path = join(pidDir, `${name}.pid`);
  return existsSync(path) ? Number(readFileSync(path, "utf8")) : 0;
}

async function fetchOk(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(2500) });
    return response.ok;
  } catch {
    return false;
  }
}

async function statusServices() {
  const urls = {
    core: `http://127.0.0.1:${corePort}/health`,
    api: `http://127.0.0.1:${apiPort}/api/drafts`,
    web: `http://127.0.0.1:${webPort}`,
  };
  const states = {};
  for (const name of ["core", "api", "web"]) {
    const pid = pidOf(name);
    states[name] = {
      name,
      url: urls[name],
      pid,
      alive: pid > 0 && alive(pid),
      healthy: await fetchOk(urls[name]),
    };
  }
  // Batch authoring APIs: the runner records batch-api.port, and any API
  // instance records api-<port>.pid on startup — discover them all so status
  // shows (and stop sweeps) services this script did not start.
  const batchPorts = new Set();
  try {
    const port = readFileSync(join(pidDir, "batch-api.port"), "utf8").trim();
    if (port) batchPorts.add(port);
  } catch {
    // No batch API port has been recorded yet.
  }
  if (existsSync(pidDir)) {
    for (const name of readdirSync(pidDir)) {
      const match = /^api-(\d+)\.pid$/.exec(name);
      if (match) batchPorts.add(match[1]);
    }
  }
  let batchIndex = 0;
  for (const port of [...batchPorts].sort((a, b) => Number(a) - Number(b))) {
    batchIndex += 1;
    const name = batchIndex === 1 ? "batchApi" : `batchApi${batchIndex}`;
    let pid = 0;
    try {
      pid = Number(readFileSync(join(pidDir, `api-${port}.pid`), "utf8"));
    } catch {
      pid = pidOf("batch-api");
    }
    states[name] = {
      name,
      url: `http://127.0.0.1:${port}/api/drafts`,
      pid,
      alive: pid > 0 && alive(pid),
      healthy: await fetchOk(`http://127.0.0.1:${port}/api/drafts`),
    };
  }
  return states;
}

function printStatus(states) {
  const order = ["core", "api", "web", ...Object.keys(states).filter((name) => name.startsWith("batchApi")).sort()];
  for (const name of order) {
    const state = states[name];
    if (!state) continue;
    const managed = state.pid > 0 ? (state.alive ? `pid ${state.pid}` : "stale pid") : state.healthy ? "external process" : "not started";
    log(`${name.padEnd(8)} ${state.healthy ? "healthy" : "down"}   ${managed}   ${state.url}`);
  }
}

function startService(name, { core, api, web }) {
  if (name === "core") {
    return startOne("core", [
      cargo, "run", "-p", "gewu-cli", "--", "serve",
      "--port", core,
      "--content-root", "fixtures/algorithm-units/valid",
      "--content-root", "tools/template-authoring/drafts/.workbench/published",
      "--data-root", join(devDir, "data"),
    ], { cwd: repo });
  }
  if (name === "api") {
    return startOne("api", [npm, "run", "workbench:api:local"], {
      cwd: join(repo, "tools", "template-authoring"),
      shell: isWin,
      env: { ...process.env, GEWU_WORKBENCH_PORT: api },
    });
  }
  return startOne("web", [npm, "run", "dev", "--", "--host", "127.0.0.1", "--port", web], {
    cwd: join(repo, "tools", "template-authoring", "workbench"),
    shell: isWin,
    env: { ...process.env, GEWU_CORE_PORT: core, GEWU_AUTHORING_PORT: api },
  });
}

let startupComplete = false;
process.on("SIGINT", () => {
  if (!startupComplete) stopAllSync();
  process.exit(130);
});
process.on("SIGTERM", () => {
  if (!startupComplete) stopAllSync();
  process.exit(143);
});

async function doStart() {
  log("GEWU dev setup plan:");
  log("  collect: prerequisites/deps/LLM/ports -> then run: deps -> core -> config -> services");
  checkPrerequisites();
  const config = await collectConfig(true);
  log("[2/5] Installing npm dependencies");
  await npmInstall(join(repo, "tools", "template-authoring"), forceInstall);
  await npmInstall(join(repo, "tools", "template-authoring", "workbench"), forceInstall);
  log("[3/5] Building the Rust core");
  runSync(cargo, ["build", "-p", "gewu-cli"], { cwd: repo });
  log("[4/5] Writing LLM configuration");
  const resolved = config.keyMode === "new" ? resolveKey(config.provider) : null;
  const key = resolved ? resolved.key : config.keyMode === "new" ? await askHidden(`${PROVIDER_ENV[config.provider]} (input hidden): `) : undefined;
  if (config.keyMode === "new" && !key) die("API key cannot be empty");
  if (resolved) log(`API key read from ${resolved.source}; it is not echoed or logged`);
  writeConfig({ ...config, key });
  log("[5/5] Ensuring services are running");
  const { corePort: core, apiPort: api, webPort: web } = config;
  mkdirSync(join(devDir, "data"), { recursive: true });

  const before = await statusServices();
  const toStart = ["core", "api", "web"].filter((name) => !before[name].healthy);
  for (const name of ["core", "api", "web"]) {
    if (before[name].healthy) log(`${name} already healthy (${before[name].url})`);
    else startService(name, { core, api, web });
  }
  for (const name of toStart.length ? toStart : ["core", "api", "web"]) {
    await waitFor(before[name].url, name, pidOf(name));
  }
  startupComplete = true;

  const after = await statusServices();
  console.log("\n\x1b[32mGEWU dev stack:\x1b[0m");
  printStatus(after);
  console.log("Services run in the background. Run the script again and choose 2) Stop, or use: npm run dev:stop");
}

async function runMenu() {
  for (;;) {
    const choice = await ask(
      "\nGEWU dev — choose an action:\n"
      + "  1) Start services — ensure core, API, and web are running (starts only what is missing)\n"
      + "  2) Stop services — stop all managed services\n"
      + "  3) Status — show which services are running and healthy\n"
      + "  4) Prepare — install dependencies, build the core, configure the LLM provider\n"
      + "  5) Restart — stop everything, then start again\n"
      + "  0) Exit\nChoice: ",
      "0",
    );
    if (choice === "1") await doStart();
    else if (choice === "2") await stopAll();
    else if (choice === "3") printStatus(await statusServices());
    else if (choice === "4") await prepare();
    else if (choice === "5") {
      await stopAll();
      await doStart();
    } else if (choice === "0" || choice === "") {
      return;
    } else {
      log(`unknown choice: ${choice}`);
    }
  }
}

if (command === "help") {
  usage();
} else if (command === "menu") {
  await runMenu();
} else if (command === "status") {
  printStatus(await statusServices());
} else if (command === "prepare") {
  await prepare();
} else if (command === "stop") {
  await stopAll();
} else if (command === "restart") {
  await stopAll();
  await doStart();
} else if (command === "start") {
  await doStart();
}
