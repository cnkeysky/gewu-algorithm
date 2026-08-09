import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { upsertDraft, upsertReview } from "./persist.js";

function openDb() {
  const dir = mkdtempSync(join(tmpdir(), "gewu-persist-"));
  const db = new DatabaseSync(join(dir, "test.sqlite"));
  db.exec(`
    CREATE TABLE drafts (
      id TEXT PRIMARY KEY, task_id TEXT, slug TEXT, title TEXT NOT NULL, problem TEXT NOT NULL,
      provider TEXT NOT NULL, model TEXT NOT NULL, language TEXT NOT NULL, variants INTEGER NOT NULL,
      modes_json TEXT NOT NULL, assistance_json TEXT NOT NULL, status TEXT NOT NULL,
      created_at TEXT NOT NULL, unit_id TEXT, artifact_path TEXT, published_path TEXT, error TEXT
    );
    CREATE TABLE reviews (
      id TEXT PRIMARY KEY, draft_id TEXT NOT NULL, role TEXT NOT NULL, verdict TEXT NOT NULL,
      artifact_hash TEXT, report_path TEXT, rationale TEXT, created_at TEXT NOT NULL
    );
  `);
  return { db, dir };
}

function draft(id: string, status = "queued") {
  return {
    id,
    title: id,
    problem: "Given an array of integers and a target, return indices.",
    provider: "relay",
    model: "m",
    language: "python",
    variants: 0,
    modes: ["shadow_typing"],
    assistance: [],
    status,
    createdAt: "2026-08-09T00:00:00.000Z",
  };
}

function review(id: string, draftId: string) {
  return { id, draftId, role: "algorithm_correctness", verdict: "pass", artifactHash: null, createdAt: "2026-08-09T00:00:00.000Z" };
}

test("saving a disjoint state does not clobber other drafts", () => {
  const { db, dir } = openDb();
  try {
    upsertDraft(db, draft("a"));
    // A later save that only knows about draft b must not delete a (the
    // DELETE-all + re-insert race it guards against).
    upsertDraft(db, draft("b"));
    assert.equal(db.prepare("SELECT COUNT(*) n FROM drafts WHERE id='a'").get()!.n, 1);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM drafts WHERE id='b'").get()!.n, 1);
    // Upsert updates only the target row.
    upsertDraft(db, { ...draft("a"), status: "accepted" });
    assert.equal(db.prepare("SELECT status FROM drafts WHERE id='a'").get()!.status, "accepted");
    assert.equal(db.prepare("SELECT status FROM drafts WHERE id='b'").get()!.status, "queued");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("reviews upsert independently and deletion removes only the target rows", () => {
  const { db, dir } = openDb();
  try {
    upsertDraft(db, draft("a"));
    upsertDraft(db, draft("b"));
    upsertReview(db, review("r-a", "a"));
    upsertReview(db, review("r-b", "b"));
    // A later save carrying only b's review must not delete a's review.
    assert.equal(db.prepare("SELECT COUNT(*) n FROM reviews WHERE draft_id='a'").get()!.n, 1);
    db.prepare("DELETE FROM reviews WHERE draft_id='a'").run();
    db.prepare("DELETE FROM drafts WHERE id='a'").run();
    assert.equal(db.prepare("SELECT COUNT(*) n FROM drafts WHERE id='a'").get()!.n, 0);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM drafts WHERE id='b'").get()!.n, 1);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM reviews WHERE draft_id='b'").get()!.n, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
