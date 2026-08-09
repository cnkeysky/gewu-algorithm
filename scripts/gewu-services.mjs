// Shared service discovery for the GEWU dev/batch runners.
// Services self-identify via /api/health ({status:"ok", storage:"local"}),
// so stop commands can find orphaned APIs even when pid/port traces are gone.
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const isWin = process.platform === "win32";

/** Every listening TCP port on localhost (Linux: /proc/net/tcp; Windows:
 * netstat), used to discover services without relying on trace files. */
export function listeningPorts() {
  if (isWin) {
    const out = spawnSync("netstat", ["-ano"], { encoding: "utf8" });
    const ports = new Set();
    for (const line of (out.stdout ?? "").split(/\r?\n/)) {
      const match = line.match(/TCP\s+[^:]+:(\d+)\s+\S+\s+LISTENING/i);
      if (match) ports.add(match[1]);
    }
    return [...ports];
  }
  const ports = new Set();
  for (const file of ["/proc/net/tcp", "/proc/net/tcp6"]) {
    let content = "";
    try {
      content = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    for (const line of content.split("\n").slice(1)) {
      const fields = line.trim().split(/\s+/);
      if (fields.length < 4 || fields[3] !== "0A") continue; // 0A = LISTEN
      const port = parseInt(fields[1].split(":")[1] ?? "", 16);
      if (Number.isInteger(port) && port > 0 && port < 65536) ports.add(String(port));
    }
  }
  return [...ports];
}

/** Ports whose /api/health advertises the GEWU authoring API signature. */
export async function authoringApiPorts() {
  const results = await Promise.all(listeningPorts().map(async (port) => {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(500) });
      if (!response.ok) return null;
      const body = await response.json().catch(() => null);
      if (body && body.status === "ok" && body.storage === "local") return port;
    } catch {
      // Not our API (or not HTTP); ignore.
    }
    return null;
  }));
  return results.filter((port) => port !== null);
}
