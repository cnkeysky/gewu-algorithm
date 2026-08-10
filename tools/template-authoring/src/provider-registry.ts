/**
 * Provider registry (single source of truth for AI providers).
 *
 * **Built-in providers come from Pi-ai** (ids, labels, key env vars via
 * `getBuiltinProviders` / `builtinProviders` / `findEnvKeys`) — vendor
 * changes are handled by updating the Pi package, never by hardcoding a
 * mapping here.
 *
 * **Relay providers are our OpenAI-compatible extension** and live in
 * `providers.json` as key-value entries: id -> { label, kind: "relay",
 * keyEnv, baseUrlEnv, wireApi?, opencodeHeaders? }. Adding a named relay is
 * data-only.
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { builtinProviders, getBuiltinProviders } from "@earendil-works/pi-ai/providers/all";
import { findEnvKeys } from "@earendil-works/pi-ai/compat";

export type ProviderKind = "builtin" | "relay";
export type WireApi = "chat" | "responses";

export interface ProviderEntry {
  id: string;
  label: string;
  kind: ProviderKind;
  keyEnv?: string;
  baseUrlEnv?: string;
  /** Wire protocol for relay providers: "chat" (openai-completions, default)
   * or "responses" (OpenAI Responses API, used by Codex-style gateways). */
  wireApi?: WireApi;
  /** Adds opencode-style x-opencode-session / x-opencode-request headers,
   * recommended by some Codex-style gateways (providers.json opt-in). */
  opencodeHeaders?: boolean;
  source: "pi" | "relay";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

let cached: Map<string, ProviderEntry> | undefined;

/** Loads the provider registry (cached; the JSON is static at runtime). */
export function providerRegistry(): Map<string, ProviderEntry> {
  if (cached) return cached;
  const entries = new Map<string, ProviderEntry>();
  // Built-ins are derived from Pi-ai: the package owns the ids, display
  // names, models, and key env conventions, so vendor updates are a `npm
  // update` away.
  const names = new Map((builtinProviders() ?? []).map((provider) => [provider.id, provider.name]));
  for (const id of getBuiltinProviders()) {
    const keys = findEnvKeys(id);
    entries.set(id, {
      id,
      label: names.get(id) ?? id,
      kind: "builtin",
      keyEnv: keys?.[0],
      source: "pi",
    });
  }
  // Relays are our extension, declared in providers.json (data-only).
  const registryPath = resolve(dirname(fileURLToPath(import.meta.url)), "../providers.json");
  const raw = JSON.parse(readFileSync(registryPath, "utf8")) as unknown;
  if (!isRecord(raw)) throw new Error("providers.json must be an object of provider entries");
  for (const [id, value] of Object.entries(raw)) {
    if (!isRecord(value)) throw new Error(`provider ${id} must be an object`);
    const kind = value.kind;
    if (kind !== "relay") throw new Error(`providers.json may only declare relay providers; ${id} has kind ${String(kind)}`);
    if (typeof value.label !== "string" || typeof value.keyEnv !== "string") {
      throw new Error(`provider ${id} requires label and keyEnv`);
    }
    if (typeof value.baseUrlEnv !== "string") {
      throw new Error(`relay provider ${id} requires baseUrlEnv`);
    }
    entries.set(id, {
      id,
      label: value.label,
      kind,
      keyEnv: value.keyEnv,
      baseUrlEnv: value.baseUrlEnv,
      wireApi: value.wireApi === "responses" ? "responses" : "chat",
      opencodeHeaders: value.opencodeHeaders === true,
      source: "relay",
    });
  }
  cached = entries;
  return cached;
}

export function providerEntry(id: string): ProviderEntry | undefined {
  return providerRegistry().get(id);
}

export function isRelayProvider(id: string): boolean {
  return providerEntry(id)?.kind === "relay";
}

/** Resolves a relay provider's configured base URL from the environment. */
export function relayBaseUrl(entry: ProviderEntry, environment: Record<string, string | undefined>): string | undefined {
  if (entry.kind !== "relay" || !entry.baseUrlEnv) return undefined;
  const value = environment[entry.baseUrlEnv];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
