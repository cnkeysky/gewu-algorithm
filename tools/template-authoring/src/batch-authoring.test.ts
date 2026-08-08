import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { coverageKey, loadProblems, parseOptions, selectProblems } from "./batch-authoring.js";

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
  assert.equal(defaults.variants, 1);
  assert.deepEqual(defaults.modes, ["shadow_typing", "flow_recall", "code_recall", "reasoning_recall", "transfer_practice"]);
  assert.deepEqual(defaults.assistance, ["comments", "cloze"]);

  const custom = parseOptions([
    "--problems", "hot100.json", "--api", "http://127.0.0.1:9999/",
    "--steps", "generate,review", "--concurrency", "4", "--resume",
    "--force", "--yes", "--select", "two-sum,3sum", "--repair-rounds", "2", "--auto-accept", "--language", "java",
    "--variants", "2", "--modes", "shadow_typing,code_recall", "--assistance", "comments",
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
  assert.equal(custom.variants, 2);
  assert.deepEqual(custom.modes, ["shadow_typing", "code_recall"]);
  assert.deepEqual(custom.assistance, ["comments"]);
});

test("loadProblems parses JSON arrays and TSV", async () => {
  const directory = await mkdtemp(join(tmpdir(), "gewu-batch-"));
  try {
    const jsonPath = join(directory, "problems.json");
    await writeFile(jsonPath, JSON.stringify([
      { id: "1", slug: "two-sum", title: "Two Sum", problem: "Given nums and target...", sourceUrl: "https://leetcode.com/problems/two-sum/", language: "python" },
      { id: "20", slug: "valid-parentheses", title: "Valid Parentheses", problem: "Given a string s..." },
    ]), "utf8");
    const jsonProblems = await loadProblems(jsonPath);
    assert.equal(jsonProblems.length, 2);
    assert.equal(jsonProblems[0].title, "Two Sum");
    assert.equal(jsonProblems[0].sourceUrl, "https://leetcode.com/problems/two-sum/");
    assert.equal(jsonProblems[0].language, "python");
    assert.equal(jsonProblems[0].slug, "two-sum");
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
