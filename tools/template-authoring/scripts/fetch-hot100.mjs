#!/usr/bin/env node
// Refresh tools/template-authoring/hot100.json from the official LeetCode
// "Top 100 Liked" study plan (leetcode.cn). The catalog is Python-targeted:
// every entry pins language: "python", so batch runs never generate other
// implementation languages.
//
// Usage: npm run fetch:hot100
import { writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const TurndownModule = require("turndown");
const TurndownService = TurndownModule.default ?? TurndownModule;

const here = dirname(fileURLToPath(import.meta.url));
const outPath = resolve(here, "..", "hot100.json");
const api = "https://leetcode.cn/graphql";
const planQuery = `
query studyPlanDetail($slug: String!) {
  studyPlanV2Detail(planSlug: $slug) {
    planSubGroups { questions { titleSlug } }
  }
}`;
const questionQuery = `
query questionData($titleSlug: String!) {
  question(titleSlug: $titleSlug) {
    questionId
    title
    titleSlug
    difficulty
    content
    translatedTitle
    translatedContent
  }
}`;

const turndown = new TurndownService({ codeBlockStyle: "fenced", bulletListMarker: "-" });

async function graphql(query, variables, retries = 3) {
  let lastError;
  for (let attempt = 0; attempt < retries; attempt += 1) {
    try {
      const response = await fetch(api, {
        method: "POST",
        headers: { "content-type": "application/json", referer: "https://leetcode.cn/studyplan/top-100-liked/" },
        body: JSON.stringify({ query, variables }),
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = await response.json();
      if (body.errors?.length) throw new Error(body.errors.map((error) => error.message).join("; "));
      return body.data;
    } catch (error) {
      lastError = error;
      await new Promise((resolveWait) => setTimeout(resolveWait, 500 * (attempt + 1)));
    }
  }
  throw lastError;
}

async function fetchQuestion(titleSlug) {
  const data = await graphql(questionQuery, { titleSlug });
  const question = data.question;
  if (!question) throw new Error(`no question data for ${titleSlug}`);
  return {
    id: String(question.questionId),
    slug: question.titleSlug,
    title: question.translatedTitle || question.title,
    difficulty: question.difficulty,
    problem: turndown.turndown(question.translatedContent || question.content).trim(),
    sourceUrl: `https://leetcode.cn/problems/${question.titleSlug}/`,
    language: "python",
  };
}

async function main() {
  const plan = await graphql(planQuery, { slug: "top-100-liked" });
  const slugs = [...new Set(
    (plan.studyPlanV2Detail?.planSubGroups ?? []).flatMap((group) => group.questions.map((question) => question.titleSlug)),
  )];
  if (slugs.length < 100) throw new Error(`expected 100 problems, got ${slugs.length}`);

  const entries = [];
  let cursor = 0;
  const workers = Array.from({ length: 8 }, async () => {
    for (; ;) {
      const index = cursor;
      cursor += 1;
      const slug = slugs[index];
      if (!slug) return;
      const entry = await fetchQuestion(slug);
      entries.push(entry);
      process.stdout.write(`\r  fetched ${entries.length}/${slugs.length} ${slug.padEnd(48)}`);
    }
  });
  await Promise.all(workers);
  process.stdout.write("\n");

  entries.sort((a, b) => Number(a.id) - Number(b.id));
  await writeFile(outPath, `${JSON.stringify(entries, null, 2)}\n`, "utf8");
  console.log(`wrote ${entries.length} problems to ${outPath} (python only)`);
}

main().catch((error) => {
  console.error(`fetch-hot100: ${error instanceof Error ? error.message : error}`);
  process.exit(1);
});
