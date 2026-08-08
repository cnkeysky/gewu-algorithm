import { OUTPUT_SCHEMA, materializeSourceTemplates, practicePropertySchema, validateGeneratedShape } from "./generate-template.js";
import type { DraftTask, GenerationProfile, PracticeModeSelection } from "./pi-generator.js";
import { createHash } from "node:crypto";

export const EXTRA_PRACTICE_MODES = ["code_recall", "reasoning_recall", "transfer_practice"] as const;
export type ExtraPracticeMode = (typeof EXTRA_PRACTICE_MODES)[number];
export const CODE_RECALL_LAYOUTS = ["full_recall", "comment_guided", "comment_to_code", "cloze"] as const;
export type CodeRecallLayout = (typeof CODE_RECALL_LAYOUTS)[number];

export interface StageSpec {
  readonly mode: ExtraPracticeMode;
  readonly layout?: CodeRecallLayout;
}

export const STAGE_SPECS: StageSpec[] = [
  { mode: "code_recall", layout: "full_recall" },
  { mode: "code_recall", layout: "comment_guided" },
  { mode: "code_recall", layout: "comment_to_code" },
  { mode: "code_recall", layout: "cloze" },
  { mode: "reasoning_recall" },
  { mode: "transfer_practice" },
];

const SLOT_MARKER = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function normalizeSlugs(values: unknown): string[] {
  return Array.isArray(values)
    ? values.map((value) => typeof value === "string" ? slugify(value) : "").filter((value) => value !== "")
    : [];
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function modePropertySchema(mode: ExtraPracticeMode): Record<string, unknown> {
  const practice = practicePropertySchema();
  const practiceProperties = isRecord(practice.properties) ? practice.properties : {};
  return {
    type: "object",
    additionalProperties: false,
    required: ["practice"],
    properties: {
      practice: {
        type: "object",
        additionalProperties: false,
        required: [mode],
        properties: { [mode]: practiceProperties[mode] },
      },
    },
  };
}

export function coreStageInstruction(baseInstruction: string, variants: number): string {
  const variantRule = variants > 1
    ? ` Generate exactly ${variants} distinct implementation strategies, each with its own lowercase-slug key and a strategy describing that variant. practice.shadow_typing must include exactly one item per implementation, each referencing its key.`
    : variants === 0
      ? " There is no fixed variant count. Generate as many genuinely distinct implementation strategies as the problem warrants — different algorithmic approaches or clear complexity trade-offs — typically a single canonical solution and rarely more than three; never produce variants that differ only cosmetically. practice.shadow_typing must include exactly one item per implementation, each referencing its key."
      : " Generate exactly one implementation strategy.";
  const bindingRule = " flow_recall, code_recall, reasoning_recall, and transfer_practice bind to the canonical first-declared implementation only; their practice variants are exercise formats of that implementation, never additional implementations.";
  return `${baseInstruction}\n\nThis is the CORE stage of a staged generation.${variantRule}${bindingRule} tests/python_test.py must load the implementation with importlib.util.spec_from_file_location from the unit root; never use "from code.python import ..." because the Python standard library "code" module shadows the local package. Generate the complete manifest with shadow typing and flow recall populated, but leave practice.code_recall, practice.reasoning_recall, and practice.transfer_practice as empty arrays. Those projections are generated in separate follow-up stages.`;
}

export interface StageContext {
  readonly problem: string;
  readonly implementations: Array<{ key: string; strategy: string }>;
  readonly code: string;
  readonly patterns: Array<{ id: string; summary: string }>;
}

export function buildStageTask(
  spec: StageSpec,
  profile: GenerationProfile,
  context: StageContext,
  revisionFeedback = "",
): DraftTask {
  const mode = spec.mode;
  const codeBlock = context.code;
  const implementationList = context.implementations.map((item) => `- ${item.key}: ${item.strategy}`).join("\n");
  const implementationKeys = context.implementations.map((item) => item.key);
  let instruction: string;
  if (mode === "code_recall") {
    const layout = spec.layout ?? "full_recall";
    const layoutRules: Record<CodeRecallLayout, string> = {
      full_recall: `Generate one or more items with layout "full_recall". Use assistance "none" with an empty scaffold, or assistance "comments" with a nonempty scaffold of reviewed comments. Never declare slots or source_template.`,
      comment_guided: `Generate one or more items with layout "comment_guided" and assistance "comments". Every slot must declare a nonempty cue and expected code that appears verbatim in the canonical implementation; the server derives source_template from those slots. Provide a nonempty scaffold.`,
      comment_to_code: `Generate one or more items with layout "comment_to_code" and assistance "comments". Provide an ordered nonempty scaffold of reviewed algorithm-operation comments. Never declare slots or source_template.`,
      cloze: `Generate one or more items with layout "cloze" and assistance "cloze". Every slot must declare expected code that appears verbatim in the canonical implementation; the server derives source_template from those slots.`,
    };
    instruction = `Generate ONLY practice.code_recall items with layout "${layout}" for the algorithm unit described below. The unit declares these implementation variants:\n${implementationList}\nEvery item's implementation field must be one of: ${implementationKeys.join(", ")}. Generate items for each declared implementation variant when the layout applies. The canonical implementation source is:\n\`\`\`python\n${codeBlock}\n\`\`\`\n${layoutRules[layout]} Every slot expected value must be copied character-for-character from the canonical implementation; never invent expected text. Keep every prompt aligned with the implementation it references. Return one JSON object matching the schema: {"practice": {"code_recall": [items with layout "${layout}" only]}}.`;
  } else if (mode === "reasoning_recall") {
    instruction = `Generate ONLY the practice.reasoning_recall projection for the algorithm unit described below. The unit declares these implementation variants:\n${implementationList}\nEvery prompt must target the implemented strategy family (its states, invariants, boundaries, and failure modes); when several variants are declared, use trade_off items to compare them, and never describe an algorithm that is not among the declared variants as the implemented one. Each item should declare the variant it targets via the optional implementation field (one of: ${implementationKeys.join(", ")}), and every declared variant must be covered by at least one item. Each item must use one aspect from mechanism, invariant, trade_off, boundary, or failure_condition; prompts must be concrete and answerable without revealing the solution; concepts must be lowercase slugs. Return one JSON object matching the schema: {"practice": {"reasoning_recall": [...]}}.`;
  } else {
    const patternList = context.patterns.map((pattern) => `- ${pattern.id}: ${pattern.summary}`).join("\n");
    instruction = `Generate ONLY the practice.transfer_practice projection for the algorithm unit described below. The unit declares these implementation variants:\n${implementationList}\nThe unit declares these patterns:\n${patternList}\nEvery item's pattern must exactly equal one of those pattern ids, and the transfer must keep the core mechanism of one declared implementation variant. Each item should declare the variant it targets via the optional implementation field (one of: ${implementationKeys.join(", ")}), and every declared variant must be covered by at least one item. Each item needs a concrete new_case, a prompt, lowercase-slug concepts, and nonempty transfers, differences, and boundaries. Return one JSON object matching the schema: {"practice": {"transfer_practice": [...]}}.`;
  }
  const fullInstruction = revisionFeedback
    ? `${instruction}\n\nRevision feedback from the last LLM pre-review relevant to this stage. Address every finding in this stage's output:\n${revisionFeedback}`
    : instruction;
  return {
    taskId: `algorithm-unit-stage-${mode}`,
    taskVersion: "1",
    selectedInputHash: `sha256:${createHash("sha256").update(`${mode}:${context.problem}`).digest("hex")}`,
    instruction: `${fullInstruction}\n\nAlgorithm problem:\n${context.problem}`,
    outputSchema: modePropertySchema(mode),
    profile,
    validate: (parsed: unknown) => validateStageArtifact(spec, parsed, context),
  };
}

export function validateCoreStage(value: unknown): void {
  validateGeneratedShape(value);
  if (!isRecord(value) || !isRecord(value.manifest) || !isRecord(value.manifest.practice)) throw new Error("core stage artifact must contain manifest.practice");
  const practice = value.manifest.practice;
  const testsSource = isRecord(value.sources) && typeof value.sources["tests/python_test.py"] === "string" ? value.sources["tests/python_test.py"] : "";
  if (/from\s+code\s*\.\s*python\s+import/.test(testsSource)) {
    throw new Error("tests/python_test.py must load the implementation via importlib.util.spec_from_file_location; `from code.python import ...` is shadowed by the Python standard library `code` module");
  }
  const implementations = Array.isArray(value.manifest.implementations) ? value.manifest.implementations.filter(isRecord) : [];
  if (implementations.length === 0) throw new Error("core stage must declare at least one implementation");
  const implementationKeys = new Set(implementations.map((item) => String(item.key ?? "")));
  for (const mode of EXTRA_PRACTICE_MODES) {
    if (!Array.isArray(practice[mode]) || practice[mode].length !== 0) {
      throw new Error(`core stage must leave practice.${mode} as an empty array`);
    }
  }
  if (!Array.isArray(practice.shadow_typing) || practice.shadow_typing.length === 0) throw new Error("core stage must include shadow typing");
  if (practice.shadow_typing.length !== implementations.length) throw new Error("core stage must declare exactly one shadow typing item per implementation");
  const shadowKeys = new Set(practice.shadow_typing.map((item) => isRecord(item) ? String(item.implementation ?? "") : ""));
  for (const key of implementationKeys) {
    if (!shadowKeys.has(key)) throw new Error(`core stage shadow typing must reference implementation ${key}`);
  }
  if (!isRecord(practice.flow_recall) || !Array.isArray(practice.flow_recall.steps) || practice.flow_recall.steps.length === 0) throw new Error("core stage must include flow recall steps");
}

export function validateStageArtifact(spec: StageSpec, parsed: unknown, context: StageContext): void {
  const mode = spec.mode;
  if (!isRecord(parsed) || !isRecord(parsed.practice)) throw new Error(`${mode} stage must return {"practice": {...}}`);
  const items = parsed.practice[mode];
  if (!Array.isArray(items)) throw new Error(`practice.${mode} must be an array`);
  if (spec.layout === "full_recall" && items.length === 0) throw new Error("practice.code_recall full_recall stage must not be empty");
  const implementationKeys = context.implementations.map((item) => item.key);
  if (mode === "code_recall") {
    const pseudoManifest = { practice: { code_recall: items } };
    materializeSourceTemplates(pseudoManifest, { "code/python.py": context.code });
    const ids = new Set<string>();
    for (const [index, item] of items.entries()) {
      if (!isRecord(item)) throw new Error(`practice.code_recall[${index}] must be an object`);
      if (spec.layout && item.layout !== spec.layout) throw new Error(`practice.code_recall[${index}].layout must be "${spec.layout}" in this stage`);
      if (typeof item.id !== "string" || !SLOT_MARKER.test(item.id)) throw new Error(`practice.code_recall[${index}].id must be a lowercase slug`);
      if (ids.has(item.id)) throw new Error(`practice.code_recall[${index}].id duplicates ${item.id}`);
      ids.add(item.id);
      if (typeof item.implementation !== "string" || item.implementation !== implementationKeys[0]) {
        throw new Error(`practice.code_recall[${index}].implementation must bind to the canonical implementation ${implementationKeys[0]}`);
      }
      if (typeof item.prompt !== "string" || item.prompt.trim() === "") throw new Error(`practice.code_recall[${index}].prompt must be nonempty`);
    }
  } else if (mode === "reasoning_recall") {
    const ids = new Set<string>();
    for (const [index, item] of items.entries()) {
      if (!isRecord(item)) throw new Error(`practice.reasoning_recall[${index}] must be an object`);
      if (typeof item.id !== "string" || !SLOT_MARKER.test(item.id)) throw new Error(`practice.reasoning_recall[${index}].id must be a lowercase slug`);
      if (ids.has(item.id)) throw new Error(`practice.reasoning_recall[${index}].id duplicates ${item.id}`);
      ids.add(item.id);
      if (!["mechanism", "invariant", "trade_off", "boundary", "failure_condition"].includes(String(item.aspect))) {
        throw new Error(`practice.reasoning_recall[${index}].aspect is not supported`);
      }
      if (typeof item.prompt !== "string" || item.prompt.trim() === "") throw new Error(`practice.reasoning_recall[${index}].prompt must be nonempty`);
      if (item.implementation !== undefined && (typeof item.implementation !== "string" || item.implementation !== implementationKeys[0])) {
        throw new Error(`practice.reasoning_recall[${index}].implementation must bind to the canonical implementation ${implementationKeys[0]}`);
      }
      item.concepts = normalizeSlugs(item.concepts);
      if (item.concepts.length === 0) throw new Error(`practice.reasoning_recall[${index}].concepts must be nonempty lowercase slugs`);
    }
  } else {
    const patternIds = new Set(context.patterns.map((pattern) => pattern.id));
    const ids = new Set<string>();
    for (const [index, item] of items.entries()) {
      if (!isRecord(item)) throw new Error(`practice.transfer_practice[${index}] must be an object`);
      if (typeof item.id !== "string" || !SLOT_MARKER.test(item.id)) throw new Error(`practice.transfer_practice[${index}].id must be a lowercase slug`);
      if (ids.has(item.id)) throw new Error(`practice.transfer_practice[${index}].id duplicates ${item.id}`);
      ids.add(item.id);
      if (typeof item.pattern !== "string" || !SLOT_MARKER.test(item.pattern) || !patternIds.has(item.pattern)) {
        throw new Error(`practice.transfer_practice[${index}].pattern must reference a declared pattern id`);
      }
      if (typeof item.new_case !== "string" || item.new_case.trim() === "") throw new Error(`practice.transfer_practice[${index}].new_case must be nonempty`);
      if (typeof item.prompt !== "string" || item.prompt.trim() === "") throw new Error(`practice.transfer_practice[${index}].prompt must be nonempty`);
      if (item.implementation !== undefined && (typeof item.implementation !== "string" || item.implementation !== implementationKeys[0])) {
        throw new Error(`practice.transfer_practice[${index}].implementation must bind to the canonical implementation ${implementationKeys[0]}`);
      }
      item.concepts = normalizeSlugs(item.concepts);
      if (item.concepts.length === 0) throw new Error(`practice.transfer_practice[${index}].concepts must be nonempty lowercase slugs`);
      for (const field of ["transfers", "differences", "boundaries"]) {
        if (!Array.isArray(item[field]) || item[field].length === 0 || item[field].some((entry) => typeof entry !== "string" || entry.trim() === "")) {
          throw new Error(`practice.transfer_practice[${index}].${field} must be nonempty`);
        }
      }
    }
  }
}

export function mergeStage(spec: StageSpec, manifest: Record<string, unknown>, parsed: unknown): void {
  const mode = spec.mode;
  if (!isRecord(manifest.practice)) throw new Error("merged manifest has no practice object");
  if (!isRecord(parsed) || !isRecord(parsed.practice)) throw new Error(`${mode} stage returned an invalid practice object`);
  if (mode === "code_recall") {
    const items = parsed.practice[mode];
    if (!Array.isArray(items)) throw new Error("code_recall stage returned a non-array");
    if (!Array.isArray(manifest.practice[mode])) manifest.practice[mode] = [];
    manifest.practice[mode].push(...items);
  } else {
    manifest.practice[mode] = parsed.practice[mode];
  }
}

/** Shadow typing exposes one item per implementation strategy; all other
 * practice modes bind to the canonical first-declared implementation. */
export function assertVariantCoverage(manifest: Record<string, unknown>): void {
  const practice = isRecord(manifest.practice) ? manifest.practice : undefined;
  const implementationKeys = Array.isArray(manifest.implementations)
    ? manifest.implementations.filter(isRecord).map((item) => String(item.key ?? "")).filter((key) => key !== "")
    : [];
  if (implementationKeys.length <= 1) return;
  const canonical = implementationKeys[0];
  const coveredKeys = (items: unknown): Set<string> => {
    const covered = new Set<string>();
    if (!Array.isArray(items)) return covered;
    for (const item of items) {
      if (!isRecord(item)) continue;
      covered.add(typeof item.implementation === "string" ? item.implementation : canonical);
    }
    return covered;
  };
  for (const key of implementationKeys) {
    if (!coveredKeys(practice?.shadow_typing).has(key)) throw new Error(`practice.shadow_typing must cover implementation variant ${key}`);
  }
  for (const field of ["code_recall", "reasoning_recall", "transfer_practice"]) {
    const items = Array.isArray(practice?.[field]) ? practice[field] : [];
    for (const [index, item] of items.entries()) {
      if (!isRecord(item)) continue;
      const reference = typeof item.implementation === "string" ? item.implementation : canonical;
      if (reference !== canonical) throw new Error(`practice.${field}[${index}] must bind to the canonical implementation ${canonical}`);
    }
  }
}

export function stageContextFromCore(coreManifest: Record<string, unknown>, sources: Record<string, unknown>, problem: string): StageContext {
  const implementations = Array.isArray(coreManifest.implementations)
    ? coreManifest.implementations
        .filter(isRecord)
        .map((item) => ({ key: String(item.key ?? ""), strategy: typeof item.strategy === "string" ? item.strategy : "" }))
        .filter((item) => item.key !== "")
    : [];
  const patterns = Array.isArray(coreManifest.patterns)
    ? coreManifest.patterns.filter(isRecord).map((item) => ({ id: String(item.id ?? ""), summary: String(item.summary ?? "") })).filter((item) => item.id)
    : [];
  return {
    problem,
    implementations,
    code: typeof sources["code/python.py"] === "string" ? sources["code/python.py"] : "",
    patterns,
  };
}

export { OUTPUT_SCHEMA };
