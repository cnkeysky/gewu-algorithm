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
          <legend>Practice projections</legend>
          <div class="mode-list">${modes.map((mode) => `<label class="mode-option"><input type="checkbox" name="mode" value="${mode.id}" ${mode.id === "shadow_typing" || mode.id === "flow_recall" ? "checked" : ""} /><span class="checkmark"></span><span><strong>${mode.label}</strong><small>${mode.hint}</small></span></label>`).join("")}</div>
        </fieldset>
        <fieldset id="assistance-fieldset" class="assistance-fieldset" disabled>
          <legend>Code recall assistance</legend>
          <div class="assistance-list">${assistance.map((item) => `<label><input type="checkbox" name="assistance" value="${item.id}" /><span>${item.label}</span></label>`).join("")}</div>
          <p class="field-note">Select code recall to configure its hint progression.</p>
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
      <div class="draft-list"><button class="draft-row" type="button" data-go="new"><span class="draft-icon">TS</span><span><strong>topological-sort-kahn-r1</strong><small>Draft · Python · 5 practice projections</small></span><span class="draft-date">Just now</span></button><button class="draft-row" type="button" data-go="new"><span class="draft-icon">BF</span><span><strong>graph-bfs-r1</strong><small>Pending review · Python · 2 practice projections</small></span><span class="draft-date">Aug 04, 2026</span></button><button class="draft-row" type="button" data-go="new"><span class="draft-icon">BS</span><span><strong>binary-search-r1</strong><small>Accepted · Python · 3 practice projections</small></span><span class="draft-date">Aug 03, 2026</span></button></div>
      <p class="view-note">Draft entries will become API-backed once the local authoring service is connected.</p>
    </section>
    <section id="history-view" class="app-view panel page-panel" hidden>
      <div class="panel-heading"><div><p class="eyebrow">Audit trail</p><h2>Review history</h2></div><span class="lock">Immutable reports</span></div>
      <div class="history-list"><div class="history-row"><span class="review-mark pass">&#10003;</span><span><strong>Algorithm correctness</strong><small>binary-search-r1 · artifact sha256:7a21...c91e</small></span><span class="history-status">Pass</span></div><div class="history-row"><span class="review-mark pass">&#10003;</span><span><strong>Learning design</strong><small>graph-bfs-r1 · artifact sha256:12e4...a02d</small></span><span class="history-status">Pass</span></div><div class="history-row"><span class="review-mark pending-mark">&#8226;</span><span><strong>Provenance and safety</strong><small>topological-sort-kahn-r1 · awaiting generation</small></span><span class="history-status">Pending</span></div></div>
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

function showView(view: string): void {
  document.querySelectorAll<HTMLElement>(".app-view").forEach((panel) => { panel.hidden = panel.id !== `${view}-view`; });
  document.querySelectorAll<HTMLButtonElement>(".nav-item").forEach((button) => button.classList.toggle("active", button.dataset.view === view));
  window.scrollTo({ top: 0, behavior: "smooth" });
}

document.querySelectorAll<HTMLButtonElement>(".nav-item, [data-go]").forEach((button) => button.addEventListener("click", () => showView(button.dataset.view ?? button.dataset.go ?? "new")));

function selectedValues<T extends string>(name: string): T[] {
  return [...document.querySelectorAll<HTMLInputElement>(`input[name="${name}"]:checked`)].map((input) => input.value as T);
}

function updateProfile(): void {
  const selectedModes = selectedValues<PracticeMode>("mode");
  const selectedAssistance = selectedValues<Assistance>("assistance");
  const codeRecall = selectedModes.includes("code_recall");
  assistanceFieldset.disabled = !codeRecall;
  const language = (document.querySelector<HTMLInputElement>("#languages")!.value || "python").split(",").map((value) => value.trim()).filter(Boolean);
  const variants = Number(document.querySelector<HTMLInputElement>("#variants")!.value);
  profileState.textContent = selectedModes.length > 0 && language.length > 0 && variants > 0 ? "Ready" : "Needs input";
  profileState.className = `valid-badge ${profileState.textContent === "Ready" ? "" : "warning"}`;
  profileSummary.innerHTML = `<div class="summary-block"><span>Modes</span><div class="tag-list">${selectedModes.length ? selectedModes.map((mode) => `<span class="tag">${mode.replaceAll("_", " ")}</span>`).join("") : "<em>None selected</em>"}</div></div><div class="summary-block"><span>Assistance</span><div class="tag-list">${codeRecall && selectedAssistance.length ? selectedAssistance.map((item) => `<span class="tag muted">${item}</span>`).join("") : `<em>${codeRecall ? "Choose optional hints" : "Requires code recall"}</em>`}</div></div><div class="summary-meta"><span>${language.join(", ")}</span><span>${Number.isFinite(variants) ? variants : 0} variant${variants === 1 ? "" : "s"}</span></div>`;
}

document.querySelectorAll<HTMLInputElement>("input, select, textarea").forEach((input) => input.addEventListener("input", updateProfile));
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
form.addEventListener("submit", (event) => {
  event.preventDefault();
  const selectedModes = selectedValues<PracticeMode>("mode");
  if (!selectedModes.length) {
    message.textContent = "Select at least one practice projection.";
    message.className = "form-message error";
    return;
  }
  message.textContent = "Draft request prepared. Connect the local authoring API to start generation.";
  message.className = "form-message success";
});
document.querySelector<HTMLButtonElement>("#reset")!.addEventListener("click", () => { form.reset(); updateProfile(); message.textContent = ""; });
updateProfile();
