#!/usr/bin/env node
// Cross-platform GEWU dev stack runner (Node 22+; Node is already required).
import { spawn, spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import readline from "node:readline";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..");
const devDir = join(repo, ".gewu-dev");
const logDir = join(devDir, "logs");
const pidDir = join(devDir, "pids");
const envFile = process.env.GEWU_DEV_ENV_FILE ?? join(repo, "tools", "template-authoring", ".env.local");
const envExample = join(repo, "tools", "template-authoring", ".env.example");
const isWin = process.platform === "win32";
const npm = isWin ? "npm.cmd" : "npm";
const isTTY = Boolean(process.stdin.isTTY);

const args = process.argv.slice(2);
let command = "start";
let corePort = process.env.GEWU_CORE_PORT ?? "4175";
let apiPort = process.env.GEWU_WORKBENCH_PORT ?? "4174";
let webPort = process.env.GEWU_WEB_PORT ?? "5173";
let forceInstall = false;
let installE2e = false;
let keyOverride = false;
let selectedProvider;
let selectedModel;
let apiKeyValue;

const PROVIDER_ENV = {
  deepseek: "DEEPSEEK_API_KEY",
  openai: "OPENAI_API_KEY",
  moonshotai: "MOONSHOT_API_KEY",
  xiaomi: "XIAOMI_API_KEY",
};

const FALLBACK_MODELS = {
  deepseek: ["deepseek-v4-flash", "deepseek-v4-pro"],
  openai: ["gpt-4o", "gpt-4o-mini"],
  moonshotai: ["moonshot-v1-8k", "moonshot-v1-32k"],
  xiaomi: ["MiMo-7B-RL"],
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
  start     prepare (as needed) and start core + authoring API + web client
  stop      stop all started processes
  restart   stop then start
  help      show this help

flags:
  --core-port N   core HTTP port (default 4175, env GEWU_CORE_PORT)
  --api-port N    authoring API port (default 4174, env GEWU_WORKBENCH_PORT)
  --web-port N    Vite web port (default 5173, env GEWU_WEB_PORT)
  --force-install reinstall npm dependencies even if node_modules exists
  --e2e           also install Playwright chromium (for the e2e suite)
  --key           re-prompt for DEEPSEEK_API_KEY even if already set
  --provider ID   provider id (deepseek|openai|moonshotai|xiaomi)
  --model ID      model id (used with --provider; must exist in the pi-ai catalog)
  --api-key KEY   provider API key (used with --provider; hidden prompts otherwise)

Cross-platform: POSIX ./scripts/gewu-dev.sh, Windows scripts\\gewu-dev.cmd.`);
}

for (let i = 0; i < args.length; i += 1) {
  const arg = args[i];
  if (["prepare", "start", "stop", "restart", "help"].includes(arg)) command = arg;
  else if (arg === "--core-port") corePort = args[++i];
  else if (arg === "--api-port") apiPort = args[++i];
  else if (arg === "--web-port") webPort = args[++i];
  else if (arg === "--force-install") forceInstall = true;
  else if (arg === "--e2e") installE2e = true;
  else if (arg === "--key") keyOverride = true;
  else if (arg === "--provider") selectedProvider = args[++i];
  else if (arg === "--model") selectedModel = args[++i];
  else if (arg === "--api-key") apiKeyValue = args[++i];
  else die(`unknown argument: ${arg} (run with 'help')`);
}

function runSync(name, list, options = {}) {
  const result = spawnSync(name, list, { stdio: "inherit", ...options });
  if (result.status !== 0) die(`${name} exited with code ${result.status}`);
}

async function confirmYes(question) {
  if (!isTTY) return true;
  const answer = (await ask(`${question} [Y/n] `, "y")).toLowerCase();
  return answer === "y" || answer === "";
}

async function npmInstall(cwd, force) {
  if (existsSync(join(cwd, "node_modules")) && !force) {
    log(`node_modules present in ${cwd}; skipping npm ci (--force-install to reinstall)`);
    return;
  }
  if (!(await confirmYes(`Install npm dependencies in ${cwd} (may take a while)`))) {
    die("dependencies are required; rerun with --force-install or install manually");
  }
  log(`npm ci in ${cwd}`);
  runSync(npm, ["ci"], { cwd, shell: isWin });
}

function checkPrerequisites() {
  log("[1/5] Checking prerequisites (node, npm, cargo, python3, git)");
  const probes = [["node", "--version"], [npm, "--version"], ["cargo", "--version"], ["git", "--version"]];
  for (const [tool, flag] of probes) {
    const probe = spawnSync(tool, [flag], { stdio: "ignore" });
    if (probe.status !== 0) die(`missing required tool: ${tool}`);
  }
  const python = ["python3", "python"].find((candidate) => spawnSync(candidate, ["--version"], { stdio: "ignore" }).status === 0);
  if (!python) die("missing required tool: python3/python");
  if (!isWin && python !== "python3") {
    log(`using ${python} as the Python interpreter`);
  }
}

async function prepare() {
  checkPrerequisites();
  log("[2/5] Installing npm dependencies");
  npmInstall(join(repo, "tools", "template-authoring"), forceInstall);
  npmInstall(join(repo, "tools", "template-authoring", "workbench"), forceInstall);
  if (installE2e) {
    log("Installing Playwright chromium (for e2e)");
    runSync(npx(), ["playwright", "install", "chromium"], { cwd: join(repo, "tools", "template-authoring", "workbench"), shell: isWin });
  }
  log("[3/5] Building the Rust core");
  runSync("cargo", ["build", "-p", "gewu-cli"], { cwd: repo });
  log("[4/5] Configuring the LLM provider");
  await ensureEnv();
  log("[5/5] Setup complete");
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

async function ensureEnv() {
  log("Ensuring authoring environment (.env.local)");
  if (!existsSync(envFile)) {
    copyFileSync(envExample, envFile);
    log(`Created ${envFile} from .env.example`);
  }
  let content = readFileSync(envFile, "utf8");
  const currentProvider = /^GEWU_LLM_PROVIDER=(\S+)/m.exec(content)?.[1] ?? "deepseek";
  const currentModel = /^GEWU_LLM_MODEL=(\S+)/m.exec(content)?.[1] ?? "deepseek-v4-flash";

  if (selectedProvider && !PROVIDER_ENV[selectedProvider]) die(`unsupported provider: ${selectedProvider} (use one of: ${Object.keys(PROVIDER_ENV).join(", ")})`);

  let provider = selectedProvider;
  let model = selectedModel;
  let key = apiKeyValue;
  const interactive = !provider && !key;

  if (interactive && !keyOverride && /^[A-Z_]+_API_KEY=[^ \t]+/m.test(content)) {
    log(`already configured: provider=${currentProvider} model=${currentModel} (API key present). Use --key to reconfigure.`);
    return;
  }

  if (interactive) {
    const providerAnswer = await ask(`Provider [${Object.keys(PROVIDER_ENV).join("|")}] (default ${currentProvider}): `, currentProvider);
    provider = providerAnswer;
    if (!PROVIDER_ENV[provider]) die(`unsupported provider: ${provider}`);
    const models = await loadModels(provider);
    const modelQuestion = models.length
      ? `Model (${models.map((id, index) => `${index + 1}: ${id}`).join(", ")}; default ${currentModel}): `
      : "Model id (pi-ai catalog unavailable; type an id): ";
    const modelAnswer = await ask(modelQuestion, currentModel);
    const modelIndex = Number(modelAnswer);
    model = Number.isInteger(modelIndex) && modelIndex >= 1 && modelIndex <= models.length ? models[modelIndex - 1] : modelAnswer;
    key = await askHidden(`${PROVIDER_ENV[provider]} (input hidden): `);
  } else if (!key && (provider || selectedModel)) {
    key = await askHidden(`${PROVIDER_ENV[provider ?? currentProvider]} (input hidden): `);
  }

  if (!key) die("API key cannot be empty");
  const envVar = PROVIDER_ENV[provider ?? currentProvider];
  content = writeEnvVar(content, "GEWU_LLM_PROVIDER", provider ?? currentProvider);
  content = writeEnvVar(content, "GEWU_LLM_MODEL", model ?? currentModel);
  content = writeEnvVar(content, envVar, key);
  writeFileSync(envFile, content, { mode: 0o600 });
  if (!isWin) chmodSync(envFile, 0o600);
  log(`${envVar} and GEWU_LLM_PROVIDER/MODEL written to .env.local (mode 600)`);
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

function stopAll() {
  log("Stopping GEWU dev processes");
  if (!existsSync(pidDir)) return;
  for (const name of readdirSync(pidDir)) {
    const pid = Number(readFileSync(join(pidDir, name), "utf8"));
    if (Number.isInteger(pid) && pid > 0) killTree(pid);
    rmSync(join(pidDir, name), { force: true });
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
  const child = spawn(list[0], list.slice(1), {
    cwd: repo,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  });
  const stream = createWriteStream(logPath, { flags: "a" });
  child.stdout.pipe(stream);
  child.stderr.pipe(stream);
  writeFileSync(join(pidDir, `${name}.pid`), String(child.pid));
  log(`started ${name} (pid ${child.pid}) -> ${logPath}`);
  return child.pid;
}

async function doStart() {
  log("GEWU dev setup plan:");
  log("  1/5 prerequisites -> 2/5 npm deps -> 3/5 core build -> 4/5 LLM config -> 5/5 start services");
  checkPrerequisites();
  log("[2/5] Installing npm dependencies");
  await npmInstall(join(repo, "tools", "template-authoring"), forceInstall);
  await npmInstall(join(repo, "tools", "template-authoring", "workbench"), forceInstall);
  log("[3/5] Building the Rust core");
  runSync("cargo", ["build", "-p", "gewu-cli"], { cwd: repo });
  log("[4/5] Configuring the LLM provider");
  await ensureEnv();
  log("[5/5] Starting services");
  for (;;) {
    if (await confirmYes(`Start with core=${corePort} api=${apiPort} web=${webPort}`)) break;
    corePort = await ask("core port (default 4175): ", "4175");
    apiPort = await ask("authoring API port (default 4174): ", "4174");
    webPort = await ask("web port (default 5173): ", "5173");
    for (const value of [corePort, apiPort, webPort]) {
      if (!/^\d{1,5}$/.test(value)) die(`invalid port: ${value}`);
    }
  }
  mkdirSync(join(devDir, "data"), { recursive: true });
  stopAll();

  startOne("core", [
    "cargo", "run", "-p", "gewu-cli", "--", "serve",
    "--port", corePort,
    "--content-root", "fixtures/algorithm-units/valid",
    "--content-root", "tools/template-authoring/drafts/.workbench/published",
    "--data-root", join(devDir, "data"),
  ], { cwd: repo });

  startOne("api", [npm, "run", "workbench:api:local"], {
    cwd: join(repo, "tools", "template-authoring"),
    shell: isWin,
    env: { ...process.env, GEWU_WORKBENCH_PORT: apiPort },
  });

  startOne("web", [npm, "run", "dev", "--", "--host", "127.0.0.1", "--port", webPort], {
    cwd: join(repo, "tools", "template-authoring", "workbench"),
    shell: isWin,
    env: { ...process.env, GEWU_CORE_PORT: corePort, GEWU_AUTHORING_PORT: apiPort },
  });

  await waitFor(`http://127.0.0.1:${corePort}/health`, "core", Number(readFileSync(join(pidDir, "core.pid"), "utf8")));
  await waitFor(`http://127.0.0.1:${apiPort}/api/drafts`, "authoring api", Number(readFileSync(join(pidDir, "api.pid"), "utf8")));
  await waitFor(`http://127.0.0.1:${webPort}`, "web client", Number(readFileSync(join(pidDir, "web.pid"), "utf8")));

  console.log(`\n\x1b[32mGEWU dev stack is up:\x1b[0m
  core  http://127.0.0.1:${corePort}
  api   http://127.0.0.1:${apiPort}
  web   http://127.0.0.1:${webPort}
Stop with Ctrl+C, or run npm run dev:stop from another terminal.`);
}

function keepAlive() {
  process.on("SIGINT", () => {
    stopAll();
    process.exit(0);
  });
  process.on("SIGTERM", () => {
    stopAll();
    process.exit(0);
  });
  process.on("exit", stopAll);
}

if (command === "help") {
  usage();
} else if (command === "prepare") {
  await prepare();
} else if (command === "stop") {
  stopAll();
} else if (command === "restart" || command === "start") {
  keepAlive();
  await doStart();
  if (isTTY) {
    await ask("\nPress Enter to stop all GEWU services...", "");
    stopAll();
    process.exit(0);
  } else {
    await new Promise(() => {});
  }
}
