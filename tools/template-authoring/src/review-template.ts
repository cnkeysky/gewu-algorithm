import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PiGenerator, optionsFromEnvironment, type DraftTask } from "./pi-generator.js";
import { draftsRoot, repoRoot, rulesRoot } from "./paths.js";

const RUBRIC_VERSION = "algorithm-template-review.v2";
const ROLES = ["algorithm_correctness", "learning_design", "provenance_safety"] as const;
type ReviewRole = (typeof ROLES)[number];

const OUTPUT_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["verdict", "findings"],
  properties: {
    verdict: { type: "string", enum: ["pass", "needs_revision", "reject", "human_review_required"] },
    findings: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["rule_id", "severity", "path", "problem", "evidence", "suggested_change"],
        properties: {
          rule_id: { type: "string" },
          severity: { type: "string", enum: ["info", "minor", "major", "critical"] },
          path: { type: "string" },
          problem: { type: "string" },
          evidence: { type: "string" },
          suggested_change: { type: "string" },
        },
      },
    },
  },
};

const ACCEPTANCE_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["verdict", "rationale", "findings"],
  properties: {
    verdict: { type: "string", enum: ["pass", "needs_revision"] },
    rationale: { type: "string" },
    findings: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["rule_id", "severity", "path", "problem", "evidence", "suggested_change"],
        properties: {
          rule_id: { type: "string" },
          severity: { type: "string", enum: ["info", "minor", "major", "critical"] },
          path: { type: "string" },
          problem: { type: "string" },
          evidence: { type: "string" },
          suggested_change: { type: "string" },
        },
      },
    },
  },
};

type ModelReport = {
  verdict: "pass" | "needs_revision" | "reject" | "human_review_required";
  findings: Array<{
    rule_id: string;
    severity: "info" | "minor" | "major" | "critical";
    path: string;
    problem: string;
    evidence: string;
    suggested_change: string;
  }>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Builds the final acceptance task for a reviewed draft. The acceptance model
 * acts as the publication gate: it reads the problem, the manifest, and every
 * LLM pre-review finding, then returns pass or needs_revision with a concise
 * rationale. This is a pure builder so the prompt can be unit-tested.
 */
export function buildAcceptanceTask(
  problem: string,
  manifest: string,
  reviews: Array<{
    role: string;
    verdict: string;
    report?: { findings?: Array<{ rule_id: string; severity: string; path?: string; problem: string; evidence: string; suggested_change?: string }> };
  }>,
  sources: Array<{ path: string; content: string }> = [],
): DraftTask {
  const findings = reviews
    .flatMap((review) => (review.report?.findings ?? []).map((finding) => `[${review.role}] ${finding.severity} ${finding.rule_id}: ${finding.problem} — ${finding.evidence}`))
    .join("\n");
  const sourceText = sources.map((source) => `--- ${source.path} ---\n${source.content}`).join("\n");
  return {
    taskId: "algorithm-unit-acceptance",
    taskVersion: "acceptance-v1",
    selectedInputHash: createHash("sha256").update(`${problem}\n${manifest}\n${findings}\n${sourceText}`).digest("hex"),
    instruction: `You are the final acceptance reviewer (publication gate) for this GEWU algorithm unit. Decide whether this reviewed artifact may be accepted as a practice template.
Return pass only when the artifact is a faithful, correct, complete template for the problem and every material pre-review finding has been addressed. Otherwise return needs_revision with a concise rationale naming the blocking issue.
Return only the JSON report shape requested.\n\nProblem:\n${problem}\n\nManifest:\n${manifest}\n${sourceText ? `\nArtifact source and test files:\n${sourceText}` : ""}\n\nLLM pre-review findings:\n${findings || "No findings."}\n\nNote: the artifact's validation.content_review/transfer_review fields are stamped after this gate passes — their pending state before your pass is expected and is not itself a defect.`,
    outputSchema: ACCEPTANCE_SCHEMA,
  };
}

/**
 * Reviews that inform the acceptance gate: pre-review role findings only.
 * The gate never reads its own previous verdicts — feeding a reviewer its own
 * past rejection is a classic echo loop (a stale or hallucinated finding gets
 * repeated instead of re-derived from the artifact).
 */
export function acceptanceContextReviews<T extends { draftId: string; role: string }>(
  reviews: T[],
  draftId: string,
): T[] {
  return reviews.filter((review) => review.draftId === draftId && review.role !== "llm_acceptance");
}

/**
 * Mature rejection handling for the LLM publication gate: when the gate
 * rejects an artifact that passed deterministic validation, and this artifact
 * hash has not been rejected by the gate before, allow ONE fresh independent
 * re-read. Two agreeing rejections stick; a single rejection contradicted by
 * a clean re-read does not drive the artifact into a repair loop over a
 * finding the model itself could not reproduce.
 */
export function shouldRecheckAcceptance(
  wasDeterministicallyValidated: boolean,
  reviews: Array<{ draftId: string; role: string; artifactHash: string | null }>,
  draftId: string,
  artifactHash: string | null,
): boolean {
  if (!wasDeterministicallyValidated || !artifactHash) return false;
  return !reviews.some(
    (review) => review.draftId === draftId && review.role === "llm_acceptance" && review.artifactHash === artifactHash,
  );
}

function parseRole(value: string | undefined): ReviewRole {
  if (value && (ROLES as readonly string[]).includes(value)) return value as ReviewRole;
  throw new Error(`review role must be one of: ${ROLES.join(", ")}`);
}

function assertReport(value: unknown, allowedRules: ReadonlySet<string>): asserts value is ModelReport {
  if (!isRecord(value) || typeof value.verdict !== "string" || !Array.isArray(value.findings)) {
    throw new Error("reviewer returned an invalid report shape");
  }
  if (!["pass", "needs_revision", "reject", "human_review_required"].includes(value.verdict))
    throw new Error("reviewer returned an invalid verdict");
  for (const finding of value.findings) {
    if (!isRecord(finding)) throw new Error("review finding must be an object");
    for (const key of ["rule_id", "severity", "path", "problem", "evidence", "suggested_change"]) {
      if (typeof finding[key] !== "string" || finding[key] === "") throw new Error(`review finding field is invalid: ${key}`);
    }
    if (!allowedRules.has(finding.rule_id as string))
      throw new Error(`reviewer used a rule outside its assigned role: ${String(finding.rule_id)}`);
  }
}

function collectReviewedPaths(manifest: Record<string, unknown>): string[] {
  if (!Array.isArray(manifest.implementations)) throw new Error("draft implementations must be an array");
  const paths = new Set<string>();
  for (const implementation of manifest.implementations) {
    if (!isRecord(implementation) || typeof implementation.source !== "string")
      throw new Error("draft implementation source is invalid");
    paths.add(implementation.source);
    if (Array.isArray(implementation.test_references)) {
      for (const reference of implementation.test_references) {
        if (typeof reference !== "string") throw new Error("draft test reference is invalid");
        paths.add(reference);
      }
    }
  }
  return [...paths].sort();
}

async function hashDraft(draftRoot: string, files: Array<{ path: string; content: string }>): Promise<string> {
  const unit = await readFile(join(draftRoot, "unit.json"));
  const hash = createHash("sha256").update(unit);
  for (const file of files) hash.update(file.path).update(file.content);
  return `sha256:${hash.digest("hex")}`;
}

export async function reviewTemplateDraft(draftArgument: string, roleArgument: string | undefined): Promise<void> {
  const draftRoot = resolve(repoRoot, draftArgument);
  if (!draftRoot.startsWith(`${draftsRoot}/`)) throw new Error("review target must be inside ignored drafts/");
  const role = parseRole(roleArgument ?? process.env.GEWU_REVIEW_ROLE);
  const unit = await readFile(join(draftRoot, "unit.json"), "utf8");
  const manifest = JSON.parse(unit) as unknown;
  if (!isRecord(manifest)) throw new Error("draft manifest must be an object");
  const reviewedFiles = await Promise.all(collectReviewedPaths(manifest).map(async (path) => {
    const absolute = resolve(draftRoot, path);
    if (!absolute.startsWith(`${draftRoot}/`)) throw new Error(`reviewed file escapes draft root: ${path}`);
    return { path, content: await readFile(absolute, "utf8") };
  }));
  const rubricDocument = JSON.parse(
    await readFile(join(rulesRoot, "algorithm-template-review.v2.json"), "utf8"),
  ) as { id: string; roles: Record<string, string[]>; rules: Array<{ id: string; description: string }> };
  const assignedRuleIds = rubricDocument.roles[role];
  if (!assignedRuleIds) throw new Error(`rubric does not define role: ${role}`);
  const allowedRules = new Set(assignedRuleIds);
  const rubric = JSON.stringify({
    id: rubricDocument.id,
    role,
    rules: rubricDocument.rules.filter((rule) => allowedRules.has(rule.id)),
  });
  const artifactHash = await hashDraft(draftRoot, reviewedFiles);
  const task: DraftTask = {
    taskId: `review-${basename(draftRoot)}-${role}`,
    taskVersion: RUBRIC_VERSION,
    selectedInputHash: artifactHash,
    instruction: `Review this GEWU draft as the ${role} reviewer. This is a read-only review.
Never change files, approve publication, or trust lifecycle claims from the draft.
Use only rules in the supplied rubric. Return only the JSON report shape requested.
Rubric:\n${rubric}\nDraft manifest:\n${unit}\nReviewed source and test files:\n${JSON.stringify(reviewedFiles)}`,
    outputSchema: OUTPUT_SCHEMA,
  };
  const artifact = await new PiGenerator(optionsFromEnvironment()).generate(task);
  if (!isRecord(artifact.manifest)) throw new Error("review response must be an object");
  assertReport(artifact.manifest, allowedRules);
  const report = {
    artifact_hash: artifactHash,
    rubric_version: RUBRIC_VERSION,
    role,
    provider: artifact.provider,
    model: artifact.model,
    verdict: artifact.manifest.verdict,
    findings: artifact.manifest.findings,
    action: artifact.manifest.verdict === "pass" ? "human_confirmation_required" : "repair_or_user_review",
  };
  const outputRoot = join(draftRoot, "reviews");
  await mkdir(outputRoot, { recursive: true });
  await writeFile(join(outputRoot, `${role}.json`), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ status: "reviewed", ...report, output: relative(repoRoot, join(outputRoot, `${role}.json`)) }));
}

const [draftArgument, roleArgument] = process.argv.slice(2);
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!draftArgument) {
    console.error("usage: review-template <draft-path> <algorithm_correctness|learning_design|provenance_safety>");
    process.exitCode = 2;
  } else {
    reviewTemplateDraft(draftArgument, roleArgument).catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    });
  }
}
