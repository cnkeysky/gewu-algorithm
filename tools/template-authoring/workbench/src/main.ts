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

const root = document.querySelector<HTMLDivElement>("#app");
if (!root) throw new Error("workbench root is missing");

root.innerHTML = `
  <header class="topbar">
    <a class="brand" href="#">GEWU <span>AUTHORING</span></a>
    <nav aria-label="Primary navigation">
      <button class="nav-item active" data-view="new">New draft</button>
      <button class="nav-item" data-view="drafts">Drafts <span class="nav-count">3</span></button>
      <button class="nav-item" data-view="history">Review history</button>
    </nav>
    <div class="connection"><span class="status-dot"></span> Local workspace</div>
  </header>
  <main class="shell">
    <div id="new-view" class="app-view">
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
        <textarea id="problem" rows="6" placeholder="Describe the problem, expected behavior, constraints, and boundaries.">Implement Kahn's topological sorting algorithm for a directed graph represented as adjacency lists. Return a FIFO-deterministic ordering or an empty list when the graph contains a cycle.</textarea>
        <div class="field-row">
          <label class="field"><span>Provider</span><select id="provider"><option value="deepseek">DeepSeek</option><option value="openai">OpenAI</option><option value="moonshot">Moonshot</option><option value="zhipu">Zhipu</option></select></label>
          <label class="field"><span>Model</span><select id="model"><option>deepseek-v4-flash</option><option>deepseek-v4-pro</option></select></label>
        </div>
        <div class="field-row">
          <label class="field"><span>Languages</span><input id="languages" value="python" /></label>
          <label class="field"><span>Implementation variants</span><input id="variants" type="number" min="1" max="5" value="1" /></label>
        </div>
        <fieldset>
          <legend>Practice projections <button class="select-all" type="button" id="select-all-modes">Select all</button></legend>
          <div class="mode-list">${modes.map((mode) => `<label class="mode-option"><input type="checkbox" name="mode" value="${mode.id}" ${mode.id === "shadow_typing" || mode.id === "flow_recall" ? "checked" : ""} /><span class="checkmark"></span><span><strong>${mode.label}</strong><small>${mode.hint}</small></span></label>`).join("")}</div>
        </fieldset>
        <fieldset id="assistance-fieldset" class="assistance-fieldset">
          <legend>Code recall assistance</legend>
          <div class="assistance-list">${assistance.map((item) => `<label><input type="checkbox" name="assistance" value="${item.id}" /><span>${item.label}</span></label>`).join("")}</div>
          <p class="field-note">These hints are included only when code recall is selected.</p>
        </fieldset>
        <div class="form-actions"><button class="button secondary" type="button" id="reset">Reset</button><button class="button primary" type="submit">Create draft <span aria-hidden="true">&#8594;</span></button></div>
        <p class="form-message" id="form-message" role="status"></p>
      </form>
      <aside class="right-column">
        <section class="panel summary-panel"><div class="panel-heading"><div><p class="eyebrow">02 / Contract</p><h2>Generation profile</h2></div><span class="valid-badge" id="profile-state">Ready</span></div><div id="profile-summary"></div><div class="contract-note"><span class="note-icon">i</span><p>Modes are projections of one AlgorithmUnit. They do not create separate canonical templates.</p></div></section>
        <section class="panel review-panel"><div class="panel-heading"><div><p class="eyebrow">03 / Workflow</p><h2>Review gate</h2></div><span class="lock">Locked</span></div><div class="review-step"><span class="step-number">1</span><div><strong>Deterministic validation</strong><small>Schema, paths, source, and fixtures</small></div><span class="pending">Pending</span></div><div class="review-step"><span class="step-number">2</span><div><strong>Role review</strong><small>Correctness, learning design, provenance</small></div><span class="pending">Pending</span></div><div class="review-step"><span class="step-number">3</span><div><strong>Human acceptance</strong><small>Required before publication</small></div><span class="pending">Pending</span></div></section>
      </aside>
    </section>
    </div>
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
  <footer><span>GEWU Template Authoring</span><span>Drafts stay local until explicitly accepted.</span></footer>
`;

const form = document.querySelector<HTMLFormElement>("#draft-form")!;
const profileSummary = document.querySelector<HTMLDivElement>("#profile-summary")!;
const profileState = document.querySelector<HTMLSpanElement>("#profile-state")!;
const assistanceFieldset = document.querySelector<HTMLFieldSetElement>("#assistance-fieldset")!;
const message = document.querySelector<HTMLParagraphElement>("#form-message")!;
const draftList = document.querySelector<HTMLDivElement>("#draft-list")!;
const historyList = document.querySelector<HTMLDivElement>("#history-list")!;
const selectAllModes = document.querySelector<HTMLButtonElement>("#select-all-modes")!;

interface DraftRecord {
  id: string;
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
function formatDate(value: string): string { return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(new Date(value)); }
function renderDrafts(): void {
  const drafts = readDrafts();
  document.querySelector<HTMLSpanElement>(".nav-count")!.textContent = String(drafts.length);
  draftList.innerHTML = drafts.length ? drafts.map((draft) => `<div class="draft-row" data-draft-id="${draft.id}"><span class="draft-icon">${draft.title.slice(0, 2).toUpperCase()}</span><span><strong>${draft.title}</strong><small>${draft.status} · ${draft.language} · ${draft.modes.length} practice projection${draft.modes.length === 1 ? "" : "s"}</small></span><span class="draft-actions"><span class="draft-date">${formatDate(draft.createdAt)}</span><button class="inline-action" type="button" data-generate-id="${draft.id}" ${draft.status === "generated" || draft.status === "validated" ? "disabled" : ""}>${draft.status === "generated" || draft.status === "validated" ? "Generated" : "Generate"}</button><button class="inline-action" type="button" data-validate-id="${draft.id}" ${draft.status === "validated" ? "disabled" : ""}>${draft.status === "validated" ? "Validated" : "Validate"}</button><button class="inline-action" type="button" data-review-id="${draft.id}" ${draft.status === "queued" ? "disabled" : ""}>Review</button></span></div>`).join("") : `<div class="empty-state"><strong>No local drafts yet</strong><span>Create a draft to see it here.</span></div>`;
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
  if (navigation) showView(navigation.dataset.view ?? navigation.dataset.go ?? "new");
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
  const draftButton = target.closest<HTMLButtonElement>("[data-draft-id]");
  if (draftButton) {
    const draft = readDrafts().find((item) => item.id === draftButton.dataset.draftId);
    if (draft) {
      (document.querySelector<HTMLTextAreaElement>("#problem")!).value = draft.problem;
      (document.querySelector<HTMLInputElement>("#languages")!).value = draft.language;
      (document.querySelector<HTMLInputElement>("#variants")!).value = String(draft.variants);
      (document.querySelector<HTMLSelectElement>("#provider")!).value = draft.provider;
      document.querySelector<HTMLSelectElement>("#provider")!.dispatchEvent(new Event("change"));
      (document.querySelector<HTMLSelectElement>("#model")!).value = draft.model;
      document.querySelectorAll<HTMLInputElement>("input[name=mode]").forEach((input) => { input.checked = draft.modes.includes(input.value as PracticeMode); });
      document.querySelectorAll<HTMLInputElement>("input[name=assistance]").forEach((input) => { input.checked = draft.assistance.includes(input.value as Assistance); });
      updateProfile();
      showView("new");
    }
  }
});

function selectedValues<T extends string>(name: string): T[] {
  return [...document.querySelectorAll<HTMLInputElement>(`input[name="${name}"]:checked`)].map((input) => input.value as T);
}

function updateProfile(): void {
  const selectedModes = selectedValues<PracticeMode>("mode");
  const selectedAssistance = selectedValues<Assistance>("assistance");
  const codeRecall = selectedModes.includes("code_recall");
  assistanceFieldset.disabled = false;
  const language = (document.querySelector<HTMLInputElement>("#languages")!.value || "python").split(",").map((value) => value.trim()).filter(Boolean);
  const variants = Number(document.querySelector<HTMLInputElement>("#variants")!.value);
  profileState.textContent = selectedModes.length > 0 && language.length > 0 && variants > 0 ? "Ready" : "Needs input";
  profileState.className = `valid-badge ${profileState.textContent === "Ready" ? "" : "warning"}`;
  profileSummary.innerHTML = `<div class="summary-block"><span>Modes</span><div class="tag-list">${selectedModes.length ? selectedModes.map((mode) => `<span class="tag">${mode.replaceAll("_", " ")}</span>`).join("") : "<em>None selected</em>"}</div></div><div class="summary-block"><span>Assistance</span><div class="tag-list">${selectedAssistance.length ? selectedAssistance.map((item) => `<span class="tag muted">${item}</span>`).join("") : "<em>No hints selected</em>"}</div><small class="profile-note">${codeRecall ? "Applied to code recall." : "Configured, but inactive until code recall is selected."}</small></div><div class="summary-meta"><span>${language.join(", ")}</span><span>${Number.isFinite(variants) ? variants : 0} variant${variants === 1 ? "" : "s"}</span></div>`;
  const allSelected = selectedModes.length === document.querySelectorAll<HTMLInputElement>("input[name=mode]").length;
  selectAllModes.textContent = allSelected ? "Clear all" : "Select all";
  selectAllModes.setAttribute("aria-pressed", String(allSelected));
}

document.querySelectorAll<HTMLInputElement>("input, select, textarea").forEach((input) => input.addEventListener("input", updateProfile));
selectAllModes.addEventListener("click", () => {
  const inputs = [...document.querySelectorAll<HTMLInputElement>("input[name=mode]")];
  const shouldSelect = inputs.some((input) => !input.checked);
  inputs.forEach((input) => { input.checked = shouldSelect; });
  updateProfile();
});
document.querySelector<HTMLSelectElement>("#provider")!.addEventListener("change", (event) => {
  const provider = (event.target as HTMLSelectElement).value;
  const model = document.querySelector<HTMLSelectElement>("#model")!;
  const models: Record<string, string[]> = {
    deepseek: ["deepseek-v4-flash", "deepseek-v4-pro"],
    openai: ["gpt-5", "gpt-5-mini"],
    moonshot: ["kimi-k2"],
    zhipu: ["glm-4.5"],
  };
  model.innerHTML = (models[provider] ?? []).map((item) => `<option>${item}</option>`).join("");
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
    id: crypto.randomUUID(),
    title: problem.split(/\s+/).slice(0, 3).join(" ").replace(/[^a-zA-Z0-9 -]/g, "") || "Untitled algorithm",
    problem,
    provider: document.querySelector<HTMLSelectElement>("#provider")!.value,
    model: document.querySelector<HTMLSelectElement>("#model")!.value,
    language: document.querySelector<HTMLInputElement>("#languages")!.value || "python",
    variants: Number(document.querySelector<HTMLInputElement>("#variants")!.value),
    modes: selectedModes,
    assistance: selectedValues<Assistance>("assistance"),
    status: "queued",
    createdAt: new Date().toISOString(),
  };
  let persisted = false;
  try {
    const response = await fetch("/api/drafts", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(record) });
    if (response.ok) {
      const payload = await response.json() as { draft?: DraftRecord };
      if (payload.draft) { saveDrafts([payload.draft, ...readDrafts().filter((item) => item.id !== payload.draft!.id)]); persisted = true; }
    }
  } catch {
    // Local storage is the offline fallback for the authoring shell.
  }
  if (!persisted) saveDrafts([record, ...readDrafts()]);
  renderDrafts();
  renderHistory();
  message.textContent = persisted ? "Draft saved to the local authoring API." : "Draft queued in this browser. Start the authoring API to share it locally.";
  message.className = "form-message success";
});
document.querySelector<HTMLButtonElement>("#reset")!.addEventListener("click", () => { form.reset(); updateProfile(); message.textContent = ""; });
updateProfile();
renderDrafts();
renderHistory();
void syncFromApi();
