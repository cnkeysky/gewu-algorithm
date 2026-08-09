import assert from "node:assert/strict";
import test from "node:test";
import { isRelayProvider, providerEntry, providerRegistry, relayBaseUrl } from "./provider-registry.js";

test("built-in providers and their key env vars come from Pi-ai, not hardcoding", () => {
  const registry = providerRegistry();
  assert.ok(registry.has("deepseek"));
  assert.ok(registry.has("openai"));
  assert.ok(registry.has("moonshotai"));
  assert.ok(registry.has("xiaomi"));
  // Labels/ids come from the Pi package; keyEnv is Pi's findEnvKeys result,
  // which only reports the env var when the key is actually configured.
  assert.equal(registry.get("deepseek")?.label, "DeepSeek");
  assert.equal(registry.get("deepseek")?.source, "pi");
  assert.equal(registry.get("deepseek")?.keyEnv, undefined);
  assert.equal(registry.get("moonshotai")?.kind, "builtin");
  assert.equal(isRelayProvider("deepseek"), false);
});

test("relay entry maps to our OpenAI-compatible relay support", () => {
  const relay = providerEntry("relay");
  assert.ok(relay);
  assert.equal(relay!.kind, "relay");
  assert.equal(relay!.keyEnv, "GEWU_LLM_API_KEY");
  assert.equal(relay!.baseUrlEnv, "GEWU_LLM_BASE_URL");
  assert.equal(isRelayProvider("relay"), true);
  assert.equal(relayBaseUrl(relay!, { GEWU_LLM_BASE_URL: "https://api.example.com/v1" }), "https://api.example.com/v1");
  assert.equal(relayBaseUrl(relay!, {}), undefined);
});

test("relay entries are the only thing providers.json declares", () => {
  // providers.json only holds our relay extension; builtins derive from Pi.
  const registry = providerRegistry();
  assert.ok(registry.has("relay"));
  const relays = [...registry.values()].filter((entry) => entry.kind === "relay");
  assert.ok(relays.length >= 1);
  assert.equal(relays.every((entry) => entry.source === "relay" && entry.baseUrlEnv), true);
  const builtins = [...registry.values()].filter((entry) => entry.kind === "builtin");
  assert.ok(builtins.length > 10, `expected Pi to provide many built-ins, got ${builtins.length}`);
  assert.ok(builtins.length > relays.length);
  assert.equal(builtins.every((entry) => entry.source === "pi"), true);
});
