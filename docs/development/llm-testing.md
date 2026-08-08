# LLM Testing Policy

## Current Scope

All real provider-backed tests use the configured DeepSeek adapter:

```text
provider: deepseek
model: deepseek-v4-flash
credential: DEEPSEEK_API_KEY
```

Other Pi-ai providers remain supported by the provider-neutral boundary, but
they are not marked as integration-tested until credentials and a dedicated
test run are available.

A custom OpenAI-compatible relay (`GEWU_LLM_PROVIDER=relay` +
`GEWU_LLM_BASE_URL`) is configuration, not a new integration target: it reuses
the same adapter smoke, generation, and review layers. A relay is qualified
only by running those layers against it with real credentials; a working
built-in provider smoke test is not evidence the relay works.

## Test Layers

1. **Adapter smoke**: verify authentication, model lookup, request execution,
   and JSON response parsing with `npm run smoke:local`.
2. **Draft generation**: generate one complete algorithm draft from a fixed,
   explicitly selected input. Store it only under ignored local draft output.
3. **Contract validation**: validate the manifest and source containment with
   the Rust `gewu-template` loader.
4. **Executable validation**: format, syntax-check, and test generated source
   code where the selected language supports it.
5. **GEWU review**: inspect reasoning/explanation, boundaries, relationships,
   practice definitions, provenance, and safety before accepting a draft.
6. **Role review**: run DeepSeek independently for algorithm correctness,
   learning design, and provenance/safety. Store structured reports beside the
   ignored draft; never apply their lifecycle claims.

A successful adapter smoke test is not evidence that generated content is
schema-valid or pedagogically acceptable. Only the full layers above can
qualify a generated template for human review.

Run one read-only review role with:

```sh
npm run review-template:local -- \
  tools/template-authoring/drafts/<draft> algorithm_correctness
```

Repeat with `learning_design` and `provenance_safety`. A `pass` means only that
the selected role found no issue under the current rubric; it is not publication
approval.

Current AlgorithmUnit v2 drafts use `algorithm-template-review.v2`. Confirm
that algorithm correctness reports include `ALG-STATEMENT-001`, and reject any
draft whose statement is summarized, mismatched, unsafe, or solution-leaking.

## DeepSeek Draft Fixture

Run `npm run generate-template:local -- "problem statement"` from
`tools/template-authoring/` to exercise Layers 2 through 4 with an
algorithm-agnostic generation prompt. The prompt constrains only the GEWU
contract shape; every algorithm decision is inferred from the provided problem
text. The command uses `deepseek/deepseek-v4-flash`, writes only to the ignored
`tools/template-authoring/drafts/generated-*/` directory, and leaves the
manifest lifecycle state and all validation fields as `pending`.

The command performs a local response-shape and source-containment check,
compiles the generated Python source in memory, and invokes:

```sh
cargo run --quiet -p gewu-template --bin validate -- \
  tools/template-authoring/drafts/generated-*/unit.json
```

The final human review must examine the generated manifest and source before
any artifact is accepted. Generated content must not be copied into fixtures or
official packs as a by-product of this integration test.
