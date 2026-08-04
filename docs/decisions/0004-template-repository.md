# ADR 0004: Delay a Separate Template Repository

- Status: accepted
- Date: 2026-08-04

## Context

Reusable algorithm content may eventually have independent contributors, releases, licensing review, and consumers. The `AlgorithmUnit` schema is currently unvalidated and will evolve with the core and practice modes.

The generic name `gewu-template` would also overlap with Project-GEWU's existing cross-domain templates and would not communicate that the content is algorithm-specific.

## Decision

Keep official initial content under `packs/` in `gewu-algorithm`. Reconsider extraction after schema version 1 and meaningful content volume. If extracted, prefer the repository name `gewu-algorithm-templates`.

Keep schema definitions, migrations, and loaders in `gewu-algorithm` even after content extraction.

## Consequences

- Schema and sample content can evolve in one atomic change.
- The main repository temporarily contains both software and reviewed content.
- Extraction criteria are documented in the template-system architecture.
- Personal and generated draft content remains outside official packs.
