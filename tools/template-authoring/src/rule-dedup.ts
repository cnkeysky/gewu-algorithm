import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export type Rule = { id: string; description: string };
export type RuleProposal = { id: string; description: string; scope?: string; severity?: string };
export type RuleDecision =
  | { action: "duplicate"; duplicateOf: string; similarity: number; fingerprint: string }
  | { action: "needs_review"; similarity: number; fingerprint: string };

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(/\s+/).sort().join(" ");
}

function fingerprint(proposal: RuleProposal): string {
  const canonical = [proposal.scope ?? "", proposal.severity ?? "", normalize(proposal.description)].join("|");
  return `sha256:${createHash("sha256").update(canonical).digest("hex")}`;
}

function tokens(value: string): Set<string> { return new Set(normalize(value).split(" ").filter(Boolean)); }

function similarity(left: string, right: string): number {
  const a = tokens(left); const b = tokens(right);
  const intersection = [...a].filter((token) => b.has(token)).length;
  const union = new Set([...a, ...b]).size;
  return union === 0 ? 1 : intersection / union;
}

export function deduplicateRule(proposal: RuleProposal, existing: readonly Rule[]): RuleDecision {
  const proposalFingerprint = fingerprint(proposal);
  let best: { id: string; score: number } | undefined;
  for (const rule of existing) {
    const score = similarity(proposal.description, rule.description);
    if (!best || score > best.score) best = { id: rule.id, score };
    if (normalize(proposal.description) === normalize(rule.description)) return { action: "duplicate", duplicateOf: rule.id, similarity: 1, fingerprint: proposalFingerprint };
  }
  if (best && best.score >= 0.72) return { action: "duplicate", duplicateOf: best.id, similarity: best.score, fingerprint: proposalFingerprint };
  return { action: "needs_review", similarity: best?.score ?? 0, fingerprint: proposalFingerprint };
}

export async function loadReviewRules(): Promise<Rule[]> {
  const here = dirname(fileURLToPath(import.meta.url));
  const document = JSON.parse(await readFile(join(here, "../rules/algorithm-template-review.v2.json"), "utf8")) as { rules?: Rule[] };
  if (!Array.isArray(document.rules)) throw new Error("review rubric has no rules");
  return document.rules;
}

const [id, description] = process.argv.slice(2);
if (process.argv[1] && process.argv[1].endsWith("rule-dedup.js")) {
  if (!id || !description) {
    console.error("usage: rule-dedup <rule-id> <description>");
    process.exitCode = 2;
  } else {
    loadReviewRules().then((rules) => console.log(JSON.stringify(deduplicateRule({ id, description }, rules)))).catch((error: unknown) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
  }
}
