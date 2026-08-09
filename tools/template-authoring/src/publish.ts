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
