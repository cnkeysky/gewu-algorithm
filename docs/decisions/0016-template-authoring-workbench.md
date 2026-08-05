# ADR 0016: Separate Template Authoring Workbench

## Status

Accepted

## Context

Generating and reviewing templates is a content-authoring workflow. It needs
problem input, model selection, editable drafts, deterministic checks, multiple
review roles, and human acceptance. Those concerns are different from the
interactive practice workflow embedded in an editor.

## Decision

Build a local Vite + TypeScript/HTML/CSS authoring workbench around the existing
provider-neutral generation pipeline. Keep it independent of VS Code and make
accepted `AlgorithmUnit` artifacts the only integration contract for editor
adapters. Add React only when component complexity justifies it.

Represent coding modes with a `GenerationProfile` attached to one generation
task. Generate one algorithm unit with mode-specific practice projections;
do not create a separate canonical template for every mode.

## Consequences

- Authors can use the same workflow before any editor adapter exists.
- Secrets remain in the server environment or credential store.
- Review reports and artifact hashes can be audited independently of the UI.
- The first UI has fewer dependencies and can be run locally with the existing
  TypeScript toolchain.
- A later component framework migration remains possible because the API and
  state contracts are explicit.
