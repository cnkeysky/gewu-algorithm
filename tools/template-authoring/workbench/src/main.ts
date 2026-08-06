import "./styles.css";
import "./practice.css";
import { observeTextLayout, type TextLayoutHandle } from "./text-layout";
import type { ShadowEditorController } from "./shadow-editor";

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
          <h1 data-text-layout>Make the invisible structure of an algorithm visible.</h1>
          <p class="hero-lede" data-text-layout>GEWU turns reviewed algorithms into deliberate practice. Reconstruct code, recover reasoning, and transfer patterns while one deterministic core keeps every transition and attempt trustworthy.</p>
          <div class="hero-actions"><button class="button primary" type="button" data-go="practice">Start practicing <span aria-hidden="true">&#8594;</span></button><button class="button secondary" type="button" data-go="new">Author a unit</button></div>
          <div class="hero-meta"><span><b>01</b> canonical AlgorithmUnit</span><span><b>02</b> practice projections</span><span><b>03</b> core-owned state</span></div>
        </div>
        <div class="terminal-visual" aria-label="GEWU core status visualization"><div class="terminal-bar"><span></span><span></span><span></span><b>gewu-core</b><i class="terminal-pulse" aria-hidden="true"></i></div><div class="terminal-body"><p><em>core</em>.start(<strong>graph.bfs</strong>, <strong>code_recall</strong>)</p><p class="dim">&gt; loading reviewed revision <strong>r1</strong></p><p class="green">&gt; state machine ready</p><p class="amber" data-text-layout><span id="home-live-text">&gt; next move: reconstruct frontier</span><span class="terminal-cursor" aria-hidden="true">_</span></p><div class="terminal-grid"><span>accepted</span><strong id="home-accepted">000</strong><span>stability</span><strong id="home-stability">0.00</strong><span>mode</span><strong>RECALL</strong></div></div></div>
      </div>
      <section class="vision-strip"><div><p class="eyebrow">The GEWU model</p><h2 data-text-layout>One canonical unit. Many ways to remember it.</h2></div><p data-text-layout>Content, practice, review, and persistence share a typed boundary. The interface can change; the learning facts do not.</p></section>
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
        <section class="panel review-panel"><div class="panel-heading"><div><p class="eyebrow">03 / Workflow</p><h2>Review gate</h2></div><span class="workflow-state" id="workflow-state">No draft selected</span></div><div class="review-step" id="workflow-validation"><span class="step-number">1</span><div><strong>Deterministic validation</strong><small>Schema, paths, source, and fixtures</small></div><span class="workflow-status">Pending</span></div><div class="review-step" id="workflow-review"><span class="step-number">2</span><div><strong>Role review</strong><small>Correctness, learning design, provenance</small></div><span class="workflow-status">Pending</span></div><div class="review-step" id="workflow-acceptance"><span class="step-number">3</span><div><strong>Human acceptance</strong><small>Required before publication</small></div><span class="workflow-status">Pending</span></div></section>
      </aside>
    </section>
    </div>
    <section id="practice-view" class="app-view panel page-panel" hidden>
      <div class="practice-heading panel-heading"><div><p class="eyebrow">Core practice / local first</p><h2>Practice workspace</h2><p class="page-subtitle">Choose a unit, start one projection, and keep the current state visible while you work.</p></div><span class="connection-badge" id="practice-connection">Core offline</span></div>
      <div class="practice-layout">
        <form id="practice-start" class="practice-controls">
          <label class="field"><span>Algorithm unit</span><select id="practice-unit"><option>Loading units...</option></select></label>
          <label class="field"><span>Practice mode</span><select id="practice-mode">${modes.map((mode) => `<option value="${mode.id}">${mode.label}</option>`).join("")}</select></label>
          <label class="field"><span id="practice-option-label">Practice variant <small class="catalog-note">Reviewed choices from this unit</small></span><select id="practice-id"><option value="">Default reviewed variant</option></select></label>
          <button class="button primary" type="submit">Start practice <span aria-hidden="true">&#8594;</span></button>
          <p class="form-message" id="practice-message" role="status"></p>
        </form>
        <section class="practice-session" id="practice-session" hidden>
          <div class="session-heading"><div><p class="eyebrow">Active session</p><h3 id="session-title">Practice</h3></div><div class="session-heading-meta"><span class="session-language" id="session-language">Template language</span><span class="valid-badge" id="session-status">Active</span></div></div>
          <div id="session-progress" class="session-progress" hidden></div><div id="session-completed" class="session-completed" hidden></div><p id="session-prompt" class="session-prompt" data-text-layout></p><div id="session-scaffold" class="session-scaffold" hidden></div><pre id="session-target" class="session-target" data-text-layout></pre>
          <div id="session-editor" class="shadow-editor" aria-label="Practice code editor" hidden></div><textarea id="session-answer" rows="5" placeholder="Enter your answer or the next code segment."></textarea>
          <div class="form-actions"><button class="button primary" type="button" id="session-submit">Submit answer</button><button class="button secondary" type="button" id="session-reveal" hidden>Reveal</button><button class="button secondary" type="button" id="session-restart" hidden>Restart</button><button class="button danger" type="button" id="session-stop">Stop practice</button></div>
          <div class="session-meta" id="session-meta"></div>
        </section>
        <aside class="practice-side">
          <section><div class="panel-heading"><h3>Interrupted</h3><button class="inline-action" type="button" id="refresh-checkpoints">Refresh</button></div><div id="practice-checkpoints" class="compact-list"></div></section>
          <section><div class="panel-heading"><h3>Spaced review</h3></div><div id="practice-recommendations" class="compact-list"></div></section>
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
let draftDirty = false;
let draftPersistence: "saved" | "local" | "unknown" = "unknown";
const practiceApi = "/core/rpc";
const textLayoutHandles = new WeakMap<HTMLElement, TextLayoutHandle>();
let practiceRequestId = 1;
let practiceHandshaken = false;
let practiceHandshake: { core_version: string; protocol_version: number } | undefined;
let practiceUnits: PracticeUnit[] = [];
let activePracticeSession: { session_id: string; mode: PracticeMode } | undefined;
let activePracticeSnapshot: PracticeSession | undefined;
let shadowEditor: ShadowEditorController | undefined;
let shadowEditorLoading: Promise<ShadowEditorController> | undefined;
let shadowEditorPendingFocus = false;
let shadowAcceptedText = "";
let shadowTargetText = "";
let shadowLanguage = "plaintext";
let flowPromptRevealed = false;
let codePromptRevealed = false;
const promptRevealedModes = new Set<PracticeMode>();
type PracticeOption = { id: string; label: string; language: string; mode: PracticeMode; selector: "implementation" | "practice_id" };
type PracticeUnit = { id: string; revision: number; title: string; modes: PracticeMode[]; practice_options: PracticeOption[] };
type PracticeSession = { session_id: string; unit_title: string; problem_question?: string; mode: PracticeMode; language: string; status: string; accepted_text: string; target_text: string; current_prompt?: string; completed_prompts: string[]; completed_steps: number; total_steps: number; accepted_input_count: number; rejected_input_count: number; correction_count: number; prompt_count: number; scaffold_reveal_count: number; active_ms: number; wall_ms: number; code_assistance?: string; scaffold_count?: number; visible_scaffold?: string[]; revealed_scaffold_indices?: number[] };
type Checkpoint = { id: string; unit_title: string; unit_id: string; revision: number; mode: PracticeMode; implementation?: string; practice_id?: string; completed_steps: number; total_steps: number; accepted_characters: number; target_characters: number; saved_at: string };
type Recommendation = { policy_version: string; unit_id: string; revision: number; mode: PracticeMode; implementation?: string; practice_id?: string; kind: string; priority: string; reason: string; due_after_days: number; due_at_ms?: number };
type Attempt = { id: string; unit_id: string; mode: PracticeMode; implementation?: string; practice_id?: string; terminal_reason: string; accepted_input_count: number; rejected_input_count: number; created_at: string };
type PracticeListName = "checkpoints" | "recommendations" | "attempts";
// Two rows leave enough room for long mode/status labels inside the fixed panels.
const PRACTICE_PAGE_SIZE = 2;
const practicePages: Record<PracticeListName, number> = { checkpoints: 0, recommendations: 0, attempts: 0 };
let checkpointItems: Checkpoint[] = [];
let recommendationItems: Recommendation[] = [];
let attemptItems: Attempt[] = [];
async function practiceRpc<T>(method: string, params: unknown = {}): Promise<T> {
  if (!practiceHandshaken && method !== "gewu/handshake") {
    practiceHandshake = await practiceRpc<{ core_version: string; protocol_version: number }>("gewu/handshake", { protocol_min: 1, protocol_max: 1, client_name: "gewu-web", client_version: "0.1.0" });
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
  const sessionChanged = activePracticeSnapshot?.session_id !== session.session_id;
  activePracticeSnapshot = session;
  document.querySelector<HTMLElement>("#practice-session")!.hidden = false;
  document.querySelector<HTMLElement>("#session-title")!.textContent = session.unit_title;
  document.querySelector<HTMLElement>("#session-status")!.textContent = session.status;
  const progress = document.querySelector<HTMLElement>("#session-progress")!;
  const completed = document.querySelector<HTMLElement>("#session-completed")!;
  const prompt = document.querySelector<HTMLElement>("#session-prompt")!;
  const reveal = document.querySelector<HTMLButtonElement>("#session-reveal")!;
  const restart = document.querySelector<HTMLButtonElement>("#session-restart")!;
  const scaffold = document.querySelector<HTMLElement>("#session-scaffold")!;
  document.querySelector<HTMLElement>("#session-language")!.textContent = session.language;
  const isShadow = session.mode === "shadow_typing";
  const isFlow = session.mode === "flow_recall";
  const isCode = session.mode === "code_recall";
  const isReasoning = session.mode === "reasoning_recall";
  const isTransfer = session.mode === "transfer_practice";
  const requiresPromptReveal = isFlow || isCode || isReasoning || isTransfer;
  const promptVisible = !requiresPromptReveal || promptRevealedModes.has(session.mode);
  progress.hidden = !isFlow && !isReasoning && !isTransfer;
  progress.textContent = progress.hidden ? "" : `Step ${Math.min(session.completed_steps + 1, session.total_steps)} of ${session.total_steps}`;
  completed.hidden = !isFlow;
  completed.innerHTML = isFlow && session.completed_prompts.length > 0
    ? `<strong>Completed flow</strong><ol>${session.completed_prompts.map((item) => `<li><span aria-hidden="true">&#10003;</span>${escapeHtml(item)}</li>`).join("")}</ol>`
    : "";
  prompt.textContent = requiresPromptReveal ? (promptVisible ? session.current_prompt ?? "No reviewed prompt is available." : "Prompt hidden until Reveal") : session.current_prompt ?? "";
  prompt.classList.toggle("is-hidden", requiresPromptReveal && !promptVisible);
  reveal.hidden = !requiresPromptReveal || session.status !== "active";
  reveal.textContent = promptVisible ? "Hide prompt" : "Reveal prompt";
  restart.hidden = !isFlow && !isCode;
  scaffold.hidden = !isCode;
  scaffold.innerHTML = isCode ? `<div class="scaffold-heading"><span>${session.code_assistance ?? "Code assistance"}</span><button class="inline-action" type="button" id="reveal-scaffold" ${session.status !== "active" || (session.scaffold_count ?? 0) <= (session.revealed_scaffold_indices?.length ?? 0) ? "disabled" : ""}>Reveal next hint</button></div><ul>${(session.visible_scaffold ?? []).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>` : "";
  const target = document.querySelector<HTMLElement>("#session-target")!;
  const editorContainer = document.querySelector<HTMLElement>("#session-editor")!;
  const answer = document.querySelector<HTMLTextAreaElement>("#session-answer")!;
  const submit = document.querySelector<HTMLButtonElement>("#session-submit")!;
  target.hidden = !isShadow && !isCode;
  const isCodeEditor = isShadow || isCode;
  editorContainer.hidden = !isCodeEditor;
  answer.hidden = isCodeEditor;
  submit.hidden = isCodeEditor;
  submit.textContent = isFlow || isCode ? "Submit answer" : "Submit event";
  if (isCodeEditor) {
    shadowAcceptedText = session.accepted_text;
    shadowTargetText = session.target_text;
    shadowLanguage = session.language;
    void updateShadowEditor(editorContainer, session, sessionChanged, isShadow);
  }
  target.textContent = session.target_text || session.accepted_text || "Awaiting the next response.";
  observeTextElement(document.querySelector<HTMLElement>("#session-prompt")!);
  observeTextElement(document.querySelector<HTMLElement>("#session-target")!);
  document.querySelector<HTMLElement>("#session-meta")!.textContent = session.mode === "shadow_typing"
    ? `shadow typing · progress ${Array.from(session.accepted_text).length}/${Array.from(session.target_text).length} · accepted inputs ${session.accepted_input_count} · rejected inputs ${session.rejected_input_count} · corrections ${session.correction_count}`
    : session.mode === "code_recall"
    ? `code recall · progress ${Array.from(session.accepted_text).length}/${Array.from(session.target_text).length} · ${session.code_assistance ?? "no hints"} · rejected inputs ${session.rejected_input_count} · prompts ${session.prompt_count} · hints ${session.scaffold_reveal_count}`
    : `${session.mode.replaceAll("_", " ")} · completed ${session.accepted_input_count} steps · rejected ${session.rejected_input_count} answers · prompts ${session.prompt_count}`;
  if (session.status !== "active") {
    document.querySelector<HTMLButtonElement>("#session-submit")!.disabled = true;
    reveal.disabled = true;
    restart.disabled = false;
  } else {
    document.querySelector<HTMLButtonElement>("#session-submit")!.disabled = false;
    reveal.disabled = false;
    restart.disabled = false;
  }
}
async function updateShadowEditor(container: HTMLElement, session: PracticeSession, sessionChanged = false, showGuidance = true): Promise<void> {
  if (!shadowEditor && !shadowEditorLoading) {
    container.addEventListener("pointerdown", () => {
      if (shadowEditor) shadowEditor.focus();
      else shadowEditorPendingFocus = true;
    }, { once: true });
  }
  if (shadowEditor) {
    shadowEditor.update(session.accepted_text, session.target_text, session.language, session.status !== "active", showGuidance, sessionChanged, sessionChanged);
    return;
  }
  if (!shadowEditorLoading) {
    shadowEditorLoading = import("./shadow-editor").then(({ mountShadowEditor }) => mountShadowEditor(container, shadowAcceptedText, shadowTargetText, session.language, session.status !== "active", showGuidance, applyShadowEdit));
  }
  shadowEditor = await shadowEditorLoading;
  shadowEditor.update(shadowAcceptedText, shadowTargetText, session.language, session.status !== "active", showGuidance, sessionChanged, sessionChanged);
  if (shadowEditorPendingFocus) {
    shadowEditorPendingFocus = false;
    shadowEditor.focus();
  }
}
async function applyShadowEdit(edit: { start: number; end: number; text: string }): Promise<{ acceptedText: string }> {
  if (!activePracticeSession) throw new Error("No active practice session");
  const requestSessionId = activePracticeSession.session_id;
  const event = edit.start === edit.end ? { type: "insert_text", text: edit.text } : edit.text ? { type: "replace_range", start: edit.start, end: edit.end, text: edit.text } : { type: "delete_range", start: edit.start, end: edit.end };
  try {
    const result = await practiceRpc<{ session: PracticeSession }>("gewu/applyEvent", { session_id: requestSessionId, event, elapsed: { active_ms: 1000, wall_ms: 1000 } });
    if (activePracticeSession?.session_id === requestSessionId) renderPracticeSession(result.session);
    if (result.session.status !== "active") await refreshPracticeData();
    return { acceptedText: result.session.accepted_text };
  } catch (error) {
    if (activePracticeSession?.session_id !== requestSessionId) throw error;
    practiceMessage(error instanceof Error ? error.message : "Input rejected", true);
    shadowEditor?.update(shadowAcceptedText, shadowTargetText, shadowLanguage, false, true, true);
    throw error;
  }
}
function observeTextElement(element: HTMLElement): void {
  textLayoutHandles.get(element)?.disconnect();
  textLayoutHandles.set(element, observeTextLayout(element));
}
async function refreshPracticeData(): Promise<void> {
  try {
    const [units, checkpoints, recommendations, attempts] = await Promise.all([
      practiceRpc<PracticeUnit[]>("gewu/listUnits"),
      practiceRpc<{ checkpoints: Checkpoint[] }>("gewu/listCheckpoints"),
      practiceRpc<Recommendation[]>("gewu/reviewRecommendations"),
      practiceRpc<{ attempts: Attempt[] }>("gewu/recentAttempts", { limit: 50 }),
    ]);
    practiceUnits = units;
    const unitSelect = document.querySelector<HTMLSelectElement>("#practice-unit")!;
    unitSelect.innerHTML = units.map((unit) => `<option value="${unit.id}">${unit.title} · r${unit.revision}</option>`).join("");
    renderPracticeOptions();
    const connection = document.querySelector<HTMLElement>("#practice-connection")!;
    connection.textContent = practiceHandshake
      ? `Core connected · v${practiceHandshake.core_version} / protocol ${practiceHandshake.protocol_version}`
      : "Core connected";
    connection.classList.add("is-connected");
    const uniqueCheckpoints = new Map<string, Checkpoint>();
    for (const checkpoint of checkpoints.checkpoints) {
      const key = `${checkpoint.unit_id}:${checkpoint.revision}:${checkpoint.mode}:${checkpoint.implementation ?? ""}:${checkpoint.practice_id ?? ""}`;
      if (!uniqueCheckpoints.has(key)) uniqueCheckpoints.set(key, checkpoint);
    }
    checkpointItems = [...uniqueCheckpoints.values()];
    recommendationItems = recommendations;
    attemptItems = attempts.attempts;
    renderPracticeLists();
  } catch (error) { const connection = document.querySelector<HTMLElement>("#practice-connection")!; connection.textContent = "Core offline"; connection.classList.remove("is-connected"); practiceMessage("Rust Core 未启动。请先运行 `cargo run -p gewu-cli -- serve`。", true); }
}
function renderPagedPracticeList<T>(name: PracticeListName, targetId: string, items: T[], renderItem: (item: T) => string, emptyText: string): void {
  const target = document.querySelector<HTMLElement>(targetId)!;
  const totalPages = Math.max(1, Math.ceil(items.length / PRACTICE_PAGE_SIZE));
  practicePages[name] = Math.min(practicePages[name], totalPages - 1);
  const page = practicePages[name];
  const rows = items.slice(page * PRACTICE_PAGE_SIZE, (page + 1) * PRACTICE_PAGE_SIZE);
  target.innerHTML = `<div class="paged-list-items">${rows.length ? rows.map(renderItem).join("") : `<div class="compact-empty">${emptyText}</div>`}</div><div class="list-pagination"><span>${items.length ? `${page + 1} / ${totalPages}` : "0 items"}</span><span><button class="page-button" type="button" title="Previous page" aria-label="Previous page" data-page-list="${name}" data-page-delta="-1" ${page === 0 ? "disabled" : ""}>&#8249;</button><button class="page-button" type="button" title="Next page" aria-label="Next page" data-page-list="${name}" data-page-delta="1" ${page >= totalPages - 1 ? "disabled" : ""}>&#8250;</button></span></div>`;
}
function renderPracticeLists(): void {
  renderPagedPracticeList("checkpoints", "#practice-checkpoints", checkpointItems, (checkpoint) => { const progress = progressPercent(checkpoint.accepted_characters, checkpoint.target_characters); const saved = formatDateTime(checkpoint.saved_at); return `<div class="compact-row practice-record"><div class="record-main"><strong>${checkpoint.unit_title}</strong><span>${checkpoint.mode.replaceAll("_", " ")} · ${variantLabel(checkpoint)}</span><span title="${checkpoint.accepted_characters}/${checkpoint.target_characters} characters">${progress}% complete</span></div><div class="record-footer"><time title="${saved}">${saved}</time><span class="record-actions"><button class="inline-action" data-resume-checkpoint="${checkpoint.id}">Resume</button><button class="inline-action" data-discard-checkpoint="${checkpoint.id}">Discard</button></span></div></div>`; }, "No interrupted practice.");
  renderPagedPracticeList("recommendations", "#practice-recommendations", recommendationItems, (item) => { const due = item.due_at_ms ? new Date(item.due_at_ms) : undefined; const dueDate = due ? formatDateTime(due.toISOString()) : `${item.due_after_days}d`; const dueLabel = due && due.getTime() <= Date.now() ? "Due now" : `Due ${dueDate}`; const title = practiceUnits.find((unit) => unit.id === item.unit_id)?.title ?? item.unit_id; return `<div class="compact-row practice-record"><div class="record-main"><strong>${title}</strong><span>${item.mode.replaceAll("_", " ")} · ${variantLabel(item)}</span><span title="${escapeHtml(item.reason)}">${item.kind} · ${item.priority} priority</span></div><div class="record-footer"><time title="${dueLabel}">${dueLabel}</time><span class="record-actions"><button class="inline-action" type="button" data-start-recommendation="${item.unit_id}" data-recommendation-mode="${item.mode}">Practice</button></span></div></div>`; }, "Complete a practice to build your review schedule.");
  renderPagedPracticeList("attempts", "#practice-attempts", attemptItems, (item) => { const created = formatDateTime(item.created_at); return `<div class="compact-row practice-record"><div class="record-main"><strong>${item.unit_id}</strong><span>${item.mode.replaceAll("_", " ")} · ${variantLabel(item)}</span></div><div class="record-footer"><time title="${created}">${created}</time><span class="record-state">${item.terminal_reason}</span></div></div>`; }, "No attempts yet.");
}
function renderPracticeOptions(): void {
  const unitId = document.querySelector<HTMLSelectElement>("#practice-unit")?.value;
  const mode = document.querySelector<HTMLSelectElement>("#practice-mode")?.value as PracticeMode | undefined;
  const select = document.querySelector<HTMLSelectElement>("#practice-id");
  const label = document.querySelector<HTMLElement>("#practice-option-label");
  if (!select || !label) return;
  const options = practiceUnits.find((unit) => unit.id === unitId)?.practice_options.filter((option) => option.mode === mode) ?? [];
  const selector = options[0]?.selector;
  label.firstChild!.textContent = selector === "implementation" ? "Implementation variant " : "Practice variant ";
  select.innerHTML = options.length ? options.map((option) => `<option value="${option.id}">${option.label}</option>`).join("") : "<option value=\"\">Default reviewed configuration</option>";
  select.disabled = options.length === 0;
  select.dataset.selector = selector ?? "practice_id";
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
function saveReviews(reviews: ReviewRecord[]): void { localStorage.setItem(REVIEWS_KEY, JSON.stringify(reviews)); }
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
function formatDateTime(value: string): string { const date = new Date(value); return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(undefined, { dateStyle: "short", timeStyle: "short" }).format(date); }
function progressPercent(accepted: number, target: number): number { return target > 0 ? Math.min(100, Math.round((accepted / target) * 100)) : 0; }
function escapeHtml(value: string): string { return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ?? character); }
function variantLabel(value: { implementation?: string; practice_id?: string }): string { return value.implementation ? `implementation · ${value.implementation}` : value.practice_id ? `practice · ${value.practice_id}` : "default configuration"; }
function renderDrafts(): void {
  const drafts = readDrafts();
  document.querySelector<HTMLSpanElement>(".nav-count")!.textContent = String(drafts.length);
  draftList.innerHTML = drafts.length ? drafts.map((draft) => {
    const passingReview = readReviews().some((review) => review.draftId === draft.id && review.verdict === "pass");
    const canReview = draft.status === "validated";
    const canAccept = draft.status === "validated" && passingReview;
    return `<div class="draft-row" data-draft-id="${draft.id}" role="button" tabindex="0" aria-label="Edit ${draft.title}"><span class="draft-icon">${draft.title.slice(0, 2).toUpperCase()}</span><span class="draft-summary"><strong>${draft.title}</strong><small>${draft.status} · ${draft.language} · ${draft.modes.length} practice projection${draft.modes.length === 1 ? "" : "s"}</small></span><span class="draft-actions"><span class="draft-date">${formatDate(draft.createdAt)}</span><span class="draft-buttons"><button class="inline-action" type="button" data-generate-id="${draft.id}" ${draft.status === "generated" || draft.status === "validated" || draft.status === "accepted" ? "disabled" : ""}>${draft.status === "generated" || draft.status === "validated" || draft.status === "accepted" ? "Generated" : "Generate"}</button><button class="inline-action" type="button" data-validate-id="${draft.id}" ${draft.status === "validated" || draft.status === "accepted" ? "disabled" : ""}>${draft.status === "validated" || draft.status === "accepted" ? "Validated" : "Validate"}</button><button class="inline-action" type="button" data-review-id="${draft.id}" ${canReview ? "" : "disabled"}>Review</button><button class="inline-action" type="button" data-accept-id="${draft.id}" ${canAccept ? "" : "disabled"}>${draft.status === "accepted" ? "Accepted" : "Accept"}</button></span></span></div>`;
  }).join("") : `<div class="empty-state"><strong>No local drafts yet</strong><span>Create a draft to see it here.</span></div>`;
  renderWorkflow();
}
function renderWorkflow(): void {
  const draft = editingDraftId ? readDrafts().find((item) => item.id === editingDraftId) : undefined;
  const state = document.querySelector<HTMLElement>("#workflow-state");
  if (!state) return;
  const validation = document.querySelector<HTMLElement>("#workflow-validation .workflow-status")!;
  const review = document.querySelector<HTMLElement>("#workflow-review .workflow-status")!;
  const acceptance = document.querySelector<HTMLElement>("#workflow-acceptance .workflow-status")!;
  if (!draft) {
    state.textContent = "No draft selected";
    [validation, review, acceptance].forEach((item) => { item.textContent = "Pending"; item.className = "workflow-status"; });
    return;
  }
  const report = draftPersistence === "local" ? undefined : readReviews().filter((item) => item.draftId === draft.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  const setStatus = (target: HTMLElement, value: string, kind: "pending" | "ready" | "passed" | "blocked") => { target.textContent = value; target.className = `workflow-status ${kind}`; };
  state.textContent = draftDirty ? "Unsaved changes" : draftPersistence === "local" ? "Local only / sync pending" : draft.status === "accepted" ? "Accepted" : draft.status;
  setStatus(validation, draft.status === "validated" || draft.status === "accepted" ? "Passed" : draft.status === "generated" ? "Ready" : "Pending", draft.status === "validated" || draft.status === "accepted" ? "passed" : draft.status === "generated" ? "ready" : "pending");
  setStatus(review, report ? report.verdict.replaceAll("_", " ") : "Pending", report?.verdict === "pass" ? "passed" : report ? "blocked" : "pending");
  setStatus(acceptance, draft.status === "accepted" ? "Accepted" : report?.verdict === "pass" && draft.status === "validated" ? "Ready" : "Pending", draft.status === "accepted" ? "passed" : report?.verdict === "pass" && draft.status === "validated" ? "ready" : "pending");
}
function markDraftDirty(): void {
  if (!editingDraftId) return;
  draftDirty = true;
  renderWorkflow();
}
function renderHistory(): void {
  const drafts = readDrafts();
  const reviews = readReviews();
  historyList.innerHTML = reviews.length ? reviews.map((review) => { const draft = drafts.find((item) => item.id === review.draftId); const passed = review.verdict === "pass"; const created = formatDateTime(review.createdAt); return `<div class="history-row"><span class="review-mark ${passed ? "pass" : "pending-mark"}">${passed ? "&#10003;" : "&#8226;"}</span><span class="history-info"><strong>${review.role.replaceAll("_", " ")}</strong><small>${draft?.title ?? "Unknown draft"} · ${review.artifactHash ?? "artifact pending"}</small><time title="${created}">${created}</time></span><span class="history-status">${review.verdict}</span></div>`; }).join("") : `<div class="empty-state"><strong>No review reports yet</strong><span>Reports appear after a draft is validated and reviewed.</span></div>`;
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
      draftDirty = false;
      draftPersistence = "saved";
      submitDraft.innerHTML = `Update draft <span aria-hidden="true">&#8594;</span>`;
      renderWorkflow();
      showView("new");
    }
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" && event.key !== " ") return;
  const row = (event.target as HTMLElement).closest<HTMLElement>(".draft-row");
  if (!row || (event.target as HTMLElement).closest("button")) return;
  event.preventDefault();
  row.click();
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
form.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>("input, select, textarea").forEach((input) => {
  input.addEventListener("input", markDraftDirty);
  input.addEventListener("change", markDraftDirty);
});
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
document.querySelector<HTMLSelectElement>("#practice-unit")!.addEventListener("change", renderPracticeOptions);
document.querySelector<HTMLSelectElement>("#practice-mode")!.addEventListener("change", renderPracticeOptions);
form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const wasEditing = Boolean(editingDraftId);
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
  if (wasEditing && persisted) saveReviews(readReviews().filter((review) => review.draftId !== record.id));
  editingDraftId = record.id;
  draftDirty = false;
  draftPersistence = persisted ? "saved" : "local";
  renderDrafts();
  renderHistory();
  message.textContent = persisted ? (wasEditing ? "Draft revision saved to the local authoring API." : "Draft saved to the local authoring API.") : "Draft queued in this browser. Start the authoring API to share it locally.";
  message.className = "form-message success";
  submitDraft.innerHTML = `Update draft <span aria-hidden="true">&#8594;</span>`;
});
document.querySelector<HTMLButtonElement>("#reset")!.addEventListener("click", () => {
  editingDraftId = undefined;
  draftDirty = false;
  draftPersistence = "unknown";
  submitDraft.innerHTML = `Create draft <span aria-hidden="true">&#8594;</span>`;
  form.reset();
  document.querySelector<HTMLTextAreaElement>("#problem")!.value = "";
  document.querySelectorAll<HTMLInputElement>("input[name=mode], input[name=assistance]").forEach((input) => { input.checked = false; });
  updateProfile();
  message.textContent = "";
  renderWorkflow();
});
document.querySelector<HTMLFormElement>("#practice-start")!.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    if (activePracticeSession?.mode === "shadow_typing" || activePracticeSession?.mode === "code_recall") await shadowEditor?.flush();
    flowPromptRevealed = false;
    codePromptRevealed = false;
    promptRevealedModes.clear();
    const practiceOption = document.querySelector<HTMLSelectElement>("#practice-id")!;
    const selectedOption = practiceOption.value || undefined;
    const unitId = document.querySelector<HTMLSelectElement>("#practice-unit")!.value;
    const mode = document.querySelector<HTMLSelectElement>("#practice-mode")!.value as PracticeMode;
    const revision = practiceUnits.find((unit) => unit.id === unitId)?.revision;
    const defaultOption = practiceUnits.find((unit) => unit.id === unitId)?.practice_options.find((option) => option.mode === mode);
    const expectedImplementation = mode === "shadow_typing" ? selectedOption ?? defaultOption?.id : undefined;
    const expectedPracticeId = mode === "shadow_typing" ? undefined : selectedOption;
    const matching = checkpointItems.find((checkpoint) => checkpoint.unit_id === unitId && checkpoint.revision === revision && checkpoint.mode === mode && checkpoint.implementation === expectedImplementation && checkpoint.practice_id === expectedPracticeId);
    if (matching) {
      const resumed = await practiceRpc<{ session: PracticeSession | null }>("gewu/resumeCheckpoint", { checkpoint_id: matching.id });
      if (!resumed.session) throw new Error("The interrupted practice is no longer available");
      activePracticeSession = { session_id: resumed.session.session_id, mode: resumed.session.mode };
      renderPracticeSession(resumed.session);
      practiceMessage("Interrupted practice resumed.");
      await refreshPracticeData();
      return;
    }
    const session = await practiceRpc<{ session: PracticeSession }>("gewu/startSession", {
      unit_id: unitId,
      mode,
      ...(practiceOption.dataset.selector === "implementation" ? { implementation: selectedOption } : { practice_id: selectedOption }),
    });
    activePracticeSession = { session_id: session.session.session_id, mode: session.session.mode };
    document.querySelector<HTMLButtonElement>("#session-submit")!.disabled = false;
    renderPracticeSession(session.session);
    practiceMessage("Practice started.");
    await refreshPracticeData();
  } catch (error) { practiceMessage(error instanceof Error ? error.message : "Unable to start practice", true); }
});
document.querySelector<HTMLButtonElement>("#session-reveal")!.addEventListener("click", async () => {
  if (!activePracticeSession || activePracticeSession.mode === "shadow_typing") return;
  if (promptRevealedModes.has(activePracticeSession.mode)) {
    promptRevealedModes.delete(activePracticeSession.mode);
    if (activePracticeSnapshot) renderPracticeSession(activePracticeSnapshot);
    return;
  }
  try {
    const result = await practiceRpc<{ session: PracticeSession }>("gewu/applyEvent", { session_id: activePracticeSession.session_id, event: { type: "reveal_prompt" }, elapsed: { active_ms: 1000, wall_ms: 1000 } });
    promptRevealedModes.add(activePracticeSession.mode);
    renderPracticeSession(result.session);
  } catch (error) { practiceMessage(error instanceof Error ? error.message : "Unable to reveal prompt", true); }
});
document.querySelector<HTMLButtonElement>("#session-restart")!.addEventListener("click", async () => {
  if (!activePracticeSession || activePracticeSession.mode === "shadow_typing") return;
  try {
    const result = await practiceRpc<PracticeSession>("gewu/restartSession", { session_id: activePracticeSession.session_id });
    flowPromptRevealed = false;
    codePromptRevealed = false;
    promptRevealedModes.clear();
    renderPracticeSession(result);
    await refreshPracticeData();
  } catch (error) { practiceMessage(error instanceof Error ? error.message : "Unable to restart practice", true); }
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
    if (activePracticeSession.mode === "shadow_typing" || activePracticeSession.mode === "code_recall") await shadowEditor?.flush();
    const result = await practiceRpc<{ session: PracticeSession }>("gewu/stopSession", { session_id: activePracticeSession.session_id, elapsed: { active_ms: 1000, wall_ms: 1000 } });
    renderPracticeSession(result.session);
    activePracticeSession = undefined;
    await refreshPracticeData();
  } catch (error) { practiceMessage(error instanceof Error ? error.message : "Unable to stop practice", true); }
});
document.querySelector<HTMLButtonElement>("#refresh-checkpoints")!.addEventListener("click", () => { void refreshPracticeData(); });
document.querySelector<HTMLElement>("#practice-view")!.addEventListener("click", async (event) => {
  const target = event.target as HTMLElement;
  const recommendation = target.closest<HTMLButtonElement>("[data-start-recommendation]");
  if (recommendation) {
    const unit = document.querySelector<HTMLSelectElement>("#practice-unit")!;
    const mode = document.querySelector<HTMLSelectElement>("#practice-mode")!;
    unit.value = recommendation.dataset.startRecommendation ?? unit.value;
    mode.value = recommendation.dataset.recommendationMode ?? mode.value;
    renderPracticeOptions();
    document.querySelector<HTMLFormElement>("#practice-start")!.requestSubmit();
    return;
  }
  const pageButton = target.closest<HTMLButtonElement>("[data-page-list]");
  if (pageButton) {
    const name = pageButton.dataset.pageList as PracticeListName;
    practicePages[name] += Number(pageButton.dataset.pageDelta ?? 0);
    renderPracticeLists();
    return;
  }
  const resume = target.closest<HTMLButtonElement>("[data-resume-checkpoint]");
  const discard = target.closest<HTMLButtonElement>("[data-discard-checkpoint]");
  const revealScaffold = target.closest<HTMLButtonElement>("#reveal-scaffold");
  try {
    if (revealScaffold && activePracticeSession?.mode === "code_recall" && activePracticeSnapshot) {
      const revealed = activePracticeSnapshot.revealed_scaffold_indices ?? [];
      const nextIndex = Array.from({ length: activePracticeSnapshot.scaffold_count ?? 0 }, (_, index) => index).find((index) => !revealed.includes(index));
      if (nextIndex !== undefined) {
        const result = await practiceRpc<{ session: PracticeSession }>("gewu/applyEvent", { session_id: activePracticeSession.session_id, event: { type: "reveal_scaffold", index: nextIndex }, elapsed: { active_ms: 1000, wall_ms: 1000 } });
        renderPracticeSession(result.session);
      }
      return;
    }
    if (resume) {
      if (activePracticeSession?.mode === "shadow_typing" || activePracticeSession?.mode === "code_recall") await shadowEditor?.flush();
      const result = await practiceRpc<{ session: PracticeSession | null }>("gewu/resumeCheckpoint", { checkpoint_id: resume.dataset.resumeCheckpoint });
      if (result.session) { flowPromptRevealed = false; codePromptRevealed = false; promptRevealedModes.clear(); activePracticeSession = { session_id: result.session.session_id, mode: result.session.mode }; renderPracticeSession(result.session); }
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

document.querySelectorAll<HTMLElement>("[data-text-layout]").forEach(observeTextElement);

const telemetryFrames = [
  { accepted: "000", stability: "0.00" },
  { accepted: "018", stability: "0.72" },
  { accepted: "042", stability: "0.84" },
  { accepted: "067", stability: "0.91" },
  { accepted: "089", stability: "0.96" },
];
let telemetryFrame = 0;
window.setInterval(() => {
  if (document.querySelector<HTMLElement>("#home-view")?.hidden) return;
  const frame = telemetryFrames[telemetryFrame++ % telemetryFrames.length];
  document.querySelector<HTMLElement>("#home-accepted")!.textContent = frame.accepted;
  document.querySelector<HTMLElement>("#home-stability")!.textContent = frame.stability;
}, 3000);
const liveLines = [
  "> next move: reconstruct frontier",
  "> next move: verify invariant",
  "> next move: transfer pattern",
];
let liveLine = 0;
let liveCharacter = 0;
let liveDeleting = false;
let livePause = 0;
window.setInterval(() => {
  if (document.querySelector<HTMLElement>("#home-view")?.hidden) return;
  const element = document.querySelector<HTMLElement>("#home-live-text");
  if (!element) return;
  const phrase = liveLines[liveLine];
  if (livePause > 0) {
    livePause -= 1;
    return;
  }
  if (!liveDeleting) {
    liveCharacter = Math.min(phrase.length, liveCharacter + 1);
    element.textContent = phrase.slice(0, liveCharacter);
    if (liveCharacter === phrase.length) {
      liveDeleting = true;
      livePause = 24;
    }
  } else {
    liveCharacter = Math.max(0, liveCharacter - 1);
    element.textContent = phrase.slice(0, liveCharacter);
    if (liveCharacter === 0) {
      liveDeleting = false;
      liveLine = (liveLine + 1) % liveLines.length;
      livePause = 8;
    }
  }
}, 135);
