/**
 * Publication helpers shared by the workbench API. Kept side-effect free so
 * they can be unit tested without starting the authoring server.
 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Keeps only supersedes entries that reference an earlier revision of the same
 * unit. A first revision (or a model claiming to supersede itself) can never
 * produce an invalid "supersedes itself" published artifact. Returns
 * `undefined` when no valid entry remains, mirroring "remove the field".
 */
export function normalizeSupersedes(value: unknown, nextRevision: number): unknown {
  if (!Array.isArray(value)) return value;
  const valid = value.filter(
    (entry) =>
      isRecord(entry) &&
      Number.isInteger(entry.revision) &&
      Number(entry.revision) > 0 &&
      Number(entry.revision) < nextRevision,
  );
  return valid.length === 0 ? undefined : valid;
}

/**
 * Unit identity includes the implementation language: python and Java
 * templates of the same problem are separate units (`array.two-sum.python`
 * vs `array.two-sum.java`). When the base id is missing or invalid, falls
 * back to `unit.<language>`.
 */
export function qualifyUnitId(baseId: string | undefined, language: string): string {
  const validBase = typeof baseId === "string" && /^[a-z0-9]+(?:[-.][a-z0-9]+)+$/.test(baseId) ? baseId : "unit";
  const lang = /^[a-z0-9]+$/.test(language) ? language : "python";
  return validBase.endsWith(`.${lang}`) ? validBase : `${validBase}.${lang}`;
}

const LANGUAGE_EXTENSIONS: Record<string, string> = {
  python: "py",
  java: "java",
  javascript: "js",
  typescript: "ts",
  go: "go",
  cpp: "cpp",
  rust: "rs",
};

export function languageExtension(language: string): string {
  return LANGUAGE_EXTENSIONS[language] ?? language;
}

export function sourcePathFor(language: string): string {
  return `code/${language}.${languageExtension(language)}`;
}

export function testPathFor(language: string): string {
  return `tests/${language}_test.${languageExtension(language)}`;
}

export interface ReviewSummaryEntry {
  role: string;
  verdict: string;
  rationale?: string;
  at?: string;
}

/** Distills an audit summary for a published unit so the content pack keeps
 * the LLM/human review feedback: the final acceptance (llm_acceptance /
 * human_acceptance pass) and the needs_revision/reject history that led to
 * it. A fresh clone can then review why the unit was approved. */
export function buildReviewSummary(reviews: ReviewSummaryEntry[]): { acceptance?: ReviewSummaryEntry; history: ReviewSummaryEntry[] } {
  const acceptance = [...reviews]
    .reverse()
    .find((review) => (review.role === "llm_acceptance" || review.role === "human_acceptance") && review.verdict === "pass");
  const history = reviews.filter((review) => review.verdict === "needs_revision" || review.verdict === "reject");
  return { acceptance, history };
}
