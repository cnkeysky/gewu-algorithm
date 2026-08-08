import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
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
 *   --resume             skip problems already accepted in the store
 *   --repair-rounds <n>  regenerate from review feedback after needs_revision (default 1)
 *   --auto-accept        accept needs_revision drafts with an explicit rationale record
 *   --provider, --model  recorded metadata on the draft (generation uses server env)
 *   --language <slug>    implementation language (default python)
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
};

type Options = {
  problemsFile: string;
  api: string;
  steps: Set<Step>;
  concurrency: number;
  resume: boolean;
  repairRounds: number;
  autoAccept: boolean;
  provider?: string;
  model?: string;
  language: string;
  variants: number;
  modes: string[];
  assistance: string[];
  report: string;
};

function fail(message: string): never {
  console.error(`batch-authoring: ${message}`);
  console.error("usage: node dist/batch-authoring.js --problems <file.json|tsv> [--api url] [--steps draft,generate,validate,review,accept] [--concurrency n] [--resume] [--repair-rounds n] [--auto-accept] [--language python] [--variants 1] [--modes ...] [--assistance ...] [--report path]");
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
  const modes = optionValue(args, "--modes")?.split(",").map((mode) => mode.trim()) ?? [...ALL_MODES];
  const assistance = optionValue(args, "--assistance")?.split(",").map((item) => item.trim()) ?? [...ALL_ASSISTANCE];
  return {
    problemsFile,
    api: api.replace(/\/+$/, ""),
    steps,
    concurrency: Number(optionValue(args, "--concurrency") ?? "1"),
    resume: args.includes("--resume"),
    repairRounds: Number(optionValue(args, "--repair-rounds") ?? "1"),
    autoAccept: args.includes("--auto-accept"),
    provider: optionValue(args, "--provider"),
    model: optionValue(args, "--model"),
    language: optionValue(args, "--language") ?? "python",
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
    return list.map((item) => ({ ...item, problem: String(item.problem).trim() }));
  }
  return trimmed.split("\n").filter(Boolean).map((line) => {
    const [title, problem, sourceUrl] = line.split("\t").map((part) => part.trim());
    if (!title || !problem) throw new Error(`invalid TSV line: ${line.slice(0, 80)}`);
    return { title, problem, sourceUrl };
  });
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

async function listAcceptedProblems(options: Options): Promise<Set<string>> {
  const result = await apiRequest(options, "GET", "/api/drafts");
  if (!result.ok) throw new Error(`cannot list drafts: ${draftError(result)}`);
  const body = result.body as { drafts?: Array<{ problem: string; status: string }> };
  return new Set((body.drafts ?? []).filter((draft) => draft.status === "accepted").map((draft) => draft.problem.trim()));
}

type ItemResult = {
  title: string;
  status: "accepted" | "needs_review" | "failed" | "skipped";
  draftId?: string;
  unitId?: string;
  publishedPath?: string;
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

async function processProblem(options: Options, problem: BatchProblem): Promise<ItemResult> {
  const base: ItemResult = { title: problem.title, status: "failed" };
  try {
    if (options.resume && (await listAcceptedProblems(options)).has(problem.problem)) {
      return { ...base, status: "skipped" };
    }
    if (!options.steps.has("draft")) fail("draft step must be enabled to resolve a draft id");
    const draftResult = await apiRequest(options, "POST", "/api/drafts", {
      title: problem.title,
      problem: problem.problem,
      provider: options.provider ?? "deepseek",
      model: options.model ?? "deepseek-v4-flash",
      language: options.language,
      variants: options.variants,
      modes: options.modes,
      assistance: options.modes.includes("code_recall") ? options.assistance : [],
    });
    if (!draftResult.ok) return { ...base, status: "failed", error: `draft: ${draftError(draftResult)}` };
    const draftId = String((draftResult.body as { draft?: { id?: string } }).draft?.id ?? "");
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
    return { ...base, status: "failed", error: error instanceof Error ? error.message : String(error) };
  }
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  if (!Number.isInteger(options.concurrency) || options.concurrency < 1) fail("--concurrency must be a positive integer");
  if (!Number.isInteger(options.variants) || options.variants < 1) fail("--variants must be a positive integer");
  const problems = await loadProblems(options.problemsFile);
  if (problems.length === 0) fail("problems file contains no entries");
  console.log(`batch-authoring: ${problems.length} problems, steps=[${[...options.steps].join(",")}], concurrency=${options.concurrency}${options.resume ? ", resume" : ""}`);

  const results: ItemResult[] = [];
  const queue = [...problems];
  const workers = Array.from({ length: Math.min(options.concurrency, problems.length) }, async () => {
    for (; ; ) {
      const problem = queue.shift();
      if (!problem) return;
      const result = await processProblem(options, problem);
      results.push(result);
      const label = result.status === "accepted" ? "OK" : result.status === "skipped" ? "--" : result.status === "needs_review" ? "!!" : "XX";
      console.log(`[${label}] ${problem.title}${result.draftId ? ` (draft ${result.draftId})` : ""}${result.error ? ` — ${result.error}` : ""}${result.reviewVerdicts ? ` — ${JSON.stringify(result.reviewVerdicts)}` : ""}`);
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
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
