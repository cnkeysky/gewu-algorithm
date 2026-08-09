/**
 * Content lifecycle of an artifact manifest, separate from the draft
 * workflow state machine (draft-lifecycle.ts).
 *
 * The manifest's `status` and `validation.*` fields must advance together
 * with real checks — the recurring bugs came from stamping being best-effort
 * and optional. Every transition here declares the stamps it REQUIRES, and
 * the API applies them through this module (fail-hard) and refuses to
 * publish until the invariant `status == "validated"` and all four
 * validation stages are `"passed"` hold.
 */

export type ManifestStatus = "draft" | "reviewed" | "validated";
export type ValidationStage = "pending" | "passed";

export interface ManifestValidation {
  schema: ValidationStage;
  code: ValidationStage;
  content_review: ValidationStage;
  transfer_review: ValidationStage;
  last_validated_at: string | null;
}

export type ContentTransitionId =
  | "deterministic_validation" // Rust contract validation passed (schema + code)
  | "acceptance_gate_pass"     // decisive LLM acceptance gate (content + transfer)
  | "publish";                 // final guard before the artifact is served

/** The stamps each content transition must apply. The API must call the
 * matching transition; a unit test pins that every workflow state that can
 * be published has its required stamps defined here. */
export const CONTENT_TRANSITIONS: Record<ContentTransitionId, { status?: ManifestStatus; validation?: Partial<ManifestValidation> }> = {
  deterministic_validation: { validation: { schema: "passed", code: "passed" } },
  // The Rust ContentStatus chain is strict (draft → reviewed → validated):
  // the gate/human accept is the content review, so it advances to
  // "reviewed"; publish finalizes to "validated".
  acceptance_gate_pass: { status: "reviewed", validation: { content_review: "passed", transfer_review: "passed" } },
  publish: { status: "validated" },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Applies a content transition to a manifest, returning a new manifest.
 * Throws on a non-object manifest (fail-hard: a transition can never
 * silently skip its stamps). */
export function applyContentTransition(manifest: unknown, transition: ContentTransitionId, now = new Date().toISOString()): Record<string, unknown> {
  if (!isRecord(manifest)) throw new Error("manifest must be an object to stamp content state");
  const spec = CONTENT_TRANSITIONS[transition];
  const validation = isRecord(manifest.validation) ? { ...manifest.validation } : {};
  for (const [key, value] of Object.entries(spec.validation ?? {})) validation[key] = value;
  validation.last_validated_at = now;
  return { ...manifest, validation, ...(spec.status ? { status: spec.status } : {}) };
}

/** Structural guard: an artifact may only be published when its content
 * lifecycle is complete. Throws otherwise, so publishing can never produce a
 * manifest that claims draft/pending. */
export function assertPublishable(manifest: unknown): void {
  if (!isRecord(manifest)) throw new Error("cannot publish: manifest must be an object");
  if (manifest.status !== "validated") {
    throw new Error(`cannot publish: manifest status is ${String(manifest.status ?? "missing")}, expected validated`);
  }
  const validation = isRecord(manifest.validation) ? manifest.validation : {};
  for (const key of ["schema", "code", "content_review", "transfer_review"] as const) {
    if (validation[key] !== "passed") {
      throw new Error(`cannot publish: validation.${key} is ${String(validation[key] ?? "missing")}, expected passed`);
    }
  }
}
