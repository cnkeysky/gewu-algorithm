import { createHash, randomUUID } from "node:crypto";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { PiGenerator, optionsFromEnvironment, type DraftTask, type GenerationProfile } from "./pi-generator.js";

/**
 * Algorithm-agnostic generation instruction. It constrains only the GEWU
 * contract shape; every algorithm decision (domain, strategy, signatures,
 * complexity, patterns, projections) must be inferred from the author's input.
 */
export const GENERIC_INSTRUCTION = `Create one AlgorithmUnit for the problem. Infer domain, category, prerequisites, implementations, complexity, assumptions, tests, patterns, relationships, and practice projections from the text; do not invent an algorithm or signature beyond it.

Statement:
- problem.statement: complete learner-facing Markdown in your own words - rephrase the provided problem text rather than copying it verbatim (the input may be a third-party statement, e.g., LeetCode); keep all constraints, example values, formulas ($...$, $$...$$, \\(...\\), \\[...\\]), and image references; never leak the solution.
- Keep Markdown image references (https URLs or relative paths).

Identifiers:
- manifest id: dotted lowercase, at least one dot (array.two-sum).
- implementation keys and language ids: lowercase slugs (python-teaching, python).
- position.domain/category: lowercase slugs (array, two-pointers).
- position.prerequisites: dotted algorithm unit ids (array.two-sum).
- shadow_typing/code_recall implementation references must match implementations[].key.

Sources:
- Implementation source: code/python.py; tests: tests/python_test.py; include both in sources, reference tests in test_references.
- normalization: line_endings "lf", whitespace "strict".
- tests/python_test.py loads the implementation via importlib.util.spec_from_file_location from the unit root; never "from code.python import ...".

Practice:
- code_recall layouts: full_recall reconstructs the code; cloze/comment_guided use slots whose expected code appears verbatim in code/python.py (source_template is server-derived); comment_to_code provides ordered comments.
- assistance "none": empty scaffold; otherwise nonempty.
- Variants: distinct strategies only (different approaches or complexity trade-offs); usually one canonical solution, at most three; never cosmetic-only.
- shadow_typing: one item per strategy; flow_recall/code_recall/reasoning_recall/transfer_practice bind to the first implementation only - their variants are exercise formats, not new implementations.
- provenance.sources: cite the actual origin (title, URL, accessed_at) with role "primary", "synthesis", or "lead"; transfer/example arithmetic and indices must be correct.

Return only the schema fields.`;

export const OUTPUT_SCHEMA: Record<string, unknown> = {
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
        schema_version: { const: "2" },
        id: { type: "string", pattern: "^[a-z0-9]+(?:[.-][a-z0-9]+)+$" },
        revision: { type: "integer", minimum: 1 },
        status: { const: "draft" },
        title: { type: "string" },
        tags: { type: "array", items: { type: "string" } },
        position: {
          type: "object",
          additionalProperties: false,
          required: ["domain", "category", "prerequisites"],
          properties: {
            domain: { type: "string", pattern: "^[a-z0-9]+(-[a-z0-9]+)*$" },
            category: { type: "string", pattern: "^[a-z0-9]+(-[a-z0-9]+)*$" },
            prerequisites: { type: "array", items: { type: "string", pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*(?:\\.[a-z0-9]+(?:-[a-z0-9]+)*)+$" } },
          },
        },
        problem: {
          type: "object",
          additionalProperties: false,
          required: ["question", "statement", "scope", "out_of_scope"],
          properties: {
            question: { type: "string" },
            statement: { type: "string", minLength: 20 },
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
              purpose: { enum: ["teaching", "concise", "iterative", "recursive", "optimized"] }, strategy: { type: "string" },
              complexity: { type: "object", additionalProperties: false, required: ["time", "space"], properties: { time: { type: "string" }, space: { type: "string" } } },
              assumptions: { type: "array", items: { type: "string" } },
              test_references: { type: "array", items: { type: "string" } },
              normalization: {
                type: "object", additionalProperties: false,
                required: ["line_endings", "trailing_newline", "whitespace"],
                properties: {
                  line_endings: { const: "lf" },
                  trailing_newline: { type: "boolean" },
                  whitespace: { const: "strict" },
                },
              },
            },
          },
        },
        patterns: {
          type: "array", minItems: 1,
          items: {
            type: "object", additionalProperties: false,
            required: ["id", "summary", "applicability", "boundaries"],
            properties: {
              id: { type: "string" }, summary: { type: "string" },
              applicability: { type: "array", items: { type: "string" } },
              boundaries: { type: "array", items: { type: "string" } },
            },
          },
        },
        relationships: {
          type: "array",
          items: {
            type: "object", additionalProperties: false,
            required: ["target", "type", "reason", "boundary"],
            properties: {
              target: { type: "string", pattern: "^[a-z0-9]+(?:[.-][a-z0-9]+)+$" },
              type: { enum: ["depends_on", "influences", "analogous_to", "contrasts_with", "composes_with", "generalizes", "specializes", "supersedes"] },
              reason: { type: "string" }, boundary: { type: "string" },
            },
          },
        },
        practice: {
          type: "object", additionalProperties: false,
          required: ["shadow_typing", "flow_recall", "code_recall", "reasoning_recall", "transfer_practice"],
          properties: {
            shadow_typing: { type: "array", items: { type: "object", additionalProperties: false, required: ["implementation", "strict"], properties: { implementation: { type: "string" }, strict: { type: "boolean" } } } },
            flow_recall: { type: "object", additionalProperties: false, required: ["steps"], properties: { steps: { type: "array", items: { type: "object", additionalProperties: false, required: ["id", "prompt", "concepts", "aliases"], properties: { id: { type: "string" }, prompt: { type: "string" }, concepts: { type: "array", items: { type: "string" } }, aliases: { type: "array", items: { type: "string" } } } } } } },
            code_recall: { type: "array", items: { type: "object", additionalProperties: false, required: ["id", "implementation", "layout", "assistance", "prompt", "scaffold", "slots"], properties: { id: { type: "string" }, implementation: { type: "string" }, layout: { enum: ["full_recall", "comment_guided", "comment_to_code", "cloze"] }, assistance: { enum: ["skeleton", "comments", "keywords", "cloze", "none"] }, prompt: { type: "string" }, scaffold: { type: "array", items: { type: "string" } }, source_template: { type: "string" }, slots: { type: "array", items: { type: "object", additionalProperties: false, required: ["id", "expected"], properties: { id: { type: "string" }, cue: { type: "string" }, expected: { type: "string" } } } } } } },
            reasoning_recall: { type: "array", items: { type: "object", additionalProperties: false, required: ["id", "aspect", "prompt", "concepts", "aliases"], properties: { id: { type: "string" }, implementation: { type: "string" }, aspect: { enum: ["mechanism", "invariant", "trade_off", "boundary", "failure_condition"] }, prompt: { type: "string" }, concepts: { type: "array", items: { type: "string" } }, aliases: { type: "array", items: { type: "string" } } } } },
            transfer_practice: { type: "array", items: { type: "object", additionalProperties: false, required: ["id", "pattern", "new_case", "prompt", "concepts", "transfers", "differences", "boundaries"], properties: { id: { type: "string" }, implementation: { type: "string" }, pattern: { type: "string" }, new_case: { type: "string" }, prompt: { type: "string" }, concepts: { type: "array", items: { type: "string" } }, transfers: { type: "array", items: { type: "string" } }, differences: { type: "array", items: { type: "string" } }, boundaries: { type: "array", items: { type: "string" } } } } },
          },
        },
        validation: { type: "object", additionalProperties: false, required: ["schema", "code", "content_review", "transfer_review", "last_validated_at"], properties: { schema: { const: "pending" }, code: { const: "pending" }, content_review: { const: "pending" }, transfer_review: { const: "pending" }, last_validated_at: { type: ["string", "null"] } } },
        provenance: { type: "object", additionalProperties: false, required: ["authors", "generated_by", "reviewed_by", "sources", "license"], properties: { authors: { type: "array", items: { type: "string" } }, generated_by: { type: ["object", "null"], additionalProperties: false, required: ["provider", "model", "task_version", "generated_at"], properties: { provider: { type: "string" }, model: { type: "string" }, task_version: { type: "string" }, generated_at: { type: "string" } } }, reviewed_by: { type: "array", items: { type: "string" } }, sources: { type: "array", items: { type: "object", additionalProperties: false, required: ["title", "url", "role", "accessed_at"], properties: { title: { type: "string" }, url: { type: "string" }, role: { type: "string", enum: ["primary", "synthesis", "lead"] }, accessed_at: { type: "string" } } } }, license: { type: "string" } } },
        supersedes: { type: "array", items: { type: "object", additionalProperties: false, required: ["revision", "reason"], properties: { revision: { type: "integer", minimum: 1 }, reason: { type: "string" } } } },
      },
    },
    sources: {
      type: "object",
      minProperties: 2,
      additionalProperties: { type: "string", minLength: 1 },
    },
  },
};

export function practicePropertySchema(): Record<string, unknown> {
  const root = OUTPUT_SCHEMA as Record<string, unknown>;
  const rootProperties = isRecord(root.properties) ? root.properties : {};
  const manifest = isRecord(rootProperties.manifest) ? rootProperties.manifest : {};
  const manifestProperties = isRecord(manifest.properties) ? manifest.properties : {};
  const practice = isRecord(manifestProperties.practice) ? manifestProperties.practice : {};
  return practice;
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const IMPLEMENTATION_PURPOSES = new Set(["teaching", "concise", "iterative", "recursive", "optimized"]);

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function assertSlug(value: unknown, path: string): asserts value is string {
  if (typeof value !== "string" || !SLUG.test(value)) throw new Error(`${path} must be a lowercase slug`);
}

/**
 * Pre-flights the Rust contract rules that LLM output most often violates, so the
 * generator can repair before writing. Algorithm-agnostic: it validates shape
 * only, never a specific algorithm's requirements.
 */
export function validateGeneratedShape(value: unknown): void {
  if (!isRecord(value) || !isRecord(value.manifest) || !isRecord(value.sources)) throw new Error("artifact must contain manifest and sources objects");
  const manifest = value.manifest;
  if (manifest.schema_version !== "2" || manifest.status !== "draft") throw new Error("manifest must declare schema_version 2 and draft status");
  if (typeof manifest.id !== "string" || !/^[a-z0-9]+(?:[.-][a-z0-9]+)+$/.test(manifest.id)) throw new Error("manifest.id must be a dotted lowercase identifier");
  if (!isRecord(manifest.problem) || typeof manifest.problem.statement !== "string" || manifest.problem.statement.trim().length < 20) {
    throw new Error("problem.statement is required and must contain the complete learner-facing Markdown problem statement");
  }
  if (!Array.isArray(manifest.implementations) || manifest.implementations.length === 0) throw new Error("at least one implementation is required");
  const keys = new Set<string>();
  for (const [index, implementation] of manifest.implementations.entries()) {
    if (!isRecord(implementation)) throw new Error(`implementations[${index}] must be an object`);
    assertSlug(implementation.key, `implementations[${index}].key`);
    assertSlug(implementation.language, `implementations[${index}].language`);
    if (typeof implementation.purpose !== "string" || !IMPLEMENTATION_PURPOSES.has(implementation.purpose)) {
      throw new Error(`implementations[${index}].purpose must be one of teaching, concise, iterative, recursive, optimized`);
    }
    if (implementation.source !== "code/python.py") throw new Error("implementation source must be code/python.py");
    if (!Array.isArray(implementation.test_references) || !implementation.test_references.includes("tests/python_test.py")) {
      throw new Error("implementation test_references must include tests/python_test.py");
    }
    if (!isRecord(implementation.normalization) || implementation.normalization.line_endings !== "lf" || implementation.normalization.whitespace !== "strict") {
      throw new Error(`implementations[${index}].normalization must use line_endings "lf" and whitespace "strict"`);
    }
    if (keys.has(implementation.key)) throw new Error(`implementations[${index}].key duplicates ${implementation.key}`);
    keys.add(implementation.key);
  }
  const practice = isRecord(manifest.practice) ? manifest.practice : {};
  for (const field of ["shadow_typing", "code_recall"]) {
    const items = practice[field];
    if (!Array.isArray(items)) continue;
    for (const [index, item] of items.entries()) {
      if (!isRecord(item)) throw new Error(`practice.${field}[${index}] must be an object`);
      assertSlug(item.implementation, `practice.${field}[${index}].implementation`);
      if (!keys.has(item.implementation)) throw new Error(`practice.${field}[${index}].implementation must exactly match an implementations[].key`);
    }
  }
  if (isRecord(practice.flow_recall) && Array.isArray(practice.flow_recall.steps)) {
    const flowIds = new Set<string>();
    for (const [index, step] of practice.flow_recall.steps.entries()) {
      if (!isRecord(step) || typeof step.id !== "string" || !SLUG.test(step.id)) throw new Error(`practice.flow_recall.steps[${index}].id must be a lowercase slug`);
      if (flowIds.has(step.id)) throw new Error(`practice.flow_recall.steps[${index}].id duplicates ${step.id}`);
      flowIds.add(step.id);
      if (typeof step.prompt !== "string" || step.prompt.trim() === "") throw new Error(`practice.flow_recall.steps[${index}].prompt must be nonempty`);
      step.concepts = Array.isArray(step.concepts)
        ? step.concepts.map((concept) => typeof concept === "string" ? slugify(concept) : "").filter((concept) => concept !== "")
        : [];
      if (step.concepts.length === 0) throw new Error(`practice.flow_recall.steps[${index}].concepts must be nonempty lowercase slugs`);
    }
  }
  for (const [index, item] of (Array.isArray(practice.reasoning_recall) ? practice.reasoning_recall : []).entries()) {
    if (!isRecord(item)) throw new Error(`practice.reasoning_recall[${index}] must be an object`);
    assertSlug(item.id, `practice.reasoning_recall[${index}].id`);
    if (typeof item.aspect !== "string" || !["mechanism", "invariant", "trade_off", "boundary", "failure_condition"].includes(item.aspect)) {
      throw new Error(`practice.reasoning_recall[${index}].aspect is not supported`);
    }
    if (typeof item.prompt !== "string" || item.prompt.trim() === "") throw new Error(`practice.reasoning_recall[${index}].prompt must be nonempty`);
    item.concepts = Array.isArray(item.concepts)
      ? item.concepts.map((concept) => typeof concept === "string" ? slugify(concept) : "").filter((concept) => concept !== "")
      : [];
    if (item.concepts.length === 0) throw new Error(`practice.reasoning_recall[${index}].concepts must be nonempty lowercase slugs`);
  }
  for (const [index, item] of (Array.isArray(practice.transfer_practice) ? practice.transfer_practice : []).entries()) {
    if (!isRecord(item)) throw new Error(`practice.transfer_practice[${index}] must be an object`);
    assertSlug(item.id, `practice.transfer_practice[${index}].id`);
    assertSlug(item.pattern, `practice.transfer_practice[${index}].pattern`);
    if (typeof item.new_case !== "string" || item.new_case.trim() === "") throw new Error(`practice.transfer_practice[${index}].new_case must be nonempty`);
    if (typeof item.prompt !== "string" || item.prompt.trim() === "") throw new Error(`practice.transfer_practice[${index}].prompt must be nonempty`);
    item.concepts = Array.isArray(item.concepts)
      ? item.concepts.map((concept) => typeof concept === "string" ? slugify(concept) : "").filter((concept) => concept !== "")
      : [];
    if (item.concepts.length === 0) throw new Error(`practice.transfer_practice[${index}].concepts must be nonempty lowercase slugs`);
    for (const field of ["transfers", "differences", "boundaries"]) {
      if (!Array.isArray(item[field]) || item[field].length === 0 || item[field].some((entry: unknown) => typeof entry !== "string" || entry.trim() === "")) {
        throw new Error(`practice.transfer_practice[${index}].${field} must be nonempty`);
      }
    }
  }
  for (const required of ["code/python.py", "tests/python_test.py"]) {
    if (typeof value.sources[required] !== "string" || (value.sources[required] as string).trim() === "") {
      throw new Error(`source is missing or empty: ${required}`);
    }
  }
}

const SLOT_MARKER = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Derives code_recall source templates from the canonical implementation instead of trusting the
 * model's copy. Markers replace exactly the declared slot expectations, which makes the Rust
 * reconstructability check deterministic and keeps the repair loop focused on slot selection.
 */
export function materializeSourceTemplates(manifest: Record<string, unknown>, sources: Record<string, unknown>): void {
  const code = sources["code/python.py"];
  if (typeof code !== "string") return;
  const practice = isRecord(manifest.practice) ? manifest.practice : undefined;
  const items = practice?.code_recall;
  if (!Array.isArray(items)) return;
  const seenItemIds = new Set<string>();
  for (const [index, item] of items.entries()) {
    if (!isRecord(item)) continue;
    let itemId = typeof item.id === "string" && SLOT_MARKER.test(item.id) ? item.id : `recall-${index + 1}`;
    while (seenItemIds.has(itemId)) itemId = `${itemId}-${index + 1}`;
    item.id = itemId;
    seenItemIds.add(itemId);
    if ((item.layout === "comment_guided" || item.layout === "comment_to_code") && item.assistance !== "comments") {
      throw new Error(`practice.code_recall[${index}] must use assistance "comments" for layout ${String(item.layout)}`);
    }
    if (item.assistance === "none") {
      item.scaffold = [];
    } else if (item.layout === "comment_guided") {
      // Cues are the scaffold; never let a redundant model scaffold duplicate the code.
      delete item.scaffold;
    } else if (!Array.isArray(item.scaffold) || item.scaffold.length === 0) {
      if (item.layout === "cloze") {
        item.scaffold = ["Fill in each marked decision with the exact code."];
      } else if (item.layout !== "comment_guided") {
        throw new Error(`practice.code_recall[${index}] scaffold must contain at least one nonempty item when assistance is enabled`);
      }
    } else if (item.scaffold.some((entry) => typeof entry !== "string" || entry.trim() === "")) {
      item.scaffold = item.scaffold.filter((entry): entry is string => typeof entry === "string" && entry.trim() !== "");
      if (item.scaffold.length === 0) {
        if (item.layout === "cloze") {
          item.scaffold = ["Fill in each marked decision with the exact code."];
        } else if (item.layout === "comment_guided") {
          // Derived from slot cues after the slot loop below.
        } else if (item.layout === "full_recall") {
          item.scaffold = ["Reconstruct the implementation, guided by the visible comments."];
        } else {
          throw new Error(`practice.code_recall[${index}] scaffold must contain at least one nonempty item for comment_to_code`);
        }
      }
    }
    if (item.layout !== "cloze" && item.layout !== "comment_guided") {
      delete item.source_template;
      item.slots = [];
      continue;
    }
    if (!Array.isArray(item.slots) || item.slots.length === 0) {
      throw new Error(`practice.code_recall[${index}].slots must be nonempty for layout ${String(item.layout)}`);
    }
    let template = code;
    const seenSlotIds = new Set<string>();
    for (const [slotIndex, slot] of item.slots.entries()) {
      if (!isRecord(slot)) throw new Error(`practice.code_recall[${index}] slot must be an object`);
      let slotId = typeof slot.id === "string" && SLOT_MARKER.test(slot.id) ? slot.id : `slot-${slotIndex + 1}`;
      while (seenSlotIds.has(slotId)) slotId = `${slotId}-${slotIndex + 2}`;
      slot.id = slotId;
      seenSlotIds.add(slotId);
      const expected = slot.expected;
      if (typeof expected !== "string" || expected.length === 0) {
        throw new Error(`practice.code_recall[${index}] slot ${slotId} must declare expected code`);
      }
      if (item.layout === "comment_guided" && (typeof slot.cue !== "string" || slot.cue.trim() === "")) {
        throw new Error(`practice.code_recall[${index}] slot ${slotId} must declare a nonempty cue for comment_guided`);
      }
      if (typeof slot.cue === "string" && slot.cue.trim() === "") delete slot.cue;
      if (!template.includes(expected)) {
        throw new Error(`practice.code_recall[${index}] slot ${slotId} expected code does not appear verbatim in code/python.py`);
      }
      template = template.replace(expected, `{{${slotId}}}`);
    }
    item.source_template = template;
    if (item.layout === "comment_guided" && (!Array.isArray(item.scaffold) || item.scaffold.length === 0)) {
      item.scaffold = item.slots.map((slot: any) => String(slot.cue ?? "").trim()).filter(Boolean);
      if (item.scaffold.length === 0) throw new Error(`practice.code_recall[${index}] comment_guided cues must be nonempty to derive scaffold`);
    }
  }
}

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
      authors: Array.isArray(existing.authors) && existing.authors.length > 0 ? existing.authors : ["GEWU"],
      license: typeof existing.license === "string" && existing.license.trim() ? existing.license : "all-rights-reserved",
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

function runChecked(command: string, args: string[], cwd: string): void {
  const result = spawnSync(command, args, { cwd, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`${command} validation failed:\n${result.stderr || result.stdout}`);
  }
}

export async function generateTemplateDraft(problem: string): Promise<void> {
  const generator = new PiGenerator(optionsFromEnvironment());
  const profile: GenerationProfile = {
    practice_modes: ["shadow_typing", "flow_recall", "code_recall", "reasoning_recall", "transfer_practice"],
    code_recall_assistance: ["comments", "cloze"],
    code_recall_layouts: ["full_recall", "comment_guided", "comment_to_code", "cloze"],
    implementation_languages: ["python"],
    implementation_variants: 1,
  };
  const task: DraftTask = {
    taskId: "algorithm-unit-v2",
    taskVersion: "1",
    selectedInputHash: `sha256:${createHash("sha256").update(problem).digest("hex")}`,
    instruction: `${GENERIC_INSTRUCTION}\n\nAlgorithm problem:\n${problem}`,
    outputSchema: OUTPUT_SCHEMA,
    profile,
    validate: (parsed: unknown) => {
      validateGeneratedShape(parsed);
      if (isRecord(parsed) && isRecord(parsed.manifest) && isRecord(parsed.sources)) {
        materializeSourceTemplates(parsed.manifest, parsed.sources);
      }
    },
  };
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
  if (!isRecord(artifact.manifest.sources)) throw new Error("draft sources must be an object");
  const trustedDraft = { ...artifact.manifest, manifest: trustedManifest } as { manifest: Record<string, unknown>; sources: Record<string, unknown> };
  materializeSourceTemplates(trustedManifest, trustedDraft.sources);

  const here = dirname(fileURLToPath(import.meta.url));
  const repoRoot = resolve(here, "../..", "..");
  const draftsRoot = resolve(here, "../drafts");
  const suffix = generatedAt.replaceAll(/[-:.TZ]/g, "");
  const finalRoot = join(draftsRoot, `generated-${suffix}`);
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
  const problem = process.argv[2] ?? "Given a weighted directed graph and a source vertex, return the shortest distances to every reachable vertex using a single-source shortest path algorithm.";
  generateTemplateDraft(problem).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
