import assert from "node:assert/strict";
import test from "node:test";
import {
  applyTrustedDraftState,
  applyTrustedProvenance,
  assertGeneratedTemplate,
  task,
} from "./generate-template.js";

function validDraft(): Record<string, unknown> {
  return {
    manifest: {
      schema_version: "1",
      id: "graph.topological-sort",
      revision: 1,
      status: "draft",
      title: "Kahn Topological Sort",
      tags: ["graph"],
      position: {},
      problem: {},
      understanding: {},
      implementations: [{
        key: "python-teaching",
        language: "python",
        source: "code/python.py",
        purpose: "teaching",
        strategy: "kahn-fifo-frontier",
        complexity: { time: "O(V + E)", space: "O(V)" },
        assumptions: ["vertices are numbered 0 through n-1"],
        test_references: ["tests/python_test.py"],
      }],
      patterns: [],
      relationships: [],
      practice: { shadow_typing: [{}] },
      validation: {
        schema: "pending",
        code: "pending",
        content_review: "pending",
        transfer_review: "pending",
      },
      provenance: { generated_by: { provider: "untrusted" } },
      supersedes: [],
    },
    sources: {
      "code/python.py": "def topological_order(graph):\n    return []\n",
      "tests/python_test.py": "def test_placeholder():\n    assert True\n",
    },
  };
}

test("fixed task uses a stable selected-input hash and a non-fixture algorithm", () => {
  assert.match(task.selectedInputHash, /^sha256:[0-9a-f]{64}$/);
  assert.match(task.instruction, /Kahn's topological sorting/);
  assert.match(task.instruction, /list\[list\[int\]\]/);
  assert.doesNotMatch(task.instruction, /Breadth-First Search/);
});

test("local validator accepts a contained pending draft", () => {
  assert.doesNotThrow(() => assertGeneratedTemplate(validDraft()));
});

test("local validator rejects a source path that traverses outside the draft", () => {
  const draft = validDraft();
  const sources = draft.sources as Record<string, unknown>;
  sources["../outside.py"] = "print('unsafe')";
  assert.throws(() => assertGeneratedTemplate(draft), /not portable or contained/);
});

test("local validator rejects the legacy generic practice array shape", () => {
  const draft = validDraft();
  const manifest = draft.manifest as Record<string, unknown>;
  manifest.practice = [];
  assert.throws(() => assertGeneratedTemplate(draft), /shadow typing practice/);
});

test("adapter overwrites model supplied provenance", () => {
  const manifest = validDraft().manifest as Record<string, unknown>;
  const trusted = applyTrustedProvenance(
    manifest,
    "deepseek",
    "deepseek-v4-flash",
    "1",
    "2026-08-05T00:00:00.000Z",
  );
  const provenance = trusted.provenance as Record<string, Record<string, string>>;
  assert.deepEqual(provenance.generated_by, {
    provider: "deepseek",
    model: "deepseek-v4-flash",
    task_version: "1",
    generated_at: "2026-08-05T00:00:00.000Z",
  });
});

test("adapter overwrites model supplied lifecycle and validation claims", () => {
  const manifest = validDraft().manifest as Record<string, unknown>;
  manifest.status = "validated";
  manifest.validation = {
    schema: "passed",
    code: "passed",
    content_review: "passed",
    transfer_review: "passed",
  };
  const trusted = applyTrustedDraftState(manifest);
  assert.equal(trusted.status, "draft");
  assert.deepEqual(trusted.validation, {
    schema: "pending",
    code: "pending",
    content_review: "pending",
    transfer_review: "pending",
    last_validated_at: null,
  });
});
