import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PORT = Number(process.env.GEWU_WORKBENCH_PORT ?? 4174);
const here = dirname(fileURLToPath(import.meta.url));
const statePath = resolve(here, "../drafts/.workbench/state.json");

type DraftStatus = "draft" | "queued" | "validated" | "accepted";
type DraftRecord = {
  id: string;
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
    const reviewMatch = url.pathname.match(/^\/api\/drafts\/([^/]+)\/reviews$/);
    if (request.method === "POST" && reviewMatch) {
      const payload = await body(request);
      if (!isRecord(payload) || typeof payload.role !== "string") throw new Error("review role is required");
      if (!state.drafts.some((draft) => draft.id === reviewMatch[1])) return send(response, 404, { error: "draft not found" });
      const review: ReviewRecord = { id: crypto.randomUUID(), draftId: reviewMatch[1], role: payload.role, verdict: "pending", artifactHash: null, createdAt: new Date().toISOString() };
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
