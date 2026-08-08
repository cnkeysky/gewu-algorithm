import assert from "node:assert/strict";
import test from "node:test";
import {
  applyTrustedDraftState,
  applyTrustedProvenance,
  GENERIC_INSTRUCTION,
} from "./generate-template.js";
import { redactSecretLikeText, validateGenerationProfile } from "./pi-generator.js";

function validDraft(): Record<string, unknown> {
  return {
    manifest: {
      schema_version: "2",
      id: "graph.topological-sort",
      revision: 1,
      status: "draft",
      title: "Kahn Topological Sort",
      tags: ["graph"],
      position: {},
      problem: { statement: "Given a directed graph, return a topological order or report a cycle.", question: "How can dependencies be ordered?", scope: ["directed graphs"], out_of_scope: [] },
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

test("generic instruction is algorithm-agnostic", () => {
  assert.doesNotMatch(GENERIC_INSTRUCTION, /Kahn|binary search|topological_order|breadth-?first|shortest path|sorting algorithm/i);
  assert.match(GENERIC_INSTRUCTION, /infer .* from the (problem text|text)/i);
  assert.match(GENERIC_INSTRUCTION, /lowercase slugs/);
  assert.match(GENERIC_INSTRUCTION, /code\/python\.py/);
  assert.match(GENERIC_INSTRUCTION, /importlib\.util\.spec_from_file_location/);
});

test("generation profile rejects assistance without code recall", () => {
  assert.throws(() => validateGenerationProfile({
    practice_modes: ["shadow_typing"],
    code_recall_assistance: ["comments"],
    code_recall_layouts: [],
    implementation_languages: ["python"],
    implementation_variants: 1,
  }), /code recall assistance/);
});

test("credential-like provider text is redacted from surfaced errors", () => {
  assert.equal(
    redactSecretLikeText("Pi-ai error with sk-abcdef1234567890 and key-0987654321fedcba"),
    "Pi-ai error with [REDACTED] and [REDACTED]",
  );
  assert.equal(redactSecretLikeText("no secret here"), "no secret here");
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
