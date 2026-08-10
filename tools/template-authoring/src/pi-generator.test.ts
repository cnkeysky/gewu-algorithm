import assert from "node:assert/strict";
import test from "node:test";
import { buildRelayHeaders, isTransientPiError, resolveProxyOptions, validateGenerationProfile, type GenerationProfile } from "./pi-generator.js";

const BASE: GenerationProfile = {
  practice_modes: ["shadow_typing"],
  code_recall_assistance: [],
  code_recall_layouts: [],
  implementation_languages: ["python"],
  implementation_variants: 0,
};

test("generation profile accepts zero variants as auto and rejects negatives", () => {
  validateGenerationProfile(BASE);
  validateGenerationProfile({ ...BASE, implementation_variants: 2 });
  assert.throws(() => validateGenerationProfile({ ...BASE, implementation_variants: -1 }), /0 \(auto\)/);
});

test("transient gateway errors are retried, hard blocks fail fast", () => {
  assert.equal(isTransientPiError("HTTP 429 Too Many Requests"), true);
  assert.equal(isTransientPiError("upstream 500 Internal Server Error"), true);
  assert.equal(isTransientPiError("socket hang up ETIMEDOUT"), true);
  assert.equal(isTransientPiError("Stream ended without finish_reason"), true);
  assert.equal(isTransientPiError("400: {\"message\":\"No tool call found for function call output\",\"type\":\"api_error\"}"), true);
  assert.equal(isTransientPiError(undefined), false);
  assert.equal(isTransientPiError("403 <!DOCTYPE html> Cloudflare blocked"), false);
  assert.equal(isTransientPiError("401 authentication failed"), false);
  assert.equal(isTransientPiError("invalid_request_error: Thinking mode does not support this tool_choice"), false);
  assert.equal(isTransientPiError("insufficient_quota"), false);
});

test("relay headers strip SDK fingerprints and set a neutral user agent", () => {
  const headers = buildRelayHeaders(
    { "x-stainless-package-version": "1.2.3", "x-stainless-os": "Linux", accept: "application/json" },
    "session-1",
    3,
    false,
  );
  assert.equal(headers.get("user-agent"), "gewu-template-authoring/relay");
  assert.equal(headers.get("accept"), "application/json");
  assert.equal(headers.has("x-stainless-package-version"), false);
  assert.equal(headers.has("x-stainless-os"), false);
});

test("opencode session/request headers are opt-in per provider", () => {
  const off = buildRelayHeaders(undefined, "session-1", 5, false);
  assert.equal(off.has("x-opencode-session"), false);
  assert.equal(off.has("x-opencode-request"), false);

  const on = buildRelayHeaders(undefined, "session-2", 7, true);
  assert.equal(on.get("x-opencode-session"), "session-2");
  assert.equal(on.get("x-opencode-request"), "7");
});

test("GEWU_LLM_PROXY overrides the proxy explicitly; otherwise env defaults apply", () => {
  assert.equal(resolveProxyOptions({}), undefined);
  assert.equal(resolveProxyOptions({ HTTPS_PROXY: "http://127.0.0.1:7890" }), undefined);
  assert.deepEqual(
    resolveProxyOptions({ GEWU_LLM_PROXY: "http://proxy.example:8080", HTTPS_PROXY: "http://127.0.0.1:7890" }),
    { httpProxy: "http://proxy.example:8080", httpsProxy: "http://proxy.example:8080" },
  );
  assert.equal(resolveProxyOptions({ GEWU_LLM_PROXY: "  " }), undefined);
});
