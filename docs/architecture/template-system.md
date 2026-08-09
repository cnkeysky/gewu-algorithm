# Template System

## Ownership

The template system has two distinct assets:

1. the `AlgorithmUnit` schema and loaders, owned by `gewu-algorithm`;
2. reusable algorithm content packs, initially stored under `packs/` and potentially moved to `gewu-algorithm-templates` after the schema stabilizes.

Personal units and generated drafts are not official content packs.

## Package Layout

```text
pack.yaml
units/
└── graph/
    └── bfs/
        ├── unit.yaml
        ├── code/
        │   ├── python.py
        │   └── cpp.cpp
        ├── practice/
        │   ├── shadow.yaml
        │   └── flow.yaml
        ├── examples/
        ├── counterexamples/
        └── tests/
```

## Distribution (current implementation)

Generated units ship as a **content pack** rather than raw files in git:

- `units/index.json` — the committed ledger: per unit, id (slug.language),
  language, revision, practice modes, `sha256` checksum, and update time. It
  drives batch dedup on fresh clones and is the audit/checksum record.
- `gewu-units-<tag>.tar.gz` — the full unit content (manifests, code, tests,
  and `reviews/summary.json` per unit), built with `npm run units:pack` and
  attached to the GitHub release (`gh release upload`).
- A fresh clone runs `npm run units:fetch` to download and extract the pack
  into the local content root for practice; dedup works from the ledger alone.

Each published unit carries `reviews/summary.json` (acceptance role/rationale
plus the needs_revision history), so reviewers see the LLM/human feedback
behind the content even when the local authoring store is empty.

The manifest contains identity and structured semantics. Source code remains in normal language files so formatters, compilers, syntax highlighting, and diffs work naturally.

Practice content follows the platform-independent contracts in
[Practice Content Contracts](practice-content-contracts.md). In particular,
comment-guided reconstruction, keyword hints, structural skeletons, and cloze
regions are assistance policies for `code_recall`, not editor features or new
persisted practice modes.

## Authoring Rules

- Human-authored YAML is validated against a versioned JSON Schema.
- Required fields must justify deterministic behavior, compatibility, provenance, or meaningful learning value.
- Markdown may explain a unit but is not the sole source for machine-required semantics.
- Relationships include a reason and boundary.
- Transfer examples include what structure transfers and what differs.
- Counterexamples identify cases where a tempting pattern is invalid or insufficient.
- Published code variants include executable tests where practical.
- Generated content remains under local draft storage until reviewed.
- Generation tasks may emit only fields defined by an implemented schema
  contract; a provider response cannot extend practice semantics implicitly.
- One generation task emits one `AlgorithmUnit` aggregate with every applicable
  practice definition. Generation may run in stages (a core stage, then one
  stage per practice mode or code recall layout), but the authoring server
  merges the stages into one aggregate before review; separate templates per
  practice mode are never published.
- Generated implementation variants declare strategy, complexity, assumptions,
  and contained test references. Content cannot provide shell commands.
- Practice definitions bind implementation strategies where the contract
  allows: shadow typing exposes exactly one item per strategy, while code
  recall, reasoning recall, and transfer practice bind to the canonical
  first-declared implementation (an optional binding that is absent means the
  canonical one). Multi-strategy units vary only shadow typing; the other
  modes are exercise formats of the canonical implementation and are never
  duplicated per strategy.
- Problem-class prompt templates are not used. One algorithm-agnostic contract
  prompt drives generation; per-class strictness, when needed, belongs to the
  versioned review rubric rather than to generation prompts.
- Model reviewers are read-only. They emit versioned findings and repair
  handoffs; they cannot promote or publish a draft.

## Schema Evolution

- Schema versions use a positive major version represented as a string.
- Additive optional fields may remain within a compatible schema release.
- New required fields or semantic changes require a new major schema version and migration plan.
- Loaders report unsupported versions rather than guessing.
- Fixtures cover the oldest supported and current versions.

## Official Pack Split Criteria

Moving official content to a separate repository should occur only when most of these conditions hold:

- schema version 2 is stable;
- at least 30 to 50 maintained units exist;
- content and code have meaningfully different review cadence;
- independent consumers need the content;
- content contributors do not need the software workspace;
- licensing and provenance checks have their own maintainers;
- releases can be tagged and compatibility-tested independently.

Until then, a monorepo avoids synchronized changes across unstable contracts.

## Distribution

Git is the authoring and review mechanism. `gewu-template pack build` emits a
versioned JSON manifest with SHA-256 hashes for every unit directory and the
pack inventory; `gewu-template pack verify` validates those hashes before a
runtime consumes the pack. Runtime clients should consume a tagged,
checksummed content-pack artifact or an explicitly selected local directory.
Git submodules are not the default distribution mechanism because they make
installation and version resolution harder for ordinary users.
