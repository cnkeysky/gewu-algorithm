# Fixtures

Fixtures exercise public schemas and domain behavior. They are not automatically official content.

- `algorithm-units/valid/` contains schema-valid design fixtures.
- `algorithm-units/invalid/` contains targeted negative fixtures for ID syntax, unsupported schema
  versions, missing and traversing sources, and unknown implementation references.

| Fixture | Expected loader error |
| --- | --- |
| `invalid/invalid-id.json` | `id` does not use dotted lowercase syntax |
| `invalid/unsupported-schema.json` | schema version is unsupported |
| `invalid/missing-source.json` | declared implementation source is unavailable |
| `invalid/traversing-source.json` | implementation source attempts parent traversal |
| `invalid/unknown-shadow/unit.json` | shadow typing references an undeclared implementation |

The BFS and binary-search fixtures remain drafts. Their presence demonstrates that graph traversal and ordered-search units are representable; it does not establish reviewed learning quality or validated content.
