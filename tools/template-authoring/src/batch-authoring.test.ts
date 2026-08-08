import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { loadProblems, parseOptions } from "./batch-authoring.js";

test("parseOptions applies defaults and overrides", () => {
  const defaults = parseOptions(["--problems", "hot100.json"]);
  assert.equal(defaults.problemsFile, "hot100.json");
  assert.equal(defaults.api, "http://127.0.0.1:4174");
  assert.deepEqual([...defaults.steps], ["draft", "generate", "validate", "review", "accept"]);
  assert.equal(defaults.concurrency, 1);
  assert.equal(defaults.repairRounds, 1);
  assert.equal(defaults.autoAccept, false);
  assert.equal(defaults.language, "python");
  assert.equal(defaults.variants, 1);
  assert.deepEqual(defaults.modes, ["shadow_typing", "flow_recall", "code_recall", "reasoning_recall", "transfer_practice"]);
  assert.deepEqual(defaults.assistance, ["comments", "cloze"]);

  const custom = parseOptions([
    "--problems", "hot100.json", "--api", "http://127.0.0.1:9999/",
    "--steps", "generate,review", "--concurrency", "4", "--resume",
    "--repair-rounds", "2", "--auto-accept", "--language", "python",
    "--variants", "2", "--modes", "shadow_typing,code_recall", "--assistance", "comments",
  ]);
  assert.equal(custom.api, "http://127.0.0.1:9999");
  assert.deepEqual([...custom.steps], ["generate", "review"]);
  assert.equal(custom.concurrency, 4);
  assert.equal(custom.resume, true);
  assert.equal(custom.repairRounds, 2);
  assert.equal(custom.autoAccept, true);
  assert.equal(custom.variants, 2);
  assert.deepEqual(custom.modes, ["shadow_typing", "code_recall"]);
  assert.deepEqual(custom.assistance, ["comments"]);
});

test("loadProblems parses JSON arrays and TSV", async () => {
  const directory = await mkdtemp(join(tmpdir(), "gewu-batch-"));
  try {
    const jsonPath = join(directory, "problems.json");
    await writeFile(jsonPath, JSON.stringify([
      { title: "Two Sum", problem: "Given nums and target...", sourceUrl: "https://leetcode.com/problems/two-sum/" },
      { title: "Valid Parentheses", problem: "Given a string s..." },
    ]), "utf8");
    const jsonProblems = await loadProblems(jsonPath);
    assert.equal(jsonProblems.length, 2);
    assert.equal(jsonProblems[0].title, "Two Sum");
    assert.equal(jsonProblems[0].sourceUrl, "https://leetcode.com/problems/two-sum/");

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
