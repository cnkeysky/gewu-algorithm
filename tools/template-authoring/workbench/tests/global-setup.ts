import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const workbenchRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = resolve(workbenchRoot, "../../..");
const corePort = process.env.GEWU_E2E_CORE_PORT ?? "4185";
const webPort = process.env.GEWU_E2E_WEB_PORT ?? "5183";

async function waitFor(url: string, process: ChildProcess): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (process.exitCode !== null) throw new Error(`${url} server exited with code ${process.exitCode}`);
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(500) });
      if (response.ok) {
        if (process.exitCode !== null) throw new Error(`${url} server exited with code ${process.exitCode}`);
        return;
      }
    } catch {
      // The server is still compiling or binding its loopback port.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 150));
  }
  throw new Error(`timed out waiting for ${url}`);
}

function stop(process: ChildProcess): void {
  if (!process.pid || process.exitCode !== null) return;
  try {
    if (globalThis.process.platform === "win32") process.kill("SIGTERM");
    else globalThis.process.kill(-process.pid, "SIGTERM");
  } catch {
    // The process may have already exited after a failed test startup.
  }
}

export default async function globalSetup(): Promise<() => void> {
  const dataRoot = mkdtempSync(join(tmpdir(), "gewu-playwright-"));
  const core = spawn("cargo", [
    "run", "-p", "gewu-cli", "--", "serve",
    "--port", corePort,
    "--content-root", "fixtures/algorithm-units/valid",
    "--data-root", dataRoot,
  ], { cwd: repositoryRoot, detached: process.platform !== "win32", stdio: "inherit" });
  await waitFor(`http://127.0.0.1:${corePort}/health`, core);

  const web = spawn("npm", ["run", "dev", "--", "--host", "127.0.0.1", "--port", webPort], {
    cwd: workbenchRoot,
    env: { ...process.env, GEWU_CORE_PORT: corePort },
    detached: process.platform !== "win32",
    stdio: "inherit",
  });
  try {
    await waitFor(`http://127.0.0.1:${webPort}`, web);
  } catch (error) {
    stop(core);
    throw error;
  }

  return () => {
    stop(web);
    stop(core);
  };
}
