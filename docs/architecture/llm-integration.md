# LLM Integration

## Role

LLMs are optional assistants for generating and analyzing content. They do not decide practice transitions, publish official units, store credentials, or replace executable validation.

## Typed Tasks

The public application layer should expose tasks such as:

```text
AnalyzeProblem
GenerateImplementationDraft
GenerateFlowDraft
GenerateReasoningQuestions
GenerateRelationships
GenerateTransferCases
GenerateCounterexamples
GenerateReviewQuestions
CompareImplementations
```

Each task defines typed input, expected structured output, a prompt version, validation, and privacy classification.

## Provider Boundary

Provider adapters may support remote and local models, but concrete SDK types and error types must remain inside the adapter. Common capabilities should be discovered explicitly; the abstraction must not assume every provider supports embeddings, reranking, tools, or identical sampling parameters.

The Stage 7 boundary reuses `@earendil-works/pi-ai` as the provider adapter. It
follows Pi's provider registry model:
provider identity and protocol style are separate, and custom providers can
declare an OpenAI-compatible endpoint. GEWU does not depend on Pi's agent loop,
tool runtime, session store, or prompt renderer. `gewu-llm` owns only typed
generation tasks, structured responses, review-gated draft artifacts, and a
fake-provider pipeline used by tests. A small TypeScript bridge will translate
Pi-ai stream events into these contracts.

The initial profiles identify OpenAI Responses and the OpenAI-compatible
Completions style used by DeepSeek, Moonshot/Kimi, Zhipu/GLM, and Xiaomi MiMo.
Base URLs, credentials, model catalogs, and compatibility flags are owned by the
Pi-ai adapter configuration; GEWU does not duplicate those defaults. Provider-
specific reasoning, tools, audio, web search, and streaming fields must be
opt-in extensions rather than silently flattened into the common task contract.

## Generation Pipeline

```text
explicitly selected input
  -> privacy and size check
  -> task prompt construction
  -> provider execution
  -> structured parsing
  -> schema validation
  -> code validation where applicable
  -> local draft
  -> human review
  -> optional publication
```

Structured tasks use one required Pi-ai tool call whose parameters are the
versioned TypeBox/JSON Schema contract. The adapter validates tool arguments
before exposing them to GEWU. Ordinary text, markdown fences, partial tool
arguments, and ambiguous wrappers are protocol failures; GEWU does not search
for the first brace or recover content with regular expressions. Provider
errors and schema failures use bounded retries; no request loop may retry
indefinitely.

## Model Review

Review is role-specific and read-only. The initial roles are algorithm
correctness, learning design, and provenance/safety. Each reviewer receives the
same immutable artifact hash and a versioned subset of the universal algorithm
rubric, then returns a structured verdict and findings. A model `pass` still
requires human confirmation and never mutates lifecycle state.

`needs_revision` produces a repair handoff that another generation call may
consume. `reject`, reviewer disagreement, source/licensing decisions, and
changes to the algorithm contract require a human decision. Every repaired
artifact gets a new hash and repeats deterministic validation and review.

Remote source text is untrusted data. Prompts must delimit it as content and must not allow embedded instructions to select files, reveal secrets, or execute commands.

## Reproducibility and Provenance

Generated drafts record:

- provider and model identifier;
- task and prompt version;
- generation timestamp;
- hashes or references for selected inputs;
- sampling parameters when available;
- validation results;
- human reviewer and review timestamp when promoted.

Raw prompts and responses may contain private data and are not committed by default.

## Failure Behavior

Provider timeouts, rate limits, malformed output, and unavailable capabilities are expected errors. They must not corrupt an existing unit or block local practice.
