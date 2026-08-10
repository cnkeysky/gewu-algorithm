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

### Custom OpenAI-compatible relay

Relay providers are our OpenAI-compatible extension and are enabled by
configuration, not code: `providers.json` declares each relay as a key-value
entry (`id -> { label, keyEnv, baseUrlEnv, wireApi?, opencodeHeaders? }`), the
default entry being `relay` with `GEWU_LLM_PROVIDER=relay`,
`GEWU_LLM_BASE_URL`, and `GEWU_LLM_API_KEY`. `GEWU_LLM_MODEL` picks the model.
The credential comes only from the entry's `keyEnv` — provider keys like
`DEEPSEEK_API_KEY` are never sent to a relay. Bearer auth, one model id per
run, and OpenAI-compatible parameters are supported on two wire protocols:

- `wireApi: "responses"` (default for the built-in relay entry, matching
  Codex-style gateways) talks to the OpenAI Responses API;
- `wireApi: "chat"` talks to the standard `/v1/chat/completions` shape used by
  DeepSeek, Moonshot/Kimi, Zhipu/GLM, Xiaomi MiMo, and most sub2api-style
  gateways.

Tool schemas are sent non-strict (`supportsStrictMode: false`): open gateways
vary in their JSON-schema enforcement, and our contracts legitimately use
features outside OpenAI's strict subset (e.g. open `sources` maps). Pi-ai
still validates every returned tool call and repairs violations with
feedback. `opencodeHeaders: true` adds the `x-opencode-session` /
`x-opencode-request` headers that some Codex-style gateways recommend; generic
relays leave it off. Relay transport routes through an explicit
`GEWU_LLM_PROXY` when set, otherwise honors `HTTPS_PROXY` / `HTTP_PROXY`
(`NO_PROXY` applies either way), and connects directly when no proxy is
configured — implemented with undici's `EnvHttpProxyAgent` because Node's
built-in fetch ignores proxy env vars. Anthropic-Messages-only gateways and
custom auth schemes are out of scope for the generic relay and need a
dedicated adapter or extension. No endpoint URL is hardcoded; the relay model
carries DeepSeek-style compatibility defaults, and a relaxed per-call timeout
(`GEWU_LLM_TIMEOUT_MS`) is recommended for reasoning-mode upstreams.
Built-in providers (everything Pi-ai ships) are derived from the Pi package —
ids, labels, models, and key env conventions — so vendor changes are handled
by updating Pi.

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

Rubric v2 adds the required learner-facing statement contract. Algorithm review
checks Markdown/math safety and agreement with code and tests; learning-design
review checks that modes and variants remain projections of the same unit
revision rather than substituting another statement. Layout-specific clauses
apply only to their declared Code Recall layout.

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

Generation profiles also declare requested Code Recall layouts. Generation
must keep `layout` separate from assistance: `full_recall` targets the complete
canonical implementation, `comment_guided` supplies reviewed operation cues,
`comment_to_code` reconstructs code from reviewed intent, and `cloze` hides
meaningful algorithm decisions. Models must not create cloze slots for
punctuation, formatting, or arbitrary syntax merely to satisfy a requested
count. Comment-guided slots require non-revealing cues and exact source
reconstruction; comment-to-code scaffolds must cover the complete algorithm
flow. Learning-design review checks these rules before publication.

## Failure Behavior

Provider timeouts, rate limits, malformed output, and unavailable capabilities are expected errors. They must not corrupt an existing unit or block local practice.
