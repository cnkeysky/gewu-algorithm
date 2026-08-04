# Schemas

Public schemas define persisted and exchanged data contracts. They are normative and require compatibility review.

Current drafts:

- [`algorithm-unit.schema.json`](algorithm-unit.schema.json): reusable algorithm learning content.

Schema files use JSON Schema Draft 2020-12. YAML authoring files are validated against the same data model after parsing.

Before schema version 1 is declared stable, incompatible changes are permitted only when fixtures, documentation, and an ADR or explicit decision update change atomically.
