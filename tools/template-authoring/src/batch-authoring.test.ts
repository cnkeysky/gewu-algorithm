import assert from "node:assert/strict";
import test from "node:test";
import { defaultApproverSpec, parseOptions } from "./batch-authoring.js";

test("parseOptions defaults to all steps and all five practice modes", () => {
  const options = parseOptions(["--problems", "problems.json"]);
  assert.deepEqual([...options.steps].sort(), ["accept", "draft", "generate", "review", "validate"]);
  assert.deepEqual(options.modes, ["shadow_typing", "flow_recall", "code_recall", "reasoning_recall", "transfer_practice"]);
});

test("default approver follows env provider/model, then flags, then built-in", () => {
  assert.equal(defaultApproverSpec({}, { GEWU_LLM_PROVIDER: "relay", GEWU_LLM_MODEL: "deepseek-v4-flash" }), "relay:deepseek-v4-flash");
  assert.equal(defaultApproverSpec({ provider: "moonshotai", model: "kimi-k2" }, {}), "moonshotai:kimi-k2");
  assert.equal(defaultApproverSpec({}, {}), "deepseek:deepseek-v4-flash");
});
