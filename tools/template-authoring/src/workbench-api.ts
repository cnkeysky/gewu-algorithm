import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { builtinModels } from "@earendil-works/pi-ai/providers/all";
import { PiGenerator, optionsFromEnvironment, type CodeRecallAssistanceSelection, type PracticeModeSelection } from "./pi-generator.js";
import { reviewTemplateDraft } from "./review-template.js";
import { builtinTaskRegistry } from "./task-registry.js";

const PORT = Number(process.env.GEWU_WORKBENCH_PORT ?? 4174);
const here = dirname(fileURLToPath(import.meta.url));
const storageRoot = resolve(here, "../drafts/.workbench");
const databasePath = join(storageRoot, "authoring.sqlite");
mkdirSync(storageRoot, { recursive: true });
const database = new DatabaseSync(databasePath);
const modelCatalog = builtinModels();
database.exec(`
  CREATE TABLE IF NOT EXISTS drafts (
    id TEXT PRIMARY KEY, task_id TEXT, title TEXT NOT NULL, problem TEXT NOT NULL,
    provider TEXT NOT NULL, model TEXT NOT NULL, language TEXT NOT NULL, variants INTEGER NOT NULL,
    modes_json TEXT NOT NULL, assistance_json TEXT NOT NULL, status TEXT NOT NULL,
    created_at TEXT NOT NULL, artifact_path TEXT
  );
  CREATE TABLE IF NOT EXISTS reviews (
    id TEXT PRIMARY KEY, draft_id TEXT NOT NULL, role TEXT NOT NULL, verdict TEXT NOT NULL,
    artifact_hash TEXT, created_at TEXT NOT NULL, FOREIGN KEY (draft_id) REFERENCES drafts(id)
  );
`);

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
  const drafts = database.prepare("SELECT id, task_id, title, problem, provider, model, language, variants, modes_json, assistance_json, status, created_at, artifact_path FROM drafts ORDER BY created_at DESC").all() as Array<Record<string, unknown>>;
  const reviews = database.prepare("SELECT id, draft_id, role, verdict, artifact_hash, created_at FROM reviews ORDER BY created_at DESC").all() as Array<Record<string, unknown>>;
  return {
    drafts: drafts.map((row) => ({ id: String(row.id), taskId: row.task_id ? String(row.task_id) : undefined, title: String(row.title), problem: String(row.problem), provider: String(row.provider), model: String(row.model), language: String(row.language), variants: Number(row.variants), modes: JSON.parse(String(row.modes_json)) as string[], assistance: JSON.parse(String(row.assistance_json)) as string[], status: row.status as DraftStatus, createdAt: String(row.created_at), artifactPath: row.artifact_path ? String(row.artifact_path) : undefined })),
    reviews: reviews.filter((row) => row.role !== "all").map((row) => ({ id: String(row.id), draftId: String(row.draft_id), role: String(row.role), verdict: row.verdict as ReviewRecord["verdict"], artifactHash: row.artifact_hash ? String(row.artifact_hash) : null, createdAt: String(row.created_at) })),
  };
}

function saveState(state: State): void {
  database.exec("BEGIN");
  try {
    database.exec("DELETE FROM reviews; DELETE FROM drafts;");
    const draftInsert = database.prepare("INSERT INTO drafts (id, task_id, title, problem, provider, model, language, variants, modes_json, assistance_json, status, created_at, artifact_path) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
    for (const draft of state.drafts) draftInsert.run(draft.id, draft.taskId ?? null, draft.title, draft.problem, draft.provider, draft.model, draft.language, draft.variants, JSON.stringify(draft.modes), JSON.stringify(draft.assistance), draft.status, draft.createdAt, draft.artifactPath ?? null);
    const reviewInsert = database.prepare("INSERT INTO reviews (id, draft_id, role, verdict, artifact_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)");
    for (const review of state.reviews.filter((item) => item.role !== "all")) reviewInsert.run(review.id, review.draftId, review.role, review.verdict, review.artifactHash, review.createdAt);
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

function migrateLegacyState(): void {
  if (!existsSync(join(storageRoot, "state.json"))) return;
  const count = Number((database.prepare("SELECT COUNT(*) AS count FROM drafts").get() as { count: number }).count);
  if (count > 0) return;
  const legacy = JSON.parse(readFileSync(join(storageRoot, "state.json"), "utf8")) as Partial<State>;
  saveState({ drafts: Array.isArray(legacy.drafts) ? legacy.drafts : [], reviews: Array.isArray(legacy.reviews) ? legacy.reviews.filter((review) => review.role !== "all") : [] });
}

migrateLegacyState();

async function generateDraft(draft: DraftRecord): Promise<{ provider: string; model: string; artifactPath: string }> {
  const definition = builtinTaskRegistry.resolve(draft.taskId, draft.problem);
  const artifact = await new PiGenerator(optionsFromEnvironment()).generate(definition.buildTask(draft.problem, {
      practice_modes: draft.modes as PracticeModeSelection[],
      code_recall_assistance: draft.assistance as CodeRecallAssistanceSelection[],
      code_recall_layouts: draft.modes.includes("code_recall")
        ? [
            "full_recall",
            ...(draft.assistance.includes("comments")
              ? ["comment_guided" as const, "comment_to_code" as const]
              : []),
            ...(draft.assistance.includes("cloze") ? ["cloze" as const] : []),
          ]
        : [],
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
  const artifactAbsolutePath = join(storageRoot, "artifacts", `${draft.id}-${Date.now()}`);
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
    "access-control-allow-methods": "GET,POST,PATCH,OPTIONS",
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
    if (request.method === "GET" && url.pathname === "/api/providers") {
      const providers = [
        ["deepseek", "DeepSeek"], ["openai", "OpenAI"], ["moonshotai", "Moonshot"], ["xiaomi", "Xiaomi MiMo"],
      ].map(([id, label]) => ({ id, label, models: modelCatalog.getModels(id).map((model) => model.id) }));
      return send(response, 200, { providers });
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
      const updated = draftFrom({ ...draft, ...(await body(request) as Record<string, unknown>) });
      updated.id = draft.id;
      updated.createdAt = draft.createdAt;
      updated.status = "queued";
      updated.artifactPath = undefined;
      validatePersistedDraft(updated);
      state.drafts = state.drafts.map((item) => item.id === draft.id ? updated : item);
      state.reviews = state.reviews.filter((review) => review.draftId !== draft.id);
      await saveState(state);
      return send(response, 200, { draft: updated });
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
      if (draft.status !== "validated" || !draft.artifactPath) return send(response, 409, { error: "validate the generated draft before requesting review" });
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
    if (error instanceof DraftInputError) return send(response, 422, { status: "failed", errors: error.errors });
    return send(response, 400, { error: error instanceof Error ? error.message : "invalid request" });
  }
});

server.listen(PORT, "127.0.0.1", () => console.log(`GEWU authoring API listening on http://127.0.0.1:${PORT}`));
