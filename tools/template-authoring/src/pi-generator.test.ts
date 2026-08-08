import assert from "node:assert/strict";
import test from "node:test";
import { validateGenerationProfile, type GenerationProfile } from "./pi-generator.js";

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
