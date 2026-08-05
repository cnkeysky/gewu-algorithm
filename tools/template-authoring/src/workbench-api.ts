import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PiGenerator, optionsFromEnvironment, type CodeRecallAssistanceSelection, type PracticeModeSelection } from "./pi-generator.js";
import { reviewTemplateDraft } from "./review-template.js";
import { builtinTaskRegistry } from "./task-registry.js";

const PORT = Number(process.env.GEWU_WORKBENCH_PORT ?? 4174);
const here = dirname(fileURLToPath(import.meta.url));
const statePath = resolve(here, "../drafts/.workbench/state.json");

type DraftStatus = "draft" | "queued" | "generated" | "validated" | "accepted";
type DraftRecord = {
  id: string;
  taskId?: string;
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
  artifactPath?: string;
};
type ReviewRecord = {
  id: string;
  draftId: string;
  role: string;
  verdict: "pending" | "pass" | "needs_revision" | "reject";
  artifactHash: string | null;
  createdAt: string;
};
type State = { drafts: DraftRecord[]; reviews: ReviewRecord[] };

function validateDraft(draft: DraftRecord): string[] {
  const errors: string[] = [];
  if (draft.problem.trim().length < 20) errors.push("problem must contain at least 20 characters");
  if (draft.modes.length === 0) errors.push("at least one practice mode is required");
  if (!draft.modes.includes("code_recall") && draft.assistance.length > 0) errors.push("code recall assistance requires code_recall");
  if (draft.variants < 1 || draft.variants > 5) errors.push("variants must be between 1 and 5");
  return errors;
}

async function loadState(): Promise<State> {
  try {
    const value = JSON.parse(await readFile(statePath, "utf8")) as Partial<State>;
    return { drafts: Array.isArray(value.drafts) ? value.drafts : [], reviews: Array.isArray(value.reviews) ? value.reviews : [] };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return { drafts: [], reviews: [] };
  }
}

async function saveState(state: State): Promise<void> {
  await mkdir(dirname(statePath), { recursive: true });
  const temporary = `${statePath}.tmp`;
  await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  await rename(temporary, statePath);
}

async function generateDraft(draft: DraftRecord): Promise<{ provider: string; model: string; artifactPath: string }> {
  const definition = builtinTaskRegistry.resolve(draft.taskId, draft.problem);
  const artifact = await new PiGenerator(optionsFromEnvironment()).generate(definition.buildTask(draft.problem, {
      practice_modes: draft.modes as PracticeModeSelection[],
      code_recall_assistance: draft.assistance as CodeRecallAssistanceSelection[],
      implementation_languages: [draft.language],
      implementation_variants: draft.variants,
    }));
  if (!isRecord(artifact.manifest)) throw new Error("generator returned an invalid artifact");
  if (!isRecord(artifact.manifest.manifest)) throw new Error("generator manifest is invalid");
  artifact.manifest.manifest.status = "draft";
  artifact.manifest.manifest.validation = {
    schema: "pending", code: "pending", content_review: "pending", transfer_review: "pending", last_validated_at: null,
  };
  artifact.manifest.manifest.provenance = {
    ...(isRecord(artifact.manifest.manifest.provenance) ? artifact.manifest.manifest.provenance : {}),
    generated_by: { provider: artifact.provider, model: artifact.model, task_version: artifact.taskVersion, generated_at: new Date().toISOString() },
  };
  definition.validateArtifact(artifact.manifest);
  if (!isRecord(artifact.manifest.sources)) throw new Error("generator sources are invalid");
  const artifactAbsolutePath = join(dirname(statePath), "artifacts", draft.id);
  await mkdir(artifactAbsolutePath, { recursive: true });
  await writeFile(join(artifactAbsolutePath, "unit.json"), `${JSON.stringify(artifact.manifest.manifest, null, 2)}\n`, "utf8");
  for (const [path, content] of Object.entries(artifact.manifest.sources)) {
    if (typeof content !== "string" || path.includes("..") || path.startsWith("/")) throw new Error(`invalid generated source path: ${path}`);
    const destination = join(artifactAbsolutePath, path);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, content, "utf8");
  }
  await writeFile(join(artifactAbsolutePath, "generation.json"), `${JSON.stringify({ provider: artifact.provider, model: artifact.model, task_id: artifact.taskId, task_version: artifact.taskVersion, review: artifact.review }, null, 2)}\n`, "utf8");
  return { provider: artifact.provider, model: artifact.model, artifactPath: relative(resolve(here, "../..", ".."), artifactAbsolutePath) };
}

function send(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "access-control-allow-origin": "http://127.0.0.1:5173",
    "access-control-allow-headers": "content-type",
    "access-control-allow-methods": "GET,POST,OPTIONS",
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
  if (!Number.isInteger(variants) || Number(variants) < 1 || Number(variants) > 5) throw new Error("variants must be between 1 and 5");
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    taskId: typeof value.taskId === "string" ? value.taskId : undefined,
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
  };
}

const server = createServer(async (request, response) => {
  if (request.method === "OPTIONS") return send(response, 204, {});
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
  try {
    if (request.method === "GET" && url.pathname === "/api/health") return send(response, 200, { status: "ok", storage: "local" });
    if (request.method === "GET" && url.pathname === "/api/tasks") return send(response, 200, { tasks: builtinTaskRegistry.list().map((definition) => ({ taskId: definition.taskId, label: definition.label, taskVersion: definition.taskVersion })) });
    const state = await loadState();
    if (request.method === "GET" && url.pathname === "/api/drafts") return send(response, 200, { drafts: state.drafts });
    if (request.method === "GET" && url.pathname === "/api/reviews") return send(response, 200, { reviews: state.reviews });
    if (request.method === "POST" && url.pathname === "/api/drafts") {
      const draft = draftFrom(await body(request));
      state.drafts = [draft, ...state.drafts];
      state.reviews = [{ id: crypto.randomUUID(), draftId: draft.id, role: "all", verdict: "pending", artifactHash: null, createdAt: draft.createdAt }, ...state.reviews];
      await saveState(state);
      return send(response, 201, { draft });
    }
    const generationMatch = url.pathname.match(/^\/api\/drafts\/([^/]+)\/generate$/);
    if (request.method === "POST" && generationMatch) {
      const draft = state.drafts.find((item) => item.id === generationMatch[1]);
      if (!draft) return send(response, 404, { error: "draft not found" });
      const generated = await generateDraft(draft);
      draft.status = "generated";
      draft.artifactPath = generated.artifactPath;
      await saveState(state);
      return send(response, 200, { status: "generated", provider: generated.provider, model: generated.model, artifactPath: generated.artifactPath });
    }
    const validationMatch = url.pathname.match(/^\/api\/drafts\/([^/]+)\/validate$/);
    if (request.method === "POST" && validationMatch) {
      const draft = state.drafts.find((item) => item.id === validationMatch[1]);
      if (!draft) return send(response, 404, { error: "draft not found" });
      const errors = validateDraft(draft);
      if (errors.length > 0) return send(response, 422, { status: "failed", errors });
      draft.status = "validated";
      await saveState(state);
      return send(response, 200, { status: "passed", draft });
    }
    const acceptanceMatch = url.pathname.match(/^\/api\/drafts\/([^/]+)\/accept$/);
    if (request.method === "POST" && acceptanceMatch) {
      const draft = state.drafts.find((item) => item.id === acceptanceMatch[1]);
      if (!draft) return send(response, 404, { error: "draft not found" });
      if (draft.status !== "validated") return send(response, 409, { error: "validate the draft before acceptance" });
      const passedReview = state.reviews.some((review) => review.draftId === draft.id && review.verdict === "pass");
      if (!passedReview) return send(response, 409, { error: "a passing role review is required before acceptance" });
      draft.status = "accepted";
      await saveState(state);
      return send(response, 200, { status: "accepted", draft });
    }
    const reviewMatch = url.pathname.match(/^\/api\/drafts\/([^/]+)\/reviews$/);
    if (request.method === "POST" && reviewMatch) {
      const payload = await body(request);
      if (!isRecord(payload) || typeof payload.role !== "string") throw new Error("review role is required");
      const draft = state.drafts.find((item) => item.id === reviewMatch[1]);
      if (!draft) return send(response, 404, { error: "draft not found" });
      if (!draft.artifactPath) return send(response, 409, { error: "generate the draft before requesting review" });
      const repoRoot = resolve(here, "../..", "..");
      const artifactAbsolutePath = resolve(repoRoot, draft.artifactPath);
      await reviewTemplateDraft(relative(repoRoot, artifactAbsolutePath), payload.role);
      const reportPath = join(artifactAbsolutePath, "reviews", `${payload.role}.json`);
      const report = JSON.parse(await readFile(reportPath, "utf8")) as { verdict?: ReviewRecord["verdict"]; artifact_hash?: string };
      const review: ReviewRecord = { id: crypto.randomUUID(), draftId: draft.id, role: payload.role, verdict: report.verdict ?? "pending", artifactHash: report.artifact_hash ?? null, createdAt: new Date().toISOString() };
      state.reviews = [review, ...state.reviews];
      await saveState(state);
      return send(response, 201, { review });
    }
    return send(response, 404, { error: "route not found" });
  } catch (error) {
    return send(response, 400, { error: error instanceof Error ? error.message : "invalid request" });
  }
});

server.listen(PORT, "127.0.0.1", () => console.log(`GEWU authoring API listening on http://127.0.0.1:${PORT}`));
