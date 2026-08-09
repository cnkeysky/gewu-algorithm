import { readFile, rename, writeFile } from "node:fs/promises";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { fileURLToPath } from "node:url";

/**
 * Batch authoring CLI. Drives the same workbench API used by the web UI so
 * every draft stays in the local sqlite store, appears in the Drafts/Review
 * history pages, and publishes through the normal acceptance gate.
 *
 * Usage:
 *   node dist/batch-authoring.js --problems hot100.json [options]
 *
 * Problems file (JSON):
 *   [{ "title": "Two Sum", "problem": "Given an array of integers ...", "source_url": "https://leetcode.com/problems/two-sum/" }]
 * Or TSV:  title\tproblem\turl
 *
 * Options:
 *   --api <url>          workbench API base (default http://127.0.0.1:4174)
 *   --steps <list>       comma list of draft,generate,validate,review,accept (default all)
 *   --concurrency <n>    parallel problems (default 1)
 *   --resume             kept for compatibility; deduplication is the default
 *   --force              regenerate problems even when an accepted unit covers them
 *   --yes                skip duplicate prompts (default when not a TTY)
 *   --select <ids>       run only the given ids/slugs/titles (comma list)
 *   --regenerate <ids>   regenerate the given ids/slugs/titles even when their
 *                        requested modes are already covered (comma list)
 *   --repair-rounds <n>  regenerate from review feedback after needs_revision (default 1)
 *   --auto-accept        accept needs_revision drafts with an explicit rationale record
 *   --provider, --model  recorded metadata on the draft (generation uses server env)
 *   --llm-approve [provider:model]  run the decisive LLM approval gate before
 *                        publishing (a pass publishes with the LLM-approved
 *                        label; pair with --steps draft,generate,validate,accept
 *                        to make the LLM gate the sole reviewer)
 *   --creator-models <list>  round-robin creator models across problems (provider:model,provider:model)
 *   --language <slug>    implementation language (default python; overrides the catalog entry)
 *   --variants <n>       implementation strategy count (default auto: the model decides 1-3 meaningful strategies)
 *   --modes <list>       practice modes (default all five)
 *   --assistance <list>  code recall assistance (default comments,cloze)
 *   --timeout-minutes <n> per-request timeout for LLM-backed API calls (default 60)
 *   --report <path>      JSON report output (default batch-report.json)
 *
 * Defaults: all five practice modes are generated. Code recall expands to
 * four layouts (full_recall, comment_guided, comment_to_code, cloze), so a
 * default run produces 8 practice kinds, plus one shadow typing item per
 * implementation strategy.
 *
 * Deduplication: identity is the problem's slug/id + language, unified with a
 * statement fingerprint — a problem matches an existing draft when its slug
 * OR its normalized-statement fingerprint hits (cross-catalog slug variants
 * and slug-less web drafts resolve to the same problem). Fully covered
 * problems are skipped (interactive choice in a TTY), partially covered ones
 * fork into a new revision, and non-accepted drafts are reused (reset to
 * queued) instead of accumulating duplicates. Unit ids are language-qualified
 * (`<slug>.<language>`). Gateway 429s retry with exponential backoff; the
 * default LLM approver follows GEWU_LLM_PROVIDER/GEWU_LLM_MODEL, then
 * --provider/--model, then deepseek:deepseek-v4-flash.
 */

const REVIEW_ROLES = ["algorithm_correctness", "learning_design", "provenance_safety"] as const;
const ALL_MODES = ["shadow_typing", "flow_recall", "code_recall", "reasoning_recall", "transfer_practice"] as const;
const ALL_ASSISTANCE = ["comments", "cloze"] as const;
const ALL_STEPS = ["draft", "generate", "validate", "review", "accept"] as const;
type Step = (typeof ALL_STEPS)[number];

type BatchProblem = {
  title: string;
  problem: string;
  sourceUrl?: string;
  id?: string;
  slug?: string;
  language?: string;
  provider?: string;
  model?: string;
};

type Options = {
  problemsFile: string;
  api: string;
  steps: Set<Step>;
  concurrency: number;
  resume: boolean;
  force: boolean;
  yes: boolean;
  select: string[];
  regenerate: string[];
  repairRounds: number;
  autoAccept: boolean;
  llmApprove?: string;
  creatorModels: string[];
  provider?: string;
  model?: string;
  language: string;
  languageProvided: boolean;
  variants: number;
  modes: string[];
  assistance: string[];
  timeoutMinutes: number;
  /** Pause between LLM-backed API calls to stay under gateway rate limits. */
  requestDelayMs: number;
  report: string;
};

/** Resolves the default LLM approver for the acceptance gate: the environment's
 * provider/model wins, then --provider/--model, then the built-in default. */
export function defaultApproverSpec(
  options: Pick<Options, "provider" | "model">,
  environment: Record<string, string | undefined> = process.env,
): string {
  const envProvider = environment.GEWU_LLM_PROVIDER;
  const envModel = environment.GEWU_LLM_MODEL;
  if (envProvider && envModel) return `${envProvider}:${envModel}`;
  if (options.provider && options.model) return `${options.provider}:${options.model}`;
  return "deepseek:deepseek-v4-flash";
}

class UsageError extends Error {}

function printUsage(): void {
  console.error("usage: node dist/batch-authoring.js --problems <file.json|tsv> [--api url] [--steps draft,generate,validate,review,accept] [--concurrency n] [--force] [--yes] [--select id1,id2] [--repair-rounds n] [--auto-accept] [--language python] [--variants 1] [--modes ...] [--assistance ...] [--request-delay-ms n] [--report path]");
}

function fail(message: string): never {
  throw new UsageError(message);
}

function optionValue(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 && index + 1 < args.length ? args[index + 1] : undefined;
}

/** Parses `provider:model` (a bare value means model with the default provider). */
function parseModelSpec(spec: string): [string, string] {
  const index = spec.indexOf(":");
  if (index <= 0 || index === spec.length - 1) return ["deepseek", spec];
  return [spec.slice(0, index), spec.slice(index + 1)];
}

export function parseOptions(args: string[]): Options {
  const problemsFile = optionValue(args, "--problems");
  if (!problemsFile) fail("--problems file is required");
  const api = optionValue(args, "--api") ?? "http://127.0.0.1:4174";
  const stepsValue = optionValue(args, "--steps");
  const steps = new Set<Step>(stepsValue ? stepsValue.split(",").map((step) => step.trim() as Step) : [...ALL_STEPS]);
  for (const step of steps) if (!(ALL_STEPS as readonly string[]).includes(step)) fail(`unknown step: ${step}`);
  if (steps.has("draft") && !steps.has("generate")) fail("draft without generate is not useful; include generate or drop draft");
  if ((steps.has("review") || steps.has("accept")) && !steps.has("validate")) {
    fail("review and accept require the validate step: a reviewable or publishable artifact must be contract-validated first");
  }
  const modes = optionValue(args, "--modes")?.split(",").map((mode) => mode.trim()) ?? [...ALL_MODES];
  const assistance = optionValue(args, "--assistance")?.split(",").map((item) => item.trim()) ?? [...ALL_ASSISTANCE];
  const timeoutMinutes = Number(optionValue(args, "--timeout-minutes") ?? process.env.GEWU_BATCH_TIMEOUT_MINUTES ?? "60");
  if (!Number.isInteger(timeoutMinutes) || timeoutMinutes < 1) fail("--timeout-minutes must be a positive integer");
  const requestDelayMs = Number(optionValue(args, "--request-delay-ms") ?? process.env.GEWU_BATCH_REQUEST_DELAY_MS ?? "0");
  if (!Number.isInteger(requestDelayMs) || requestDelayMs < 0) fail("--request-delay-ms must be a non-negative integer");
  const selectValue = optionValue(args, "--select");
  const regenerateValue = optionValue(args, "--regenerate");
  return {
    problemsFile,
    api: api.replace(/\/+$/, ""),
    steps,
    concurrency: Number(optionValue(args, "--concurrency") ?? "1"),
    resume: args.includes("--resume"),
    force: args.includes("--force"),
    yes: args.includes("--yes"),
    select: selectValue ? selectValue.split(",").map((item) => item.trim().toLowerCase()).filter(Boolean) : [],
    regenerate: regenerateValue ? regenerateValue.split(",").map((item) => item.trim().toLowerCase()).filter(Boolean) : [],
    repairRounds: Number(optionValue(args, "--repair-rounds") ?? "1"),
    autoAccept: args.includes("--auto-accept"),
    llmApprove: optionValue(args, "--llm-approve"),
    creatorModels: optionValue(args, "--creator-models")?.split(",").map((item) => item.trim()).filter(Boolean) ?? [],
    provider: optionValue(args, "--provider"),
    model: optionValue(args, "--model"),
    language: optionValue(args, "--language") ?? "python",
    languageProvided: optionValue(args, "--language") !== undefined,
    variants: Number(optionValue(args, "--variants") ?? "0"),
    modes,
    assistance,
    timeoutMinutes,
    requestDelayMs,
    report: optionValue(args, "--report") ?? "batch-report.json",
  };
}

export async function loadProblems(path: string): Promise<BatchProblem[]> {
  const content = await readFile(resolve(path), "utf8");
  const trimmed = content.trim();
  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    const parsed = JSON.parse(trimmed) as BatchProblem[] | BatchProblem;
    const list = Array.isArray(parsed) ? parsed : [parsed];
    return list.map((item) => ({ ...item, problem: String(item.problem ?? "").trim() }));
  }
  const lines = trimmed.split("\n").filter(Boolean).map((line) => {
    const [title, problem, sourceUrl] = line.split("\t").map((part) => part.trim());
    if (!title || !problem) throw new Error(`invalid TSV line: ${line.slice(0, 80)}`);
    return { title, problem, sourceUrl };
  });
  return lines;
}

/**
 * Restrict a problem list to the requested ids/slugs/titles. Matching is
 * case-insensitive: exact on `id` and `slug`, exact-or-substring on `title`.
 * An empty selection returns the full list.
 */
export function selectProblems(problems: BatchProblem[], select: string[]): BatchProblem[] {
  if (select.length === 0) return problems;
  return problems.filter((problem) => matchesRequested(problem, select));
}

/** Case-insensitive match on id / slug / exact-or-substring title. */
function matchesRequested(problem: BatchProblem, wanted: string[]): boolean {
  if (wanted.length === 0) return false;
  const id = String(problem.id ?? "").toLowerCase();
  const slug = String(problem.slug ?? "").toLowerCase();
  const title = String(problem.title ?? "").toLowerCase();
  return wanted.some((item) => id === item || slug === item || title === item || title.includes(item));
}

/**
 * Coverage identity for duplicate detection: a problem in one implementation
 * language is a separate deliverable from the same problem in another
 * language, so the key includes both the statement and the language.
 */
export function coverageKey(problem: string, language: string): string {
  return `${problem}\u0000${language}`;
}

/** Problem identity for deduplication: canonical slug/id when available,
 * else the statement text. Same-slug problems never create duplicates even
 * when their statement wording or title differs. */
export function problemKey(problem: BatchProblem, language: string): string {
  const identity = normalizeIdentity(problem.slug)
    ?? (problem.id ? `lc-${normalizeIdentity(String(problem.id)) ?? String(problem.id)}` : textIdentity(problem.problem));
  return coverageKey(identity, language);
}

/** Mirrors problemKey for stored drafts: slug when present, else text. */
export function draftKey(draft: { slug?: string; problem: string }, language: string): string {
  return coverageKey(normalizeIdentity(draft.slug) ?? textIdentity(draft.problem), language);
}

/** A slug must be a stable lowercase identifier; anything else (spaces,
 * uppercase, invalid characters) falls back to statement-text identity. */
function normalizeIdentity(value: string | undefined): string | undefined {
  const trimmed = value?.trim().toLowerCase();
  return trimmed && /^[a-z0-9]+(?:[-.][a-z0-9]+)*$/.test(trimmed) ? trimmed : undefined;
}

/**
 * Content-fingerprint fallback for problems without a stable slug/id:
 * normalize (NFKC, lowercase, collapse whitespace) then hash, so formatting
 * differences never break dedup and near-duplicate statements collapse.
 */
function textIdentity(statement: string): string {
  const normalized = statement.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
  return `txt:${createHash("sha256").update(normalized).digest("hex").slice(0, 24)}`;
}

/**
 * Language resolution for one problem: an explicit --language is a global
 * override; otherwise the catalog entry's own `language` wins; the final
 * fallback is the CLI default (python). This keeps per-entry languages and
 * the global override decoupled, so a catalog may mix languages.
 */
export function resolveLanguage(
  options: Pick<Options, "language" | "languageProvided">,
  problem: BatchProblem,
): string {
  return options.languageProvided ? options.language : (problem.language ?? options.language);
}

type ApiResult = { ok: true; status: number; body: unknown } | { ok: false; status: number; body: unknown };

/** LLM-backed authoring endpoints (the ones that hit the upstream gateway). */
const LLM_BACKED_PATH = /\/generate$|\/acceptance$|\/accept$|\/reviews$/;

async function apiRequest(options: Options, method: string, path: string, payload?: unknown): Promise<ApiResult> {
  // node:http has no internal header/body timeouts (undici's fetch drops
  // connections that take more than ~5 minutes to respond, which LLM-backed
  // authoring requests routinely exceed). The AbortSignal below is the only
  // bound, driven by --timeout-minutes.
  const url = new URL(`${options.api}${path}`);
  // Pace LLM-backed calls (--request-delay-ms): shared relays trip Cloudflare
  // style rate/security limits when requests burst, so space them out.
  if (options.requestDelayMs > 0 && LLM_BACKED_PATH.test(path)) {
    await new Promise((settle) => setTimeout(settle, options.requestDelayMs));
  }
  for (let attempt = 1; ; attempt += 1) {
    const result = await new Promise<ApiResult>((resolveRequest, rejectRequest) => {
      const req = httpRequest(url, {
        method,
        headers: payload === undefined ? undefined : { "content-type": "application/json" },
        signal: AbortSignal.timeout(options.timeoutMinutes * 60_000),
      }, (response) => {
        let text = "";
        response.setEncoding("utf8");
        response.on("data", (chunk: string) => { text += chunk; });
        response.on("end", () => {
          let body: unknown = null;
          try { body = text ? JSON.parse(text) : null; } catch { body = text; }
          resolveRequest({ ok: response.statusCode !== undefined && response.statusCode >= 200 && response.statusCode < 300, status: response.statusCode ?? 0, body });
        });
      });
      req.on("error", rejectRequest);
      if (payload !== undefined) req.write(JSON.stringify(payload));
      req.end();
    });
    // Gateway rate limits (429) are retried; transient 5xx only for
    // idempotent calls (GET/PATCH) — retrying a POST /generate that already
    // spent gateway quota would double-charge. A JSON 403 (quota/access
    // style) gets one short retry; HTML 403 responses are security blocks
    // (e.g. Cloudflare) and are returned immediately.
    const body = result.body;
    const htmlBlock = result.status === 403 && typeof body === "string" && body.trim().startsWith("<");
    const idempotent = method === "GET" || method === "HEAD" || method === "PATCH";
    const retryable = !htmlBlock && (result.status === 429 || (idempotent && result.status >= 500 && result.status < 600) || (result.status === 403 && attempt < 2));
    if (!retryable || attempt >= 5) return result;
    const baseMs = result.status === 429 ? 5_000 : 2_000;
    const waitMs = Math.min(60_000, baseMs * 2 ** (attempt - 1));
    await new Promise((settle) => setTimeout(settle, waitMs));
  }
}

function draftError(result: ApiResult): string {
  if (result.ok || result.body === null) return `HTTP ${result.status}`;
  const body = result.body as { error?: string; errors?: string[] };
  return body.error ?? body.errors?.join("; ") ?? `HTTP ${result.status}`;
}

type AcceptedUnit = { draftId: string; unitId?: string; modes: Set<string> };

class RunAborted extends Error {}

type RunContext = {
  duplicatePolicy: "ask" | "skip" | "force";
  promptChain: Promise<void>;
  aborted: boolean;
};

async function askDuplicate(problem: BatchProblem, accepted: AcceptedUnit): Promise<"skip" | "force" | "forceAll" | "quit"> {
  const rl = createInterface({ input, output });
  try {
    const answer = (await rl.question(
      `\n[duplicate] "${problem.title}" is already covered by an accepted unit (modes: ${[...accepted.modes].join(", ")}).\n` +
        "  s) skip (default)\n" +
        "  r) regenerate this problem as a new revision\n" +
        "  a) regenerate all remaining duplicates\n" +
        "  q) quit\n" +
        "choose [s/r/a/q]: ",
    )).trim().toLowerCase();
    if (answer === "r") return "force";
    if (answer === "a") return "forceAll";
    if (answer === "q") return "quit";
    return "skip";
  } finally {
    rl.close();
  }
}

type DraftIndexes = {
  accepted: Map<string, AcceptedUnit>;
  /** Accepted units matched by statement fingerprint (cross-catalog slug
   * variants and slug-less web drafts resolve to the same problem). */
  acceptedByFingerprint: Map<string, AcceptedUnit>;
  /** Newest non-accepted draft per problem+language, reused on re-runs so
   * failed/interrupted attempts are retried instead of accumulating. */
  existing: Map<string, { id: string; status: string }>;
  existingByFingerprint: Map<string, { id: string; status: string }>;
};

async function loadDraftIndexes(options: Options): Promise<DraftIndexes> {
  const result = await apiRequest(options, "GET", "/api/drafts");
  if (!result.ok) throw new Error(`cannot list drafts: ${draftError(result)}`);
  const drafts = (result.body as { drafts?: Array<{ id: string; problem: string; status: string; language?: string; modes?: string[]; unitId?: string }> }).drafts ?? [];
  const accepted = new Map<string, AcceptedUnit>();
  const acceptedByFingerprint = new Map<string, AcceptedUnit>();
  const existing = new Map<string, { id: string; status: string }>();
  const existingByFingerprint = new Map<string, { id: string; status: string }>();
  for (const draft of drafts) {
    const problem = String(draft.problem ?? "").trim();
    if (!problem) continue;
    const language = String(draft.language ?? "python").trim() || "python";
    const key = draftKey(draft, language);
    const fingerprintKey = coverageKey(textIdentity(problem), language);
    if (draft.status === "accepted") {
      const modes = new Set(draft.modes ?? []);
      const unit = { draftId: draft.id, unitId: draft.unitId, modes };
      const previous = accepted.get(key);
      if (previous) for (const mode of previous.modes) unit.modes.add(mode);
      accepted.set(key, unit);
      const fpPrevious = acceptedByFingerprint.get(fingerprintKey);
      if (fpPrevious) for (const mode of fpPrevious.modes) unit.modes.add(mode);
      acceptedByFingerprint.set(fingerprintKey, unit);
    } else {
      if (!existing.has(key)) existing.set(key, { id: draft.id, status: String(draft.status ?? "") });
      if (!existingByFingerprint.has(fingerprintKey)) existingByFingerprint.set(fingerprintKey, { id: draft.id, status: String(draft.status ?? "") });
    }
  }
  return { accepted, acceptedByFingerprint, existing, existingByFingerprint };
}

type ItemResult = {
  title: string;
  status: "accepted" | "needs_review" | "failed" | "skipped";
  draftId?: string;
  draftSource?: string;
  unitId?: string;
  publishedPath?: string;
  reason?: string;
  error?: string;
  reviewVerdicts?: Record<string, string>;
  repairRoundsUsed?: number;
};

/**
 * Reconciles the run's bookkeeping with the store's final state so the
 * report never contradicts the authoring API: a draft that was accepted here
 * but no longer is (concurrent/stale clobbering) is reported as failed, and a
 * draft accepted in the store during the run is reported as accepted.
 */
export function reconcileResults(results: ItemResult[], statusById: Map<string, string>): ItemResult[] {
  return results.map((result) => {
    if (!result.draftId) return result;
    const storeStatus = statusById.get(result.draftId);
    if (!storeStatus) return result;
    if (result.status === "accepted" && storeStatus !== "accepted") {
      return {
        ...result,
        status: "failed",
        error: `state divergence: the run accepted this draft but the store now has ${storeStatus}; re-run to regenerate it`,
      };
    }
    if (result.status !== "accepted" && storeStatus === "accepted") {
      return { ...result, status: "accepted", error: undefined, reason: "accepted in the store during or after this run" };
    }
    return result;
  });
}

async function runReviews(options: Options, draftId: string): Promise<{ verdicts: Record<string, string>; allPassed: boolean }> {
  // Fire all roles concurrently: the workbench API requires the draft to be in
  // "validated" state per request, and a single failing role flips it to
  // "needs_revision", which would block the remaining sequential calls.
  const settled = await Promise.allSettled(
    REVIEW_ROLES.map(async (role) => {
      const result = await apiRequest(options, "POST", `/api/drafts/${draftId}/reviews`, { role });
      if (!result.ok) throw new Error(`review ${role} failed: ${draftError(result)}`);
      const body = result.body as { review?: { verdict?: string } };
      return [role, body.review?.verdict ?? "unknown"] as const;
    }),
  );
  const verdicts: Record<string, string> = {};
  let firstError: string | undefined;
  for (const outcome of settled) {
    if (outcome.status === "fulfilled") verdicts[outcome.value[0]] = outcome.value[1];
    else firstError ??= outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason);
  }
  if (firstError) throw new Error(firstError);
  return { verdicts, allPassed: Object.values(verdicts).every((verdict) => verdict === "pass") };
}

/** Re-fetches one draft's current status from the store. */
async function recheckDraftStatus(options: Options, draftId: string): Promise<string | undefined> {
  const result = await apiRequest(options, "GET", "/api/drafts");
  if (!result.ok) return undefined;
  const drafts = (result.body as { drafts?: Array<{ id: string; status: string }> }).drafts ?? [];
  return drafts.find((draft) => draft.id === draftId)?.status;
}

async function processProblem(
  options: Options,
  problem: BatchProblem,
  indexes: DraftIndexes,
  context: RunContext,
): Promise<ItemResult> {
  const base: ItemResult = { title: problem.title, status: "failed" };
  let duplicatePolicy = context.duplicatePolicy;
  try {
    const language = resolveLanguage(options, problem);
    const key = problemKey(problem, language);
    const fingerprintKey = coverageKey(textIdentity(problem.problem), language);
    const accepted = indexes.accepted.get(key) ?? indexes.acceptedByFingerprint.get(fingerprintKey);
    const covered = accepted !== undefined && options.modes.every((mode) => accepted.modes.has(mode));
    if (accepted && covered && !options.force && !matchesRequested(problem, options.regenerate)) {
      if (duplicatePolicy === "ask") {
        const outcome = await new Promise<"skip" | "force" | "forceAll" | "quit">((resolveOutcome) => {
          context.promptChain = context.promptChain.then(async () => {
            if (context.aborted) {
              resolveOutcome("quit");
              return;
            }
            try {
              resolveOutcome(await askDuplicate(problem, accepted));
            } catch {
              resolveOutcome("skip");
            }
          });
        });
        if (outcome === "force" || outcome === "forceAll") {
          if (outcome === "forceAll") context.duplicatePolicy = "force";
          duplicatePolicy = "force";
        } else if (outcome === "quit") {
          context.aborted = true;
          throw new RunAborted("aborted by user");
        } else {
          duplicatePolicy = "skip";
        }
      }
      if (duplicatePolicy === "skip") {
        return { ...base, status: "skipped", reason: `already covered by accepted unit (modes: ${[...accepted.modes].join(", ")}); use --regenerate <id> or --force to regenerate` };
      }
    }
    if (!options.steps.has("draft")) fail("draft step must be enabled to resolve a draft id");

    let draftId: string;
    if (accepted !== undefined && (options.force || duplicatePolicy === "force" || !covered)) {
      // Regenerate or extend the existing unit as a new revision.
      const fork = await apiRequest(options, "POST", `/api/drafts/${accepted.draftId}/fork`);
      if (!fork.ok) return { ...base, status: "failed", error: `fork: ${draftError(fork)}` };
      draftId = String((fork.body as { draft?: { id?: string } }).draft?.id ?? "");
      const patch = await apiRequest(options, "PATCH", `/api/drafts/${draftId}`, {
        title: problem.title,
        problem: problem.problem,
        slug: problem.slug,
        provider: options.provider ?? "deepseek",
        model: options.model ?? "deepseek-v4-flash",
        language,
        variants: options.variants,
        modes: options.modes,
        assistance: options.modes.includes("code_recall") ? options.assistance : [],
      });
      if (!patch.ok) return { ...base, status: "failed", error: `fork update: ${draftError(patch)}` };
      base.draftSource = accepted.unitId ? `revision of ${accepted.unitId}` : `revision of ${accepted.draftId}`;
    } else {
      // Reuse the newest non-accepted draft for this problem+language: reset it
      // to queued with the current run's configuration and retry, instead of
      // creating a duplicate entry on every re-run.
      const existing = indexes.existing.get(key) ?? indexes.existingByFingerprint.get(fingerprintKey);
      if (existing) {
        // Optimistic concurrency: the index is a snapshot, so a draft may have
        // changed (or been accepted) since it was loaded. The server refuses
        // the reuse when the observed status no longer matches.
        const patch = await apiRequest(options, "PATCH", `/api/drafts/${existing.id}`, {
          title: problem.title,
          problem: problem.problem,
          slug: problem.slug,
          provider: options.provider ?? "deepseek",
          model: options.model ?? "deepseek-v4-flash",
          language,
          variants: options.variants,
          modes: options.modes,
          assistance: options.modes.includes("code_recall") ? options.assistance : [],
          expectedStatus: existing.status,
        });
        if (!patch.ok) {
          const currentStatus = await recheckDraftStatus(options, existing.id);
          if (currentStatus === "accepted") {
            return { ...base, status: "skipped", reason: `already covered by accepted unit (draft ${existing.id.slice(0, 8)} was accepted during this run)` };
          }
          return { ...base, status: "failed", error: `reuse update: ${draftError(patch)}` };
        }
        draftId = existing.id;
        base.draftSource = `reused ${existing.id.slice(0, 8)} (was ${existing.status})`;
      } else {
        const draftResult = await apiRequest(options, "POST", "/api/drafts", {
          title: problem.title,
          problem: problem.problem,
          slug: problem.slug,
          provider: options.provider ?? "deepseek",
          model: options.model ?? "deepseek-v4-flash",
          language,
          variants: options.variants,
          modes: options.modes,
          assistance: options.modes.includes("code_recall") ? options.assistance : [],
        });
        if (!draftResult.ok) return { ...base, status: "failed", error: `draft: ${draftError(draftResult)}` };
        draftId = String((draftResult.body as { draft?: { id?: string } }).draft?.id ?? "");
      }
    }
    base.draftId = draftId;

    // Per-problem creator model distribution: entries may pin provider/model,
    // overriding the authoring server's configured model for this draft only.
    const generationBody: Record<string, unknown> = {};
    if (problem.provider) generationBody.provider = problem.provider;
    if (problem.model) generationBody.model = problem.model;
    const generateDraft = (): Promise<ApiResult> =>
      apiRequest(options, "POST", `/api/drafts/${draftId}/generate`, Object.keys(generationBody).length ? generationBody : undefined);

    if (options.steps.has("generate")) {
      // No blind batch-level retry: the generator already retries transient
      // gateway errors and re-prompts with validation feedback internally, so
      // re-running the identical prompt here would only spend quota twice on
      // persistent failures (403 blocks, exhausted quota, invalid output).
      // Failed drafts stay failed and a later run reuses them.
      const generated = await generateDraft();
      if (!generated.ok) return { ...base, status: "failed", error: `generate: ${draftError(generated)}` };
    }
    if (options.steps.has("validate")) {
      const validated = await apiRequest(options, "POST", `/api/drafts/${draftId}/validate`);
      if (!validated.ok) return { ...base, status: "failed", error: `validate: ${draftError(validated)}` };
    }

    let reviewVerdicts: Record<string, string> = {};
    let allPassed = true;
    if (options.steps.has("review")) {
      let repairs = 0;
      for (; ; ) {
        const reviewed = await runReviews(options, draftId);
        reviewVerdicts = reviewed.verdicts;
        allPassed = reviewed.allPassed;
        if (allPassed || repairs >= options.repairRounds || !options.steps.has("generate") || !options.steps.has("validate")) break;
        const rollback = await apiRequest(options, "POST", `/api/drafts/${draftId}/rollback`);
        if (!rollback.ok) break;
        const regenerated = await generateDraft();
        if (!regenerated.ok) break;
        const revalidated = await apiRequest(options, "POST", `/api/drafts/${draftId}/validate`);
        if (!revalidated.ok) break;
        repairs += 1;
      }
      base.repairRoundsUsed = repairs;
      base.reviewVerdicts = reviewVerdicts;
    }

    if (options.steps.has("accept") && options.llmApprove) {
      // The LLM approval gate completes the fully-automated pipeline: the
      // approver model reads the artifact and all pre-review findings, decides
      // pass or needs_revision, and the audit trail records `llm_acceptance`
      // (explicitly an LLM approval, never labeled as human).
      const [approverProvider, approverModel] = parseModelSpec(options.llmApprove);
      let verdict = "needs_revision";
      let rationale = "";
      let approvals = 0;
      for (; ; ) {
        const acceptance = await apiRequest(options, "POST", `/api/drafts/${draftId}/acceptance`, { provider: approverProvider, model: approverModel });
        if (!acceptance.ok) return { ...base, status: "failed", error: `llm approval: ${draftError(acceptance)}` };
        const body = acceptance.body as { verdict?: string; rationale?: string };
        verdict = body.verdict ?? "needs_revision";
        rationale = body.rationale ?? "";
        if (verdict === "pass") break;
        if (approvals >= options.repairRounds || !options.steps.has("generate") || !options.steps.has("validate") || !options.steps.has("review")) break;
        const rollback = await apiRequest(options, "POST", `/api/drafts/${draftId}/rollback`);
        if (!rollback.ok) break;
        if (!(await generateDraft()).ok || !(await apiRequest(options, "POST", `/api/drafts/${draftId}/validate`)).ok) break;
        await runReviews(options, draftId);
        approvals += 1;
      }
      if (verdict === "pass") {
        const accepted = await apiRequest(options, "POST", `/api/drafts/${draftId}/accept`, {
          override: true,
          rationale: `LLM approve by ${approverProvider}/${approverModel}: ${rationale}`,
          acceptanceRole: "llm_acceptance",
        });
        if (!accepted.ok) return { ...base, status: "failed", error: `accept(llm): ${draftError(accepted)}` };
        const body = accepted.body as { publishedPath?: string; draft?: { unitId?: string } };
        return { ...base, status: "accepted", unitId: body.draft?.unitId, publishedPath: body.publishedPath, repairRoundsUsed: base.repairRoundsUsed, reviewVerdicts: base.reviewVerdicts };
      }
      return { ...base, status: "needs_review", error: `llm approval: ${rationale || verdict}` };
    }

    if (options.steps.has("accept")) {
      const listed = await apiRequest(options, "GET", "/api/drafts");
      if (!listed.ok) return { ...base, status: "failed", error: `status lookup: ${draftError(listed)}` };
      const status = ((listed.body as { drafts?: Array<{ id: string; status: string }> }).drafts ?? []).find((item) => item.id === draftId)?.status;
      if (status === "llm_reviewed") {
        const accepted = await apiRequest(options, "POST", `/api/drafts/${draftId}/accept`);
        if (!accepted.ok) return { ...base, status: "failed", error: `accept: ${draftError(accepted)}` };
        const body = accepted.body as { publishedPath?: string; draft?: { unitId?: string } };
        return { ...base, status: "accepted", unitId: body.draft?.unitId, publishedPath: body.publishedPath };
      }
      if (status === "needs_revision" && options.autoAccept) {
        const accepted = await apiRequest(options, "POST", `/api/drafts/${draftId}/accept`, {
          override: true,
          rationale: "Automated batch acceptance: operator-approved Hot 100 authoring run after LLM design and pre-review.",
        });
        if (!accepted.ok) return { ...base, status: "failed", error: `accept(override): ${draftError(accepted)}` };
        const body = accepted.body as { publishedPath?: string; draft?: { unitId?: string } };
        return { ...base, status: "accepted", unitId: body.draft?.unitId, publishedPath: body.publishedPath };
      }
      return { ...base, status: "needs_review", error: `draft status is ${status ?? "unknown"}; review it in the web workbench or rerun with --auto-accept` };
    }
    return { ...base, status: "needs_review", reviewVerdicts };
  } catch (error) {
    if (error instanceof RunAborted) throw error;
    return { ...base, status: "failed", error: error instanceof Error ? error.message : String(error) };
  }
}

async function main(): Promise<void> {
  // Single-instance guard: two concurrent batch runs would both reuse and
  // generate the same drafts, double-spending gateway quota and racing each
  // other's state. The lock is a pid file with a liveness check (the common
  // portable pattern; flock is unavailable on Windows without a dependency).
  const lockDirPath = join(resolve(dirname(fileURLToPath(import.meta.url)), "../../.."), ".gewu-dev", "pids");
  const lockPath = join(lockDirPath, "batch-run.lock");
  mkdirSync(lockDirPath, { recursive: true });
  const existingPid = existsSync(lockPath) ? Number(await readFile(lockPath, "utf8")) : 0;
  let lockHeldByLiveProcess = false;
  if (existingPid > 0) {
    try {
      process.kill(existingPid, 0);
      lockHeldByLiveProcess = true;
    } catch {
      // Stale lock from a crashed run; overwrite below.
    }
  }
  if (lockHeldByLiveProcess) {
    console.error(`batch-authoring: another run is in progress (pid ${existingPid}); wait for it to finish or remove ${lockPath} if it is stale`);
    process.exit(2);
  }
  await writeFile(lockPath, String(process.pid));
  const releaseLock = (): void => {
    try {
      rmSync(lockPath, { force: true });
    } catch {
      // Best effort on exit paths.
    }
  };
  process.on("exit", releaseLock);
  process.on("SIGINT", () => { releaseLock(); process.exit(130); });
  process.on("SIGTERM", () => { releaseLock(); process.exit(143); });

  const options = parseOptions(process.argv.slice(2));
  if (!Number.isInteger(options.concurrency) || options.concurrency < 1) fail("--concurrency must be a positive integer");
  if (!Number.isInteger(options.variants) || options.variants < 0) fail("--variants must be 0 (auto) or a positive integer");
  const loaded = await loadProblems(options.problemsFile);
  const withStatements = loaded.filter((problem) => problem.problem.length > 0);
  const empty = loaded.length - withStatements.length;
  const problems = selectProblems(withStatements, options.select);
  const deselected = withStatements.length - problems.length;
  if (empty > 0) console.log(`batch-authoring: skipped ${empty} entries without a problem statement`);
  if (deselected > 0) console.log(`batch-authoring: selected ${problems.length} of ${withStatements.length} problems (--select)`);
  if (problems.length === 0) fail("problems file contains no entries");
  // Preflight: same identity key mapping to different titles means two distinct
  // problems share a slug/id — dedup would wrongly treat them as one unit.
  const identityTitles = new Map<string, string>();
  let identityCollisions = 0;
  for (const problem of problems) {
    const key = problemKey(problem, resolveLanguage(options, problem));
    const previous = identityTitles.get(key);
    if (previous !== undefined && previous !== problem.title) identityCollisions += 1;
    else identityTitles.set(key, problem.title);
  }
  if (identityCollisions > 0) {
    console.warn(`batch-authoring: ${identityCollisions} identity key(s) map to different titles — dedup treats the same slug/id as the same unit; verify the catalog's slugs`);
  }
  if (options.creatorModels.length > 0) {
    problems.forEach((problem, index) => {
      if (problem.provider || problem.model) return;
      const [provider, model] = parseModelSpec(options.creatorModels[index % options.creatorModels.length]);
      problem.provider = provider;
      problem.model = model;
    });
    console.log(`batch-authoring: creator models rotate across ${options.creatorModels.length} model(s)`);
  }
  if (options.steps.has("accept") && !options.autoAccept && !options.llmApprove) {
    // The fully-automated batch pipeline approves through the LLM acceptance
    // gate by default; --auto-accept remains the operator (human-tier) override.
    options.llmApprove = defaultApproverSpec(options);
    console.log(`batch-authoring: LLM approval gate enabled by default (approver ${options.llmApprove}); pass --auto-accept for operator approval`);
  }
  console.log(`batch-authoring: ${problems.length} problems, steps=[${[...options.steps].join(",")}], concurrency=${options.concurrency}${options.force ? ", force" : ", dedupe-covered"}${options.select.length > 0 ? `, select=[${options.select.join(",")}]` : ""}`);

  const indexes = await loadDraftIndexes(options);
  if (options.force || options.regenerate.length > 0) {
    // Explicit regeneration: no pre-run skip summary needed.
  } else {
    const covered = problems.filter((problem) => {
      const language = resolveLanguage(options, problem);
      const accepted = indexes.accepted.get(problemKey(problem, language))
        ?? indexes.acceptedByFingerprint.get(coverageKey(textIdentity(problem.problem), language));
      return accepted !== undefined && options.modes.every((mode) => accepted.modes.has(mode));
    });
    if (covered.length > 0) {
      console.log(`batch-authoring: ${covered.length} problem(s) already fully covered by accepted units — they will be skipped unless you pick --regenerate <id>:`);
      for (const problem of covered) console.log(`  - ${problem.title}`);
    }
  }
  const context: RunContext = {
    duplicatePolicy: options.yes || !process.stdin.isTTY ? "skip" : "ask",
    promptChain: Promise.resolve(),
    aborted: false,
  };

  const results: ItemResult[] = [];
  const queue = [...problems];
  const workers = Array.from({ length: Math.min(options.concurrency, problems.length) }, async () => {
    for (; ; ) {
      if (context.aborted) return;
      const problem = queue.shift();
      if (!problem) return;
      let result: ItemResult;
      try {
        result = await processProblem(options, problem, indexes, context);
      } catch (error) {
        if (error instanceof RunAborted) return;
        throw error;
      }
      results.push(result);
      const label = result.status === "accepted" ? "OK" : result.status === "skipped" ? "--" : result.status === "needs_review" ? "!!" : "XX";
      const source = result.draftSource ? ` (${result.draftSource})` : result.draftId ? ` (draft ${result.draftId})` : "";
      console.log(`[${label}] ${problem.title}${source}${result.reason ? ` — ${result.reason}` : ""}${result.error ? ` — ${result.error}` : ""}${result.reviewVerdicts ? ` — ${JSON.stringify(result.reviewVerdicts)}` : ""}`);
    }
  });
  await Promise.all(workers);

  // The report must reflect the store, not just this process's bookkeeping:
  // a concurrent or stale client can change states mid-run, so verify each
  // processed draft's final status before writing the report.
  let statusById = new Map<string, string>();
  try {
    const draftsResult = await apiRequest(options, "GET", "/api/drafts");
    if (draftsResult.ok) {
      statusById = new Map((draftsResult.body as { drafts?: Array<{ id: string; status: string }> }).drafts?.map((draft) => [draft.id, String(draft.status ?? "")]) ?? []);
    }
  } catch {
    // Reconciliation is best-effort; the report falls back to CLI bookkeeping.
  }
  const reconciled = reconcileResults(results, statusById);
  const diverged = reconciled.filter((result, index) => result.status !== results[index].status);
  if (diverged.length > 0) {
    console.log(`batch-authoring: reconciled ${diverged.length} result(s) against the store (report now matches live draft states)`);
  }
  const summary = {
    generatedAt: new Date().toISOString(),
    total: problems.length,
    accepted: reconciled.filter((result) => result.status === "accepted").length,
    needsReview: reconciled.filter((result) => result.status === "needs_review").length,
    failed: reconciled.filter((result) => result.status === "failed").length,
    skipped: reconciled.filter((result) => result.status === "skipped").length,
    results: reconciled,
  };
  // Atomic report write (tmp + rename): a concurrent or interrupted writer can
  // never leave a half-written report behind.
  const reportPath = resolve(options.report);
  const reportTmpPath = `${reportPath}.tmp`;
  await writeFile(reportTmpPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  await rename(reportTmpPath, reportPath);
  console.log(`batch-authoring: done — ${summary.accepted} accepted, ${summary.needsReview} need review, ${summary.failed} failed, ${summary.skipped} skipped. Report: ${options.report}`);
  if (context.aborted) {
    console.error("batch-authoring: aborted by user; partial results written to the report");
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    if (error instanceof UsageError) {
      console.error(`batch-authoring: ${error.message}`);
      printUsage();
      process.exitCode = 2;
    } else {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    }
  });
}
