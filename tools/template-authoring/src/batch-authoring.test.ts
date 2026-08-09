import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { coverageKey, defaultApproverSpec, draftKey, loadProblems, parseOptions, problemKey, reconcileResults, resolveLanguage, selectProblems } from "./batch-authoring.js";

test("parseOptions applies defaults and overrides", () => {
  const defaults = parseOptions(["--problems", "hot100.json"]);
  assert.equal(defaults.problemsFile, "hot100.json");
  assert.equal(defaults.api, "http://127.0.0.1:4174");
  assert.deepEqual([...defaults.steps], ["draft", "generate", "validate", "review", "accept"]);
  assert.equal(defaults.concurrency, 1);
  assert.equal(defaults.force, false);
  assert.equal(defaults.yes, false);
  assert.deepEqual(defaults.select, []);
  assert.equal(defaults.repairRounds, 1);
  assert.equal(defaults.autoAccept, false);
  assert.equal(defaults.language, "python");
  assert.equal(defaults.languageProvided, false);
  assert.equal(defaults.variants, 0);
  assert.equal(defaults.llmApprove, undefined);
  assert.deepEqual(defaults.creatorModels, []);
  assert.deepEqual(defaults.modes, ["shadow_typing", "flow_recall", "code_recall", "reasoning_recall", "transfer_practice"]);
  assert.deepEqual(defaults.assistance, ["comments", "cloze"]);
  assert.equal(defaults.requestDelayMs, 0);

  const custom = parseOptions([
    "--problems", "hot100.json", "--api", "http://127.0.0.1:9999/",
    "--steps", "generate,review", "--concurrency", "4", "--resume",
    "--force", "--yes", "--select", "two-sum,3sum", "--repair-rounds", "2", "--auto-accept", "--language", "java",
    "--request-delay-ms", "2000",
    "--variants", "2", "--llm-approve", "openai:gpt-4.1", "--creator-models", "deepseek:deepseek-v4-flash,openai:gpt-4.1", "--modes", "shadow_typing,code_recall", "--assistance", "comments",
  ]);
  assert.equal(custom.api, "http://127.0.0.1:9999");
  assert.deepEqual([...custom.steps], ["generate", "review"]);
  assert.equal(custom.concurrency, 4);
  assert.equal(custom.resume, true);
  assert.equal(custom.force, true);
  assert.equal(custom.yes, true);
  assert.deepEqual(custom.select, ["two-sum", "3sum"]);
  assert.equal(custom.repairRounds, 2);
  assert.equal(custom.autoAccept, true);
  assert.equal(custom.language, "java");
  assert.equal(custom.languageProvided, true);
  assert.equal(custom.llmApprove, "openai:gpt-4.1");
  assert.deepEqual(custom.creatorModels, ["deepseek:deepseek-v4-flash", "openai:gpt-4.1"]);
  assert.equal(custom.variants, 2);
  assert.deepEqual(custom.modes, ["shadow_typing", "code_recall"]);
  assert.deepEqual(custom.assistance, ["comments"]);
  assert.equal(custom.requestDelayMs, 2000);
});

test("loadProblems parses JSON arrays and TSV", async () => {
  const directory = await mkdtemp(join(tmpdir(), "gewu-batch-"));
  try {
    const jsonPath = join(directory, "problems.json");
    await writeFile(jsonPath, JSON.stringify([
      { id: "1", slug: "two-sum", title: "Two Sum", problem: "Given nums and target...", sourceUrl: "https://leetcode.com/problems/two-sum/", language: "python", provider: "openai", model: "gpt-4.1" },
      { id: "20", slug: "valid-parentheses", title: "Valid Parentheses", problem: "Given a string s..." },
    ]), "utf8");
    const jsonProblems = await loadProblems(jsonPath);
    assert.equal(jsonProblems.length, 2);
    assert.equal(jsonProblems[0].title, "Two Sum");
    assert.equal(jsonProblems[0].sourceUrl, "https://leetcode.com/problems/two-sum/");
    assert.equal(jsonProblems[0].language, "python");
    assert.equal(jsonProblems[0].slug, "two-sum");
    assert.equal(jsonProblems[0].provider, "openai");
    assert.equal(jsonProblems[0].model, "gpt-4.1");
    assert.equal(jsonProblems[1].language, undefined);

    const tsvPath = join(directory, "problems.tsv");
    await writeFile(tsvPath, "Two Sum\tGiven nums and target...\thttps://leetcode.com/problems/two-sum/\nValid Parentheses\tGiven a string s...\n", "utf8");
    const tsvProblems = await loadProblems(tsvPath);
    assert.equal(tsvProblems.length, 2);
    assert.equal(tsvProblems[0].title, "Two Sum");
    assert.equal(tsvProblems[0].sourceUrl, "https://leetcode.com/problems/two-sum/");
    assert.equal(tsvProblems[1].sourceUrl, undefined);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("selectProblems filters by id, slug, or title", () => {
  const problems = [
    { id: "1", slug: "two-sum", title: "Two Sum", problem: "a" },
    { id: "15", slug: "3sum", title: "3Sum", problem: "b" },
    { id: "20", slug: "valid-parentheses", title: "Valid Parentheses", problem: "c" },
  ];
  assert.equal(selectProblems(problems, []).length, 3);
  assert.deepEqual(selectProblems(problems, ["1"]).map((item) => item.slug), ["two-sum"]);
  assert.deepEqual(selectProblems(problems, ["3sum"]).map((item) => item.slug), ["3sum"]);
  assert.deepEqual(selectProblems(problems, ["valid parentheses"]).map((item) => item.slug), ["valid-parentheses"]);
  assert.deepEqual(selectProblems(problems, ["two-sum", "valid"]).map((item) => item.slug), ["two-sum", "valid-parentheses"]);
  assert.deepEqual(selectProblems(problems, ["missing"]), []);
});

test("coverageKey separates problems by language", () => {
  const statement = "Given nums and target, return indices.";
  assert.equal(coverageKey(statement, "python"), coverageKey(statement, "python"));
  assert.notEqual(coverageKey(statement, "python"), coverageKey(statement, "java"));
  assert.notEqual(coverageKey("a", "python"), coverageKey("b", "python"));
});

test("resolveLanguage decouples per-entry language from the global override", () => {
  const pythonEntry = { title: "Two Sum", problem: "x", language: "python" };
  const javaEntry = { title: "Two Sum", problem: "x", language: "java" };
  const noEntry = { title: "Two Sum", problem: "x" };
  const defaults = { language: "python", languageProvided: false };
  const javaOverride = { language: "java", languageProvided: true };

  assert.equal(resolveLanguage(defaults, pythonEntry), "python");
  assert.equal(resolveLanguage(defaults, javaEntry), "java");
  assert.equal(resolveLanguage(defaults, noEntry), "python");
  assert.equal(resolveLanguage(javaOverride, pythonEntry), "java");
  assert.equal(resolveLanguage(javaOverride, javaEntry), "java");
  assert.equal(resolveLanguage(javaOverride, noEntry), "java");
});

test("parseOptions defaults to all five practice modes and empty regenerate list", () => {
  const defaults = parseOptions(["--problems", "hot100.json"]);
  assert.deepEqual(defaults.modes, ["shadow_typing", "flow_recall", "code_recall", "reasoning_recall", "transfer_practice"]);
  assert.deepEqual(defaults.regenerate, []);
  assert.equal(defaults.timeoutMinutes, 60);
});

test("default approver follows env provider/model, then flags, then built-in", () => {
  assert.equal(defaultApproverSpec({}, { GEWU_LLM_PROVIDER: "relay", GEWU_LLM_MODEL: "deepseek-v4-flash" }), "relay:deepseek-v4-flash");
  assert.equal(defaultApproverSpec({ provider: "moonshotai", model: "kimi-k2" }, {}), "moonshotai:kimi-k2");
  assert.equal(defaultApproverSpec({}, {}), "deepseek:deepseek-v4-flash");
});

test("problemKey normalizes slugs and falls back for invalid ones", () => {
  assert.equal(problemKey({ title: "T", slug: "Two-Sum", problem: "P" }, "python"), coverageKey("two-sum", "python"));
  const fallback = problemKey({ title: "T", slug: "two sum", problem: "P" }, "python");
  assert.notEqual(fallback, coverageKey("P", "python"));
  assert.equal(problemKey({ title: "T", id: "1", problem: "P" }, "python"), coverageKey("lc-1", "python"));
  const plain = problemKey({ title: "T", problem: "P" }, "python");
  assert.notEqual(plain, coverageKey("P", "python"));
  assert.equal(plain, fallback);
});

test("draftKey normalizes stored slugs identically to problemKey", () => {
  assert.equal(draftKey({ slug: "Two-Sum", problem: "P" }, "python"), coverageKey("two-sum", "python"));
  assert.equal(draftKey({ slug: "two sum", problem: "P" }, "python"), draftKey({ problem: "P" }, "python"));
});

test("text identity is a normalized fingerprint, robust to formatting changes", () => {
  const a = problemKey({ title: "T", problem: "Given   an array   [1, 2],  target 9" }, "python");
  const b = problemKey({ title: "T", problem: "Given an array [1, 2], target 9" }, "python");
  assert.equal(a, b);
  const different = problemKey({ title: "T", problem: "Given an array [1, 2], target 10" }, "python");
  assert.notEqual(a, different);
});

test("language is part of identity: python and java stay separate units", () => {
  const python = problemKey({ title: "T", slug: "two-sum", problem: "P" }, "python");
  const java = problemKey({ title: "T", slug: "two-sum", problem: "P" }, "java");
  assert.notEqual(python, java);
  const fpPython = problemKey({ title: "T", problem: "Given an array, return indices." }, "python");
  const fpJava = problemKey({ title: "T", problem: "Given an array, return indices." }, "java");
  assert.notEqual(fpPython, fpJava);
  // Same slug + language identifies the same unit even with reworded text.
  assert.equal(
    problemKey({ title: "T1", slug: "two-sum", problem: "P1" }, "python"),
    problemKey({ title: "T2", slug: "two-sum", problem: "P2" }, "python"),
  );
});

test("reconcileResults downgrades accepted results that the store no longer has", () => {
  const results = [
    { title: "A", status: "accepted" as const, draftId: "d1" },
    { title: "B", status: "accepted" as const, draftId: "d2" },
    { title: "C", status: "failed" as const, draftId: "d3", error: "upstream 403" },
    { title: "D", status: "skipped" as const },
  ];
  const reconciled = reconcileResults(results, new Map([["d1", "queued"], ["d2", "accepted"], ["d3", "accepted"]]));
  assert.equal(reconciled[0].status, "failed");
  assert.match(reconciled[0].error ?? "", /state divergence/);
  assert.equal(reconciled[1].status, "accepted");
  assert.equal(reconciled[2].status, "accepted");
  assert.equal(reconciled[2].reason, "accepted in the store during or after this run");
  assert.equal(reconciled[3].status, "skipped");
});

test("reconcileResults leaves results without a draftId untouched", () => {
  const results = [{ title: "A", status: "skipped" as const, reason: "already covered" }];
  const reconciled = reconcileResults(results, new Map([["d1", "accepted"]]));
  assert.deepEqual(reconciled, results);
});
