# ADR 0019: Language-Qualified Unit Identity

- Status: accepted
- Date: 2026-08-09

## Context

Different implementation languages are distinct deliverables: a Python and a
Java template for the same problem are separate units with separate practice
content, scoring targets, and published artifacts. The batch deduplicates by
`slug`/id + language, but the published unit identity (`manifest.id`, the
published directory, and `unit_id`) contained only the problem slug — so a
second language for the same problem would overwrite the first in
`published/` and collapse to a single Units entry, contradicting the stated
"languages coexist as separate units" behavior.

## Decision

Unit identity is language-qualified:

- Batch runs derive the manifest id deterministically from the stable problem
  slug and language: `<slug>.<language>` (for example `two-sum.python`).
- Web-created drafts keep the model's base id and the server appends the
  language segment idempotently (`array.two-sum` -> `array.two-sum.python`).
- The generation instruction states the id must end with the implementation
  language segment, and the server enforces the suffix after generation.
- Stored slugs are validated against the lowercase dotted/hyphenated shape;
  invalid slugs are dropped, and identity then falls back to the
  language-qualified model id or the statement fingerprint.

## Consequences

- Python and Java templates of the same problem coexist as separate published
  units, directories, and Units entries.
- Unit ids are no longer language-agnostic; tooling treats the language suffix
  as part of the unit identity. Fork/revision already follows `unit_id` from
  the published path, so revisions stay within one language.
- Existing stores predate this ADR and were cleared as test data; no migration
  is required for current deployments.
