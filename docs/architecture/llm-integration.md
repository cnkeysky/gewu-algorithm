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
