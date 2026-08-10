import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { cp, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { PiGenerator, modelCatalogFromEnvironment, optionsFromEnvironment, type CodeRecallAssistanceSelection, type GenerationProfile, type PracticeModeSelection } from "./pi-generator.js";
import { assertDraftTransition, draftReuseGuard } from "./draft-lifecycle.js";
import { applyContentTransition, assertPublishable, type ContentTransitionId } from "./manifest-lifecycle.js";
import { providerRegistry } from "./provider-registry.js";
import { buildAcceptanceTask, reviewTemplateDraft } from "./review-template.js";
import { builtinTaskRegistry } from "./task-registry.js";
import { applyTrustedDraftState, applyTrustedProvenance, materializeSourceTemplates } from "./generate-template.js";
import { buildReviewSummary, normalizeSupersedes, qualifyUnitId, sourcePathFor, testPathFor } from "./publish.js";
import { casUpsertDraft, releaseClaim, tryAcquireClaim, upsertDraft, upsertReview } from "./persist.js";
import {
  STAGE_SPECS,
  assertExplicitVariantCount,
  assertVariantCoverage,
  buildStageTask,
  codeRecallLayoutsFor,
  coreStageInstruction,
  mergeStage,
  stageContextFromCore,
  validateCoreStage,
} from "./staged-generation.js";

const PORT = Number(process.env.GEWU_WORKBENCH_PORT ?? 4174);
const here = dirname(fileURLToPath(import.meta.url));
/** Short build id of the executing API bundle: hashes every runtime module
 * (not just workbench-api.js), so any source change (pi-generator, lifecycle,
 * staging, …) makes dev scripts detect a stale API process and restart it
 * instead of silently reusing old in-memory code. */
const BUILD_ID = createHash("sha256")
  .update(
    [
      "workbench-api.js", "pi-generator.js", "generate-template.js", "review-template.js",
      "staged-generation.js", "persist.js", "draft-lifecycle.js", "manifest-lifecycle.js",
      "publish.js", "task-registry.js", "rule-dedup.js",
    ]
      .map((file) => readFileSync(join(dirname(fileURLToPath(import.meta.url)), file)).toString("base64"))
      .join("|"),
  )
  .digest("hex")
  .slice(0, 12);
const storageRoot = resolve(here, "../drafts/.workbench");
const databasePath = join(storageRoot, "authoring.sqlite");
mkdirSync(storageRoot, { recursive: true });
const database = new DatabaseSync(databasePath);
const publishedRoot = resolve(process.env.GEWU_PUBLISHED_ROOT ?? join(storageRoot, "published"));
const modelCatalog = modelCatalogFromEnvironment();
database.exec(`
  CREATE TABLE IF NOT EXISTS drafts (
    id TEXT PRIMARY KEY, task_id TEXT, title TEXT NOT NULL, problem TEXT NOT NULL,
    provider TEXT NOT NULL, model TEXT NOT NULL, language TEXT NOT NULL, variants INTEGER NOT NULL,
    modes_json TEXT NOT NULL, assistance_json TEXT NOT NULL, status TEXT NOT NULL,
    created_at TEXT NOT NULL, unit_id TEXT, artifact_path TEXT, published_path TEXT
  );
  CREATE TABLE IF NOT EXISTS reviews (
    id TEXT PRIMARY KEY, draft_id TEXT NOT NULL, role TEXT NOT NULL, verdict TEXT NOT NULL,
    artifact_hash TEXT, report_path TEXT, rationale TEXT, created_at TEXT NOT NULL, FOREIGN KEY (draft_id) REFERENCES drafts(id)
  );
  CREATE TABLE IF NOT EXISTS claims (
    draft_id TEXT NOT NULL, operation TEXT NOT NULL, role TEXT NOT NULL DEFAULT '',
    claimed_at TEXT NOT NULL, expires_at TEXT NOT NULL,
    PRIMARY KEY (draft_id, operation, role)
  );
`);
try { database.exec("ALTER TABLE drafts ADD COLUMN published_path TEXT"); } catch { /* Existing database already has the column. */ }
try { database.exec("ALTER TABLE drafts ADD COLUMN unit_id TEXT"); } catch { /* Existing database already has the column. */ }
try { database.exec("ALTER TABLE reviews ADD COLUMN rationale TEXT"); } catch { /* Existing database already has the column. */ }
try { database.exec("ALTER TABLE reviews ADD COLUMN report_path TEXT"); } catch { /* Existing database already has the column. */ }
try { database.exec("ALTER TABLE drafts ADD COLUMN error TEXT"); } catch { /* Existing database already has the column. */ }
try { database.exec("ALTER TABLE drafts ADD COLUMN slug TEXT"); } catch { /* Existing database already has the column. */ }
database.exec("CREATE TABLE IF NOT EXISTS schema_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
database.prepare("INSERT OR REPLACE INTO schema_meta (key, value) VALUES (?, ?)").run("authoring_schema", "2");

type DraftStatus = "draft" | "queued" | "generated" | "validated" | "llm_reviewed" | "needs_revision" | "revision_requested" | "accepted" | "failed";
type DraftRecord = {
  id: string;
  taskId?: string;
  slug?: string;
  title: string;
  problem: string;
  provider: string;
  model: string;
  language: string;
  variants: number;
  modes: string[];
  assistance: string[];
  status: DraftStatus;
  createdAt: string;
  unitId?: string;
  artifactPath?: string;
  publishedPath?: string;
  error?: string;
};
type ReviewRecord = {
  id: string;
  draftId: string;
  role: string;
  verdict: "pending" | "pass" | "needs_revision" | "reject";
  artifactHash: string | null;
  reportPath?: string;
  rationale?: string;
  createdAt: string;
};
type State = { drafts: DraftRecord[]; reviews: ReviewRecord[] };

function validateDraft(draft: DraftRecord): string[] {
  const errors: string[] = [];
  if (draft.problem.trim().length < 20) errors.push("problem must contain at least 20 characters");
  if (draft.modes.length === 0) errors.push("at least one practice mode is required");
  if (!draft.modes.includes("code_recall") && draft.assistance.length > 0) errors.push("code recall assistance requires code_recall");
  if (draft.variants < 0 || draft.variants > 5) errors.push("variants must be 0 (auto) or between 1 and 5");
  return errors;
}

function validatePersistedDraft(draft: DraftRecord): void {
  const errors = validateDraft(draft);
  if (errors.length > 0) {
    throw new DraftInputError(errors);
  }
}

class DraftInputError extends Error {
  constructor(readonly errors: string[]) {
    super(errors.join("; "));
    this.name = "DraftInputError";
  }
}

function loadState(): State {
  const drafts = database.prepare("SELECT id, task_id, slug, title, problem, provider, model, language, variants, modes_json, assistance_json, status, created_at, unit_id, artifact_path, published_path, error FROM drafts ORDER BY created_at DESC, rowid DESC").all() as Array<Record<string, unknown>>;
  const reviews = database.prepare("SELECT id, draft_id, role, verdict, artifact_hash, report_path, rationale, created_at FROM reviews ORDER BY created_at DESC, rowid DESC").all() as Array<Record<string, unknown>>;
  return {
    drafts: drafts.map((row) => ({ id: String(row.id), taskId: row.task_id ? String(row.task_id) : undefined, slug: row.slug ? String(row.slug) : undefined, title: String(row.title), problem: String(row.problem), provider: String(row.provider), model: String(row.model), language: String(row.language), variants: Number(row.variants), modes: JSON.parse(String(row.modes_json)) as string[], assistance: JSON.parse(String(row.assistance_json)) as string[], status: row.status as DraftStatus, createdAt: String(row.created_at), unitId: row.unit_id ? String(row.unit_id) : undefined, artifactPath: row.artifact_path ? String(row.artifact_path) : undefined, publishedPath: row.published_path ? String(row.published_path) : undefined, error: row.error ? String(row.error) : undefined })),
    reviews: reviews.filter((row) => row.role !== "all").map((row) => ({ id: String(row.id), draftId: String(row.draft_id), role: String(row.role), verdict: row.verdict as ReviewRecord["verdict"], artifactHash: row.artifact_hash ? String(row.artifact_hash) : null, reportPath: row.report_path ? String(row.report_path) : undefined, rationale: row.rationale ? String(row.rationale) : undefined, createdAt: String(row.created_at) })),
  };
}

function saveState(state: State): void {
  database.exec("BEGIN");
  try {
    // Per-row upserts instead of DELETE-all + re-insert: concurrent requests
    // (and any stale process) can only update their own rows, so a later save
    // can never clobber another request's accepted status or resurrect
    // unrelated rows.
    for (const draft of state.drafts) upsertDraft(database, draft);
    for (const review of state.reviews.filter((item) => item.role !== "all")) upsertReview(database, review);
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

function migrateLegacyState(): void {
  if (!existsSync(join(storageRoot, "state.json"))) return;
  // One-time migration: a marker prevents re-importing the legacy snapshot
  // every time the API starts with an empty store (which resurrected old
  // test drafts after every deliberate wipe).
  const migrated = database.prepare("SELECT value FROM schema_meta WHERE key = 'legacy_state_migrated'").get() as { value?: string } | undefined;
  if (migrated) return;
  const count = Number((database.prepare("SELECT COUNT(*) AS count FROM drafts").get() as { count: number }).count);
  if (count === 0) {
    const legacy = JSON.parse(readFileSync(join(storageRoot, "state.json"), "utf8")) as Partial<State>;
    saveState({ drafts: Array.isArray(legacy.drafts) ? legacy.drafts : [], reviews: Array.isArray(legacy.reviews) ? legacy.reviews.filter((review) => review.role !== "all") : [] });
  }
  database.prepare("INSERT OR REPLACE INTO schema_meta (key, value) VALUES ('legacy_state_migrated', '1')").run();
}

migrateLegacyState();

async function revisionFeedbackFor(draft: DraftRecord, reviews: ReviewRecord[]): Promise<string> {
  const relevant = reviews.filter((review) => review.draftId === draft.id && (review.verdict === "needs_revision" || review.verdict === "reject") && review.reportPath);
  const chunks: string[] = [];
  for (const review of relevant) {
    const reportPath = resolve(here, "../..", "..", review.reportPath!);
    try {
      const report = JSON.parse(await readFile(reportPath, "utf8")) as { findings?: Array<{ rule_id?: string; severity?: string; path?: string; problem?: string; suggested_change?: string }> };
      if (!Array.isArray(report.findings)) continue;
      for (const finding of report.findings) {
        chunks.push(`- [${finding.rule_id ?? "rule"}][${finding.severity ?? "info"}] ${finding.path ?? ""}: ${finding.problem ?? ""} Suggested: ${finding.suggested_change ?? "see report"}`);
      }
    } catch {
      // A report that cannot be read must not block regeneration; the reviewer verdict still gates approval.
    }
  }
  // The decisive LLM acceptance gate records its needs_revision rationale as
  // a review without a report file; feed it back so the repair regeneration
  // is informed by the gate instead of blind.
  for (const review of reviews) {
    if (review.draftId === draft.id && review.role === "llm_acceptance" && review.verdict === "needs_revision" && review.rationale) {
      chunks.push(`- [llm acceptance gate] ${review.rationale}`);
    }
  }
  return chunks.join("\n");
}

/** Applies a content-lifecycle transition to the artifact manifest. This is
 * fail-hard: a transition is only complete when the manifest was read,
 * stamped, and written back — an unreadable manifest aborts the request
 * before the draft state is persisted, so the two can never drift. */
function stampManifestWith(draft: DraftRecord, transition: ContentTransitionId): void {
  if (!draft.artifactPath) throw new Error("cannot stamp content state without an artifact");
  const unitPath = join(artifactAbsolutePath(draft), "unit.json");
  const manifest = JSON.parse(readFileSync(unitPath, "utf8")) as unknown;
  writeFileSync(unitPath, `${JSON.stringify(applyContentTransition(manifest, transition), null, 2)}\n`);
}

async function generateDraft(
  draft: DraftRecord,
  reviews: ReviewRecord[],
  overrides?: { provider?: string; model?: string },
): Promise<{ provider: string; model: string; artifactPath: string }> {
  const definition = builtinTaskRegistry.resolve(draft.taskId, draft.problem);
  const options = optionsFromEnvironment(
    overrides?.provider || overrides?.model
      ? { ...process.env, GEWU_LLM_PROVIDER: overrides.provider, GEWU_LLM_MODEL: overrides.model }
      : undefined,
  );
  const generatedAt = new Date().toISOString();
  const profile = {
    practice_modes: draft.modes as PracticeModeSelection[],
    code_recall_assistance: draft.assistance as CodeRecallAssistanceSelection[],
    code_recall_layouts: draft.modes.includes("code_recall") ? codeRecallLayoutsFor(draft.assistance) : [],
    implementation_languages: [draft.language],
    implementation_variants: draft.variants,
  } satisfies GenerationProfile;
  const baseTask = definition.buildTask(draft.problem, profile);
  // Revision feedback (pre-review findings and the acceptance gate's
  // needs_revision rationale) is applied on every regeneration, including a
  // reused draft after a failed attempt, so repairs are informed instead of
  // blind. revisionFeedbackFor returns "" when there is nothing relevant.
  const revisionFeedback = await revisionFeedbackFor(draft, reviews);
  let instruction = baseTask.instruction;
  if (draft.unitId) instruction += `\n\nThe manifest id MUST be exactly "${draft.unitId}" so this draft publishes as a new revision of that unit.`;
  if (revisionFeedback) instruction += `\n\nRevision feedback from the last LLM pre-review. Address every finding in the regenerated artifact, including the statement, implementation, and tests where relevant:\n${revisionFeedback}`;
  // A retry from the failed state is informed by the last validation error
  // (schema/contract assertions from the backend), but never by upstream or
  // transport noise (403 blocks, timeouts), which would only confuse the
  // model and waste another generation.
  if (draft.status === "failed" && draft.error && !/stop reason error|HTTP \d{3}|<!doctype|econn|etimedout|timeout|fetch failed|socket/i.test(draft.error)) {
    instruction += `\n\nThe previous generation failed validation. Address the reported problems and return a complete, valid artifact:\n${draft.error}`;
  }

  const coreArtifact = await new PiGenerator(options).generate({
    ...baseTask,
    instruction: coreStageInstruction(instruction, draft.variants, draft.language),
    validate: async (value: unknown) => {
      validateCoreStage(value, draft.language);
      await validateCoreArtifactWithRust(value);
    },
  });
  const coreManifest = coreArtifact.manifest;
  if (!isRecord(coreManifest) || !isRecord(coreManifest.manifest) || !isRecord(coreManifest.sources)) throw new Error("core stage returned an invalid artifact");
  const manifest = coreManifest.manifest as Record<string, unknown>;
  if (draft.unitId) {
    manifest.id = draft.unitId;
  } else if (draft.slug) {
    // Deterministic per-slug, per-language unit identity for batch runs.
    manifest.id = `${draft.slug}.${draft.language}`;
  } else {
    // Web-created drafts: keep the model's base id, language-qualified.
    manifest.id = qualifyUnitId(typeof manifest.id === "string" ? manifest.id : undefined, draft.language);
  }
  // Unit identity is language-qualified (ADR 0019): every implementation of a
  // unit must be in the unit's language, so the generated code matches the
  // language suffix and the language-specific source/test paths.
  if (Array.isArray(manifest.implementations)) {
    for (const implementation of manifest.implementations) {
      if (isRecord(implementation)) implementation.language = draft.language;
    }
  }
  assertExplicitVariantCount(
    Array.isArray(manifest.implementations)
      ? manifest.implementations.filter(isRecord).map((item) => String(item.key ?? ""))
      : [],
    draft.variants,
  );

  const stageContext = stageContextFromCore(manifest, coreManifest.sources, draft.problem, draft.language);
  for (const spec of STAGE_SPECS) {
    if (spec.mode === "code_recall") {
      if (!draft.modes.includes("code_recall") || !profile.code_recall_layouts.includes(spec.layout!)) continue;
    } else if (!draft.modes.includes(spec.mode)) {
      continue;
    }
    const stageArtifact = await new PiGenerator(options).generate(buildStageTask(spec, profile, stageContext, revisionFeedback));
    mergeStage(spec, manifest, stageArtifact.manifest);
  }
  assertVariantCoverage(manifest);

  const trustedManifest = applyTrustedProvenance(
    applyTrustedDraftState(manifest),
    options.provider,
    options.model,
    baseTask.taskVersion,
    generatedAt,
  );
  const provenance = isRecord(trustedManifest.provenance) ? trustedManifest.provenance : undefined;
  if (Array.isArray(provenance?.sources)) {
    for (const [sourceIndex, source] of provenance.sources.entries()) {
      if (!isRecord(source) || typeof source.role !== "string" || !["primary", "synthesis", "lead"].includes(source.role)) {
        throw new Error(`provenance.sources[${sourceIndex}].role must be one of primary, synthesis, lead`);
      }
    }
  }
  materializeSourceTemplates(trustedManifest, coreManifest.sources);
  definition.validateArtifact({ manifest: trustedManifest, sources: coreManifest.sources });
  const artifactAbsolutePath = join(storageRoot, "artifacts", `${draft.id}-${Date.now()}`);
  await mkdir(artifactAbsolutePath, { recursive: true });
  await writeFile(join(artifactAbsolutePath, "unit.json"), `${JSON.stringify(trustedManifest, null, 2)}\n`, "utf8");
  for (const [sourcePath, content] of Object.entries(coreManifest.sources)) {
    if (typeof content !== "string" || sourcePath.includes("..") || sourcePath.startsWith("/")) throw new Error(`invalid generated source path: ${sourcePath}`);
    const destination = join(artifactAbsolutePath, sourcePath);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, content, "utf8");
  }
  await writeFile(join(artifactAbsolutePath, "generation.json"), `${JSON.stringify({ provider: options.provider, model: options.model, task_id: baseTask.taskId, task_version: baseTask.taskVersion, review: "pending" }, null, 2)}\n`, "utf8");
  await validateArtifactWithRust(artifactAbsolutePath);
  return { provider: options.provider, model: options.model, artifactPath: relative(resolve(here, "../..", ".."), artifactAbsolutePath) };
}

const execFileAsync = promisify(execFile);

/**
 * Runs the authoritative Rust template validator on a core-stage artifact so
 * contract violations surface inside Pi-ai's structured retry loop (the model
 * receives the exact validation error and corrects it) instead of failing at
 * the end of generation.
 */
async function validateCoreArtifactWithRust(value: unknown): Promise<void> {
  if (!isRecord(value) || !isRecord(value.manifest) || !isRecord(value.sources)) throw new Error("core stage returned an invalid artifact");
  const manifest = value.manifest as Record<string, unknown>;
  const sources = value.sources as Record<string, string>;
  const staged = join(storageRoot, "artifacts", `.retry-${crypto.randomUUID()}`);
  await mkdir(staged, { recursive: true });
  try {
    materializeSourceTemplates(manifest, sources);
    await writeFile(join(staged, "unit.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    for (const [sourcePath, content] of Object.entries(sources)) {
      if (typeof content !== "string" || sourcePath.includes("..") || sourcePath.startsWith("/")) throw new Error(`invalid generated source path: ${sourcePath}`);
      const destination = join(staged, sourcePath);
      await mkdir(dirname(destination), { recursive: true });
      await writeFile(destination, content, "utf8");
    }
    await validateArtifactWithRust(staged, false);
  } finally {
    await rm(staged, { recursive: true, force: true });
  }
}

/**
 * Final acceptance gate driven by a designated approver model. The model reads
 * the problem, the manifest, and every LLM pre-review finding, then returns
 * pass or needs_revision. The verdict is recorded as an `llm_acceptance`
 * review so the audit trail shows the approval came from an LLM gate.
 */
async function runModelAcceptance(
  draft: DraftRecord,
  reviews: ReviewRecord[],
  overrides?: { provider?: string; model?: string },
): Promise<{ review: ReviewRecord; rationale: string }> {
  const root = artifactAbsolutePath(draft);
  const manifest = await readFile(join(root, "unit.json"), "utf8");
  // The gate must read the actual implementation and tests, not just the
  // manifest paths — otherwise a strict reviewer correctly reports the
  // source as "not provided". Missing files are omitted so the gate can
  // flag an incomplete artifact.
  const sources: Array<{ path: string; content: string }> = [];
  for (const relativePath of [sourcePathFor(draft.language), testPathFor(draft.language)]) {
    try {
      sources.push({ path: relativePath, content: await readFile(join(root, relativePath), "utf8") });
    } catch {
      // Optional: a missing file is a legitimate acceptance finding.
    }
  }
  const reports = await Promise.all(
    reviews
      .filter((review) => review.draftId === draft.id && review.reportPath)
      .map(async (review) => {
        const report = JSON.parse(await readFile(resolve(here, "../..", "..", review.reportPath!), "utf8")) as unknown;
        return { role: review.role, verdict: review.verdict, report: isRecord(report) ? report : {} };
      }),
  );
  const options = optionsFromEnvironment(
    overrides?.provider || overrides?.model
      ? { ...process.env, GEWU_LLM_PROVIDER: overrides.provider, GEWU_LLM_MODEL: overrides.model }
      : undefined,
  );
  const task = buildAcceptanceTask(draft.problem, manifest, reports, sources);
  const artifact = await new PiGenerator(options).generate(task);
  if (!isRecord(artifact.manifest) || typeof artifact.manifest.verdict !== "string") throw new Error("acceptance review returned an invalid response");
  const verdict = artifact.manifest.verdict === "pass" ? "pass" : "needs_revision";
  const rationale = typeof artifact.manifest.rationale === "string" ? artifact.manifest.rationale : "";
  const report = {
    rubric_version: "acceptance-v1",
    role: "llm_acceptance",
    provider: artifact.provider,
    model: artifact.model,
    verdict,
    rationale,
    findings: Array.isArray(artifact.manifest.findings) ? artifact.manifest.findings : [],
  };
  const reviewsDir = join(root, "reviews");
  await mkdir(reviewsDir, { recursive: true });
  await writeFile(join(reviewsDir, "llm_acceptance.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return {
    rationale,
    review: {
      id: crypto.randomUUID(),
      draftId: draft.id,
      role: "llm_acceptance",
      verdict,
      artifactHash: latestArtifactHash(reviews, draft.id),
      reportPath: relative(resolve(here, "../..", ".."), join(reviewsDir, "llm_acceptance.json")),
      createdAt: new Date().toISOString(),
    },
  };
}

async function validateArtifactWithRust(artifactPath: string, cleanupOnFailure = true): Promise<void> {
  const repoRoot = resolve(here, "../..", "..");
  const validator = join(repoRoot, "target/debug/validate");
  try {
    if (existsSync(validator)) {
      await execFileAsync(validator, [join(artifactPath, "unit.json")], { cwd: repoRoot, maxBuffer: 2_000_000 });
    } else {
      await execFileAsync("cargo", ["run", "--quiet", "-p", "gewu-template", "--bin", "validate", "--", join(artifactPath, "unit.json")], { cwd: repoRoot, maxBuffer: 2_000_000 });
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    if (cleanupOnFailure) await rm(artifactPath, { recursive: true, force: true });
    throw new Error(`Rust template validation failed: ${detail}`);
  }
}

function artifactAbsolutePath(draft: DraftRecord): string {
  if (!draft.artifactPath) throw new Error("draft has no generated artifact");
  const repoRoot = resolve(here, "../..", "..");
  const absolute = resolve(repoRoot, draft.artifactPath);
  const draftsRoot = resolve(here, "../drafts");
  if (!absolute.startsWith(`${draftsRoot}/`)) throw new Error("artifact is outside the drafts root");
  return absolute;
}

function latestArtifactHash(reviews: ReviewRecord[], draftId: string): string | null {
  return reviews.find((review) => review.draftId === draftId)?.artifactHash ?? null;
}
function latestReviewForRole(reviews: ReviewRecord[], draftId: string, role: string): ReviewRecord | undefined {
  return reviews.find((review) => review.draftId === draftId && review.role === role);
}

async function readArtifact(draft: DraftRecord, reviews: ReviewRecord[]): Promise<Record<string, unknown>> {
  const root = artifactAbsolutePath(draft);
  const files: Record<string, string> = {};
  const walk = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const absolute = join(directory, entry.name);
      if (entry.isDirectory()) await walk(absolute);
      else files[relative(root, absolute)] = await readFile(absolute, "utf8");
    }
  };
  await walk(root);
  const reports = await Promise.all(reviews.filter((review) => review.draftId === draft.id && review.reportPath).map(async (review) => ({
    ...review,
    report: JSON.parse(await readFile(resolve(here, "../..", "..", review.reportPath!), "utf8")) as unknown,
  })));
  return { draft, files, reviews: reports };
}

async function publishArtifact(draft: DraftRecord, reviews: ReviewRecord[]): Promise<string> {
  if (!publishedRoot) throw new Error("publishing is not configured; set GEWU_PUBLISHED_ROOT");
  const source = artifactAbsolutePath(draft);
  const manifest = JSON.parse(await readFile(join(source, "unit.json"), "utf8")) as Record<string, unknown>;
  const id = typeof manifest.id === "string" ? manifest.id : undefined;
  if (!id || !/^[a-z0-9]+(?:[.-][a-z0-9]+)+$/.test(id)) throw new Error("published artifact has no valid unit identity");
  const unitRoot = resolve(publishedRoot, id);
  let nextRevision = 1;
  if (existsSync(unitRoot)) {
    for (const entry of await readdir(unitRoot, { withFileTypes: true })) {
      const match = entry.isDirectory() ? /^r(\d+)$/.exec(entry.name) : null;
      if (match) nextRevision = Math.max(nextRevision, Number(match[1]) + 1);
    }
  }
  manifest.revision = nextRevision;
  // A published unit must be content-validated: apply the publish transition
  // and refuse to publish if any validation stage is still pending — the
  // structural guard that makes an unstamped artifact unpublishable.
  const stamped = applyContentTransition(manifest, "publish");
  assertPublishable(stamped);
  Object.assign(manifest, stamped);
  // A manifest's supersedes entries reference prior revisions of the same
  // unit. When this is the first published revision (or the model claimed a
  // revision that is not earlier), drop the invalid entries so the published
  // artifact can never supersede itself or a revision that does not exist.
  const supersedes = normalizeSupersedes(manifest.supersedes, nextRevision);
  // `supersedes` is a required manifest field: an empty array for a first
  // revision (or when every entry referenced a non-earlier revision).
  if (supersedes === undefined) manifest.supersedes = [];
  else manifest.supersedes = supersedes;
  const destination = resolve(unitRoot, `r${nextRevision}`);
  if (!destination.startsWith(`${publishedRoot}/`)) throw new Error("published artifact path escaped configured root");
  await mkdir(publishedRoot, { recursive: true });
  await rm(destination, { recursive: true, force: true });
  // The content pack carries the full review record: copy the artifact's
  // reviews/ (LLM pre-review role reports + acceptance gate report) and add
  // the distilled summary below, so reviewers see the LLM/human feedback
  // behind each published unit even without the local authoring store.
  await cp(source, destination, { recursive: true });
  await writeFile(join(destination, "unit.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  // The content pack carries the audit summary (acceptance rationale + the
  // needs_revision history), so reviewers on a fresh clone see the LLM/human
  // feedback behind each published unit.
  const summary = buildReviewSummary(reviews.map((review) => ({
    role: review.role,
    verdict: review.verdict,
    rationale: review.rationale,
    at: review.createdAt,
  })));
  const publishedReviewsDir = join(destination, "reviews");
  await mkdir(publishedReviewsDir, { recursive: true });
  await writeFile(join(publishedReviewsDir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  try {
    await validateArtifactWithRust(destination, false);
  } catch (error) {
    await rm(destination, { recursive: true, force: true });
    throw error;
  }
  // The published root serves the latest revision only: earlier revisions
  // live on in the authoring store as accepted drafts (their artifacts are
  // retained), and forking one republishes it as a new revision.
  for (const entry of await readdir(unitRoot, { withFileTypes: true })) {
    if (entry.isDirectory() && entry.name !== `r${nextRevision}` && /^r\d+$/.test(entry.name)) {
      await rm(join(unitRoot, entry.name), { recursive: true, force: true });
    }
  }
  await buildPublishedPackManifest();
  return relative(resolve(here, "../..", ".."), destination);
}

/**
 * Startup guard: validate every published unit revision and quarantine any
 * invalid one (move it under `.invalid/`) so a bad artifact can never break
 * the Core's unit list (the symptom behind "Rust Core is unavailable").
 */
async function validatePublishedContent(): Promise<void> {
  if (!existsSync(publishedRoot)) return;
  for (const unitDir of await readdir(publishedRoot, { withFileTypes: true })) {
    if (!unitDir.isDirectory() || unitDir.name === ".invalid" || !/^[a-z0-9.-]+$/.test(unitDir.name)) continue;
    for (const revisionDir of await readdir(join(publishedRoot, unitDir.name), { withFileTypes: true })) {
      if (!revisionDir.isDirectory() || !/^r\d+$/.test(revisionDir.name)) continue;
      const revisionPath = join(publishedRoot, unitDir.name, revisionDir.name);
      try {
        await validateArtifactWithRust(revisionPath, false);
      } catch {
        const quarantine = join(publishedRoot, ".invalid", `${unitDir.name}-${revisionDir.name}`);
        await mkdir(dirname(quarantine), { recursive: true });
        await rm(quarantine, { recursive: true, force: true });
        await rename(revisionPath, quarantine);
        console.error(`published unit quarantined: ${unitDir.name}/${revisionDir.name} -> .invalid/`);
      }
    }
  }
}

async function buildPublishedPackManifest(): Promise<void> {
  const manifestPath = join(publishedRoot, "pack.json");
  const repoRoot = resolve(here, "../..", "..");
  const packBinary = join(repoRoot, "target/debug/pack");
  const args = ["build", publishedRoot, manifestPath, "gewu-workbench", "0.1.0"];
  if (existsSync(packBinary)) await execFileAsync(packBinary, args, { cwd: repoRoot, maxBuffer: 2_000_000 });
  else await execFileAsync("cargo", ["run", "--quiet", "-p", "gewu-template", "--bin", "pack", "--", ...args], { cwd: repoRoot, maxBuffer: 2_000_000 });
}

const REVIEW_ROLES = new Set(["algorithm_correctness", "learning_design", "provenance_safety"]);

async function pruneUnreferencedArtifacts(draft: DraftRecord, reviews: ReviewRecord[]): Promise<void> {
  const root = join(storageRoot, "artifacts");
  if (!existsSync(root)) return;
  const retention = Math.max(1, Number(process.env.GEWU_ARTIFACT_RETENTION ?? 5));
  const current = draft.artifactPath ? basenameSafe(draft.artifactPath) : "";
  const referenced = reviews.filter((review) => review.draftId === draft.id && review.reportPath).map((review) => review.reportPath!);
  const entries = (await readdir(root, { withFileTypes: true })).filter((entry) => entry.isDirectory() && entry.name.startsWith(`${draft.id}-`)).sort((left, right) => right.name.localeCompare(left.name));
  let keptUnreferenced = 0;
  for (const entry of entries) {
    const isCurrent = entry.name === current;
    const isReferenced = referenced.some((path) => path.includes(`/artifacts/${entry.name}/`));
    if (isCurrent || isReferenced || keptUnreferenced++ < retention) continue;
    await rm(join(root, entry.name), { recursive: true, force: true });
  }
}

function basenameSafe(path: string): string { return path.split(/[\\/]/).pop() ?? ""; }

function send(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "access-control-allow-origin": "http://127.0.0.1:5173",
    "access-control-allow-headers": "content-type",
    "access-control-allow-methods": "GET,POST,PATCH,PUT,OPTIONS",
  });
  response.end(JSON.stringify(body));
}

async function body(request: IncomingMessage): Promise<unknown> {
  let content = "";
  for await (const chunk of request) {
    content += chunk.toString();
    if (content.length > 1_000_000) throw new Error("request body is too large");
  }
  return JSON.parse(content || "{}");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function draftFrom(value: unknown): DraftRecord {
  if (!isRecord(value) || typeof value.title !== "string" || typeof value.problem !== "string" || value.problem.trim() === "") {
    throw new Error("title and a non-empty problem are required");
  }
  const list = (key: string): string[] => {
    const result = value[key];
    if (!Array.isArray(result) || result.some((item) => typeof item !== "string")) throw new Error(`${key} must be a string array`);
    return result;
  };
  const variants = value.variants;
  if (!Number.isInteger(variants) || Number(variants) < 0 || Number(variants) > 5) throw new Error("variants must be 0 (auto) or between 1 and 5");
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    taskId: typeof value.taskId === "string" ? value.taskId : undefined,
    slug: typeof value.slug === "string" && /^[a-z0-9]+(?:[-.][a-z0-9]+)*$/.test(value.slug.trim().toLowerCase()) ? value.slug.trim().toLowerCase() : undefined,
    title: value.title,
    problem: value.problem,
    provider: typeof value.provider === "string" ? value.provider : "deepseek",
    model: typeof value.model === "string" ? value.model : "deepseek-v4-flash",
    language: typeof value.language === "string" && value.language ? value.language : "python",
    variants: Number(variants),
    modes: list("modes"),
    assistance: list("assistance"),
    status: "queued",
    createdAt: now,
    unitId: typeof value.unitId === "string" && value.unitId ? value.unitId : undefined,
  };
}

const server = createServer(async (request, response) => {
  if (request.method === "OPTIONS") return send(response, 204, {});
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
  try {
    if (request.method === "GET" && url.pathname === "/api/health") return send(response, 200, { status: "ok", storage: "local", build: BUILD_ID });
    if (request.method === "GET" && url.pathname === "/api/tasks") return send(response, 200, { tasks: builtinTaskRegistry.list().map((definition) => ({ taskId: definition.taskId, label: definition.label, taskVersion: definition.taskVersion })) });
    if (request.method === "GET" && url.pathname === "/api/providers") {
      // Provider list comes from the declarative registry (providers.json):
      // builtins route through Pi-ai, relay entries through our
      // OpenAI-compatible relay support.
      const providers = [...providerRegistry().values()].map((entry) => ({
        id: entry.id,
        label: entry.label,
        kind: entry.kind,
        configured: entry.kind === "builtin"
          ? Boolean(entry.keyEnv && process.env[entry.keyEnv])
          : Boolean(entry.baseUrlEnv && process.env[entry.baseUrlEnv]),
        models: modelCatalog.getModels(entry.id).map((model) => model.id),
      }));
      return send(response, 200, { providers });
    }
    if (request.method === "GET" && url.pathname === "/api/published-units") {
      // Published units are the batch dedup source on fresh clones: the local
      // store may be empty, so the committed ledger (units/index.json) is the
      // authoritative "what is published" record — dedup works even before
      // the content pack is fetched. Fall back to scanning the content root
      // when the ledger is missing (legacy setups).
      const units: Array<{ id: string; title: string; language: string; revision: number; modes: string[]; updatedAt: string }> = [];
      const ledgerPath = join(resolve(here, "../../.."), "units", "index.json");
      if (existsSync(ledgerPath)) {
        try {
          const ledger = JSON.parse(await readFile(ledgerPath, "utf8")) as { units?: Array<Record<string, unknown>> };
          if (Array.isArray(ledger.units)) {
            for (const entry of ledger.units) {
              if (!isRecord(entry) || typeof entry.id !== "string") continue;
              units.push({
                id: entry.id,
                title: typeof entry.title === "string" ? entry.title : entry.id,
                language: typeof entry.language === "string" && entry.language ? entry.language : "python",
                revision: Number(entry.revision ?? 1),
                modes: Array.isArray(entry.modes) ? entry.modes.map(String) : [],
                updatedAt: typeof entry.updatedAt === "string" ? entry.updatedAt : "",
              });
            }
            return send(response, 200, { units });
          }
        } catch {
          // Fall through to scanning the content root.
        }
      }
      if (existsSync(publishedRoot)) {
        for (const entry of await readdir(publishedRoot, { withFileTypes: true })) {
          if (!entry.isDirectory()) continue;
          const unitDir = join(publishedRoot, entry.name);
          let latestRevision = 0;
          let latestDir = "";
          for (const revision of await readdir(unitDir, { withFileTypes: true })) {
            const match = /^r(\d+)$/.exec(revision.name);
            if (revision.isDirectory() && match && Number(match[1]) > latestRevision) {
              latestRevision = Number(match[1]);
              latestDir = revision.name;
            }
          }
          if (!latestDir) continue;
          try {
            const manifest = JSON.parse(await readFile(join(unitDir, latestDir, "unit.json"), "utf8")) as Record<string, unknown>;
            const practice = isRecord(manifest.practice) ? manifest.practice : {};
            units.push({
              id: typeof manifest.id === "string" ? manifest.id : entry.name,
              title: typeof manifest.title === "string" ? manifest.title : entry.name,
              language: typeof manifest.language === "string" && manifest.language ? manifest.language : "python",
              revision: latestRevision,
              modes: Object.keys(practice),
              updatedAt: statSync(join(unitDir, latestDir)).mtime.toISOString(),
            });
          } catch {
            // An unreadable unit must not block the list; skip it.
          }
        }
      }
      return send(response, 200, { units });
    }
    const state = await loadState();
    if (request.method === "GET" && url.pathname === "/api/drafts") return send(response, 200, { drafts: state.drafts });
    if (request.method === "GET" && url.pathname === "/api/reviews") return send(response, 200, { reviews: state.reviews });
    if (request.method === "POST" && url.pathname === "/api/drafts") {
      const draft = draftFrom(await body(request));
      validatePersistedDraft(draft);
      state.drafts = [draft, ...state.drafts];
      await saveState(state);
      return send(response, 201, { draft });
    }
    const updateMatch = url.pathname.match(/^\/api\/drafts\/([^/]+)$/);
    if (request.method === "PATCH" && updateMatch) {
      const draft = state.drafts.find((item) => item.id === updateMatch[1]);
      if (!draft) return send(response, 404, { error: "draft not found" });
      const payload = await body(request);
      const expectedStatus = isRecord(payload) && typeof payload.expectedStatus === "string" ? payload.expectedStatus : undefined;
      // Reuse/reset is a state-machine transition: refuse to clobber an
      // accepted draft, and refuse stale clients whose observed status no
      // longer matches (optimistic concurrency).
      const reuseGuardError = draftReuseGuard(draft, expectedStatus);
      if (reuseGuardError) return send(response, 409, { error: reuseGuardError, currentStatus: draft.status, expectedStatus });
      const updated = draftFrom({ ...draft, ...(isRecord(payload) ? payload : {}) });
      updated.id = draft.id;
      updated.createdAt = draft.createdAt;
      updated.unitId = draft.unitId;
      updated.status = "queued";
      updated.artifactPath = undefined;
      updated.publishedPath = undefined;
      updated.error = undefined;
      validatePersistedDraft(updated);
      // Compare-and-set at the storage layer: the update only lands if the
      // row still has the status the caller observed (or the current status
      // when no expectation was given), so a concurrent writer can never be
      // silently overwritten. The DB is already correct after this, so we do
      // not re-save the whole in-memory snapshot (which could clobber other
      // rows changed concurrently since loadState).
      const casApplied = casUpsertDraft(database, updated, expectedStatus ?? draft.status);
      if (!casApplied) {
        return send(response, 409, {
          error: "draft changed concurrently; reload and retry",
          currentStatus: state.drafts.find((item) => item.id === draft.id)?.status ?? "unknown",
          expectedStatus,
        });
      }
      // Keep needs_revision/reject reviews on reuse: they are the feedback
      // the next generation needs. Pass/pending reviews are stale once the
      // artifact is replaced and are dropped so a stale pass can never gate
      // acceptance.
      database.prepare("DELETE FROM reviews WHERE draft_id = ? AND verdict NOT IN ('needs_revision', 'reject')").run(draft.id);
      state.drafts = state.drafts.map((item) => item.id === draft.id ? updated : item);
      state.reviews = state.reviews.filter((review) => review.draftId !== draft.id || review.verdict === "needs_revision" || review.verdict === "reject");
      return send(response, 200, { draft: updated });
    }
    const generationMatch = url.pathname.match(/^\/api\/drafts\/([^/]+)\/generate$/);
    if (request.method === "POST" && generationMatch) {
      const draft = state.drafts.find((item) => item.id === generationMatch[1]);
      if (!draft) return send(response, 404, { error: "draft not found" });
      const generateError = assertDraftTransition(draft.status, "generate");
      if (generateError) return send(response, 409, { error: generateError });
      if (!tryAcquireClaim(database, { draftId: draft.id, operation: "generate" })) {
        return send(response, 409, { error: "draft generation is already in progress" });
      }
      const generationPayload = await body(request).catch(() => ({}));
      const generationOverrides = isRecord(generationPayload) && (typeof generationPayload.provider === "string" || typeof generationPayload.model === "string")
        ? { provider: typeof generationPayload.provider === "string" ? generationPayload.provider : undefined, model: typeof generationPayload.model === "string" ? generationPayload.model : undefined }
        : undefined;
      try {
        const generated = await generateDraft(draft, state.reviews, generationOverrides);
        draft.status = "generated";
        draft.artifactPath = generated.artifactPath;
        draft.provider = generated.provider;
        draft.model = generated.model;
        draft.error = undefined;
        await pruneUnreferencedArtifacts(draft, state.reviews);
        await saveState(state);
        return send(response, 200, { status: "generated", provider: generated.provider, model: generated.model, artifactPath: generated.artifactPath });
      } catch (error) {
        draft.status = "failed";
        draft.error = error instanceof Error ? error.message : String(error);
        draft.artifactPath = undefined;
        await saveState(state);
        return send(response, 422, { status: "failed", error: draft.error, draft });
      } finally {
        releaseClaim(database, draft.id, "generate");
      }
    }
    const validationMatch = url.pathname.match(/^\/api\/drafts\/([^/]+)\/validate$/);
    if (request.method === "POST" && validationMatch) {
      const draft = state.drafts.find((item) => item.id === validationMatch[1]);
      if (!draft) return send(response, 404, { error: "draft not found" });
      const validateError = assertDraftTransition(draft.status, "validate");
      if (!draft.artifactPath || validateError) return send(response, 409, { error: "generate the draft before deterministic validation" });
      const errors = validateDraft(draft);
      if (errors.length > 0) {
        draft.status = "failed";
        draft.error = errors.join("; ");
        await saveState(state);
        return send(response, 422, { status: "failed", errors, draft });
      }
      try { await validateArtifactWithRust(artifactAbsolutePath(draft), false); } catch (error) {
        draft.status = "failed";
        draft.error = error instanceof Error ? error.message : String(error);
        await saveState(state);
        return send(response, 422, { status: "failed", errors: [draft.error], draft });
      }
      draft.status = "validated";
      draft.error = undefined;
      stampManifestWith(draft, "deterministic_validation");
      await saveState(state);
      return send(response, 200, { status: "passed", draft });
    }
    const acceptanceMatch = url.pathname.match(/^\/api\/drafts\/([^/]+)\/acceptance$/);
    if (request.method === "POST" && acceptanceMatch) {
      const draft = state.drafts.find((item) => item.id === acceptanceMatch[1]);
      if (!draft) return send(response, 404, { error: "draft not found" });
      const acceptanceError = assertDraftTransition(draft.status, "acceptance");
      if (!draft.artifactPath || acceptanceError) {
        return send(response, 409, { error: "model acceptance requires a validated artifact (generate + validate first)" });
      }
      if (!tryAcquireClaim(database, { draftId: draft.id, operation: "acceptance" })) {
        return send(response, 409, { error: "LLM acceptance is already in progress for this draft" });
      }
      try {
        const payload = await body(request).catch(() => ({}));
        const overrides = isRecord(payload) && (typeof payload.provider === "string" || typeof payload.model === "string")
          ? { provider: typeof payload.provider === "string" ? payload.provider : undefined, model: typeof payload.model === "string" ? payload.model : undefined }
          : undefined;
        const { review, rationale } = await runModelAcceptance(draft, state.reviews, overrides);
        if (review.verdict === "pass") {
          // The acceptance gate is the decisive content/transfer review in
          // the automated flow; stamp the manifest so published units do not
          // claim pending validation or a draft lifecycle.
          stampManifestWith(draft, "acceptance_gate_pass");
        }
        state.reviews = [review, ...state.reviews];
        // The acceptance gate is the decisive LLM reviewer: a needs_revision
        // verdict moves the draft to that state so the UI offers revision,
        // while a pass leaves the draft ready for the llm_acceptance publish.
        if (review.verdict === "needs_revision" && draft.status !== "needs_revision") {
          draft.status = "needs_revision";
        }
        await saveState(state);
        return send(response, 200, { verdict: review.verdict, rationale, review });
      } finally {
        releaseClaim(database, draft.id, "acceptance");
      }
    }
    const acceptMatch = url.pathname.match(/^\/api\/drafts\/([^/]+)\/accept$/);
    if (request.method === "POST" && acceptMatch) {
      const draft = state.drafts.find((item) => item.id === acceptMatch[1]);
      if (!draft) return send(response, 404, { error: "draft not found" });
      const payload = await body(request).catch(() => ({}));
      const humanOverride = isRecord(payload) && payload.override === true && typeof payload.rationale === "string" && payload.rationale.trim().length > 0;
      const acceptanceRole = isRecord(payload) && payload.acceptanceRole === "llm_acceptance" ? "llm_acceptance" : "human_acceptance";
      const rationale = isRecord(payload) && typeof payload.rationale === "string" ? payload.rationale.trim() : "";
      if (draft.status === "accepted") {
        // Human approval is superior to an LLM approval: a human may upgrade an
        // LLM-approved published draft by recording an explicit human
        // acceptance with a rationale. The unit stays published.
        const alreadyHuman = state.reviews.some((review) => review.draftId === draft.id && review.role === "human_acceptance");
        if (acceptanceRole !== "human_acceptance" || alreadyHuman) return send(response, 409, { error: "draft is already accepted" });
        if (!rationale) return send(response, 409, { error: "human upgrade requires a rationale" });
        const upgradeReview: ReviewRecord = {
          id: crypto.randomUUID(),
          draftId: draft.id,
          role: "human_acceptance",
          verdict: "pass",
          artifactHash: latestArtifactHash(state.reviews, draft.id),
          rationale,
          createdAt: new Date().toISOString(),
        };
        state.reviews = [upgradeReview, ...state.reviews];
        await saveState(state);
        return send(response, 200, { status: "accepted", draft, publishedPath: draft.publishedPath });
      }
      // The LLM acceptance gate is decisive: a passing llm_acceptance review
      // for the current artifact publishes with the LLM label without any
      // human step, even when advisory pre-review roles found issues.
      // Any artifact-changing operation clears reviews, so a passing
      // llm_acceptance review always corresponds to the current artifact even
      // when no pre-review ran and the acceptance review has no artifact hash.
      const llmAcceptancePass = acceptanceRole === "llm_acceptance"
        && state.reviews.some((review) => review.draftId === draft.id && review.role === "llm_acceptance" && review.verdict === "pass");
      if (!llmAcceptancePass) {
        const humanEdited = state.reviews.some((review) => review.draftId === draft.id && review.role === "human_revision" && review.verdict === "pass");
        const acceptError = assertDraftTransition(draft.status, "accept");
        if (acceptError || (draft.status === "validated" && !humanEdited)) {
          return send(response, 409, { error: "LLM pre-review must pass or the artifact must be human-edited and reviewed before acceptance" });
        }
        if (draft.status === "needs_revision" && !humanOverride && !humanEdited) return send(response, 409, { error: "draft needs revision; send {override:true, rationale} only after explicit human review" });
        const passedReview = humanEdited || state.reviews.some((review) => review.draftId === draft.id && review.verdict === "pass" && review.artifactHash && review.artifactHash === latestArtifactHash(state.reviews, draft.id));
        if (!passedReview && !humanOverride) {
          return send(response, 409, { error: "a passing pre-review for the current artifact is required before human acceptance; send {override:true, rationale} only after explicit human review" });
        }
      }
      const existingAcceptance = state.reviews.some((review) => review.draftId === draft.id && review.role === acceptanceRole
        && (acceptanceRole === "llm_acceptance" ? review.verdict === "pass" : Boolean(review.artifactHash) && review.artifactHash === latestArtifactHash(state.reviews, draft.id)));
      // Record the acceptance review on every approval path (normal or
      // override) so the audit trail always shows who approved and why, and
      // the draft never falls back to the neutral "Approved" label.
      if (!existingAcceptance) {
        const acceptanceReview: ReviewRecord = {
          id: crypto.randomUUID(),
          draftId: draft.id,
          role: acceptanceRole,
          verdict: "pass",
          artifactHash: latestArtifactHash(state.reviews, draft.id),
          rationale: rationale || (acceptanceRole === "human_acceptance" ? "Human approval" : "LLM approval"),
          createdAt: new Date().toISOString(),
        };
        state.reviews = [acceptanceReview, ...state.reviews];
      }
      // Human acceptance also completes the content lifecycle (the decisive
      // review is the human's); stamping before publish is fail-hard, and
      // publish itself refuses an unstamped manifest.
      stampManifestWith(draft, "acceptance_gate_pass");
      const publishedPath = await publishArtifact(draft, state.reviews);
      draft.status = "accepted";
      draft.publishedPath = publishedPath;
      const idMatch = /\/published\/([^/]+)\/r\d+$/.exec(publishedPath);
      draft.unitId = idMatch?.[1] ?? draft.unitId;
      await saveState(state);
      return send(response, 200, { status: "accepted", draft, publishedPath });
    }
    const forkMatch = url.pathname.match(/^\/api\/drafts\/([^/]+)\/fork$/);
    if (request.method === "POST" && forkMatch) {
      const source = state.drafts.find((item) => item.id === forkMatch[1]);
      if (!source) return send(response, 404, { error: "draft not found" });
      const forkError = assertDraftTransition(source.status, "fork");
      if (forkError) return send(response, 409, { error: forkError });
      const now = new Date().toISOString();
      const publishedId = source.publishedPath ? /\/published\/([^/]+)\/r\d+$/.exec(source.publishedPath)?.[1] : undefined;
      const fork: DraftRecord = {
        id: crypto.randomUUID(),
        taskId: source.taskId,
        title: source.title,
        problem: source.problem,
        provider: source.provider,
        model: source.model,
        language: source.language,
        variants: source.variants,
        modes: [...source.modes],
        assistance: [...source.assistance],
        status: "queued",
        createdAt: now,
        unitId: source.unitId ?? publishedId,
      };
      state.drafts = [fork, ...state.drafts];
      await saveState(state);
      return send(response, 201, { draft: fork });
    }
    const reviewMatch = url.pathname.match(/^\/api\/drafts\/([^/]+)\/reviews$/);
    if (request.method === "POST" && reviewMatch) {
      const payload = await body(request);
      if (!isRecord(payload) || typeof payload.role !== "string") throw new Error("review role is required");
      if (!REVIEW_ROLES.has(payload.role)) return send(response, 422, { error: "review role is not registered" });
      const draft = state.drafts.find((item) => item.id === reviewMatch[1]);
      if (!draft) return send(response, 404, { error: "draft not found" });
      // A failing role flips the draft to needs_revision; the remaining roles
      // must still be able to complete so the review report is whole.
      const preReviewError = assertDraftTransition(draft.status, "pre_review");
      if (!draft.artifactPath || preReviewError) {
        return send(response, 409, { error: "validate the generated draft before requesting review" });
      }
      // Per-role lock: the three roles run concurrently on the same draft
      // (batch fires them in parallel), so the key includes the role — only a
      // duplicate of the same role on the same draft is refused.
      if (!tryAcquireClaim(database, { draftId: draft.id, operation: "review", role: payload.role })) {
        return send(response, 409, { error: `review role ${payload.role} is already in progress for this draft` });
      }
      try {
        const repoRoot = resolve(here, "../..", "..");
        const artifactAbsolutePath = resolve(repoRoot, draft.artifactPath);
        await reviewTemplateDraft(relative(repoRoot, artifactAbsolutePath), payload.role);
        const reportPath = join(artifactAbsolutePath, "reviews", `${payload.role}.json`);
        const report = JSON.parse(await readFile(reportPath, "utf8")) as { verdict?: ReviewRecord["verdict"]; artifact_hash?: string };
        const reportPathRelative = relative(resolve(here, "../..", ".."), reportPath);
        const review: ReviewRecord = { id: crypto.randomUUID(), draftId: draft.id, role: payload.role, verdict: report.verdict ?? "pending", artifactHash: report.artifact_hash ?? null, reportPath: reportPathRelative, createdAt: new Date().toISOString() };
        state.reviews = [review, ...state.reviews];
        const currentHash = review.artifactHash;
        const allRolesPassed = [...REVIEW_ROLES].every((role) => latestReviewForRole(state.reviews, draft.id, role)?.verdict === "pass" && latestReviewForRole(state.reviews, draft.id, role)?.artifactHash === currentHash);
        if (allRolesPassed) draft.status = "llm_reviewed";
        else if (review.verdict === "needs_revision" || review.verdict === "reject") draft.status = "needs_revision";
        await saveState(state);
        return send(response, 201, { review });
      } finally {
        releaseClaim(database, draft.id, "review", payload.role);
      }
    }
    const artifactMatch = url.pathname.match(/^\/api\/drafts\/([^/]+)\/artifact$/);
    if (request.method === "GET" && artifactMatch) {
      const draft = state.drafts.find((item) => item.id === artifactMatch[1]);
      if (!draft) return send(response, 404, { error: "draft not found" });
      if (!draft.artifactPath) return send(response, 409, { error: "draft has no current artifact" });
      return send(response, 200, await readArtifact(draft, state.reviews));
    }
    if (request.method === "PUT" && artifactMatch) {
      const draft = state.drafts.find((item) => item.id === artifactMatch[1]);
      if (!draft) return send(response, 404, { error: "draft not found" });
      if (!draft.artifactPath || !["generated", "validated", "needs_revision", "llm_reviewed"].includes(draft.status)) return send(response, 409, { error: "only a generated draft can be edited" });
      const payload = await body(request);
      if (!isRecord(payload) || !isRecord(payload.files) || typeof payload.files["unit.json"] !== "string") return send(response, 422, { error: "files must include unit.json" });
      const root = artifactAbsolutePath(draft);
      const staging = `${root}.edit-${crypto.randomUUID()}`;
      await cp(root, staging, { recursive: true });
      for (const [path, content] of Object.entries(payload.files)) {
        if (!path || path.includes("\\") || path.startsWith("/") || path.split("/").includes("..") || path === "generation.json" || path.startsWith("reviews/")) { await rm(staging, { recursive: true, force: true }); return send(response, 422, { error: `invalid editable artifact path: ${path}` }); }
        if (typeof content !== "string" || content.length > 1_000_000) { await rm(staging, { recursive: true, force: true }); return send(response, 422, { error: `invalid artifact content: ${path}` }); }
        const destination = resolve(staging, path);
        if (!destination.startsWith(`${staging}/`)) { await rm(staging, { recursive: true, force: true }); return send(response, 422, { error: "artifact path escaped its root" }); }
        await mkdir(dirname(destination), { recursive: true });
        await writeFile(destination, content, "utf8");
      }
      const unitPath = join(staging, "unit.json");
      try {
        const editedManifest = JSON.parse(await readFile(unitPath, "utf8")) as Record<string, unknown>;
        materializeSourceTemplates(editedManifest, payload.files);
        await writeFile(unitPath, `${JSON.stringify(editedManifest, null, 2)}\n`, "utf8");
      } catch (error) {
        await rm(staging, { recursive: true, force: true });
        return send(response, 422, { status: "failed", errors: [error instanceof Error ? error.message : "edited artifact is invalid"] });
      }
      try { await validateArtifactWithRust(staging, false); } catch (error) { await rm(staging, { recursive: true, force: true }); return send(response, 422, { status: "failed", errors: [error instanceof Error ? error.message : String(error)] }); }
      await rm(join(staging, "reviews"), { recursive: true, force: true });
      await rm(root, { recursive: true, force: true });
      await rename(staging, root);
      state.reviews = state.reviews.filter((review) => review.draftId !== draft.id);
      database.prepare("DELETE FROM reviews WHERE draft_id = ?").run(draft.id);
      const humanRevision: ReviewRecord = {
        id: crypto.randomUUID(),
        draftId: draft.id,
        role: "human_revision",
        verdict: "pass",
        artifactHash: null,
        createdAt: new Date().toISOString(),
      };
      state.reviews = [humanRevision, ...state.reviews];
      draft.status = "validated";
      draft.publishedPath = undefined;
      await saveState(state);
      return send(response, 200, { status: "validated", draft });
    }
    const rollbackMatch = url.pathname.match(/^\/api\/drafts\/([^/]+)\/rollback$/);
    if (request.method === "POST" && rollbackMatch) {
      const draft = state.drafts.find((item) => item.id === rollbackMatch[1]);
      if (!draft) return send(response, 404, { error: "draft not found" });
      const rollbackError = assertDraftTransition(draft.status, "rollback");
      if (rollbackError) return send(response, 409, { error: rollbackError });
      draft.status = "revision_requested";
      draft.artifactPath = undefined;
      draft.publishedPath = undefined;
      draft.error = undefined;
      await saveState(state);
      return send(response, 200, { status: "revision_requested", draft });
    }
    const deleteMatch = url.pathname.match(/^\/api\/drafts\/([^/]+)$/);
    if (request.method === "DELETE" && deleteMatch) {
      const draft = state.drafts.find((item) => item.id === deleteMatch[1]);
      if (!draft) return send(response, 404, { error: "draft not found" });
      const deleteError = assertDraftTransition(draft.status, "delete");
      if (deleteError) return send(response, 409, { error: deleteError });
      if (draft.artifactPath) {
        try {
          const absolute = artifactAbsolutePath(draft);
          await rm(absolute, { recursive: true, force: true });
        } catch {
          // The artifact directory may already be gone; deletion still proceeds.
        }
      }
      state.drafts = state.drafts.filter((item) => item.id !== draft.id);
      state.reviews = state.reviews.filter((review) => review.draftId !== draft.id);
      database.prepare("DELETE FROM reviews WHERE draft_id = ?").run(draft.id);
      database.prepare("DELETE FROM drafts WHERE id = ?").run(draft.id);
      await saveState(state);
      return send(response, 200, { status: "deleted", id: draft.id });
    }
    return send(response, 404, { error: "route not found" });
  } catch (error) {
    if (error instanceof DraftInputError) return send(response, 422, { status: "failed", errors: error.errors });
    return send(response, 400, { error: error instanceof Error ? error.message : "invalid request" });
  }
});

server.listen(PORT, "127.0.0.1", () => console.log(`GEWU authoring API listening on http://127.0.0.1:${PORT}`));
// Leave a pid trace for the dev scripts (gewu-batch.mjs / gewu-dev.mjs):
// regardless of how this API was started, `batch:stop` can kill it by port
// even when the process tree is hidden or the npm wrapper already exited.
try {
  const pidDir = join(resolve(here, "../../.."), ".gewu-dev", "pids");
  mkdirSync(pidDir, { recursive: true });
  writeFileSync(join(pidDir, `api-${PORT}.pid`), String(process.pid));
} catch {
  // Best effort: the dev scripts also fall back to ss/lsof by port.
}
void validatePublishedContent().catch((error) => console.error(`published content validation failed: ${error instanceof Error ? error.message : String(error)}`));
