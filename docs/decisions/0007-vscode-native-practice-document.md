# ADR 0007: Use a Native Editor with a Dedicated Practice Document

- Status: accepted for Stage 2 spike
- Date: 2026-08-04

## Context

Shadow Typing needs ordinary typing, paste, keyboard navigation, clipboard, accessibility, and input-method behavior while preventing practice mutations from changing the user's source file. The project considered a native editor with decorations, a controlled virtual/custom document, and a Webview editor.

## Decision

Use a native VS Code text editor backed by a dedicated untitled in-memory practice document. Keep the source document untouched. Translate host changes into a pure TypeScript transaction policy, convert VS Code UTF-16 offsets to Unicode scalar offsets, normalize line endings at the boundary, and display progress with decorations. Own the document, change listener, and decorations in one disposable session controller.

Reject multi-cursor, Undo/Redo, formatting, snippets, completion edits, and other external mutations in the strict MVP unless the adapter can restore the accepted prefix deterministically. Disable format-on-save for practice documents. Treat IME composition as a real-host manual verification item until an extension-host test demonstrates a stable public API contract.

Do not use a custom document or Webview for the MVP. Their additional editing, undo, persistence, CSP, accessibility, and IME contracts are not justified by the current requirements.

## Consequences

- Native editor semantics and accessibility are retained for most input paths.
- The adapter must handle host event ordering, restoration edits, and VS Code UTF-16 offsets carefully.
- A dedicated untitled document avoids source corruption but requires explicit close and disposal behavior.
- Stage 3 must add the real VS Code adapter, core handshake, commands, and extension-host integration tests.
- This ADR does not claim the Stage 2 spike is complete until the manual checklist passes in a real extension host.
