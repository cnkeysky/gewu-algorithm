# ADR 0009: Use a Structured Webview for Flow Recall

- Status: accepted
- Date: 2026-08-04

## Context

Shadow Typing requires native character input and editor mutation semantics, so
ADR 0007 selected an untitled native document. Flow Recall has a different
interaction: the learner reconstructs ordered algorithm steps in their own
words, reviews completed steps, and may reveal one reviewed prompt. Repeated
notifications and input boxes hide context, scale poorly, and expose stable
content IDs as if they were learning material.

## Decision

Keep Shadow Typing in the native editor and render Flow Recall in a dedicated
VS Code Webview panel. The panel shows the unit title, problem context, progress,
completed reviewed steps, one answer field, and explicit Submit, Reveal,
Restart, Stop, and Close actions. Stable step IDs remain protocol and test
identifiers; ordinary UI asks for a natural-language reconstruction. The Rust
core remains the only scoring owner.

The MVP uses ordered steps with optional state descriptions. A general graph or
diagram editor is outside this decision.

## Consequences

- Long flows retain context without notification churn.
- Flow and Shadow use different hosts while sharing one core session contract.
- Webview messages are untrusted input and must be validated at the adapter.
- Theme compatibility, keyboard operation, resume, and disposal require real
  extension-host verification.
