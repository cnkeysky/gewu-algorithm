import "./styles.css";

type PracticeMode = "shadow_typing" | "flow_recall" | "code_recall" | "reasoning_recall" | "transfer_practice";
type Assistance = "skeleton" | "comments" | "keywords" | "cloze" | "none";

const modes: Array<{ id: PracticeMode; label: string; hint: string }> = [
  { id: "shadow_typing", label: "Shadow typing", hint: "Reconstruct the reviewed implementation." },
  { id: "flow_recall", label: "Flow recall", hint: "Recall the algorithm frontier step by step." },
  { id: "code_recall", label: "Code recall", hint: "Rebuild code with graduated assistance." },
  { id: "reasoning_recall", label: "Reasoning recall", hint: "Recover invariants, trade-offs, and boundaries." },
  { id: "transfer_practice", label: "Transfer practice", hint: "Apply the pattern to a changed case." },
];
const assistance: Array<{ id: Assistance; label: string }> = [
  { id: "comments", label: "Comments" },
  { id: "keywords", label: "Keywords" },
  { id: "cloze", label: "Cloze" },
  { id: "skeleton", label: "Skeleton" },
  { id: "none", label: "No hints" },
];
let providerModels: Record<string, string[]> = {
  deepseek: ["deepseek-v4-flash", "deepseek-v4-pro"],
  openai: ["gpt-4.1", "gpt-4.1-mini"],
  moonshotai: ["kimi-k2-0711-preview", "kimi-k2-thinking"],
  xiaomi: ["mimo-v2-flash", "mimo-v2-pro"],
};

const root = document.querySelector<HTMLDivElement>("#app");
if (!root) throw new Error("workbench root is missing");

root.innerHTML = `
  <header class="topbar">
    <a class="brand" href="#home" data-go="home"><span class="brand-mark" aria-hidden="true"><i></i><i></i><i></i><i></i></span>GEWU</a>
    <nav aria-label="Primary navigation">
      <button class="nav-item active" data-view="home">Home</button>
      <button class="nav-item" data-view="practice">Practice</button>
      <span class="nav-divider" aria-hidden="true"></span>
      <button class="nav-item" data-view="new">Authoring</button>
      <button class="nav-item" data-view="drafts">Drafts <span class="nav-count">3</span></button>
      <button class="nav-item" data-view="history">Review history</button>
    </nav>
    <div class="connection"><span class="status-dot"></span> Local workspace</div>
  </header>
  <main class="shell">
    <section id="home-view" class="app-view home-view">
      <div class="home-hero">
        <div class="hero-copy">
          <p class="eyebrow">GEWU / Algorithm practice system</p>
          <h1>Make the invisible structure of an algorithm visible.</h1>
          <p class="hero-lede">GEWU turns reviewed algorithms into deliberate practice. Reconstruct code, recover reasoning, and transfer patterns while one deterministic core keeps every transition and attempt trustworthy.</p>
          <div class="hero-actions"><button class="button primary" type="button" data-go="practice">Start practicing <span aria-hidden="true">&#8594;</span></button><button class="button secondary" type="button" data-go="new">Author a unit</button></div>
          <div class="hero-meta"><span><b>01</b> canonical AlgorithmUnit</span><span><b>05</b> practice projections</span><span><b>00</b> hidden scoring shortcuts</span></div>
        </div>
        <div class="terminal-visual" aria-label="GEWU core status visualization"><div class="terminal-bar"><span></span><span></span><span></span><b>gewu-core</b></div><div class="terminal-body"><p><em>core</em>.start(<strong>graph.bfs</strong>, <strong>code_recall</strong>)</p><p class="dim">&gt; loading reviewed revision <strong>r1</strong></p><p class="green">&gt; state machine ready</p><p class="amber">&gt; next move: reconstruct frontier</p><div class="terminal-grid"><span>accepted</span><strong>000</strong><span>stability</span><strong>0.00</strong><span>mode</span><strong>RECALL</strong></div></div></div>
      </div>
      <section class="vision-strip"><div><p class="eyebrow">The GEWU model</p><h2>One canonical unit. Many ways to remember it.</h2></div><p>Content, practice, review, and persistence share a typed boundary. The interface can change; the learning facts do not.</p></section>
      <section class="home-cards"><article><span class="card-index">01</span><h3>Reconstruct</h3><p>Shadow typing and code recall make the implementation a sequence of decisions, not a snippet to copy.</p><button class="text-link" type="button" data-go="practice">Open Practice <span aria-hidden="true">&#8594;</span></button></article><article><span class="card-index">02</span><h3>Understand</h3><p>Flow, reasoning, and transfer recall keep state, invariants, trade-offs, and boundaries in view.</p><button class="text-link" type="button" data-go="practice">Explore modes <span aria-hidden="true">&#8594;</span></button></article><article><span class="card-index">03</span><h3>Author</h3><p>Describe an algorithm once. GEWU generates one reviewed learning unit with explicit practice projections.</p><button class="text-link" type="button" data-go="new">Build a unit <span aria-hidden="true">&#8594;</span></button></article></section>
      <section class="core-principles"><div><p class="eyebrow">Under the surface</p><h2>Trust lives in the core.</h2></div><div class="principle-list"><p><b>Rust Core</b><span>Owns scoring, transitions, checkpoints, and attempt facts.</span></p><p><b>Local first</b><span>Your content and practice history stay on the machine.</span></p><p><b>Provider neutral</b><span>LLM generation is optional and never owns completion state.</span></p></div></section>
    </section>
    <div id="new-view" class="app-view" hidden>
    <section class="intro">
      <div>
        <p class="eyebrow">Template authoring</p>
        <h1>Shape the next practice unit.</h1>
        <p class="lede">Describe the algorithm once. GEWU will build one canonical unit with the practice projections you select.</p>
      </div>
      <div class="stage-chip"><span>01</span><strong>Draft</strong><small>Not published</small></div>
    </section>
    <section class="workspace-grid">
      <form class="panel form-panel" id="draft-form">
        <div class="panel-heading"><div><p class="eyebrow">01 / Input</p><h2>New generation draft</h2></div><span class="required">Required</span></div>
        <label class="field-label" for="problem">Algorithm problem</label>
        <textarea id="problem" rows="6" placeholder="Describe the problem, expected behavior, constraints, and boundaries."></textarea>
        <div class="field-row">
          <label class="field"><span>Provider</span><select id="provider"><option value="deepseek">DeepSeek</option><option value="openai">OpenAI</option><option value="moonshotai">Moonshot</option><option value="xiaomi">Xiaomi MiMo</option></select></label>
          <label class="field"><span>Model <small class="catalog-note">From provider catalog</small></span><select id="model"><option>deepseek-v4-flash</option><option>deepseek-v4-pro</option></select></label>
        </div>
        <div class="field-row">
          <label class="field"><span>Languages</span><input id="languages" value="python" /></label>
          <div class="field"><span>Implementation plan</span><div class="readonly-value"><strong>Automatic</strong><small>One teaching implementation by default</small></div></div>
        </div>
        <fieldset>
          <legend>Practice projections <label class="select-all"><input type="checkbox" id="select-all-modes" /><span>All modes</span></label></legend>
          <div class="mode-list">${modes.map((mode) => `<label class="mode-option"><input type="checkbox" name="mode" value="${mode.id}" /><span class="checkmark"></span><span><strong>${mode.label}</strong><small>${mode.hint}</small></span></label>`).join("")}</div>
        </fieldset>
        <fieldset id="assistance-fieldset" class="assistance-fieldset">
          <legend>Code recall assistance</legend>
          <div class="assistance-list">${assistance.map((item) => `<label><input type="checkbox" name="assistance" value="${item.id}" /><span>${item.label}</span></label>`).join("")}</div>
          <p class="field-note" id="assistance-note">Select Code recall above to enable these hints.</p>
        </fieldset>
        <div class="form-actions"><button class="button secondary" type="button" id="reset">Reset</button><button class="button primary" type="submit" id="submit-draft">Create draft <span aria-hidden="true">&#8594;</span></button></div>
        <p class="form-message" id="form-message" role="status"></p>
      </form>
      <aside class="right-column">
        <section class="panel summary-panel"><div class="panel-heading"><div><p class="eyebrow">02 / Contract</p><h2>Generation profile</h2></div><span class="valid-badge" id="profile-state">Ready</span></div><div id="profile-summary"></div><div class="contract-note"><span class="note-icon">i</span><p>Modes are projections of one AlgorithmUnit. They do not create separate canonical templates.</p></div></section>
        <section class="panel review-panel"><div class="panel-heading"><div><p class="eyebrow">03 / Workflow</p><h2>Review gate</h2></div><span class="lock">Locked</span></div><div class="review-step"><span class="step-number">1</span><div><strong>Deterministic validation</strong><small>Schema, paths, source, and fixtures</small></div><span class="pending">Pending</span></div><div class="review-step"><span class="step-number">2</span><div><strong>Role review</strong><small>Correctness, learning design, provenance</small></div><span class="pending">Pending</span></div><div class="review-step"><span class="step-number">3</span><div><strong>Human acceptance</strong><small>Required before publication</small></div><span class="pending">Pending</span></div></section>
      </aside>
    </section>
    </div>
    <section id="practice-view" class="app-view panel page-panel" hidden>
      <div class="panel-heading"><div><p class="eyebrow">Core practice</p><h2>Practice workspace</h2></div><span class="lock" id="practice-connection">Core offline</span></div>
      <div class="practice-layout">
        <form id="practice-start" class="practice-controls">
          <label class="field"><span>Algorithm unit</span><select id="practice-unit"><option>Loading units...</option></select></label>
          <label class="field"><span>Practice mode</span><select id="practice-mode">${modes.map((mode) => `<option value="${mode.id}">${mode.label}</option>`).join("")}</select></label>
          <label class="field"><span>Practice ID <small class="catalog-note">Optional for multi-variant units</small></span><input id="practice-id" placeholder="automatic" /></label>
          <button class="button primary" type="submit">Start practice <span aria-hidden="true">&#8594;</span></button>
          <p class="form-message" id="practice-message" role="status"></p>
        </form>
        <section class="practice-session" id="practice-session" hidden>
          <div class="session-heading"><div><p class="eyebrow">Active session</p><h3 id="session-title">Practice</h3></div><span class="valid-badge" id="session-status">Active</span></div>
          <p id="session-prompt" class="session-prompt"></p><pre id="session-target" class="session-target"></pre>
          <textarea id="session-answer" rows="5" placeholder="Enter your answer or the next code segment."></textarea>
          <div class="form-actions"><button class="button primary" type="button" id="session-submit">Submit event</button><button class="button secondary" type="button" id="session-stop">Stop practice</button></div>
          <div class="session-meta" id="session-meta"></div>
        </section>
        <aside class="practice-side">
          <section><div class="panel-heading"><h3>Interrupted</h3><button class="inline-action" type="button" id="refresh-checkpoints">Refresh</button></div><div id="practice-checkpoints" class="compact-list"></div></section>
          <section><div class="panel-heading"><h3>Review queue</h3></div><div id="practice-recommendations" class="compact-list"></div></section>
          <section><div class="panel-heading"><h3>Recent attempts</h3></div><div id="practice-attempts" class="compact-list"></div></section>
        </aside>
      </div>
    </section>
    <section id="drafts-view" class="app-view panel page-panel" hidden>
      <div class="panel-heading"><div><p class="eyebrow">Saved work</p><h2>Drafts</h2></div><button class="button primary" type="button" data-go="new">New draft <span aria-hidden="true">&#8594;</span></button></div>
      <div class="draft-list" id="draft-list"></div>
      <p class="view-note">Draft entries will become API-backed once the local authoring service is connected.</p>
    </section>
    <section id="history-view" class="app-view panel page-panel" hidden>
      <div class="panel-heading"><div><p class="eyebrow">Audit trail</p><h2>Review history</h2></div><span class="lock">Immutable reports</span></div>
      <div class="history-list" id="history-list"></div>
      <p class="view-note">Reports are tied to an artifact hash and cannot promote a draft without human acceptance.</p>
    </section>
  </main>
  <footer><span>GEWU / deliberate algorithm practice</span><span>Local by design.</span></footer>
`;

const form = document.querySelector<HTMLFormElement>("#draft-form")!;
const profileSummary = document.querySelector<HTMLDivElement>("#profile-summary")!;
const profileState = document.querySelector<HTMLSpanElement>("#profile-state")!;
const assistanceFieldset = document.querySelector<HTMLFieldSetElement>("#assistance-fieldset")!;
const message = document.querySelector<HTMLParagraphElement>("#form-message")!;
const draftList = document.querySelector<HTMLDivElement>("#draft-list")!;
const historyList = document.querySelector<HTMLDivElement>("#history-list")!;
const selectAllModes = document.querySelector<HTMLInputElement>("#select-all-modes")!;
const assistanceNote = document.querySelector<HTMLParagraphElement>("#assistance-note")!;
const submitDraft = document.querySelector<HTMLButtonElement>("#submit-draft")!;
let editingDraftId: string | undefined;
const practiceApi = "/core/rpc";
let practiceRequestId = 1;
let practiceHandshaken = false;
let activePracticeSession: { session_id: string; mode: PracticeMode } | undefined;
type PracticeUnit = { id: string; revision: number; title: string; modes: PracticeMode[] };
type PracticeSession = { session_id: string; unit_title: string; mode: PracticeMode; status: string; accepted_text: string; target_text: string; current_prompt?: string; completed_steps: number; total_steps: number; accepted_input_count: number; rejected_input_count: number; prompt_count: number; scaffold_reveal_count: number; active_ms: number; wall_ms: number };
type Checkpoint = { id: string; unit_title: string; unit_id: string; mode: PracticeMode; completed_steps: number; total_steps: number; accepted_characters: number; target_characters: number; saved_at: string };
type Recommendation = { unit_id: string; revision: number; mode: PracticeMode; kind: string; priority: string; reason: string; due_after_days: number; due_at_ms?: number };
type Attempt = { id: string; unit_id: string; mode: PracticeMode; terminal_reason: string; accepted_input_count: number; rejected_input_count: number; created_at: string };
async function practiceRpc<T>(method: string, params: unknown = {}): Promise<T> {
  if (!practiceHandshaken && method !== "gewu/handshake") {
    await practiceRpc("gewu/handshake", { protocol_min: 1, protocol_max: 1, client_name: "gewu-web", client_version: "0.1.0" });
    practiceHandshaken = true;
  }
  const response = await fetch(practiceApi, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: practiceRequestId++, method, params }) });
  if (!response.ok) throw new Error(`Core HTTP ${response.status}`);
  const payload = await response.json() as { result?: T; error?: { message?: string } };
  if (payload.error) throw new Error(payload.error.message ?? "Core request failed");
  return payload.result as T;
}
function practiceMessage(text: string, error = false): void { const target = document.querySelector<HTMLParagraphElement>("#practice-message")!; target.textContent = text; target.className = `form-message ${error ? "error" : "success"}`; }
function renderPracticeSession(session: PracticeSession): void {
  document.querySelector<HTMLElement>("#practice-session")!.hidden = false;
  document.querySelector<HTMLElement>("#session-title")!.textContent = session.unit_title;
  document.querySelector<HTMLElement>("#session-status")!.textContent = session.status;
  document.querySelector<HTMLElement>("#session-prompt")!.textContent = session.current_prompt ?? "";
  document.querySelector<HTMLElement>("#session-target")!.textContent = session.target_text || session.accepted_text || "Awaiting the next response.";
  document.querySelector<HTMLElement>("#session-meta")!.textContent = `${session.mode.replaceAll("_", " ")} · ${session.accepted_input_count} accepted · ${session.rejected_input_count} rejected · ${session.prompt_count} prompts`;
  if (session.status !== "active") document.querySelector<HTMLButtonElement>("#session-submit")!.disabled = true;
}
async function refreshPracticeData(): Promise<void> {
  try {
    const [units, checkpoints, recommendations, attempts] = await Promise.all([
      practiceRpc<PracticeUnit[]>("gewu/listUnits"),
      practiceRpc<{ checkpoints: Checkpoint[] }>("gewu/listCheckpoints"),
      practiceRpc<Recommendation[]>("gewu/reviewRecommendations"),
      practiceRpc<{ attempts: Attempt[] }>("gewu/recentAttempts", { limit: 10 }),
    ]);
    const unitSelect = document.querySelector<HTMLSelectElement>("#practice-unit")!;
    unitSelect.innerHTML = units.map((unit) => `<option value="${unit.id}">${unit.title} · r${unit.revision}</option>`).join("");
    document.querySelector<HTMLElement>("#practice-connection")!.textContent = "Core connected";
    document.querySelector<HTMLElement>("#practice-checkpoints")!.innerHTML = checkpoints.checkpoints.length ? checkpoints.checkpoints.map((checkpoint) => `<div class="compact-row"><span><strong>${checkpoint.unit_title}</strong>${checkpoint.mode.replaceAll("_", " ")} · ${checkpoint.accepted_characters}/${checkpoint.target_characters}</span><span><button class="inline-action" data-resume-checkpoint="${checkpoint.id}">Resume</button><button class="inline-action" data-discard-checkpoint="${checkpoint.id}">Discard</button></span></div>`).join("") : `<div class="compact-empty">No interrupted practice.</div>`;
    document.querySelector<HTMLElement>("#practice-recommendations")!.innerHTML = recommendations.length ? recommendations.map((item) => `<div class="compact-row"><span><strong>${item.unit_id} · ${item.mode.replaceAll("_", " ")}</strong>${item.reason}</span><span>${item.due_at_ms ? formatDate(new Date(item.due_at_ms).toISOString()) : `${item.due_after_days}d`}</span></div>`).join("") : `<div class="compact-empty">No recommendations yet.</div>`;
    document.querySelector<HTMLElement>("#practice-attempts")!.innerHTML = attempts.attempts.length ? attempts.attempts.map((item) => `<div class="compact-row"><span><strong>${item.unit_id}</strong>${item.mode.replaceAll("_", " ")}</span><span>${item.terminal_reason}</span></div>`).join("") : `<div class="compact-empty">No attempts yet.</div>`;
  } catch (error) { document.querySelector<HTMLElement>("#practice-connection")!.textContent = "Core offline"; practiceMessage("Rust Core 未启动。请先运行 `cargo run -p gewu-cli -- serve`。", true); }
}

interface DraftRecord {
  id: string;
  taskId?: string;
  title: string;
  problem: string;
  provider: string;
  model: string;
  language: string;
  variants: number;
  modes: PracticeMode[];
  assistance: Assistance[];
  status: "draft" | "queued" | "generated" | "validated" | "accepted";
  createdAt: string;
}
interface ReviewRecord { id: string; draftId: string; role: string; verdict: "pending" | "pass" | "needs_revision" | "reject"; artifactHash: string | null; createdAt: string; }

const DRAFTS_KEY = "gewu.authoring.drafts.v1";
const REVIEWS_KEY = "gewu.authoring.reviews.v1";
function readDrafts(): DraftRecord[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(DRAFTS_KEY) ?? "[]");
    return Array.isArray(value) ? value.filter((item): item is DraftRecord => typeof item === "object" && item !== null && typeof (item as DraftRecord).id === "string") : [];
  } catch { return []; }
}
function saveDrafts(drafts: DraftRecord[]): void { localStorage.setItem(DRAFTS_KEY, JSON.stringify(drafts)); }
function readReviews(): ReviewRecord[] { try { const value: unknown = JSON.parse(localStorage.getItem(REVIEWS_KEY) ?? "[]"); return Array.isArray(value) ? value as ReviewRecord[] : []; } catch { return []; } }
async function syncFromApi(): Promise<void> {
  try {
    const response = await fetch("/api/drafts");
    if (!response.ok) return;
    const payload = await response.json() as { drafts?: DraftRecord[] };
    if (Array.isArray(payload.drafts)) saveDrafts(payload.drafts);
    const reviewsResponse = await fetch("/api/reviews");
    if (reviewsResponse.ok) {
      const reviewsPayload = await reviewsResponse.json() as { reviews?: ReviewRecord[] };
      if (Array.isArray(reviewsPayload.reviews)) localStorage.setItem(REVIEWS_KEY, JSON.stringify(reviewsPayload.reviews));
    }
    renderDrafts();
    renderHistory();
  } catch {
    // The Vite client remains usable with local storage when the API is stopped.
  }
}
async function syncProviders(): Promise<void> {
  try {
    const response = await fetch("/api/providers");
    if (!response.ok) return;
    const payload = await response.json() as { providers?: Array<{ id: string; label: string; models: string[] }> };
    if (!Array.isArray(payload.providers)) return;
    providerModels = Object.fromEntries(payload.providers.filter((provider) => provider.models.length).map((provider) => [provider.id, provider.models]));
    const provider = document.querySelector<HTMLSelectElement>("#provider")!;
    provider.innerHTML = payload.providers.filter((item) => item.models.length).map((item) => `<option value="${item.id}">${item.label}</option>`).join("");
    provider.dispatchEvent(new Event("change"));
  } catch {
    // Static catalog fallback keeps the form usable without the API.
  }
}
function formatDate(value: string): string { return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(new Date(value)); }
function renderDrafts(): void {
  const drafts = readDrafts();
  document.querySelector<HTMLSpanElement>(".nav-count")!.textContent = String(drafts.length);
  draftList.innerHTML = drafts.length ? drafts.map((draft) => `<div class="draft-row" data-draft-id="${draft.id}"><span class="draft-icon">${draft.title.slice(0, 2).toUpperCase()}</span><span><strong>${draft.title}</strong><small>${draft.status} · ${draft.language} · ${draft.modes.length} practice projection${draft.modes.length === 1 ? "" : "s"}</small></span><span class="draft-actions"><span class="draft-date">${formatDate(draft.createdAt)}</span><button class="inline-action" type="button" data-edit-id="${draft.id}">Edit</button><button class="inline-action" type="button" data-generate-id="${draft.id}" ${draft.status === "generated" || draft.status === "validated" || draft.status === "accepted" ? "disabled" : ""}>${draft.status === "generated" || draft.status === "validated" || draft.status === "accepted" ? "Generated" : "Generate"}</button><button class="inline-action" type="button" data-validate-id="${draft.id}" ${draft.status === "validated" || draft.status === "accepted" ? "disabled" : ""}>${draft.status === "validated" || draft.status === "accepted" ? "Validated" : "Validate"}</button><button class="inline-action" type="button" data-review-id="${draft.id}" ${draft.status === "queued" || draft.status === "accepted" ? "disabled" : ""}>Review</button><button class="inline-action" type="button" data-accept-id="${draft.id}" ${draft.status !== "validated" ? "disabled" : ""}>${draft.status === "accepted" ? "Accepted" : "Accept"}</button></span></div>`).join("") : `<div class="empty-state"><strong>No local drafts yet</strong><span>Create a draft to see it here.</span></div>`;
}
function renderHistory(): void {
  const drafts = readDrafts();
  const reviews = readReviews();
  historyList.innerHTML = reviews.length ? reviews.map((review) => { const draft = drafts.find((item) => item.id === review.draftId); const passed = review.verdict === "pass"; return `<div class="history-row"><span class="review-mark ${passed ? "pass" : "pending-mark"}">${passed ? "&#10003;" : "&#8226;"}</span><span><strong>${review.role.replaceAll("_", " ")}</strong><small>${draft?.title ?? "Unknown draft"} · ${review.artifactHash ?? "artifact pending"}</small></span><span class="history-status">${review.verdict}</span></div>`; }).join("") : `<div class="empty-state"><strong>No review reports yet</strong><span>Reports appear after a draft is validated and reviewed.</span></div>`;
}

function showView(view: string): void {
  renderDrafts();
  renderHistory();
  document.querySelectorAll<HTMLElement>(".app-view").forEach((panel) => { panel.hidden = panel.id !== `${view}-view`; });
  document.querySelectorAll<HTMLButtonElement>(".nav-item").forEach((button) => button.classList.toggle("active", button.dataset.view === view));
  window.scrollTo({ top: 0, behavior: "smooth" });
}

document.addEventListener("click", (event) => {
  const target = event.target as HTMLElement;
  const navigation = target.closest<HTMLButtonElement>(".nav-item, [data-go]");
  if (navigation) {
    const view = navigation.dataset.view ?? navigation.dataset.go ?? "new";
    showView(view);
    if (view === "practice") void refreshPracticeData();
  }
  const generateButton = target.closest<HTMLButtonElement>("[data-generate-id]");
  if (generateButton) {
    event.stopPropagation();
    const id = generateButton.dataset.generateId;
    void fetch(`/api/drafts/${id}/generate`, { method: "POST" }).then(async (response) => {
      const payload = await response.json() as { error?: string; status?: string };
      message.textContent = response.ok ? "Draft generated and stored as a local artifact." : `Generation failed: ${payload.error ?? "unknown error"}`;
      message.className = response.ok ? "form-message success" : "form-message error";
      if (response.ok) { await syncFromApi(); showView("drafts"); }
    }).catch(() => { message.textContent = "Authoring API is unavailable."; message.className = "form-message error"; });
    return;
  }
  const validateButton = target.closest<HTMLButtonElement>("[data-validate-id]");
  if (validateButton) {
    event.stopPropagation();
    const id = validateButton.dataset.validateId;
    void fetch(`/api/drafts/${id}/validate`, { method: "POST" }).then(async (response) => {
      const payload = await response.json() as { status?: string; errors?: string[] };
      message.textContent = response.ok ? "Deterministic validation passed." : `Validation failed: ${(payload.errors ?? ["unknown error"]).join("; ")}`;
      message.className = response.ok ? "form-message success" : "form-message error";
      if (response.ok) { await syncFromApi(); showView("drafts"); }
    }).catch(() => { message.textContent = "Authoring API is unavailable."; message.className = "form-message error"; });
    return;
  }
  const reviewButton = target.closest<HTMLButtonElement>("[data-review-id]");
  if (reviewButton) {
    event.stopPropagation();
    const id = reviewButton.dataset.reviewId;
    void fetch(`/api/drafts/${id}/reviews`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ role: "algorithm_correctness" }) }).then(async (response) => {
      const payload = await response.json() as { error?: string };
      message.textContent = response.ok ? "Algorithm correctness review completed." : `Review failed: ${payload.error ?? "unknown error"}`;
      message.className = response.ok ? "form-message success" : "form-message error";
      if (response.ok) { await syncFromApi(); showView("history"); }
    }).catch(() => { message.textContent = "Authoring API is unavailable."; message.className = "form-message error"; });
    return;
  }
  const acceptButton = target.closest<HTMLButtonElement>("[data-accept-id]");
  if (acceptButton) {
    event.stopPropagation();
    const id = acceptButton.dataset.acceptId;
    void fetch(`/api/drafts/${id}/accept`, { method: "POST" }).then(async (response) => {
      const payload = await response.json() as { error?: string };
      message.textContent = response.ok ? "Draft accepted for publication." : `Acceptance failed: ${payload.error ?? "unknown error"}`;
      message.className = response.ok ? "form-message success" : "form-message error";
      if (response.ok) { await syncFromApi(); showView("drafts"); }
    }).catch(() => { message.textContent = "Authoring API is unavailable."; message.className = "form-message error"; });
    return;
  }
  const draftButton = target.closest<HTMLButtonElement>("[data-edit-id]") ?? target.closest<HTMLButtonElement>("[data-draft-id]");
  if (draftButton) {
    const draft = readDrafts().find((item) => item.id === (draftButton.dataset.editId ?? draftButton.dataset.draftId));
    if (draft) {
      (document.querySelector<HTMLTextAreaElement>("#problem")!).value = draft.problem;
      (document.querySelector<HTMLInputElement>("#languages")!).value = draft.language;
      (document.querySelector<HTMLSelectElement>("#provider")!).value = draft.provider;
      document.querySelector<HTMLSelectElement>("#provider")!.dispatchEvent(new Event("change"));
      (document.querySelector<HTMLSelectElement>("#model")!).value = draft.model;
      document.querySelectorAll<HTMLInputElement>("input[name=mode]").forEach((input) => { input.checked = draft.modes.includes(input.value as PracticeMode); });
      document.querySelectorAll<HTMLInputElement>("input[name=assistance]").forEach((input) => { input.checked = draft.assistance.includes(input.value as Assistance); });
      updateProfile();
      editingDraftId = draft.id;
      submitDraft.innerHTML = `Update draft <span aria-hidden="true">&#8594;</span>`;
      showView("new");
    }
  }
});

function selectedValues<T extends string>(name: string): T[] {
  return [...document.querySelectorAll<HTMLInputElement>(`input[name="${name}"]:checked`)].map((input) => input.value as T);
}

function updateProfile(): void {
  const selectedModes = selectedValues<PracticeMode>("mode");
  const codeRecall = selectedModes.includes("code_recall");
  assistanceFieldset.disabled = !codeRecall;
  if (!codeRecall) {
    document.querySelectorAll<HTMLInputElement>("input[name=assistance]").forEach((input) => { input.checked = false; });
  }
  const selectedAssistance = codeRecall ? selectedValues<Assistance>("assistance") : [];
  assistanceNote.textContent = codeRecall ? "These hints will be included in the code recall projection." : "Select Code recall above to enable these hints.";
  const language = (document.querySelector<HTMLInputElement>("#languages")!.value || "python").split(",").map((value) => value.trim()).filter(Boolean);
  const variants = 1;
  profileState.textContent = selectedModes.length > 0 && language.length > 0 && variants > 0 ? "Ready" : "Needs input";
  profileState.className = `valid-badge ${profileState.textContent === "Ready" ? "" : "warning"}`;
  profileSummary.innerHTML = `<div class="summary-block"><span>Modes</span><div class="tag-list">${selectedModes.length ? selectedModes.map((mode) => `<span class="tag">${mode.replaceAll("_", " ")}</span>`).join("") : "<em>None selected</em>"}</div></div><div class="summary-block"><span>Assistance</span><div class="tag-list">${selectedAssistance.length ? selectedAssistance.map((item) => `<span class="tag muted">${item}</span>`).join("") : "<em>No hints selected</em>"}</div><small class="profile-note">${codeRecall ? "Applied to code recall." : "Configured, but inactive until code recall is selected."}</small></div><div class="summary-meta"><span>${language.join(", ")}</span><span>Automatic implementation</span></div>`;
  const totalModes = document.querySelectorAll<HTMLInputElement>("input[name=mode]").length;
  const allSelected = totalModes > 0 && selectedModes.length === totalModes;
  selectAllModes.checked = allSelected;
  selectAllModes.indeterminate = selectedModes.length > 0 && !allSelected;
}

document.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>("input:not(#select-all-modes), select, textarea").forEach((input) => input.addEventListener("input", updateProfile));
document.querySelectorAll<HTMLInputElement>("input[name=mode]").forEach((input) => {
  input.addEventListener("change", updateProfile);
  input.addEventListener("click", () => setTimeout(updateProfile, 0));
});
selectAllModes.addEventListener("change", () => {
  const inputs = [...document.querySelectorAll<HTMLInputElement>("input[name=mode]")];
  inputs.forEach((input) => { input.checked = selectAllModes.checked; });
  updateProfile();
});
document.querySelector<HTMLSelectElement>("#provider")!.addEventListener("change", (event) => {
  const provider = (event.target as HTMLSelectElement).value;
  const model = document.querySelector<HTMLSelectElement>("#model")!;
  model.innerHTML = (providerModels[provider] ?? []).map((item) => `<option>${item}</option>`).join("");
});
form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const selectedModes = selectedValues<PracticeMode>("mode");
  if (!selectedModes.length) {
    message.textContent = "Select at least one practice projection.";
    message.className = "form-message error";
    return;
  }
  const problem = document.querySelector<HTMLTextAreaElement>("#problem")!.value.trim();
  const record: DraftRecord = {
    id: editingDraftId ?? crypto.randomUUID(),
    title: problem.split(/\s+/).slice(0, 3).join(" ").replace(/[^a-zA-Z0-9 -]/g, "") || "Untitled algorithm",
    problem,
    provider: document.querySelector<HTMLSelectElement>("#provider")!.value,
    model: document.querySelector<HTMLSelectElement>("#model")!.value,
    language: document.querySelector<HTMLInputElement>("#languages")!.value || "python",
    variants: 1,
    modes: selectedModes,
    assistance: selectedModes.includes("code_recall") ? selectedValues<Assistance>("assistance") : [],
    status: "queued",
    createdAt: new Date().toISOString(),
  };
  let persisted = false;
  try {
    const response = await fetch(editingDraftId ? `/api/drafts/${editingDraftId}` : "/api/drafts", { method: editingDraftId ? "PATCH" : "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(record) });
    if (response.ok) {
      const payload = await response.json() as { draft?: DraftRecord };
      if (payload.draft) { saveDrafts([payload.draft, ...readDrafts().filter((item) => item.id !== payload.draft!.id)]); persisted = true; }
    }
  } catch {
    // Local storage is the offline fallback for the authoring shell.
  }
  if (!persisted) saveDrafts([record, ...readDrafts().filter((item) => item.id !== record.id)]);
  renderDrafts();
  renderHistory();
  message.textContent = persisted ? (editingDraftId ? "Draft revision saved to the local authoring API." : "Draft saved to the local authoring API.") : "Draft queued in this browser. Start the authoring API to share it locally.";
  message.className = "form-message success";
  editingDraftId = undefined;
  submitDraft.innerHTML = `Create draft <span aria-hidden="true">&#8594;</span>`;
});
document.querySelector<HTMLButtonElement>("#reset")!.addEventListener("click", () => {
  editingDraftId = undefined;
  submitDraft.innerHTML = `Create draft <span aria-hidden="true">&#8594;</span>`;
  form.reset();
  document.querySelector<HTMLTextAreaElement>("#problem")!.value = "";
  document.querySelectorAll<HTMLInputElement>("input[name=mode], input[name=assistance]").forEach((input) => { input.checked = false; });
  updateProfile();
  message.textContent = "";
});
document.querySelector<HTMLFormElement>("#practice-start")!.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const session = await practiceRpc<{ session: PracticeSession }>("gewu/startSession", {
      unit_id: document.querySelector<HTMLSelectElement>("#practice-unit")!.value,
      mode: document.querySelector<HTMLSelectElement>("#practice-mode")!.value,
      practice_id: document.querySelector<HTMLInputElement>("#practice-id")!.value.trim() || undefined,
    });
    activePracticeSession = { session_id: session.session.session_id, mode: session.session.mode };
    document.querySelector<HTMLButtonElement>("#session-submit")!.disabled = false;
    renderPracticeSession(session.session);
    practiceMessage("Practice started.");
    await refreshPracticeData();
  } catch (error) { practiceMessage(error instanceof Error ? error.message : "Unable to start practice", true); }
});
document.querySelector<HTMLButtonElement>("#session-submit")!.addEventListener("click", async () => {
  if (!activePracticeSession) return;
  const answer = document.querySelector<HTMLTextAreaElement>("#session-answer")!;
  const answerModes: PracticeMode[] = ["flow_recall", "reasoning_recall", "transfer_practice"];
  const event = answerModes.includes(activePracticeSession.mode) ? { type: "submit_answer", answer: answer.value } : { type: "insert_text", text: answer.value };
  try {
    const result = await practiceRpc<{ session: PracticeSession }>("gewu/applyEvent", { session_id: activePracticeSession.session_id, event, elapsed: { active_ms: 1000, wall_ms: 1000 } });
    renderPracticeSession(result.session);
    answer.value = "";
    await refreshPracticeData();
  } catch (error) { practiceMessage(error instanceof Error ? error.message : "Event rejected", true); }
});
document.querySelector<HTMLButtonElement>("#session-stop")!.addEventListener("click", async () => {
  if (!activePracticeSession) return;
  try {
    const result = await practiceRpc<{ session: PracticeSession }>("gewu/stopSession", { session_id: activePracticeSession.session_id, elapsed: { active_ms: 1000, wall_ms: 1000 } });
    renderPracticeSession(result.session);
    activePracticeSession = undefined;
    await refreshPracticeData();
  } catch (error) { practiceMessage(error instanceof Error ? error.message : "Unable to stop practice", true); }
});
document.querySelector<HTMLButtonElement>("#refresh-checkpoints")!.addEventListener("click", () => { void refreshPracticeData(); });
document.querySelector<HTMLElement>("#practice-view")!.addEventListener("click", async (event) => {
  const target = event.target as HTMLElement;
  const resume = target.closest<HTMLButtonElement>("[data-resume-checkpoint]");
  const discard = target.closest<HTMLButtonElement>("[data-discard-checkpoint]");
  try {
    if (resume) {
      const result = await practiceRpc<{ session: PracticeSession | null }>("gewu/resumeCheckpoint", { checkpoint_id: resume.dataset.resumeCheckpoint });
      if (result.session) { activePracticeSession = { session_id: result.session.session_id, mode: result.session.mode }; renderPracticeSession(result.session); }
    }
    if (discard) await practiceRpc("gewu/discardCheckpoint", { checkpoint_id: discard.dataset.discardCheckpoint });
    await refreshPracticeData();
  } catch (error) { practiceMessage(error instanceof Error ? error.message : "Checkpoint action failed", true); }
});
updateProfile();
renderDrafts();
renderHistory();
void syncFromApi();
void syncProviders();
