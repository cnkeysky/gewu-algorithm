import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
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
 *   --repair-rounds <n>  regenerate from review feedback after needs_revision (default 1)
 *   --auto-accept        accept needs_revision drafts with an explicit rationale record
 *   --provider, --model  recorded metadata on the draft (generation uses server env)
 *   --language <slug>    implementation language (default python; overrides the catalog entry)
 *   --variants <n>       implementation variants per unit (default 1)
 *   --modes <list>       practice modes (default all five)
 *   --assistance <list>  code recall assistance (default comments,cloze)
 *   --report <path>      JSON report output (default batch-report.json)
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
  repairRounds: number;
  autoAccept: boolean;
  provider?: string;
  model?: string;
  language: string;
  languageProvided: boolean;
  variants: number;
  modes: string[];
  assistance: string[];
  report: string;
};

function fail(message: string): never {
  console.error(`batch-authoring: ${message}`);
  console.error("usage: node dist/batch-authoring.js --problems <file.json|tsv> [--api url] [--steps draft,generate,validate,review,accept] [--concurrency n] [--force] [--yes] [--select id1,id2] [--repair-rounds n] [--auto-accept] [--language python] [--variants 1] [--modes ...] [--assistance ...] [--report path]");
  process.exit(2);
}

function optionValue(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 && index + 1 < args.length ? args[index + 1] : undefined;
}

export function parseOptions(args: string[]): Options {
  const problemsFile = optionValue(args, "--problems");
  if (!problemsFile) fail("--problems file is required");
  const api = optionValue(args, "--api") ?? "http://127.0.0.1:4174";
  const stepsValue = optionValue(args, "--steps");
  const steps = new Set<Step>(stepsValue ? stepsValue.split(",").map((step) => step.trim() as Step) : [...ALL_STEPS]);
  for (const step of steps) if (!(ALL_STEPS as readonly string[]).includes(step)) fail(`unknown step: ${step}`);
  if (steps.has("draft") && !steps.has("generate")) fail("draft without generate is not useful; include generate or drop draft");
  const modes = optionValue(args, "--modes")?.split(",").map((mode) => mode.trim()) ?? [...ALL_MODES];
  const assistance = optionValue(args, "--assistance")?.split(",").map((item) => item.trim()) ?? [...ALL_ASSISTANCE];
  const selectValue = optionValue(args, "--select");
  return {
    problemsFile,
    api: api.replace(/\/+$/, ""),
    steps,
    concurrency: Number(optionValue(args, "--concurrency") ?? "1"),
    resume: args.includes("--resume"),
    force: args.includes("--force"),
    yes: args.includes("--yes"),
    select: selectValue ? selectValue.split(",").map((item) => item.trim().toLowerCase()).filter(Boolean) : [],
    repairRounds: Number(optionValue(args, "--repair-rounds") ?? "1"),
    autoAccept: args.includes("--auto-accept"),
    provider: optionValue(args, "--provider"),
    model: optionValue(args, "--model"),
    language: optionValue(args, "--language") ?? "python",
    languageProvided: optionValue(args, "--language") !== undefined,
    variants: Number(optionValue(args, "--variants") ?? "1"),
    modes,
    assistance,
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
  return problems.filter((problem) => {
    const id = String(problem.id ?? "").toLowerCase();
    const slug = String(problem.slug ?? "").toLowerCase();
    const title = String(problem.title ?? "").toLowerCase();
    return select.some((wanted) => id === wanted || slug === wanted || title === wanted || title.includes(wanted));
  });
}

/**
 * Coverage identity for duplicate detection: a problem in one implementation
 * language is a separate deliverable from the same problem in another
 * language, so the key includes both the statement and the language.
 */
export function coverageKey(problem: string, language: string): string {
  return `${problem}\u0000${language}`;
}

type ApiResult = { ok: true; status: number; body: unknown } | { ok: false; status: number; body: unknown };

async function apiRequest(options: Options, method: string, path: string, payload?: unknown): Promise<ApiResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10 * 60_000);
  try {
    const response = await fetch(`${options.api}${path}`, {
      method,
      headers: payload === undefined ? undefined : { "content-type": "application/json" },
      body: payload === undefined ? undefined : JSON.stringify(payload),
      signal: controller.signal,
    });
    const text = await response.text();
    let body: unknown = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = text; }
    return { ok: response.ok, status: response.status, body };
  } finally {
    clearTimeout(timer);
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

async function acceptedByProblem(options: Options): Promise<Map<string, AcceptedUnit>> {
  const result = await apiRequest(options, "GET", "/api/drafts");
  if (!result.ok) throw new Error(`cannot list drafts: ${draftError(result)}`);
  const drafts = (result.body as { drafts?: Array<{ id: string; problem: string; status: string; language?: string; modes?: string[]; unitId?: string }> }).drafts ?? [];
  const map = new Map<string, AcceptedUnit>();
  for (const draft of drafts) {
    if (draft.status !== "accepted") continue;
    const problem = String(draft.problem ?? "").trim();
    if (!problem) continue;
    const language = String(draft.language ?? "python").trim() || "python";
    const modes = new Set(draft.modes ?? []);
    const key = coverageKey(problem, language);
    const existing = map.get(key);
    if (existing) for (const mode of existing.modes) modes.add(mode);
    map.set(key, { draftId: draft.id, unitId: draft.unitId, modes });
  }
  return map;
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

async function processProblem(
  options: Options,
  problem: BatchProblem,
  acceptedMap: Map<string, AcceptedUnit>,
  context: RunContext,
): Promise<ItemResult> {
  const base: ItemResult = { title: problem.title, status: "failed" };
  let duplicatePolicy = context.duplicatePolicy;
  try {
    // An explicit --language always wins; otherwise the catalog entry (for
    // example hot100.json pins python) is the default.
    const language = options.languageProvided ? options.language : (problem.language ?? options.language);
    const accepted = acceptedMap.get(coverageKey(problem.problem, language));
    const covered = accepted !== undefined && options.modes.every((mode) => accepted.modes.has(mode));
    if (accepted && covered && !options.force) {
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
        return { ...base, status: "skipped", reason: "already covered by accepted unit (use --force to regenerate)" };
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
      const draftResult = await apiRequest(options, "POST", "/api/drafts", {
        title: problem.title,
        problem: problem.problem,
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
    base.draftId = draftId;

    if (options.steps.has("generate")) {
      const generated = await apiRequest(options, "POST", `/api/drafts/${draftId}/generate`);
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
        if (allPassed || repairs >= options.repairRounds || !options.steps.has("generate")) break;
        const rollback = await apiRequest(options, "POST", `/api/drafts/${draftId}/rollback`);
        if (!rollback.ok) break;
        const regenerated = await apiRequest(options, "POST", `/api/drafts/${draftId}/generate`);
        if (!regenerated.ok) break;
        const revalidated = await apiRequest(options, "POST", `/api/drafts/${draftId}/validate`);
        if (!revalidated.ok) break;
        repairs += 1;
      }
      base.repairRoundsUsed = repairs;
      base.reviewVerdicts = reviewVerdicts;
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
  const options = parseOptions(process.argv.slice(2));
  if (!Number.isInteger(options.concurrency) || options.concurrency < 1) fail("--concurrency must be a positive integer");
  if (!Number.isInteger(options.variants) || options.variants < 1) fail("--variants must be a positive integer");
  const loaded = await loadProblems(options.problemsFile);
  const withStatements = loaded.filter((problem) => problem.problem.length > 0);
  const empty = loaded.length - withStatements.length;
  const problems = selectProblems(withStatements, options.select);
  const deselected = withStatements.length - problems.length;
  if (empty > 0) console.log(`batch-authoring: skipped ${empty} entries without a problem statement`);
  if (deselected > 0) console.log(`batch-authoring: selected ${problems.length} of ${withStatements.length} problems (--select)`);
  if (problems.length === 0) fail("problems file contains no entries");
  console.log(`batch-authoring: ${problems.length} problems, steps=[${[...options.steps].join(",")}], concurrency=${options.concurrency}${options.force ? ", force" : ", dedupe-covered"}${options.select.length > 0 ? `, select=[${options.select.join(",")}]` : ""}`);

  const acceptedMap = await acceptedByProblem(options);
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
        result = await processProblem(options, problem, acceptedMap, context);
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

  const summary = {
    generatedAt: new Date().toISOString(),
    total: problems.length,
    accepted: results.filter((result) => result.status === "accepted").length,
    needsReview: results.filter((result) => result.status === "needs_review").length,
    failed: results.filter((result) => result.status === "failed").length,
    skipped: results.filter((result) => result.status === "skipped").length,
    results,
  };
  await writeFile(resolve(options.report), `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  console.log(`batch-authoring: done — ${summary.accepted} accepted, ${summary.needsReview} need review, ${summary.failed} failed, ${summary.skipped} skipped. Report: ${options.report}`);
  if (context.aborted) {
    console.error("batch-authoring: aborted by user; partial results written to the report");
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
