import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { casUpsertDraft, releaseClaim, tryAcquireClaim, upsertDraft, upsertReview } from "./persist.js";

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
    CREATE TABLE claims (
      draft_id TEXT NOT NULL, operation TEXT NOT NULL, role TEXT NOT NULL DEFAULT '',
      claimed_at TEXT NOT NULL, expires_at TEXT NOT NULL,
      PRIMARY KEY (draft_id, operation, role)
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

test("casUpsertDraft applies only when the row still has the expected status", () => {
  const { db, dir } = openDb();
  try {
    upsertDraft(db, draft("a", "queued"));
    // Matching expectation wins the CAS.
    assert.equal(casUpsertDraft(db, { ...draft("a", "queued") }, "queued"), true);
    // A stale writer whose expectation no longer matches is refused.
    assert.equal(casUpsertDraft(db, { ...draft("a", "queued") }, "failed"), false);
    assert.equal(db.prepare("SELECT status FROM drafts WHERE id='a'").get()!.status, "queued");
    // The CAS is the concurrency primitive; keeping accepted terminal is the
    // state machine guard's job (draftReuseGuard), which refuses before CAS.
    assert.equal(casUpsertDraft(db, { ...draft("a", "accepted") }, "queued"), true);
    assert.equal(db.prepare("SELECT status FROM drafts WHERE id='a'").get()!.status, "accepted");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("claims serialize LLM work across processes and let review roles run concurrently", () => {
  const { db, dir } = openDb();
  try {
    // A second connection simulates a second API process sharing the store.
    const dbOther = new DatabaseSync(join(dir, "test.sqlite"));
    try {
      assert.equal(tryAcquireClaim(db, { draftId: "d1", operation: "generate" }), true);
      // The same operation on the same draft is refused across connections.
      assert.equal(tryAcquireClaim(dbOther, { draftId: "d1", operation: "generate" }), false);
      // A different operation on the same draft is independent.
      assert.equal(tryAcquireClaim(dbOther, { draftId: "d1", operation: "acceptance" }), true);
      // The three review roles on the same draft run concurrently.
      assert.equal(tryAcquireClaim(dbOther, { draftId: "d1", operation: "review", role: "algorithm_correctness" }), true);
      assert.equal(tryAcquireClaim(dbOther, { draftId: "d1", operation: "review", role: "learning_design" }), true);
      assert.equal(tryAcquireClaim(dbOther, { draftId: "d1", operation: "review", role: "algorithm_correctness" }), false);
    } finally {
      releaseClaim(db, "d1", "generate");
      dbOther.close();
    }
    assert.equal(tryAcquireClaim(db, { draftId: "d1", operation: "generate" }), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("expired claims are reclaimed for a crashed worker", () => {
  const { db, dir } = openDb();
  try {
    const now = Date.parse("2026-08-09T00:00:00.000Z");
    assert.equal(tryAcquireClaim(db, { draftId: "d1", operation: "generate", leaseMs: 1_000 }, now), true);
    assert.equal(tryAcquireClaim(db, { draftId: "d1", operation: "generate", leaseMs: 1_000 }, now + 500), false);
    // Lease expired: the next worker can take over.
    assert.equal(tryAcquireClaim(db, { draftId: "d1", operation: "generate", leaseMs: 1_000 }, now + 2_000), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
