import {
  checkpointProgressPercentage,
  checkpointStartActions,
  CheckpointSummary,
} from "../src/core-client.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const checkpoints: readonly CheckpointSummary[] = [
  {
    id: "checkpoint-session-shadow",
    unit_id: "graph.bfs",
    unit_title: "Breadth-First Search",
    revision: 1,
    mode: "shadow_typing",
    completed_steps: 0,
    total_steps: 0,
    accepted_characters: 4,
    target_characters: 120,
    saved_at: "2026-08-05T00:00:00Z",
  },
  {
    id: "checkpoint-session-flow",
    unit_id: "search.binary-search",
    unit_title: "Binary Search",
    revision: 1,
    mode: "flow_recall",
    completed_steps: 1,
    total_steps: 3,
    accepted_characters: 0,
    target_characters: 0,
    saved_at: "2026-08-05T00:01:00Z",
  },
];

const actions = checkpointStartActions(checkpoints, "flow_recall");
assert(
  actions.length === 3,
  "start choices include only matching-mode checkpoints",
);
assert(
  actions[0]?.action === "start" && actions[0].mode === "flow_recall",
  "new start choice identifies its requested mode",
);
assert(
  actions
    .filter((action) => action.action === "resume")
    .map((action) => ("checkpoint_id" in action ? action.checkpoint_id : ""))
    .join(",") === "checkpoint-session-flow",
  "resume choices identify matching-mode checkpoints",
);
assert(
  actions
    .filter((action) => action.action === "discard")
    .map((action) => ("checkpoint_id" in action ? action.checkpoint_id : ""))
    .join(",") === "checkpoint-session-flow",
  "discard choices identify matching-mode checkpoints",
);
console.log("PASS scopes checkpoint start choices to the requested mode");

assert(
  checkpointProgressPercentage(checkpoints[0]!) === 3,
  "Shadow Typing progress is presented as a percentage",
);
assert(
  checkpointProgressPercentage(checkpoints[1]!) === 33,
  "Flow Recall progress is presented as a percentage",
);
console.log("PASS presents checkpoint progress as percentages");
