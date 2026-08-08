import "./styles.css";
import "./practice.css";
import { observeTextLayout, type TextLayoutHandle } from "./text-layout";
import { renderProblemStatement } from "./problem-renderer";
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
        <div class="terminal-visual" aria-label="GEWU core status visualization"><div class="terminal-bar"><span></span><span></span><span></span><b>gewu-core</b><i class="terminal-pulse" aria-hidden="true"></i></div><div class="terminal-body"><p><em>core</em>.start(<strong id="home-unit-id">your.algorithm</strong>, <strong>code_recall</strong>)</p><p class="dim">&gt; loading reviewed revision <strong>r1</strong></p><p class="green">&gt; state machine ready</p><p class="amber" data-text-layout><span id="home-live-text">&gt; next move: reconstruct frontier</span><span class="terminal-cursor" aria-hidden="true">_</span></p><div class="terminal-grid"><span>accepted</span><strong id="home-accepted">000</strong><span>stability</span><strong id="home-stability">0.00</strong><span>mode</span><strong>RECALL</strong></div></div></div>
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
          <label class="field"><span>Implementation variants <small class="catalog-note">Distinct strategies per unit</small></span><input id="variants" type="number" min="1" max="5" value="1" /></label>
        </div>
        <fieldset>
          <legend>Practice projections <label class="select-all"><input type="checkbox" id="select-all-modes" /><span>All modes</span></label></legend>
          <div class="mode-list">${modes.map((mode) => { const locked = mode.id === "shadow_typing" || mode.id === "flow_recall"; return `<label class="mode-option" title="${locked ? "Required by the unit contract" : ""}"><input type="checkbox" name="mode" value="${mode.id}" ${locked ? "checked disabled" : ""} /><span class="checkmark"></span><span><strong>${mode.label}</strong><small>${mode.hint}${locked ? " · core" : ""}</small></span></label>`; }).join("")}</div>
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
        <section class="panel review-panel"><div class="panel-heading"><div><p class="eyebrow">03 / Workflow</p><h2>Review gate</h2></div><span class="workflow-state" id="workflow-state">No draft selected</span></div><div class="review-step" id="workflow-validation"><span class="step-number">1</span><div><strong>Deterministic validation</strong><small>Schema, paths, source, and fixtures</small></div><span class="workflow-status">Pending</span></div><div class="review-step" id="workflow-review"><span class="step-number">2</span><div><strong>Role review</strong><small>Correctness, learning design, provenance</small></div><span class="review-step-actions"><span class="workflow-status">Pending</span><button class="inline-action" type="button" id="workflow-revise" hidden>Open artifact to revise</button></span></div><div class="review-step" id="workflow-acceptance"><span class="step-number">3</span><div><strong>Human acceptance</strong><small>Required before publication</small></div><span class="workflow-status">Pending</span></div></section>
      </aside>
    </section>
    </div>
    <section id="practice-view" class="app-view panel page-panel" hidden>
      <div class="practice-heading panel-heading"><div><p class="eyebrow">Core practice / local first</p><h2>Practice workspace</h2><p class="page-subtitle">Choose a unit, start one projection, and keep the current state visible while you work.</p></div><span class="connection-badge" id="practice-connection">Core offline</span></div>
      <form id="practice-start" class="practice-controls">
        <label class="field"><span>Algorithm unit</span><select id="practice-unit"><option>Loading units...</option></select></label>
        <label class="field"><span>Practice mode</span><select id="practice-mode">${modes.map((mode) => `<option value="${mode.id}">${mode.label}</option>`).join("")}</select></label>
        <label class="field"><span id="practice-option-label">Practice variant <small class="catalog-note">Reviewed choices from this unit</small></span><select id="practice-id"><option value="">Default reviewed variant</option></select></label>
        <button class="button primary" type="submit">Start practice <span aria-hidden="true">&#8594;</span></button>
        <p class="form-message" id="practice-message" role="status"></p>
      </form>
      <aside class="practice-side">
        <section><div class="panel-heading"><h3>Interrupted</h3><button class="inline-action" type="button" id="refresh-checkpoints">Refresh</button></div><div id="practice-checkpoints" class="compact-list"></div></section>
        <section><div class="panel-heading"><h3>Spaced review</h3></div><div id="practice-recommendations" class="compact-list"></div></section>
        <section><div class="panel-heading"><h3>Recent attempts</h3></div><div id="practice-attempts" class="compact-list"></div></section>
      </aside>
    </section>
    <section id="practice-session" class="app-view panel page-panel" hidden>
      <div class="session-heading" id="session-heading"><div><p class="eyebrow">Active session</p><h3 id="session-title">Practice</h3><p class="session-context" id="session-context"></p></div><div class="session-heading-meta"><span class="valid-badge" id="session-status">Active</span><span class="session-actions"><button class="button secondary" type="button" id="practice-back">&#8592; Back to workspace</button><button class="button danger" type="button" id="session-stop">Stop practice</button></span></div></div>
      <div class="practice-layout">
        <section class="problem-pane">
          <div class="session-problem"><span>Problem</span><div class="session-question" id="session-question"></div></div>
        </section>
        <div class="split-divider" id="split-divider"></div>
        <div class="session-column">
        <section class="practice-session" id="practice-session-body">
          <p class="session-meta" id="session-meta"></p>
          <div id="session-progress" class="session-progress" hidden></div><div id="session-completed" class="session-completed" hidden></div><p id="session-prompt" class="session-prompt" data-text-layout></p><div id="session-scaffold" class="session-scaffold" hidden></div><pre id="session-cloze-template" class="session-cloze-template" hidden data-text-layout></pre><pre id="session-target" class="session-target" data-text-layout></pre>
          <div id="session-editor-shell" class="practice-editor-shell" hidden><div class="practice-editor-toolbar"><span class="session-language" id="session-language">Template language</span><label>Font size <select id="editor-font-size"><option value="12">12</option><option value="13" selected>13</option><option value="14">14</option><option value="16">16</option><option value="18">18</option><option value="20">20</option></select></label></div><div id="session-editor" class="shadow-editor" aria-label="Practice code editor"></div></div><textarea id="session-answer" rows="5" placeholder="Enter your answer or the next code segment."></textarea>
          <div class="form-actions"><button class="button primary" type="button" id="session-submit">Submit answer</button><button class="button secondary" type="button" id="session-reveal" hidden>Reveal</button><button class="button secondary" type="button" id="session-restart" hidden>Restart</button></div>
        </section>
        </div>
      </div>
    </section>
    <section id="drafts-view" class="app-view panel page-panel" hidden>
      <div class="panel-heading"><div><p class="eyebrow">Saved work</p><h2>Drafts</h2></div><button class="button primary" type="button" data-go="new">New draft <span aria-hidden="true">&#8594;</span></button></div>
      <div class="filter-pills" id="draft-filters"></div>
      <div class="draft-list" id="draft-list"></div>
      <p class="view-note">Generated artifacts and LLM pre-review reports remain inspectable; only Human approve promotes a draft.</p>
    </section>
    <section id="history-view" class="app-view panel page-panel" hidden>
      <div class="panel-heading"><div><p class="eyebrow">Audit trail</p><h2>Review history</h2></div><span class="lock">Immutable reports</span></div>
      <div class="filter-pills" id="history-filters"></div>
      <div class="history-list" id="history-list"></div>
      <p class="view-note">Reports are tied to an artifact hash and cannot promote a draft without human acceptance.</p>
    </section>
  </main>
  <footer><span>GEWU / deliberate algorithm practice</span><span>Local by design.</span></footer>
  <div id="app-toast" class="toast" role="status" hidden></div>
  <div class="modal-overlay" id="confirm-dialog" hidden>
    <div class="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
      <h3 id="confirm-title">Confirm</h3>
      <p id="confirm-message"></p>
      <div class="confirm-actions">
        <button class="button secondary" type="button" id="confirm-cancel">Cancel</button>
        <button class="button danger" type="button" id="confirm-ok">Confirm</button>
      </div>
    </div>
  </div>
  <section class="artifact-inspector" id="artifact-inspector" hidden>
    <div class="artifact-modal">
      <div class="panel-heading"><div><p class="eyebrow">Artifact inspection</p><h3 id="artifact-title">Generated template</h3></div><span><button class="inline-action approval-action" type="button" id="save-artifact">Save revision</button> <button class="inline-action" type="button" id="close-artifact">Close</button></span></div>
      <p class="inspector-meta" id="artifact-meta"></p>
      <p class="artifact-message" id="artifact-message" role="status"></p>
      <div class="manifest-block"><h4>Manifest</h4><textarea id="artifact-manifest" class="artifact-editor" spellcheck="false"></textarea></div>
      <div class="files-block"><h4>Source and tests</h4><div id="artifact-files"></div></div>
      <div class="reviews-block"><h4>LLM pre-review feedback</h4><div id="artifact-reviews"></div></div>
    </div>
  </section>
`;

const form = document.querySelector<HTMLFormElement>("#draft-form")!;
const profileSummary = document.querySelector<HTMLDivElement>("#profile-summary")!;
const profileState = document.querySelector<HTMLSpanElement>("#profile-state")!;
const assistanceFieldset = document.querySelector<HTMLFieldSetElement>("#assistance-fieldset")!;
const message = document.querySelector<HTMLParagraphElement>("#form-message")!;
const draftList = document.querySelector<HTMLDivElement>("#draft-list")!;
const historyList = document.querySelector<HTMLDivElement>("#history-list")!;
const artifactInspector = document.querySelector<HTMLElement>("#artifact-inspector")!;
const ARTIFACT_REVIEW_PAGE_SIZE = 4;
let artifactReviewPage = 0;
let currentArtifactReviews: ArtifactPayload["reviews"] = [];
function artifactMessage(text: string, error = false): void {
  const target = document.querySelector<HTMLParagraphElement>("#artifact-message")!;
  target.textContent = text;
  target.className = `artifact-message ${error ? "error" : "success"}`;
}
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
type PracticeOption = { id: string; label: string; language: string; code_layout?: string; mode: PracticeMode; selector: "implementation" | "practice_id" };
type PracticeUnit = { id: string; revision: number; title: string; modes: PracticeMode[]; practice_options: PracticeOption[] };
type PracticeSession = { session_id: string; unit_id: string; revision: number; unit_title: string; problem_question: string; problem_statement: string; mode: PracticeMode; language: string; implementation?: string; practice_id?: string; code_layout?: string; code_template?: string; code_slot_ids?: string[]; current_code_slot?: string; status: string; accepted_text: string; target_text: string; current_prompt?: string; completed_prompts: string[]; completed_steps: number; total_steps: number; accepted_input_count: number; rejected_input_count: number; correction_count: number; prompt_count: number; scaffold_reveal_count: number; active_ms: number; wall_ms: number; code_assistance?: string; scaffold_count?: number; visible_scaffold?: string[]; revealed_scaffold_indices?: number[] };
type Checkpoint = { id: string; unit_title: string; unit_id: string; revision: number; mode: PracticeMode; implementation?: string; practice_id?: string; completed_steps: number; total_steps: number; accepted_characters: number; target_characters: number; saved_at: string };
type Recommendation = { policy_version: string; unit_id: string; revision: number; mode: PracticeMode; implementation?: string; practice_id?: string; kind: string; priority: string; reason: string; due_after_days: number; due_at_ms?: number };
type Attempt = { id: string; unit_id: string; revision: number; mode: PracticeMode; implementation?: string; practice_id?: string; terminal_reason: string; accepted_input_count: number; rejected_input_count: number; created_at: string };
type PracticeListName = "checkpoints" | "recommendations" | "attempts";
// Two rows leave enough room for long mode/status labels inside the fixed panels.
const PRACTICE_PAGE_SIZE = 2;
const practicePages: Record<PracticeListName, number> = { checkpoints: 0, recommendations: 0, attempts: 0 };
const DRAFT_PAGE_SIZE = 6;
let draftPage = 0;
const HISTORY_PAGE_SIZE = 6;
let historyPage = 0;
type DraftFilter = "all" | "attention" | "progress" | "published";
type HistoryFilter = "all" | "pass" | "needs_revision" | "reject";
let draftFilter: DraftFilter = "all";
let historyFilter: HistoryFilter = "all";

type PaginationKind = PracticeListName | "drafts" | "history";

function filterDrafts(drafts: DraftRecord[]): DraftRecord[] {
  if (draftFilter === "attention") return drafts.filter((draft) => draft.status === "needs_revision" || draft.status === "llm_reviewed");
  if (draftFilter === "progress") return drafts.filter((draft) => ["queued", "generated", "validated", "revision_requested"].includes(draft.status));
  if (draftFilter === "published") return drafts.filter((draft) => draft.status === "accepted");
  return drafts;
}
function filterReviews(reviews: ReviewRecord[]): ReviewRecord[] {
  if (historyFilter === "pass") return reviews.filter((review) => review.verdict === "pass");
  if (historyFilter === "needs_revision") return reviews.filter((review) => review.verdict === "needs_revision");
  if (historyFilter === "reject") return reviews.filter((review) => review.verdict === "reject");
  return reviews;
}
function renderDraftFilters(allDrafts: DraftRecord[]): void {
  const groups: Array<{ key: DraftFilter; label: string; match: (draft: DraftRecord) => boolean }> = [
    { key: "all", label: "All", match: () => true },
    { key: "attention", label: "Needs attention", match: (draft) => draft.status === "needs_revision" || draft.status === "llm_reviewed" },
    { key: "progress", label: "In progress", match: (draft) => ["queued", "generated", "validated", "revision_requested"].includes(draft.status) },
    { key: "published", label: "Published", match: (draft) => draft.status === "accepted" },
  ];
  document.querySelector<HTMLElement>("#draft-filters")!.innerHTML = groups.map((group) => `<button class="filter-pill${draftFilter === group.key ? " active" : ""}" type="button" data-draft-filter="${group.key}">${group.label}<span class="filter-count">${allDrafts.filter(group.match).length}</span></button>`).join("");
}
function renderHistoryFilters(allReviews: ReviewRecord[]): void {
  const groups: Array<{ key: HistoryFilter; label: string; match: (review: ReviewRecord) => boolean }> = [
    { key: "all", label: "All", match: () => true },
    { key: "pass", label: "Pass", match: (review) => review.verdict === "pass" },
    { key: "needs_revision", label: "Needs revision", match: (review) => review.verdict === "needs_revision" },
    { key: "reject", label: "Reject", match: (review) => review.verdict === "reject" },
  ];
  document.querySelector<HTMLElement>("#history-filters")!.innerHTML = groups.map((group) => `<button class="filter-pill${historyFilter === group.key ? " active" : ""}" type="button" data-history-filter="${group.key}">${group.label}<span class="filter-count">${allReviews.filter(group.match).length}</span></button>`).join("");
}

function pageNumberItems(page: number, totalPages: number): Array<number | "…"> {
  const current = page + 1;
  const items: Array<number | "…"> = [];
  const pushWindow = (from: number, to: number): void => { for (let value = from; value <= to; value += 1) items.push(value); };
  if (totalPages <= 7) {
    pushWindow(1, totalPages);
    return items;
  }
  items.push(1);
  if (current > 3) items.push("…");
  pushWindow(Math.max(2, current - 1), Math.min(totalPages - 1, current + 1));
  if (current < totalPages - 2) items.push("…");
  items.push(totalPages);
  return items;
}

function paginationHtml(kind: PaginationKind, page: number, totalPages: number, totalItems: number, pageSize: number): string {
  if (totalItems === 0) return "";
  // Reserve the pagination strip even on a single page so the surrounding
  // layout (footer, filters, fixed-height lists) never jumps when a filter
  // changes the number of visible items.
  if (totalPages <= 1) return `<div class="list-pagination is-empty" aria-hidden="true"></div>`;
  const start = page * pageSize + 1;
  const end = Math.min((page + 1) * pageSize, totalItems);
  const pagesHtml = pageNumberItems(page, totalPages).map((item) => item === "…"
    ? `<span class="page-ellipsis" aria-hidden="true">…</span>`
    : `<button class="page-button page-number ${item === page + 1 ? "active" : ""}" type="button" data-page-number="${kind}" data-page-value="${item}" aria-label="Page ${item}" ${item === page + 1 ? 'aria-current="page"' : ""}>${item}</button>`).join("");
  return `<div class="list-pagination"><span class="pagination-info">${start}–${end} of ${totalItems}</span><span class="pagination-controls"><button class="page-button" type="button" data-page-prev="${kind}" aria-label="Previous page" ${page === 0 ? "disabled" : ""}>&#8249;</button>${pagesHtml}<button class="page-button" type="button" data-page-next="${kind}" aria-label="Next page" ${page >= totalPages - 1 ? "disabled" : ""}>&#8250;</button></span></div>`;
}

function paginationKindTotal(kind: PaginationKind): number {
  return kind === "drafts" ? filterDrafts(readDrafts()).length : kind === "history" ? filterReviews(readReviews()).length : kind === "checkpoints" ? checkpointItems.length : kind === "recommendations" ? recommendationItems.length : attemptItems.length;
}
function paginationKindSize(kind: PaginationKind): number { return kind === "drafts" ? DRAFT_PAGE_SIZE : kind === "history" ? HISTORY_PAGE_SIZE : PRACTICE_PAGE_SIZE; }
function paginationKindPage(kind: PaginationKind): number { return kind === "drafts" ? draftPage : kind === "history" ? historyPage : practicePages[kind]; }
function setPaginationKindPage(kind: PaginationKind, page: number): void {
  const maxPage = Math.max(0, Math.ceil(paginationKindTotal(kind) / paginationKindSize(kind)) - 1);
  const next = Math.min(maxPage, Math.max(0, page));
  if (kind === "drafts") draftPage = next; else if (kind === "history") historyPage = next; else practicePages[kind] = next;
}
function renderPaginationKind(kind: PaginationKind): void {
  if (kind === "drafts") renderDrafts(); else if (kind === "history") renderHistory(); else renderPracticeLists();
}

let confirmResolve: ((value: boolean) => void) | null = null;
function openConfirm(title: string, message: string, confirmLabel = "Confirm"): Promise<boolean> {
  const overlay = document.querySelector<HTMLElement>("#confirm-dialog")!;
  document.querySelector<HTMLElement>("#confirm-title")!.textContent = title;
  document.querySelector<HTMLElement>("#confirm-message")!.textContent = message;
  document.querySelector<HTMLButtonElement>("#confirm-ok")!.textContent = confirmLabel;
  overlay.hidden = false;
  document.querySelector<HTMLButtonElement>("#confirm-cancel")!.focus();
  return new Promise((resolve) => { confirmResolve = resolve; });
}
function closeConfirm(result: boolean): void {
  confirmResolve?.(result);
  confirmResolve = null;
  document.querySelector<HTMLElement>("#confirm-dialog")!.hidden = true;
}
document.querySelector<HTMLButtonElement>("#confirm-ok")!.addEventListener("click", () => closeConfirm(true));
document.querySelector<HTMLButtonElement>("#confirm-cancel")!.addEventListener("click", () => closeConfirm(false));
document.querySelector<HTMLElement>("#confirm-dialog")!.addEventListener("click", (event) => {
  if ((event.target as HTMLElement).id === "confirm-dialog") closeConfirm(false);
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !document.querySelector<HTMLElement>("#confirm-dialog")!.hidden) closeConfirm(false);
});
let checkpointItems: Checkpoint[] = [];
let recommendationItems: Recommendation[] = [];
let attemptItems: Attempt[] = [];
let practiceReconnectTimer: number | undefined;
let reconnectingPractice = false;
let practiceWasDisconnected = false;
function setPracticeConnection(connected: boolean, message?: string): void {
  const connection = document.querySelector<HTMLElement>("#practice-connection")!;
  connection.textContent = connected
    ? practiceHandshake ? `Core connected · v${practiceHandshake.core_version} / protocol ${practiceHandshake.protocol_version}` : "Core connected"
    : "Core disconnected · retrying";
  connection.classList.toggle("is-connected", connected);
  if (!connected) practiceWasDisconnected = true;
  if (message) practiceMessage(message, !connected);
}
async function establishPracticeHandshake(): Promise<void> {
  const response = await fetch(practiceApi, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: practiceRequestId++, method: "gewu/handshake", params: { protocol_min: 2, protocol_max: 2, client_name: "gewu-web", client_version: "0.1.0" } }) });
  if (!response.ok) throw new Error(`Core HTTP ${response.status}`);
  const payload = await response.json() as { result?: { core_version: string; protocol_version: number }; error?: { message?: string } };
  if (payload.error || !payload.result) throw new Error(payload.error?.message ?? "Core handshake failed");
  practiceHandshake = payload.result;
  practiceHandshaken = true;
}
async function practiceRpc<T>(method: string, params: unknown = {}): Promise<T> {
  if (!practiceHandshaken && method !== "gewu/handshake") {
    await establishPracticeHandshake();
  }
  try {
    const response = await fetch(practiceApi, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: practiceRequestId++, method, params }) });
    if (!response.ok) {
      if (response.status >= 500) { practiceHandshaken = false; setPracticeConnection(false); }
      throw new Error(`Core HTTP ${response.status}`);
    }
    const payload = await response.json() as { result?: T; error?: { message?: string } };
    if (payload.error) {
      const errorMessage = payload.error.message ?? "Core request failed";
      if (/session (not found|unknown)|checkpoint.*not found/i.test(errorMessage)) {
        practiceHandshaken = false;
        practiceHandshake = undefined;
        setPracticeConnection(false);
        void refreshPracticeData();
      }
      throw new Error(errorMessage);
    }
    return payload.result as T;
  } catch (error) {
    if (error instanceof TypeError || (error instanceof Error && error.message.startsWith("Core HTTP 5"))) {
      practiceHandshaken = false;
      practiceHandshake = undefined;
      setPracticeConnection(false);
    }
    throw error;
  }
}
function practiceMessage(text: string, error = false): void { const target = document.querySelector<HTMLParagraphElement>("#practice-message")!; target.textContent = text; target.className = `form-message ${error ? "error" : "success"}`; }
let toastTimer: number | undefined;
function notify(text: string, error = false): void {
  message.textContent = text;
  message.className = `form-message ${error ? "error" : "success"}`;
  const toast = document.querySelector<HTMLElement>("#app-toast")!;
  toast.textContent = text;
  toast.className = `toast ${error ? "error" : "success"}`;
  toast.hidden = false;
  if (toastTimer !== undefined) window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => { toast.hidden = true; }, 4000);
}
const actionLocks = new Set<string>();
let practiceStarting = false;
function lockAction(action: string, id: string | undefined): boolean {
  const key = `${action}:${id ?? ""}`;
  if (actionLocks.has(key)) return false;
  actionLocks.add(key);
  return true;
}
function unlockAction(action: string, id: string | undefined): void { actionLocks.delete(`${action}:${id ?? ""}`); }
window.addEventListener("pagehide", () => {
  const sessionId = activePracticeSession?.session_id;
  if (!sessionId) return;
  // Force a final checkpoint on unload: checkpoint persistence is throttled
  // in Core to keep typing off the disk, so recovery must be flushed here.
  void (async () => {
    try { await shadowEditor?.flush(); } catch { /* best effort */ }
    try {
      await fetch(practiceApi, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: practiceRequestId++, method: "gewu/saveCheckpoint", params: { session_id: sessionId } }),
        keepalive: true,
      });
    } catch { /* best effort */ }
  })();
});
function setPracticeFocus(focused: boolean): void {
  document.querySelector<HTMLElement>("#practice-view")!.hidden = focused;
  document.querySelector<HTMLElement>("#practice-session")!.hidden = !focused;
}
function renderPracticeSession(session: PracticeSession): void {
  const sessionChanged = activePracticeSnapshot?.session_id !== session.session_id;
  activePracticeSnapshot = session;
  document.querySelector<HTMLElement>("#session-title")!.textContent = session.unit_title;
  document.querySelector<HTMLElement>("#session-question")!.innerHTML = renderProblemStatement(session.problem_statement);
  const unitShort = session.unit_id.split(".").pop() ?? "";
  const practiceName = session.practice_id
    ? session.practice_id.startsWith(`${unitShort}-`)
      ? session.practice_id.slice(unitShort.length + 1).replaceAll("-", " ")
      : session.practice_id.replaceAll("-", " ")
    : "";
  const contextParts = [session.mode.replaceAll("_", " ")];
  if (practiceName) contextParts.push(practiceName);
  else if (session.code_layout) contextParts.push(session.code_layout.replaceAll("_", " "));
  if (session.implementation) contextParts.push(`implementation ${session.implementation}`);
  document.querySelector<HTMLElement>("#session-context")!.textContent = contextParts.join(" · ") || "default variant";
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
  const isCloze = isCode && session.code_layout === "cloze";
  const isCommentGuided = isCode && session.code_layout === "comment_guided";
  const isCommentToCode = isCode && session.code_layout === "comment_to_code";
  const isStructuredCode = isCloze || isCommentGuided;
  const requiresPromptReveal = isFlow || isCode || isReasoning || isTransfer;
  const promptVisible = !requiresPromptReveal || promptRevealedModes.has(session.mode);
  progress.hidden = !isFlow && !isReasoning && !isTransfer && !isStructuredCode;
  progress.textContent = progress.hidden ? "" : `${isStructuredCode ? "Slot" : "Step"} ${Math.min(session.completed_steps + 1, session.total_steps)} of ${session.total_steps}`;
  completed.hidden = !isFlow;
  completed.innerHTML = isFlow && session.completed_prompts.length > 0
    ? `<strong>Completed flow</strong><ol>${session.completed_prompts.map((item) => `<li><span aria-hidden="true">&#10003;</span>${escapeHtml(item)}</li>`).join("")}</ol>`
    : "";
  prompt.textContent = requiresPromptReveal ? (promptVisible ? session.current_prompt ?? "No reviewed prompt is available." : "Prompt hidden until Reveal") : session.current_prompt ?? "";
  prompt.hidden = !prompt.textContent.trim();
  prompt.classList.toggle("is-hidden", requiresPromptReveal && !promptVisible);
  reveal.hidden = !requiresPromptReveal || session.status !== "active";
  reveal.textContent = promptVisible ? "Hide prompt" : "Reveal prompt";
  restart.hidden = isShadow;
  scaffold.hidden = !isCode;
  const assistanceIsIntrinsic = isCommentGuided || isCommentToCode;
  scaffold.innerHTML = isCode ? `<div class="scaffold-heading"><span>${session.code_assistance ?? "Code assistance"}</span>${assistanceIsIntrinsic ? "" : `<button class="inline-action" type="button" id="reveal-scaffold" ${session.status !== "active" || (session.scaffold_count ?? 0) <= (session.revealed_scaffold_indices?.length ?? 0) ? "disabled" : ""}>Reveal next hint</button>`}</div><ul>${(session.visible_scaffold ?? []).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>` : "";
  const target = document.querySelector<HTMLElement>("#session-target")!;
  const clozeTemplate = document.querySelector<HTMLElement>("#session-cloze-template")!;
  const editorShell = document.querySelector<HTMLElement>("#session-editor-shell")!;
  const editorContainer = document.querySelector<HTMLElement>("#session-editor")!;
  const answer = document.querySelector<HTMLTextAreaElement>("#session-answer")!;
  const submit = document.querySelector<HTMLButtonElement>("#session-submit")!;
  target.hidden = true;
  answer.placeholder = isStructuredCode
    ? `Enter code for ${session.current_code_slot ?? "the current slot"}.`
    : isReasoning
    ? "Explain the reasoning for this step."
    : isTransfer
      ? "Describe how the algorithm transfers to this variation."
      : "Enter your answer or the next code segment.";
  clozeTemplate.hidden = !isStructuredCode;
  clozeTemplate.textContent = isStructuredCode ? (session.code_template ?? "") : "";
  const isCodeEditor = isShadow || (isCode && !isStructuredCode);
  editorShell.hidden = !isCodeEditor;
  answer.hidden = isCodeEditor;
  submit.hidden = isCodeEditor;
  submit.textContent = isFlow || (isCode && !isStructuredCode) ? "Submit answer" : isStructuredCode ? "Submit code" : "Submit event";
  document.querySelector<HTMLElement>("#practice-session-body .form-actions")!.hidden = submit.hidden && reveal.hidden && restart.hidden;
  if (isCodeEditor) {
    shadowAcceptedText = session.accepted_text;
    shadowTargetText = session.target_text;
    shadowLanguage = session.language;
    void updateShadowEditor(editorContainer, session, sessionChanged, isShadow);
  }
  target.textContent = session.target_text || session.accepted_text || "Awaiting the next response.";
  observeTextElement(document.querySelector<HTMLElement>("#session-prompt")!);
  observeTextElement(document.querySelector<HTMLElement>("#session-target")!);
  const acceptedChars = Array.from(session.accepted_text).length;
  const targetChars = Array.from(session.target_text).length;
  document.querySelector<HTMLElement>("#session-meta")!.textContent = session.mode === "shadow_typing"
    ? `progress ${progressPercent(acceptedChars, targetChars)}% · accepted inputs ${session.accepted_input_count} · rejected inputs ${session.rejected_input_count} · corrections ${session.correction_count}`
    : session.mode === "code_recall" && !isStructuredCode
    ? `progress ${progressPercent(acceptedChars, targetChars)}% · ${session.code_assistance ?? "no hints"} · rejected inputs ${session.rejected_input_count} · prompts ${session.prompt_count} · hints ${session.scaffold_reveal_count}`
    : session.mode === "code_recall"
    ? `slot ${session.completed_steps}/${session.total_steps} · rejected inputs ${session.rejected_input_count} · prompts ${session.prompt_count}`
    : `completed ${session.accepted_input_count} steps · rejected ${session.rejected_input_count} answers · prompts ${session.prompt_count}`;
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
    if (sessionChanged && session.status === "active") shadowEditor.focus();
    return;
  }
  if (!shadowEditorLoading) {
    shadowEditorLoading = import("./shadow-editor").then(({ mountShadowEditor }) => mountShadowEditor(container, shadowAcceptedText, shadowTargetText, session.language, session.status !== "active", showGuidance, applyShadowEdit));
  }
  shadowEditor = await shadowEditorLoading;
  shadowEditor.update(shadowAcceptedText, shadowTargetText, session.language, session.status !== "active", showGuidance, sessionChanged, sessionChanged);
  if (sessionChanged && session.status === "active") shadowEditor.focus();
  if (shadowEditorPendingFocus) {
    shadowEditorPendingFocus = false;
    shadowEditor.focus();
  }
}
document.querySelector<HTMLSelectElement>("#editor-font-size")!.addEventListener("change", (event) => {
  const size = Number((event.target as HTMLSelectElement).value);
  shadowEditor?.setFontSize(size);
});
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
    document.querySelector<HTMLElement>("#home-unit-id")!.textContent = units[0]?.id ?? "your.algorithm";
    const unitSelect = document.querySelector<HTMLSelectElement>("#practice-unit")!;
    const selectedUnitId = unitSelect.value;
    unitSelect.innerHTML = units.map((unit) => `<option value="${unit.id}">${unit.title} · r${unit.revision}</option>`).join("");
    if (units.some((unit) => unit.id === selectedUnitId)) unitSelect.value = selectedUnitId;
    renderPracticeOptions();
    const shouldRecoverSession = practiceWasDisconnected;
    setPracticeConnection(true);
    practiceWasDisconnected = false;
    const uniqueCheckpoints = new Map<string, Checkpoint>();
    for (const checkpoint of checkpoints.checkpoints) {
      const key = `${checkpoint.unit_id}:${checkpoint.revision}:${checkpoint.mode}:${checkpoint.implementation ?? ""}:${checkpoint.practice_id ?? ""}`;
      if (!uniqueCheckpoints.has(key)) uniqueCheckpoints.set(key, checkpoint);
    }
    checkpointItems = [...uniqueCheckpoints.values()];
    recommendationItems = recommendations;
    attemptItems = attempts.attempts;
    renderPracticeLists();
    if (practiceReconnectTimer !== undefined) { window.clearTimeout(practiceReconnectTimer); practiceReconnectTimer = undefined; }
    if (shouldRecoverSession && activePracticeSession && activePracticeSnapshot?.status === "active" && !reconnectingPractice) {
      const matching = checkpointItems.find((item) => item.unit_id === activePracticeSnapshot?.unit_id && item.revision === activePracticeSnapshot.revision && item.mode === activePracticeSession?.mode && (!activePracticeSnapshot.practice_id || item.practice_id === activePracticeSnapshot.practice_id) && (!activePracticeSnapshot.implementation || item.implementation === activePracticeSnapshot.implementation));
      if (matching && matching.id !== activePracticeSession.session_id) {
        reconnectingPractice = true;
        try {
          const resumed = await practiceRpc<{ session: PracticeSession | null }>("gewu/resumeCheckpoint", { checkpoint_id: matching.id });
          if (resumed.session) { activePracticeSession = { session_id: resumed.session.session_id, mode: resumed.session.mode }; renderPracticeSession(resumed.session); practiceMessage("Core reconnected; interrupted practice resumed."); }
        } finally { reconnectingPractice = false; }
      }
    }
  } catch (error) {
    setPracticeConnection(false, "Rust Core is unavailable. Retrying automatically.");
    if (practiceReconnectTimer === undefined) practiceReconnectTimer = window.setTimeout(() => { practiceReconnectTimer = undefined; void refreshPracticeData(); }, 1500);
  }
}
window.addEventListener("online", () => { void refreshPracticeData(); });
function renderPagedPracticeList<T>(name: PracticeListName, targetId: string, items: T[], renderItem: (item: T) => string, emptyText: string): void {
  const target = document.querySelector<HTMLElement>(targetId)!;
  const totalPages = Math.max(1, Math.ceil(items.length / PRACTICE_PAGE_SIZE));
  practicePages[name] = Math.min(practicePages[name], totalPages - 1);
  const page = practicePages[name];
  const rows = items.slice(page * PRACTICE_PAGE_SIZE, (page + 1) * PRACTICE_PAGE_SIZE);
  target.innerHTML = items.length
    ? `<div class="paged-scroll">${rows.map(renderItem).join("")}</div>${paginationHtml(name, page, totalPages, items.length, PRACTICE_PAGE_SIZE)}`
    : `<div class="compact-empty">${emptyText}</div>`;
}
function renderPracticeLists(): void {
  const activeCheckpointId = activePracticeSession ? `checkpoint-${activePracticeSession.session_id}` : null;
  renderPagedPracticeList("checkpoints", "#practice-checkpoints", checkpointItems, (checkpoint) => { const progress = progressPercent(checkpoint.accepted_characters, checkpoint.target_characters); const saved = formatDateTime(checkpoint.saved_at); const isActive = checkpoint.id === activeCheckpointId; return `<div class="compact-row practice-record${isActive ? " is-active" : ""}"><div class="record-main"><strong>${checkpoint.unit_title}</strong><span>${checkpoint.mode.replaceAll("_", " ")} · ${variantLabel(checkpoint)}${isActive ? " · in progress" : ""}</span><span title="${checkpoint.accepted_characters}/${checkpoint.target_characters} characters">${progress}% complete</span></div><div class="record-footer"><time title="${saved}">${saved}</time><span class="record-actions"><button class="inline-action" data-resume-checkpoint="${checkpoint.id}">Resume</button><button class="inline-action" data-discard-checkpoint="${checkpoint.id}">Discard</button></span></div></div>`; }, "No interrupted practice.");
  renderPagedPracticeList("recommendations", "#practice-recommendations", recommendationItems, (item) => { const due = item.due_at_ms ? new Date(item.due_at_ms) : undefined; const dueDate = due ? formatDateTime(due.toISOString()) : `${item.due_after_days}d`; const dueLabel = due && due.getTime() <= Date.now() ? "Due now" : `Due ${dueDate}`; const title = practiceUnits.find((unit) => unit.id === item.unit_id)?.title ?? item.unit_id; return `<div class="compact-row practice-record"><div class="record-main"><strong>${title}</strong><span>${item.mode.replaceAll("_", " ")} · ${variantLabel(item)}</span><span title="${escapeHtml(item.reason)}">${item.kind} · ${item.priority} priority</span></div><div class="record-footer"><time title="${dueLabel}">${dueLabel}</time><span class="record-actions"><button class="inline-action" type="button" data-start-recommendation="${item.unit_id}" data-recommendation-mode="${item.mode}">Practice</button></span></div></div>`; }, "Complete a practice to build your review schedule.");
  renderPagedPracticeList("attempts", "#practice-attempts", attemptItems, (item) => { const created = formatDateTime(item.created_at); return `<div class="compact-row practice-record"><div class="record-main"><strong>${item.unit_id} · r${item.revision}</strong><span>${item.mode.replaceAll("_", " ")} · ${variantLabel(item)}</span></div><div class="record-footer"><time title="${created}">${created}</time><span class="record-state">${item.terminal_reason}</span></div></div>`; }, "No attempts yet.");
}
function renderPracticeOptions(): void {
  const unitId = document.querySelector<HTMLSelectElement>("#practice-unit")?.value;
  const mode = document.querySelector<HTMLSelectElement>("#practice-mode")?.value as PracticeMode | undefined;
  const select = document.querySelector<HTMLSelectElement>("#practice-id");
  const label = document.querySelector<HTMLElement>("#practice-option-label");
  if (!select || !label) return;
  const options = practiceUnits.find((unit) => unit.id === unitId)?.practice_options.filter((option) => option.mode === mode) ?? [];
  const selector = options[0]?.selector;
  const previous = select.value;
  label.firstChild!.textContent = selector === "implementation" ? "Implementation variant " : "Practice variant ";
  select.innerHTML = options.length ? options.map((option) => `<option value="${option.id}">${option.label}</option>`).join("") : "<option value=\"\">Default reviewed configuration</option>";
  select.disabled = options.length === 0;
  select.dataset.selector = selector ?? "practice_id";
  // Preserve the user's selection when the options are re-rendered (e.g. by
  // refreshPracticeData after starting/stopping); fall back to the first only
  // when the chosen variant no longer exists for this unit/mode.
  if (options.some((option) => option.id === previous)) select.value = previous;
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
  status: "draft" | "queued" | "generated" | "validated" | "llm_reviewed" | "needs_revision" | "revision_requested" | "accepted";
  createdAt: string;
  artifactPath?: string;
  publishedPath?: string;
}
interface ReviewRecord { id: string; draftId: string; role: string; verdict: "pending" | "pass" | "needs_revision" | "reject"; artifactHash: string | null; reportPath?: string; createdAt: string; }
interface ArtifactPayload { draft: DraftRecord; files: Record<string, string>; reviews: Array<ReviewRecord & { report?: { verdict?: string; findings?: Array<{ rule_id: string; severity: string; path: string; problem: string; evidence: string; suggested_change: string }> } }> }

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
function statusLabel(status: DraftRecord["status"]): string { return ({ draft: "Draft", queued: "Queued", generated: "Generated", validated: "Contract valid", llm_reviewed: "LLM pre-reviewed", needs_revision: "Needs revision", revision_requested: "Revision requested", accepted: "Human approved" })[status]; }
function loadDraftIntoForm(draft: DraftRecord): void {
  (document.querySelector<HTMLTextAreaElement>("#problem")!).value = draft.problem;
  (document.querySelector<HTMLInputElement>("#languages")!).value = draft.language;
  (document.querySelector<HTMLInputElement>("#variants")!).value = String(draft.variants);
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
}
function draftStage(status: DraftRecord["status"]): number {
  return status === "queued" || status === "revision_requested" ? 1 : status === "generated" ? 2 : status === "validated" || status === "needs_revision" ? 3 : status === "llm_reviewed" ? 4 : status === "accepted" ? 5 : 0;
}
function renderDrafts(): void {
  const allDrafts = readDrafts();
  document.querySelector<HTMLSpanElement>(".nav-count")!.textContent = String(allDrafts.length);
  renderDraftFilters(allDrafts);
  const drafts = filterDrafts(allDrafts);
  const totalPages = Math.max(1, Math.ceil(drafts.length / DRAFT_PAGE_SIZE));
  draftPage = Math.min(draftPage, totalPages - 1);
  const visibleDrafts = drafts.slice(draftPage * DRAFT_PAGE_SIZE, (draftPage + 1) * DRAFT_PAGE_SIZE);
  const empty = draftFilter === "attention" ? ["Nothing needs attention", "You are all caught up."] : draftFilter === "progress" ? ["No drafts in progress", "Start a draft to see it here."] : draftFilter === "published" ? ["No published units yet", "Approve a draft to publish it."] : ["No local drafts yet", "Create a draft to see it here."];
  draftList.innerHTML = drafts.length ? `<div class="paged-scroll">${visibleDrafts.map((draft) => {
    const canGenerate = ["queued", "revision_requested"].includes(draft.status);
    const canValidate = draft.status === "generated";
    const canReview = draft.status === "validated";
    const canAccept = draft.status === "llm_reviewed" || draft.status === "needs_revision" || (draft.status === "validated" && readReviews().some((review) => review.draftId === draft.id && review.role === "human_revision"));
    const canRollback = ["generated", "validated", "llm_reviewed", "needs_revision"].includes(draft.status);
    const canFork = draft.status === "accepted";
    const canDelete = draft.status !== "accepted";
    const stage = draftStage(draft.status);
    const actions = [
      draft.artifactPath ? `<button class="inline-action${draft.status === "needs_revision" ? " revision-action" : ""}" type="button" data-view-artifact-id="${draft.id}">${draft.status === "needs_revision" ? "Revise artifact" : "View artifact"}</button>` : "",
      canGenerate ? `<button class="inline-action primary-action" type="button" data-generate-id="${draft.id}">Generate template</button>` : "",
      canValidate ? `<button class="inline-action primary-action" type="button" data-validate-id="${draft.id}">Validate contract</button>` : "",
      canReview ? `<button class="inline-action primary-action" type="button" data-review-id="${draft.id}">LLM pre-review</button>` : "",
      canAccept ? `<button class="inline-action approval-action" type="button" data-accept-id="${draft.id}">Human approve</button>` : "",
      canRollback ? `<button class="inline-action" type="button" data-rollback-id="${draft.id}">Request revision</button>` : "",
      canFork ? `<button class="inline-action" type="button" data-fork-id="${draft.id}">Extend unit</button>` : "",
      canDelete ? `<button class="inline-action danger-action" type="button" data-delete-id="${draft.id}">Delete</button>` : "",
    ].filter(Boolean).join("");
    const pipeline = (label: string, active: boolean) => `<b class="${active ? "active" : ""}">${label}</b>`;
    const separator = `<span class="pipeline-sep" aria-hidden="true">&#8250;</span>`;
    return `<div class="draft-row" data-draft-id="${draft.id}" role="button" tabindex="0" aria-label="Edit ${draft.title}"><span class="draft-icon">${draft.title.slice(0, 2).toUpperCase()}</span><span class="draft-summary"><strong>${draft.title}</strong><small>${draft.language} · ${draft.modes.length} practice projection${draft.modes.length === 1 ? "" : "s"}</small><small class="draft-pipeline" aria-label="Draft workflow">${pipeline("01 Generate", stage >= 1)}${separator}${pipeline("02 Validate", stage >= 2)}${separator}${pipeline("03 Review", stage >= 4)}${separator}${pipeline("04 Approve", stage >= 5)}</small></span><span class="draft-actions"><span class="draft-date">${formatDate(draft.createdAt)} <b class="draft-status status-${draft.status}">${statusLabel(draft.status)}</b></span><span class="draft-buttons">${actions}</span></span></div>`;
  }).join("")}</div>${paginationHtml("drafts", draftPage, totalPages, drafts.length, DRAFT_PAGE_SIZE)}` : `<div class="empty-state"><strong>${empty[0]}</strong><span>${empty[1]}</span></div><div class="list-pagination is-empty" aria-hidden="true"></div>`;
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
  state.textContent = draftDirty ? "Unsaved changes" : draftPersistence === "local" ? "Local only / sync pending" : statusLabel(draft.status);
  const contractValid = ["validated", "llm_reviewed", "accepted"].includes(draft.status);
  const readyToValidate = draft.status === "generated";
  setStatus(validation, contractValid ? "Contract valid" : readyToValidate ? "Ready to validate" : draft.status === "needs_revision" ? "Blocked by revision" : "Pending", contractValid ? "passed" : readyToValidate ? "ready" : draft.status === "needs_revision" ? "blocked" : "pending");
  const allDraftReviews = draftPersistence === "local" ? [] : readReviews().filter((item) => item.draftId === draft.id);
  const roleReviews = allDraftReviews.filter((item) => item.role !== "human_revision");
  const humanReviewed = allDraftReviews.some((item) => item.role === "human_revision" && item.verdict === "pass");
  const blockedReview = roleReviews.find((item) => item.verdict === "needs_revision" || item.verdict === "reject");
  const allRolesPassed = roleReviews.length === 3 && roleReviews.every((item) => item.verdict === "pass");
  const reviewValue = allRolesPassed ? "All roles passed" : humanReviewed ? "Human revision recorded" : blockedReview ? "Needs revision" : draft.status === "validated" ? "Ready to run" : "Pending";
  const reviewKind = allRolesPassed ? "passed" : humanReviewed ? "passed" : blockedReview ? "blocked" : draft.status === "validated" ? "ready" : "pending";
  setStatus(review, reviewValue, reviewKind);
  const acceptanceReady = draft.status === "llm_reviewed" || draft.status === "needs_revision" || (draft.status === "validated" && humanReviewed);
  setStatus(acceptance, draft.status === "accepted" ? "Human approved" : acceptanceReady ? "Ready for you" : "Pending", draft.status === "accepted" ? "passed" : acceptanceReady ? "ready" : "pending");
  const revise = document.querySelector<HTMLButtonElement>("#workflow-revise")!;
  revise.hidden = draft.status !== "needs_revision";
}
function markDraftDirty(): void {
  if (!editingDraftId) return;
  draftDirty = true;
  renderWorkflow();
}
function renderHistory(): void {
  const drafts = readDrafts();
  const allReviews = readReviews();
  renderHistoryFilters(allReviews);
  const reviews = filterReviews(allReviews);
  historyList.innerHTML = reviews.length
    ? `<div class="paged-scroll history-paged">${reviews.slice(historyPage * HISTORY_PAGE_SIZE, (historyPage + 1) * HISTORY_PAGE_SIZE).map((review) => { const draft = drafts.find((item) => item.id === review.draftId); const passed = review.verdict === "pass"; const created = formatDateTime(review.createdAt); const inspect = draft?.artifactPath ? `<button class="inline-action" type="button" data-view-artifact-id="${draft.id}">View feedback</button>` : ""; const verdictClass = passed ? "verdict-pass" : review.verdict === "needs_revision" || review.verdict === "reject" ? "verdict-reject" : "verdict-pending"; return `<div class="history-row"><span class="review-mark ${passed ? "pass" : "pending-mark"}">${passed ? "&#10003;" : "&#8226;"}</span><span class="history-info"><strong>${review.role.replaceAll("_", " ")}</strong><small>${draft?.title ?? "Unknown draft"} · ${review.artifactHash ?? "artifact pending"}</small><time title="${created}">${created}</time></span><span class="history-status ${verdictClass}">${review.verdict.replaceAll("_", " ")}</span>${inspect}</div>`; }).join("")}</div>${paginationHtml("history", historyPage, Math.max(1, Math.ceil(reviews.length / HISTORY_PAGE_SIZE)), reviews.length, HISTORY_PAGE_SIZE)}`
    : `<div class="empty-state"><strong>${historyFilter === "all" ? "No review reports yet" : "No matching reports"}</strong><span>${historyFilter === "all" ? "Reports appear after a draft is validated and reviewed." : "Try another verdict filter."}</span></div><div class="list-pagination is-empty" aria-hidden="true"></div>`;
}

async function inspectArtifact(id: string): Promise<void> {
  artifactMessage("");
  try {
    const response = await fetch(`/api/drafts/${id}/artifact`);
    const payload = await response.json() as ArtifactPayload & { error?: string };
    if (!response.ok) throw new Error(payload.error ?? "Unable to load artifact");
    artifactInspector.hidden = false;
    artifactInspector.dataset.draftId = id;
    document.querySelector<HTMLElement>("#artifact-title")!.textContent = payload.draft.title;
    document.querySelector<HTMLElement>("#artifact-meta")!.textContent = `${statusLabel(payload.draft.status)} · ${payload.draft.provider} / ${payload.draft.model}${payload.draft.publishedPath ? " · Published to Core content" : ""}`;
    const manifest = payload.files["unit.json"];
    try { document.querySelector<HTMLElement>("#artifact-manifest")!.textContent = manifest ? JSON.stringify(JSON.parse(manifest) as unknown, null, 2) : "Manifest unavailable"; }
    catch { document.querySelector<HTMLElement>("#artifact-manifest")!.textContent = manifest ?? "Manifest unavailable"; }
    document.querySelector<HTMLElement>("#artifact-files")!.innerHTML = Object.entries(payload.files).filter(([path]) => path !== "unit.json" && path !== "generation.json" && !path.startsWith("reviews/") && !path.endsWith(".pyc") && !path.includes("__pycache__")).map(([path, content]) => `<details class="artifact-file" open><summary>${escapeHtml(path)}</summary><textarea class="artifact-editor" data-artifact-file="${escapeHtml(path)}" spellcheck="false">${escapeHtml(content)}</textarea></details>`).join("") || "<p class='compact-empty'>No source files.</p>";
    currentArtifactReviews = payload.reviews;
    artifactReviewPage = 0;
    renderArtifactReviews();
    artifactInspector.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (error) {
    artifactMessage(error instanceof Error ? error.message : "Unable to inspect artifact", true);
    throw error;
  }
}
function renderArtifactReviews(): void {
  const findings = currentArtifactReviews.flatMap((review) => (review.report?.findings ?? []).map((finding) => ({ ...finding, role: review.role })));
  const container = document.querySelector<HTMLElement>("#artifact-reviews")!;
  if (!currentArtifactReviews.length) { container.innerHTML = "<p class='compact-empty'>No LLM pre-review report yet.</p>"; return; }
  const roleSummary = currentArtifactReviews.map((review) => `<span class="role-verdict ${escapeHtml(review.verdict)}">${escapeHtml(review.role.replaceAll("_", " "))} · ${escapeHtml(review.verdict)}</span>`).join("");
  if (!findings.length) { container.innerHTML = `<div class="role-verdicts">${roleSummary}</div><p class='compact-empty'>No findings were returned.</p>`; return; }
  const totalPages = Math.max(1, Math.ceil(findings.length / ARTIFACT_REVIEW_PAGE_SIZE));
  artifactReviewPage = Math.min(artifactReviewPage, totalPages - 1);
  const page = findings.slice(artifactReviewPage * ARTIFACT_REVIEW_PAGE_SIZE, (artifactReviewPage + 1) * ARTIFACT_REVIEW_PAGE_SIZE);
  const severity = (value: string): string => {
    const normalized = value.toLowerCase();
    if (["critical", "blocker", "fatal"].includes(normalized)) return "critical";
    if (["major", "high", "error"].includes(normalized)) return "major";
    if (["minor", "warning", "medium"].includes(normalized)) return "minor";
    return "info";
  };
  const cards = page.map((finding) => `<article class="finding-card severity-${severity(finding.severity)}"><div class="finding-head"><span class="severity-chip">${escapeHtml(finding.severity)}</span><b>${escapeHtml(finding.rule_id)}</b><small>${escapeHtml(finding.role.replaceAll("_", " "))} · ${escapeHtml(finding.path)}</small></div><p>${escapeHtml(finding.problem)}</p><small class="finding-evidence">${escapeHtml(finding.evidence)}</small>${finding.suggested_change ? `<small class="finding-suggestion">Suggestion: ${escapeHtml(finding.suggested_change)}</small>` : ""}</article>`).join("");
  const start = artifactReviewPage * ARTIFACT_REVIEW_PAGE_SIZE + 1;
  const end = Math.min((artifactReviewPage + 1) * ARTIFACT_REVIEW_PAGE_SIZE, findings.length);
  const pagesHtml = pageNumberItems(artifactReviewPage, totalPages).map((item) => item === "…"
    ? `<span class="page-ellipsis" aria-hidden="true">…</span>`
    : `<button class="page-button page-number ${item === artifactReviewPage + 1 ? "active" : ""}" type="button" data-review-page-number data-review-page-value="${item}" aria-label="Page ${item}" ${item === artifactReviewPage + 1 ? 'aria-current="page"' : ""}>${item}</button>`).join("");
  const controls = totalPages > 1 ? `<div class="list-pagination finding-pagination"><span class="pagination-info">${start}–${end} of ${findings.length}</span><span class="pagination-controls"><button class="page-button" type="button" data-review-page-prev aria-label="Previous page" ${artifactReviewPage === 0 ? "disabled" : ""}>&#8249;</button>${pagesHtml}<button class="page-button" type="button" data-review-page-next aria-label="Next page" ${artifactReviewPage >= totalPages - 1 ? "disabled" : ""}>&#8250;</button></span></div>` : "";
  container.innerHTML = `<div class="role-verdicts">${roleSummary}</div><div class="finding-grid">${cards}</div>${controls}`;
}
document.querySelector<HTMLButtonElement>("#close-artifact")!.addEventListener("click", () => { artifactInspector.hidden = true; });
document.querySelector<HTMLButtonElement>("#workflow-revise")!.addEventListener("click", () => {
  if (editingDraftId) void inspectArtifact(editingDraftId).catch((error) => { artifactMessage(error instanceof Error ? error.message : "Unable to inspect artifact", true); });
});
document.querySelector<HTMLButtonElement>("#save-artifact")!.addEventListener("click", async () => {
  const id = artifactInspector.dataset.draftId;
  if (!id) return;
  if (!lockAction("artifact-save", id)) return;
  const files: Record<string, string> = { "unit.json": document.querySelector<HTMLTextAreaElement>("#artifact-manifest")!.value };
  document.querySelectorAll<HTMLTextAreaElement>("[data-artifact-file]").forEach((field) => { if (field.dataset.artifactFile) files[field.dataset.artifactFile] = field.value; });
  try {
    const response = await fetch(`/api/drafts/${id}/artifact`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ files }) });
    const payload = await response.json() as { error?: string; errors?: string[] };
    if (!response.ok) throw new Error(payload.error ?? payload.errors?.join("; ") ?? "Artifact revision failed");
    notify("Revision saved and contract validated. Approve it directly or run LLM pre-review again.");
    await syncFromApi();
    await inspectArtifact(id);
  } catch (error) { notify(error instanceof Error ? error.message : "Artifact revision failed", true); }
  finally { unlockAction("artifact-save", id); }
});

function showView(view: string): void {
  renderDrafts();
  renderHistory();
  document.querySelectorAll<HTMLElement>(".app-view").forEach((panel) => { panel.hidden = panel.id !== `${view}-view`; });
  document.querySelectorAll<HTMLButtonElement>(".nav-item").forEach((button) => button.classList.toggle("active", button.dataset.view === view));
  window.scrollTo({ top: 0, behavior: "smooth" });
}
function renderDraftsView(): void {
  // Refresh the Drafts view in place after an action: keep the current page and
  // scroll position so the row the user acted on stays put.
  renderDrafts();
  renderHistory();
}

document.addEventListener("click", (event) => {
  const target = event.target as HTMLElement;
  if (target.closest<HTMLElement>("#artifact-inspector")) {
    const reviewPrev = target.closest<HTMLButtonElement>("[data-review-page-prev]");
    const reviewNext = target.closest<HTMLButtonElement>("[data-review-page-next]");
    const reviewNumber = target.closest<HTMLButtonElement>("[data-review-page-number]");
    const reviewTotal = Math.max(1, Math.ceil(currentArtifactReviews.flatMap((review) => review.report?.findings ?? []).length / ARTIFACT_REVIEW_PAGE_SIZE));
    if (reviewNumber) artifactReviewPage = Math.min(reviewTotal - 1, Math.max(0, Number(reviewNumber.dataset.reviewPageValue ?? 1) - 1));
    else if (reviewPrev && artifactReviewPage > 0) artifactReviewPage -= 1;
    else if (reviewNext && artifactReviewPage < reviewTotal - 1) artifactReviewPage += 1;
    if (reviewPrev || reviewNext || reviewNumber) renderArtifactReviews();
    event.stopPropagation();
    return;
  }
  const draftFilterButton = target.closest<HTMLButtonElement>("[data-draft-filter]");
  if (draftFilterButton) {
    event.stopPropagation();
    draftFilter = draftFilterButton.dataset.draftFilter as DraftFilter;
    draftPage = 0;
    renderDrafts();
    return;
  }
  const historyFilterButton = target.closest<HTMLButtonElement>("[data-history-filter]");
  if (historyFilterButton) {
    event.stopPropagation();
    historyFilter = historyFilterButton.dataset.historyFilter as HistoryFilter;
    historyPage = 0;
    renderHistory();
    return;
  }
  const paginationControl = target.closest<HTMLElement>("[data-page-prev], [data-page-next], [data-page-number]");
  if (paginationControl) {
    event.stopPropagation();
    const kind = (paginationControl.dataset.pagePrev ?? paginationControl.dataset.pageNext ?? paginationControl.dataset.pageNumber) as PaginationKind;
    const current = paginationKindPage(kind);
    let next = current;
    if (paginationControl.dataset.pagePrev !== undefined) next = current - 1;
    else if (paginationControl.dataset.pageNext !== undefined) next = current + 1;
    else next = Number(paginationControl.dataset.pageValue ?? current + 1) - 1;
    setPaginationKindPage(kind, next);
    renderPaginationKind(kind);
    return;
  }
  const navigation = target.closest<HTMLButtonElement>(".nav-item, [data-go]");
  if (navigation) {
    const view = navigation.dataset.view ?? navigation.dataset.go ?? "new";
    showView(view);
    if (view === "practice") void refreshPracticeData();
  }
  const viewArtifact = target.closest<HTMLButtonElement>("[data-view-artifact-id]");
  if (viewArtifact) {
    event.stopPropagation();
    void inspectArtifact(viewArtifact.dataset.viewArtifactId!).catch((error) => { notify(error instanceof Error ? error.message : "Unable to inspect artifact", true); });
    return;
  }
  const generateButton = target.closest<HTMLButtonElement>("[data-generate-id]");
  if (generateButton) {
    event.stopPropagation();
    const id = generateButton.dataset.generateId;
    if (!lockAction("generate", id)) return;
    void fetch(`/api/drafts/${id}/generate`, { method: "POST" }).then(async (response) => {
      const payload = await response.json() as { error?: string; status?: string };
      notify(response.ok ? "Template generated. Run Validate contract next." : `Generation failed: ${payload.error ?? "unknown error"}`, !response.ok);
      if (response.ok) { await syncFromApi(); renderDraftsView(); }
    }).catch((error) => { notify(error instanceof Error ? `LLM pre-review failed: ${error.message}` : "Authoring API is unavailable.", true); }).finally(() => unlockAction("generate", id));
    return;
  }
  const validateButton = target.closest<HTMLButtonElement>("[data-validate-id]");
  if (validateButton) {
    event.stopPropagation();
    const id = validateButton.dataset.validateId;
    if (!lockAction("validate", id)) return;
    void fetch(`/api/drafts/${id}/validate`, { method: "POST" }).then(async (response) => {
      const payload = await response.json() as { status?: string; errors?: string[] };
      notify(response.ok ? "Rust contract validation passed. Run LLM pre-review next." : `Validation failed: ${(payload.errors ?? ["unknown error"]).join("; ")}`, !response.ok);
      if (response.ok) { await syncFromApi(); renderDraftsView(); }
    }).catch(() => { notify("Authoring API is unavailable.", true); }).finally(() => unlockAction("validate", id));
    return;
  }
  const reviewButton = target.closest<HTMLButtonElement>("[data-review-id]");
  if (reviewButton) {
    event.stopPropagation();
    const id = reviewButton.dataset.reviewId;
    if (!lockAction("review", id)) return;
    reviewButton.disabled = true;
    const originalLabel = reviewButton.textContent ?? "LLM pre-review";
    reviewButton.textContent = "Running 3 role reviews…";
    void (async () => {
      const roles = ["algorithm_correctness", "learning_design", "provenance_safety"];
      let allPassed = true;
      for (const role of roles) {
        const response = await fetch(`/api/drafts/${id}/reviews`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ role }) });
        if (!response.ok) { const payload = await response.json() as { error?: string }; throw new Error(`${role}: ${payload.error ?? "review failed"}`); }
        const payload = await response.json() as { review?: { verdict?: string } };
        if (payload.review?.verdict !== "pass") allPassed = false;
      }
      await syncFromApi();
      const reviewed = readDrafts().find((draft) => draft.id === id);
      notify(allPassed
        ? "All LLM pre-reviews passed. Inspect feedback, then Human approve."
        : reviewed?.status === "needs_revision"
          ? "LLM pre-review found revision items. Inspect the feedback, revise or approve with rationale."
          : "LLM pre-review completed. Inspect the feedback before approving.");
      await inspectArtifact(id!); renderDraftsView();
    })().catch((error) => { notify(error instanceof Error ? `LLM pre-review failed: ${error.message}` : "Authoring API is unavailable.", true); }).finally(() => unlockAction("review", id));
    reviewButton.disabled = false;
    reviewButton.textContent = originalLabel;
    return;
  }
  const acceptButton = target.closest<HTMLButtonElement>("[data-accept-id]");
  if (acceptButton) {
    event.stopPropagation();
    const id = acceptButton.dataset.acceptId;
    if (!lockAction("accept", id)) return;
    const draft = readDrafts().find((item) => item.id === id);
    const needsOverride = draft?.status === "needs_revision";
    const rationale = needsOverride ? window.prompt("This draft still has LLM review findings. Confirm you reviewed them and enter the reason for approving:") : null;
    if (needsOverride && rationale === null) return;
    const body = needsOverride ? JSON.stringify({ override: true, rationale: rationale ?? "human review" }) : undefined;
    void fetch(`/api/drafts/${id}/accept`, { method: "POST", headers: body ? { "content-type": "application/json" } : undefined, body }).then(async (response) => {
      const payload = await response.json() as { error?: string };
      notify(response.ok ? "Human approval recorded; draft is accepted." : `Human approval failed: ${payload.error ?? "unknown error"}`, !response.ok);
      if (response.ok) { await syncFromApi(); renderDraftsView(); }
    }).catch(() => { notify("Authoring API is unavailable.", true); }).finally(() => unlockAction("accept", id));
    return;
  }
  const rollbackButton = target.closest<HTMLButtonElement>("[data-rollback-id]");
  if (rollbackButton) {
    event.stopPropagation();
    const id = rollbackButton.dataset.rollbackId;
    if (!lockAction("rollback", id)) return;
    void fetch(`/api/drafts/${id}/rollback`, { method: "POST" }).then(async (response) => {
      const payload = await response.json() as { error?: string };
      notify(response.ok ? "Revision requested. The previous artifact remains in history." : `Revision request failed: ${payload.error ?? "unknown error"}`, !response.ok);
      if (response.ok) { await syncFromApi(); renderDraftsView(); }
    }).catch(() => { notify("Authoring API is unavailable.", true); }).finally(() => unlockAction("rollback", id));
    return;
  }
  const forkButton = target.closest<HTMLButtonElement>("[data-fork-id]");
  if (forkButton) {
    event.stopPropagation();
    const id = forkButton.dataset.forkId;
    if (!lockAction("fork", id)) return;
    void fetch(`/api/drafts/${id}/fork`, { method: "POST" }).then(async (response) => {
      const payload = await response.json() as { draft?: DraftRecord; error?: string };
      if (!response.ok || !payload.draft) throw new Error(payload.error ?? "fork failed");
      await syncFromApi();
      loadDraftIntoForm(payload.draft);
      notify("Extend unit: a new editable draft was created. Adjust the modes, then Generate template.");
      showView("new");
    }).catch((error) => { notify(error instanceof Error ? `Fork failed: ${error.message}` : "Authoring API is unavailable.", true); }).finally(() => unlockAction("fork", id));
    return;
  }
  const deleteButton = target.closest<HTMLButtonElement>("[data-delete-id]");
  if (deleteButton) {
    event.stopPropagation();
    const id = deleteButton.dataset.deleteId;
    if (!lockAction("delete", id)) return;
    void (async () => {
      const confirmed = await openConfirm("Delete draft?", "Its artifact and review reports will be removed. Accepted drafts cannot be deleted.", "Delete");
      if (!confirmed) { unlockAction("delete", id); return; }
      try {
        const response = await fetch(`/api/drafts/${id}`, { method: "DELETE" });
        const payload = await response.json() as { error?: string };
        if (!response.ok) throw new Error(payload.error ?? "delete failed");
        notify("Draft deleted.");
        if (editingDraftId === id) {
          editingDraftId = undefined;
          submitDraft.innerHTML = `Create draft <span aria-hidden="true">&#8594;</span>`;
        }
        if (artifactInspector.dataset.draftId === id) {
          artifactInspector.hidden = true;
          artifactInspector.dataset.draftId = "";
        }
        await syncFromApi();
        renderDraftsView();
      } catch (error) {
        notify(error instanceof Error ? `Delete failed: ${error.message}` : "Authoring API is unavailable.", true);
      }
    })().finally(() => unlockAction("delete", id));
    return;
  }
  const draftButton = target.closest<HTMLButtonElement>("[data-edit-id]") ?? target.closest<HTMLButtonElement>("[data-draft-id]");
  if (draftButton) {
    const draft = readDrafts().find((item) => item.id === (draftButton.dataset.editId ?? draftButton.dataset.draftId));
    if (draft) {
      loadDraftIntoForm(draft);
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
  const variants = Math.min(5, Math.max(1, Number(document.querySelector<HTMLInputElement>("#variants")?.value ?? "1") || 1));
  profileState.textContent = selectedModes.length > 0 && language.length > 0 && variants > 0 ? "Ready" : "Needs input";
  profileState.className = `valid-badge ${profileState.textContent === "Ready" ? "" : "warning"}`;
  profileSummary.innerHTML = `<div class="summary-block"><span>Modes</span><div class="tag-list">${selectedModes.length ? selectedModes.map((mode) => `<span class="tag">${mode.replaceAll("_", " ")}</span>`).join("") : "<em>None selected</em>"}</div></div><div class="summary-block"><span>Assistance</span><div class="tag-list">${selectedAssistance.length ? selectedAssistance.map((item) => `<span class="tag muted">${item}</span>`).join("") : "<em>No hints selected</em>"}</div><small class="profile-note">${codeRecall ? "Applied to code recall." : "Configured, but inactive until code recall is selected."}</small></div><div class="summary-meta"><span>${language.join(", ")}</span><span>${variants} variant${variants > 1 ? "s" : ""}</span></div>`;
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
    notify("Select at least one practice projection.", true);
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
    variants: Math.min(5, Math.max(1, Number(document.querySelector<HTMLInputElement>("#variants")?.value ?? "1") || 1)),
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
  notify(persisted ? (wasEditing ? "Draft revision saved to the local authoring API." : "Draft saved to the local authoring API.") : "Draft queued in this browser. Start the authoring API to share it locally.");
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
  if (practiceStarting) return;
  practiceStarting = true;
  try {
    const practiceOption = document.querySelector<HTMLSelectElement>("#practice-id")!;
    const selectedOption = practiceOption.value || undefined;
    const unitId = document.querySelector<HTMLSelectElement>("#practice-unit")!.value;
    const mode = document.querySelector<HTMLSelectElement>("#practice-mode")!.value as PracticeMode;
    const revision = practiceUnits.find((unit) => unit.id === unitId)?.revision;
    const defaultOption = practiceUnits.find((unit) => unit.id === unitId)?.practice_options.find((option) => option.mode === mode);
    const expectedImplementation = practiceOption.dataset.selector === "implementation" ? selectedOption ?? defaultOption?.id : undefined;
    const expectedPracticeId = practiceOption.dataset.selector === "practice_id" ? selectedOption : undefined;
    if (activePracticeSession?.mode === "shadow_typing" || activePracticeSession?.mode === "code_recall") await shadowEditor?.flush();
    if (activePracticeSession && activePracticeSnapshot?.status === "active") {
      const sameSelection = activePracticeSnapshot.unit_id === unitId
        && activePracticeSnapshot.revision === revision
        && activePracticeSnapshot.mode === mode
        && (expectedImplementation === undefined || activePracticeSnapshot.implementation === expectedImplementation)
        && (expectedPracticeId === undefined || activePracticeSnapshot.practice_id === expectedPracticeId);
      if (sameSelection) {
        setPracticeFocus(true);
        practiceMessage("Practice resumed.");
        await refreshPracticeData();
        return;
      }
      await practiceRpc("gewu/stopSession", { session_id: activePracticeSession.session_id, elapsed: { active_ms: 1000, wall_ms: 1000 } });
    }
    activePracticeSession = undefined;
    flowPromptRevealed = false;
    codePromptRevealed = false;
    promptRevealedModes.clear();
    const matching = checkpointItems.find((checkpoint) => checkpoint.unit_id === unitId && checkpoint.revision === revision && checkpoint.mode === mode && (expectedImplementation === undefined || checkpoint.implementation === expectedImplementation) && (expectedPracticeId === undefined || checkpoint.practice_id === expectedPracticeId));
    if (matching) {
      const resumed = await practiceRpc<{ session: PracticeSession | null }>("gewu/resumeCheckpoint", { checkpoint_id: matching.id });
      if (!resumed.session) throw new Error("The interrupted practice is no longer available");
      activePracticeSession = { session_id: resumed.session.session_id, mode: resumed.session.mode };
      renderPracticeSession(resumed.session);
      setPracticeFocus(true);
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
    setPracticeFocus(true);
    practiceMessage("Practice started.");
    await refreshPracticeData();
  } catch (error) { practiceMessage(error instanceof Error ? error.message : "Unable to start practice", true); }
  finally { practiceStarting = false; }
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
    const result = await practiceRpc<{ session: PracticeSession }>("gewu/restartSession", { session_id: activePracticeSession.session_id });
    flowPromptRevealed = false;
    codePromptRevealed = false;
    promptRevealedModes.clear();
    activePracticeSession = { session_id: result.session.session_id, mode: result.session.mode };
    renderPracticeSession(result.session);
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
  const sessionId = activePracticeSession.session_id;
  if (!lockAction("stop", sessionId)) return;
  try {
    if (activePracticeSession.mode === "shadow_typing" || activePracticeSession.mode === "code_recall") await shadowEditor?.flush();
    const result = await practiceRpc<{ session: PracticeSession }>("gewu/stopSession", { session_id: activePracticeSession.session_id, elapsed: { active_ms: 1000, wall_ms: 1000 } });
    renderPracticeSession(result.session);
    activePracticeSession = undefined;
    setPracticeFocus(false);
    await refreshPracticeData();
  } catch (error) { practiceMessage(error instanceof Error ? error.message : "Unable to stop practice", true); }
  finally { unlockAction("stop", sessionId); }
});
document.querySelector<HTMLButtonElement>("#practice-back")!.addEventListener("click", () => setPracticeFocus(false));
document.querySelector<HTMLButtonElement>("#refresh-checkpoints")!.addEventListener("click", () => { void refreshPracticeData(); });
const splitDivider = document.querySelector<HTMLElement>("#split-divider");
if (splitDivider) {
  let splitDragging = false;
  const applySplit = (clientX: number): void => {
    const layout = document.querySelector<HTMLElement>(".practice-layout");
    if (!layout) return;
    const rect = layout.getBoundingClientRect();
    const ratio = Math.min(0.6, Math.max(0.25, (clientX - rect.left) / rect.width));
    layout.style.gridTemplateColumns = `${ratio}fr 8px ${1 - ratio}fr`;
  };
  splitDivider.addEventListener("pointerdown", (event) => {
    splitDragging = true;
    splitDivider.setPointerCapture(event.pointerId);
    splitDivider.classList.add("dragging");
    event.preventDefault();
  });
  splitDivider.addEventListener("pointermove", (event) => { if (splitDragging) applySplit(event.clientX); });
  const stopDrag = (event: PointerEvent): void => {
    if (!splitDragging) return;
    splitDragging = false;
    splitDivider.classList.remove("dragging");
    applySplit(event.clientX);
  };
  splitDivider.addEventListener("pointerup", stopDrag);
  splitDivider.addEventListener("pointercancel", stopDrag);
}
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
      if (result.session) { flowPromptRevealed = false; codePromptRevealed = false; promptRevealedModes.clear(); activePracticeSession = { session_id: result.session.session_id, mode: result.session.mode }; renderPracticeSession(result.session); setPracticeFocus(true); }
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
