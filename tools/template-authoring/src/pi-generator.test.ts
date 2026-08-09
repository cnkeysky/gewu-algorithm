import assert from "node:assert/strict";
import test from "node:test";
import { isTransientPiError, validateGenerationProfile, type GenerationProfile } from "./pi-generator.js";

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
