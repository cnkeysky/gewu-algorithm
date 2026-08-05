import { createHash, randomUUID } from "node:crypto";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { PiGenerator, optionsFromEnvironment, type DraftTask, type GenerationProfile } from "./pi-generator.js";

const FIXED_INPUT = `Create a GEWU AlgorithmUnit for Kahn's topological sorting algorithm.
The learning target is a directed graph represented as graph: list[list[int]], where vertex IDs
are exactly 0 through len(graph) - 1 and graph[u] lists u's outgoing neighbors. The implementation
must expose Python function topological_order(graph: list[list[int]]) -> list[int]. It returns the
FIFO-deterministic topological ordering, or an empty list when the graph contains a cycle. Do not
use a dictionary adjacency representation or arbitrary vertex labels. Use a FIFO queue for
zero-indegree vertices and preserve the order in which vertices become ready. This is a new
algorithm task; do not copy BFS or binary-search content from any repository fixture.`;

const REQUIRED_PRACTICE_SHAPE = `The manifest.practice field is an OBJECT, never an array. It must use this exact nesting:
"practice": {
  "shadow_typing": [{"implementation": "python-teaching", "strict": true}],
  "flow_recall": {"steps": [{"id": "a-lowercase-slug", "prompt": "nonempty", "concepts": ["lowercase-slug"], "aliases": ["optional nonempty text"]}]},
  "code_recall": [
    {"id": "comments-recall", "implementation": "python-teaching", "assistance": "comments", "prompt": "nonempty", "scaffold": ["nonempty comment"]},
    {"id": "no-hints-recall", "implementation": "python-teaching", "assistance": "none", "prompt": "nonempty", "scaffold": []}
  ],
  "reasoning_recall": [{"id": "reasoning-slug", "aspect": "invariant", "prompt": "nonempty", "concepts": ["lowercase-slug"], "aliases": ["optional nonempty text"]}],
  "transfer_practice": [{"id": "transfer-slug", "pattern": "a-declared-pattern-id", "new_case": "nonempty", "prompt": "nonempty", "concepts": ["lowercase-slug"], "transfers": ["nonempty"], "differences": ["nonempty"], "boundaries": ["nonempty"]}]
}`;

const REQUIRED_MANIFEST_FIELDS = `Every object must contain only the named fields below; do not invent fields such as "order", "type" on a practice item, or "description".
"position": {"domain": "lowercase-slug", "category": "lowercase-slug", "prerequisites": ["dotted.lowercase-id"]}
"problem": {"question": "nonempty", "scope": ["nonempty"], "out_of_scope": ["nonempty"]}
"understanding": {"summary": "nonempty", "confidence": "low|medium|high", "alternatives": ["nonempty"], "failure_conditions": ["nonempty"]}
"implementations": [{"key": "python-teaching", "language": "python", "source": "code/python.py", "purpose": "teaching", "strategy": "kahn-fifo-frontier", "complexity": {"time": "O(V + E)", "space": "O(V)"}, "assumptions": ["vertices are numbered 0 through n-1"], "test_references": ["tests/python_test.py"], "normalization": {"line_endings": "lf", "trailing_newline": true, "whitespace": "strict"}}]
"patterns": [{"id": "lowercase-slug", "summary": "nonempty", "applicability": ["nonempty"], "boundaries": ["nonempty"]}]
"relationships": [{"target": "dotted.lowercase-id", "type": "contrasts_with", "reason": "nonempty", "boundary": "nonempty"}]
"validation": {"schema": "pending", "code": "pending", "content_review": "pending", "transfer_review": "pending", "last_validated_at": null}
"provenance": {"authors": ["nonempty"], "generated_by": {"provider": "deepseek", "model": "deepseek-v4-flash", "task_version": "3", "generated_at": "ISO-8601"}, "reviewed_by": [], "sources": [], "license": "MIT"}
"supersedes": []`;

const OUTPUT_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["manifest", "sources"],
  properties: {
    manifest: {
      type: "object",
      additionalProperties: false,
      required: [
        "schema_version", "id", "revision", "status", "title", "tags", "position",
        "problem", "understanding", "implementations", "patterns", "relationships",
        "practice", "validation", "provenance", "supersedes",
      ],
      properties: {
        schema_version: { const: "1" },
        id: { type: "string" },
        revision: { type: "integer", minimum: 1 },
        status: { const: "draft" },
        title: { type: "string" },
        tags: { type: "array", items: { type: "string" } },
        position: {
          type: "object",
          additionalProperties: false,
          required: ["domain", "category", "prerequisites"],
          properties: {
            domain: { type: "string" },
            category: { type: "string" },
            prerequisites: { type: "array", items: { type: "string" } },
          },
        },
        problem: {
          type: "object",
          additionalProperties: false,
          required: ["question", "scope", "out_of_scope"],
          properties: {
            question: { type: "string" },
            scope: { type: "array", items: { type: "string" } },
            out_of_scope: { type: "array", items: { type: "string" } },
          },
        },
        understanding: {
          type: "object",
          additionalProperties: false,
          required: ["summary", "confidence", "alternatives", "failure_conditions"],
          properties: {
            summary: { type: "string" },
            confidence: { enum: ["low", "medium", "high"] },
            alternatives: { type: "array", items: { type: "string" } },
            failure_conditions: { type: "array", items: { type: "string" } },
          },
        },
        implementations: {
          type: "array", minItems: 1,
          items: {
            type: "object", additionalProperties: false,
            required: ["key", "language", "source", "purpose", "strategy", "complexity", "assumptions", "test_references", "normalization"],
            properties: {
              key: { type: "string" }, language: { type: "string" }, source: { type: "string" },
              purpose: { type: "string" }, strategy: { type: "string" },
              complexity: { type: "object", additionalProperties: false, required: ["time", "space"], properties: { time: { type: "string" }, space: { type: "string" } } },
              assumptions: { type: "array", items: { type: "string" } },
              test_references: { type: "array", items: { type: "string" } },
              normalization: { type: "object" },
            },
          },
        },
        patterns: { type: "array", minItems: 1 },
        relationships: { type: "array" },
        practice: { type: "object" },
        validation: { type: "object" },
        provenance: { type: "object" },
        supersedes: { type: "array" },
      },
    },
    sources: {
      type: "object",
      minProperties: 2,
      additionalProperties: { type: "string", minLength: 1 },
    },
  },
};

type GeneratedTemplate = {
  readonly manifest: Record<string, unknown>;
  readonly sources: Record<string, unknown>;
};

export const task: DraftTask = {
  taskId: "algorithm-unit-topological-sort-kahn",
  taskVersion: "3",
  selectedInputHash: `sha256:${createHash("sha256").update(FIXED_INPUT).digest("hex")}`,
  instruction: `${FIXED_INPUT}

Return exactly one JSON object with this shape:
{
  "manifest": <complete AlgorithmUnit manifest>,
  "sources": {"code/python.py": <complete Python source string>, "tests/python_test.py": <complete pytest source string>}
}

The manifest must be schema_version "1", status "draft", and use only these enum values:
confidence low|medium|high; relationship type depends_on|influences|analogous_to|contrasts_with|composes_with|generalizes|specializes|supersedes;
code recall assistance skeleton|comments|keywords|cloze|none; reasoning aspect mechanism|invariant|trade_off|boundary|failure_condition;
validation checks pending. Use a single implementation with key "python-teaching", language "python",
source "code/python.py", purpose "teaching", strategy/complexity/assumptions metadata,
test reference "tests/python_test.py", and strict LF/strict-whitespace normalization.
Include shadow typing, at least three flow recall steps, one comments-assisted code recall, one no-hints
code recall, one reasoning recall, one declared pattern and one transfer practice referencing that pattern.
Set provenance.generated_by to provider/model/task_version/generated_at and leave review checks pending.
Do not include markdown fences, explanatory prose, or unknown fields. All IDs and tags must be lowercase slugs;
the unit id must be a dotted lowercase id such as "graph.topological-sort".

${REQUIRED_PRACTICE_SHAPE}

${REQUIRED_MANIFEST_FIELDS}`,
  outputSchema: OUTPUT_SCHEMA,
  profile: {
    practice_modes: ["shadow_typing", "flow_recall", "code_recall", "reasoning_recall", "transfer_practice"],
    code_recall_assistance: ["comments", "none"],
    implementation_languages: ["python"],
    implementation_variants: 1,
  } satisfies GenerationProfile,
};

export function assertGeneratedTemplate(value: unknown): asserts value is GeneratedTemplate {
  if (!isRecord(value) || !isRecord(value.manifest) || !isRecord(value.sources)) {
    throw new Error("draft must contain manifest and sources objects");
  }
  const manifest = value.manifest;
  const required = [
    "schema_version", "id", "revision", "status", "title", "tags", "position", "problem",
    "understanding", "implementations", "patterns", "relationships", "practice", "validation",
    "provenance", "supersedes",
  ];
  for (const key of required) {
    if (!(key in manifest)) throw new Error(`manifest is missing required field ${key}`);
  }
  if (manifest.schema_version !== "1" || manifest.status !== "draft") {
    throw new Error("manifest must remain schema version 1 and draft status");
  }
  if (typeof manifest.id !== "string" || !/^[a-z0-9]+(?:[.-][a-z0-9]+)+$/.test(manifest.id)) {
    throw new Error("manifest.id must be a dotted lowercase identifier");
  }
  if (!Array.isArray(manifest.implementations) || manifest.implementations.length === 0) {
    throw new Error("manifest must declare at least one implementation");
  }
  if (manifest.implementations.length !== 1) {
    throw new Error("this fixed task must declare exactly one implementation");
  }
  const expectedImplementation = manifest.implementations[0];
  if (!isRecord(expectedImplementation)
    || expectedImplementation.key !== "python-teaching"
    || expectedImplementation.language !== "python"
    || expectedImplementation.source !== "code/python.py"
    || expectedImplementation.purpose !== "teaching"
    || typeof expectedImplementation.strategy !== "string"
    || !isRecord(expectedImplementation.complexity)
    || !Array.isArray(expectedImplementation.assumptions)
    || !Array.isArray(expectedImplementation.test_references)
    || !expectedImplementation.test_references.includes("tests/python_test.py")) {
    throw new Error("this fixed task must use the declared Python teaching implementation");
  }
  const sourcePaths = new Set<string>();
  for (const [source, content] of Object.entries(value.sources)) {
    if (!source || source.includes("\\") || source.startsWith("/") || source.split("/").includes("..")) {
      throw new Error(`source path is not portable or contained: ${source}`);
    }
    if (typeof content !== "string" || content.trim().length === 0) {
      throw new Error(`source content is empty: ${source}`);
    }
    sourcePaths.add(source);
  }
  for (const implementation of manifest.implementations) {
    if (!isRecord(implementation) || typeof implementation.source !== "string") {
      throw new Error("each implementation must declare a source path");
    }
    if (!sourcePaths.has(implementation.source)) {
      throw new Error(`implementation source is not returned: ${implementation.source}`);
    }
    if (Array.isArray(implementation.test_references)) {
      for (const reference of implementation.test_references) {
        if (typeof reference !== "string" || !sourcePaths.has(reference))
          throw new Error(`implementation test reference is not returned: ${String(reference)}`);
      }
    }
  }
  const practice = manifest.practice;
  if (!isRecord(practice) || !Array.isArray(practice.shadow_typing) || practice.shadow_typing.length === 0) {
    throw new Error("manifest must declare shadow typing practice");
  }
  if (!isRecord(manifest.validation)
    || manifest.validation.schema !== "pending"
    || manifest.validation.code !== "pending"
    || manifest.validation.content_review !== "pending"
    || manifest.validation.transfer_review !== "pending") {
    throw new Error("generated drafts must leave every validation check pending");
  }
  if (!isRecord(manifest.provenance)) {
    throw new Error("generated drafts must include a provenance object");
  }
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function runChecked(command: string, args: string[], cwd: string): void {
  const result = spawnSync(command, args, { cwd, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`${command} validation failed:\n${result.stderr || result.stdout}`);
  }
}

const KAHN_SEMANTIC_CHECK = `import importlib.util, pathlib, sys
path = pathlib.Path(sys.argv[1])
spec = importlib.util.spec_from_file_location("generated_topological_sort", path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
assert module.topological_order([[1, 2], [3], [3], []]) == [0, 1, 2, 3]
assert module.topological_order([[1], [2], [0]]) == []
assert module.topological_order([]) == []`;

export function applyTrustedProvenance(
  manifest: Record<string, unknown>,
  provider: string,
  model: string,
  taskVersion: string,
  generatedAt: string,
): Record<string, unknown> {
  const existing = isRecord(manifest.provenance) ? manifest.provenance : {};
  return {
    ...manifest,
    provenance: {
      ...existing,
      generated_by: {
        provider,
        model,
        task_version: taskVersion,
        generated_at: generatedAt,
      },
    },
  };
}

export function applyTrustedDraftState(manifest: Record<string, unknown>): Record<string, unknown> {
  return {
    ...manifest,
    status: "draft",
    validation: {
      schema: "pending",
      code: "pending",
      content_review: "pending",
      transfer_review: "pending",
      last_validated_at: null,
    },
  };
}

export async function generateTemplateDraft(): Promise<void> {
  const generator = new PiGenerator(optionsFromEnvironment());
  const artifact = await generator.generate(task);
  if (!isRecord(artifact.manifest.manifest)) {
    throw new Error("draft manifest must be an object");
  }
  const generatedAt = new Date().toISOString();
  const trustedManifest = applyTrustedProvenance(
    applyTrustedDraftState(artifact.manifest.manifest),
    artifact.provider,
    artifact.model,
    artifact.taskVersion,
    generatedAt,
  );
  const trustedDraft = { ...artifact.manifest, manifest: trustedManifest };
  assertGeneratedTemplate(trustedDraft);

  const here = dirname(fileURLToPath(import.meta.url));
  const repoRoot = resolve(here, "../..", "..");
  const draftsRoot = resolve(here, "../drafts");
  const suffix = generatedAt.replaceAll(/[-:.TZ]/g, "");
  const finalRoot = join(draftsRoot, `topological-sort-kahn-r1-${suffix}`);
  const stagingRoot = join(draftsRoot, `.staging-${randomUUID()}`);
  await mkdir(stagingRoot, { recursive: true });
  try {
    const manifestPath = join(stagingRoot, "unit.json");
    await writeFile(manifestPath, `${JSON.stringify(trustedDraft.manifest, null, 2)}\n`, "utf8");
    for (const [source, content] of Object.entries(trustedDraft.sources)) {
      if (typeof content !== "string") throw new Error(`source content is not text: ${source}`);
      const destination = join(stagingRoot, source);
      await mkdir(dirname(destination), { recursive: true });
      await writeFile(destination, content, "utf8");
      const normalized = relative(stagingRoot, destination).split(sep).join("/");
      if (normalized !== source) throw new Error(`source escaped draft root: ${source}`);
    }
    await writeFile(
      join(stagingRoot, "generation.json"),
      `${JSON.stringify({
        task_id: artifact.taskId,
        task_version: artifact.taskVersion,
        selected_input_hash: artifact.selectedInputHash,
        provider: artifact.provider,
        model: artifact.model,
        generated_at: generatedAt,
        review: artifact.review,
        local_shape_validation: "passed",
      }, null, 2)}\n`,
      "utf8",
    );

    const sourcePath = join(stagingRoot, "code/python.py");
    runChecked("python3", ["-c", "import pathlib,sys; compile(pathlib.Path(sys.argv[1]).read_text(), sys.argv[1], 'exec')", sourcePath], repoRoot);
    runChecked("python3", ["-c", KAHN_SEMANTIC_CHECK, sourcePath], repoRoot);
    runChecked(
      "cargo",
      ["run", "--quiet", "--manifest-path", join(repoRoot, "Cargo.toml"), "-p", "gewu-template", "--bin", "validate", "--", manifestPath],
      repoRoot,
    );
    await rename(stagingRoot, finalRoot);
  } catch (error) {
    await rm(stagingRoot, { recursive: true, force: true });
    throw error;
  }

  console.log(JSON.stringify({
    status: "draft",
    provider: artifact.provider,
    model: artifact.model,
    taskId: artifact.taskId,
    output: relative(repoRoot, finalRoot),
    localShapeValidation: "passed",
    sourceValidation: "passed",
    semanticValidation: "passed",
    contractValidation: "passed",
    review: "pending",
  }));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  generateTemplateDraft().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
