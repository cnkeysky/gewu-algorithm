#![forbid(unsafe_code)]
//! JSON loading, semantic validation, and source resolution for `AlgorithmUnit` files.

pub mod lifecycle;
pub mod pack;

use std::{
    collections::HashSet,
    fs, io,
    path::{Component, Path, PathBuf},
};

pub use gewu_domain::AlgorithmUnit;
use gewu_domain::{
    CheckStatus, CodeRecallAssistance, CodeRecallDefinition, Confidence, ContentStatus, FlowStep,
    Generator, Implementation, ImplementationComplexity, Normalization, Pattern, Position,
    PracticeDefinition, Problem, Provenance, ReasoningAspect, ReasoningRecallDefinition,
    Relationship, RelationshipType, Revision, ShadowTypingDefinition, Source, SupersededRevision,
    TransferPracticeDefinition, Understanding, UnitId, ValidationState,
};
use serde::Deserialize;
use thiserror::Error;

const SCHEMA_VERSION: &str = "1";

/// Loads an `AlgorithmUnit` JSON manifest and resolves its implementation source files.
pub fn load_algorithm_unit(path: impl AsRef<Path>) -> Result<AlgorithmUnit, LoadError> {
    let path = path.as_ref();
    let contents = fs::read_to_string(path).map_err(|source| LoadError::ReadManifest {
        path: path.to_owned(),
        source,
    })?;
    let raw: RawAlgorithmUnit =
        serde_json::from_str(&contents).map_err(|source| LoadError::InvalidJson {
            path: path.to_owned(),
            source,
        })?;
    validate_algorithm_unit(raw, path)
}

fn validate_algorithm_unit(
    raw: RawAlgorithmUnit,
    manifest_path: &Path,
) -> Result<AlgorithmUnit, LoadError> {
    if raw.schema_version != SCHEMA_VERSION {
        return Err(LoadError::UnsupportedSchemaVersion {
            found: raw.schema_version,
        });
    }

    let id = parse_unit_id(raw.id, "id")?;
    let revision = parse_revision(raw.revision, "revision")?;
    validate_text(&raw.title, "title")?;
    let tags = validate_tags(raw.tags)?;
    let position = validate_position(raw.position)?;
    let problem = validate_problem(raw.problem)?;
    let understanding = validate_understanding(raw.understanding)?;

    let root = manifest_path
        .parent()
        .ok_or_else(|| LoadError::Validation {
            path: "manifest".to_owned(),
            message: "the manifest path has no parent directory".to_owned(),
        })?;
    let root = fs::canonicalize(root).map_err(|source| LoadError::ResolveRoot {
        path: root.to_owned(),
        source,
    })?;
    let patterns = validate_patterns(raw.patterns)?;
    let implementations = validate_implementations(raw.implementations, &root)?;
    let practice = validate_practice(raw.practice, &implementations, &patterns)?;
    let relationships = validate_relationships(raw.relationships, &id)?;
    let validation = validate_validation(raw.validation)?;
    let provenance = validate_provenance(raw.provenance)?;
    let supersedes = validate_supersedes(raw.supersedes, revision)?;

    Ok(AlgorithmUnit {
        schema_version: SCHEMA_VERSION.to_owned(),
        id,
        revision,
        status: raw.status,
        title: raw.title,
        tags,
        position,
        problem,
        understanding,
        implementations,
        patterns,
        relationships,
        practice,
        validation,
        provenance,
        supersedes,
    })
}

/// A typed, actionable failure while loading untrusted template content.
#[derive(Debug, Error)]
pub enum LoadError {
    #[error("cannot read AlgorithmUnit manifest at `{path}`: {source}")]
    ReadManifest {
        path: PathBuf,
        #[source]
        source: io::Error,
    },
    #[error("invalid JSON in AlgorithmUnit manifest at `{path}`: {source}")]
    InvalidJson {
        path: PathBuf,
        #[source]
        source: serde_json::Error,
    },
    #[error("unsupported AlgorithmUnit schema version `{found}`")]
    UnsupportedSchemaVersion { found: String },
    #[error("cannot resolve AlgorithmUnit directory `{path}`: {source}")]
    ResolveRoot {
        path: PathBuf,
        #[source]
        source: io::Error,
    },
    #[error("invalid AlgorithmUnit field `{path}`: {message}")]
    Validation { path: String, message: String },
    #[error("implementation source `{source_path}` is missing or inaccessible: {source}")]
    SourceUnavailable {
        source_path: PathBuf,
        #[source]
        source: io::Error,
    },
    #[error("implementation source `{source_path}` resolves outside the AlgorithmUnit directory")]
    SourceOutsideUnit { source_path: PathBuf },
}

fn parse_unit_id(value: String, path: &str) -> Result<UnitId, LoadError> {
    UnitId::parse(value).map_err(|error| LoadError::Validation {
        path: path.to_owned(),
        message: error.to_string(),
    })
}

fn parse_revision(value: u64, path: &str) -> Result<Revision, LoadError> {
    Revision::new(value).map_err(|error| LoadError::Validation {
        path: path.to_owned(),
        message: error.to_string(),
    })
}

fn validate_text(value: &str, path: &str) -> Result<(), LoadError> {
    if value.trim().is_empty() {
        return Err(validation(path, "must not be empty or whitespace only"));
    }
    Ok(())
}

fn validate_optional_texts(values: &[String], path: &str) -> Result<(), LoadError> {
    for (index, value) in values.iter().enumerate() {
        validate_text(value, &format!("{path}[{index}]"))?;
    }
    Ok(())
}

fn validate_tags(tags: Vec<String>) -> Result<Vec<String>, LoadError> {
    let mut seen = HashSet::new();
    for (index, tag) in tags.iter().enumerate() {
        let path = format!("tags[{index}]");
        validate_slug(tag, &path)?;
        if !seen.insert(tag.as_str()) {
            return Err(validation(path, "duplicates a prior tag"));
        }
    }
    Ok(tags)
}

fn validation(path: impl Into<String>, message: impl Into<String>) -> LoadError {
    LoadError::Validation {
        path: path.into(),
        message: message.into(),
    }
}

fn validate_slug(value: &str, path: &str) -> Result<(), LoadError> {
    let mut bytes = value.bytes();
    let Some(first) = bytes.next() else {
        return Err(validation(path, "must be a lowercase slug"));
    };
    if !first.is_ascii_lowercase() && !first.is_ascii_digit() {
        return Err(validation(path, "must be a lowercase slug"));
    }

    let mut previous_hyphen = false;
    for byte in bytes {
        if byte == b'-' {
            if previous_hyphen {
                return Err(validation(path, "must be a lowercase slug"));
            }
            previous_hyphen = true;
        } else if byte.is_ascii_lowercase() || byte.is_ascii_digit() {
            previous_hyphen = false;
        } else {
            return Err(validation(path, "must be a lowercase slug"));
        }
    }
    if previous_hyphen {
        return Err(validation(path, "must be a lowercase slug"));
    }
    Ok(())
}

fn validate_position(position: RawPosition) -> Result<Position, LoadError> {
    validate_slug(&position.domain, "position.domain")?;
    validate_slug(&position.category, "position.category")?;
    let mut prerequisites = HashSet::new();
    let mut validated_prerequisites = Vec::with_capacity(position.prerequisites.len());
    for (index, prerequisite) in position.prerequisites.into_iter().enumerate() {
        let path = format!("position.prerequisites[{index}]");
        let id = parse_unit_id(prerequisite, &path)?;
        if !prerequisites.insert(id.clone()) {
            return Err(validation(path, "duplicates a prior prerequisite"));
        }
        validated_prerequisites.push(id);
    }
    Ok(Position {
        domain: position.domain,
        category: position.category,
        prerequisites: validated_prerequisites,
    })
}

fn validate_problem(problem: RawProblem) -> Result<Problem, LoadError> {
    validate_text(&problem.question, "problem.question")?;
    require_nonempty(&problem.scope, "problem.scope")?;
    validate_optional_texts(&problem.scope, "problem.scope")?;
    validate_optional_texts(&problem.out_of_scope, "problem.out_of_scope")?;
    Ok(Problem {
        question: problem.question,
        scope: problem.scope,
        out_of_scope: problem.out_of_scope,
    })
}

fn validate_understanding(understanding: RawUnderstanding) -> Result<Understanding, LoadError> {
    validate_text(&understanding.summary, "understanding.summary")?;
    validate_optional_texts(&understanding.alternatives, "understanding.alternatives")?;
    validate_optional_texts(
        &understanding.failure_conditions,
        "understanding.failure_conditions",
    )?;
    Ok(Understanding {
        summary: understanding.summary,
        confidence: understanding.confidence,
        alternatives: understanding.alternatives,
        failure_conditions: understanding.failure_conditions,
    })
}

fn require_nonempty<T>(values: &[T], path: &str) -> Result<(), LoadError> {
    if values.is_empty() {
        return Err(validation(path, "must contain at least one item"));
    }
    Ok(())
}

fn validate_implementations(
    implementations: Vec<RawImplementation>,
    root: &Path,
) -> Result<Vec<Implementation>, LoadError> {
    require_nonempty(&implementations, "implementations")?;
    let mut keys = HashSet::new();
    let mut validated = Vec::with_capacity(implementations.len());

    for (index, implementation) in implementations.into_iter().enumerate() {
        let base = format!("implementations[{index}]");
        validate_slug(&implementation.key, &format!("{base}.key"))?;
        if !keys.insert(implementation.key.clone()) {
            return Err(validation(
                format!("{base}.key"),
                "duplicates a prior implementation key",
            ));
        }
        validate_slug(&implementation.language, &format!("{base}.language"))?;
        validate_implementation_purpose(&implementation.purpose, &format!("{base}.purpose"))?;
        if let Some(strategy) = &implementation.strategy {
            validate_text(strategy, &format!("{base}.strategy"))?;
        }
        let complexity = implementation
            .complexity
            .map(|complexity| {
                validate_text(&complexity.time, &format!("{base}.complexity.time"))?;
                validate_text(&complexity.space, &format!("{base}.complexity.space"))?;
                Ok::<_, LoadError>(ImplementationComplexity {
                    time: complexity.time,
                    space: complexity.space,
                })
            })
            .transpose()?;
        validate_optional_texts(&implementation.assumptions, &format!("{base}.assumptions"))?;
        for (test_index, reference) in implementation.test_references.iter().enumerate() {
            resolve_source(
                root,
                reference,
                &format!("{base}.test_references[{test_index}]"),
            )?;
        }
        let normalization = validate_normalization(
            implementation.normalization,
            &format!("{base}.normalization"),
        )?;
        let source_path = resolve_source(root, &implementation.source, &format!("{base}.source"))?;
        validated.push(Implementation {
            key: implementation.key,
            language: implementation.language,
            source: implementation.source,
            source_path,
            purpose: implementation.purpose,
            strategy: implementation.strategy,
            complexity,
            assumptions: implementation.assumptions,
            test_references: implementation.test_references,
            normalization,
        });
    }
    Ok(validated)
}

fn validate_implementation_purpose(value: &str, path: &str) -> Result<(), LoadError> {
    if matches!(
        value,
        "teaching" | "concise" | "iterative" | "recursive" | "optimized"
    ) {
        Ok(())
    } else {
        Err(validation(
            path,
            "must be a supported implementation purpose",
        ))
    }
}

fn validate_normalization(value: RawNormalization, path: &str) -> Result<Normalization, LoadError> {
    if value.line_endings != "lf" {
        return Err(validation(format!("{path}.line_endings"), "must be `lf`"));
    }
    if value.whitespace != "strict" {
        return Err(validation(format!("{path}.whitespace"), "must be `strict`"));
    }
    Ok(Normalization {
        line_endings: value.line_endings,
        trailing_newline: value.trailing_newline,
        whitespace: value.whitespace,
    })
}

fn resolve_source(root: &Path, source: &str, field_path: &str) -> Result<PathBuf, LoadError> {
    if source.is_empty() || source.contains('\\') {
        return Err(validation(
            field_path,
            "must be a non-empty portable relative path",
        ));
    }
    let source_path = Path::new(source);
    if source_path.is_absolute()
        || source_path.components().any(|component| {
            matches!(
                component,
                Component::ParentDir | Component::RootDir | Component::Prefix(_)
            )
        })
    {
        return Err(validation(
            field_path,
            "must not be absolute or traverse parent directories",
        ));
    }
    if source_path
        .components()
        .any(|component| matches!(component, Component::CurDir))
    {
        return Err(validation(
            field_path,
            "must not contain current-directory segments",
        ));
    }

    let candidate = root.join(source_path);
    let canonical =
        fs::canonicalize(&candidate).map_err(|source| LoadError::SourceUnavailable {
            source_path: candidate,
            source,
        })?;
    if !canonical.starts_with(root) {
        return Err(LoadError::SourceOutsideUnit {
            source_path: canonical,
        });
    }
    if !canonical.is_file() {
        return Err(validation(field_path, "must resolve to a regular file"));
    }
    Ok(canonical)
}

fn validate_practice(
    practice: RawPractice,
    implementations: &[Implementation],
    patterns: &[Pattern],
) -> Result<PracticeDefinition, LoadError> {
    require_nonempty(&practice.shadow_typing, "practice.shadow_typing")?;
    let implementation_keys: HashSet<&str> = implementations
        .iter()
        .map(|implementation| implementation.key.as_str())
        .collect();
    let mut selected = HashSet::new();
    let mut shadow_typing = Vec::with_capacity(practice.shadow_typing.len());
    for (index, definition) in practice.shadow_typing.into_iter().enumerate() {
        let path = format!("practice.shadow_typing[{index}].implementation");
        validate_slug(&definition.implementation, &path)?;
        if !implementation_keys.contains(definition.implementation.as_str()) {
            return Err(validation(
                path,
                "does not reference a declared implementation",
            ));
        }
        if !selected.insert(definition.implementation.clone()) {
            return Err(validation(
                path,
                "duplicates a prior shadow typing implementation",
            ));
        }
        shadow_typing.push(ShadowTypingDefinition {
            implementation: definition.implementation,
            strict: definition.strict,
        });
    }

    require_nonempty(&practice.flow_recall.steps, "practice.flow_recall.steps")?;
    let mut step_ids = HashSet::new();
    let mut flow_recall_steps = Vec::with_capacity(practice.flow_recall.steps.len());
    for (index, step) in practice.flow_recall.steps.into_iter().enumerate() {
        let base = format!("practice.flow_recall.steps[{index}]");
        validate_slug(&step.id, &format!("{base}.id"))?;
        if !step_ids.insert(step.id.clone()) {
            return Err(validation(
                format!("{base}.id"),
                "duplicates a prior flow step ID",
            ));
        }
        validate_text(&step.prompt, &format!("{base}.prompt"))?;
        require_nonempty(&step.concepts, &format!("{base}.concepts"))?;
        for (concept_index, concept) in step.concepts.iter().enumerate() {
            validate_slug(concept, &format!("{base}.concepts[{concept_index}]"))?;
        }
        validate_optional_texts(&step.aliases, &format!("{base}.aliases"))?;
        flow_recall_steps.push(FlowStep {
            id: step.id,
            prompt: step.prompt,
            concepts: step.concepts,
            aliases: step.aliases,
        });
    }

    let code_recall = validate_code_recall(practice.code_recall, &implementation_keys)?;
    let reasoning_recall = validate_reasoning_recall(practice.reasoning_recall)?;
    let transfer_practice = validate_transfer_practice(practice.transfer_practice, patterns)?;

    Ok(PracticeDefinition {
        shadow_typing,
        flow_recall_steps,
        code_recall,
        reasoning_recall,
        transfer_practice,
    })
}

fn validate_code_recall(
    definitions: Vec<RawCodeRecallDefinition>,
    implementation_keys: &HashSet<&str>,
) -> Result<Vec<CodeRecallDefinition>, LoadError> {
    let mut ids = HashSet::new();
    let mut validated = Vec::with_capacity(definitions.len());
    for (index, definition) in definitions.into_iter().enumerate() {
        let base = format!("practice.code_recall[{index}]");
        validate_slug(&definition.id, &format!("{base}.id"))?;
        if !ids.insert(definition.id.clone()) {
            return Err(validation(
                format!("{base}.id"),
                "duplicates a prior code recall ID",
            ));
        }
        validate_slug(
            &definition.implementation,
            &format!("{base}.implementation"),
        )?;
        if !implementation_keys.contains(definition.implementation.as_str()) {
            return Err(validation(
                format!("{base}.implementation"),
                "does not reference a declared implementation",
            ));
        }
        validate_text(&definition.prompt, &format!("{base}.prompt"))?;
        validate_optional_texts(&definition.scaffold, &format!("{base}.scaffold"))?;
        match definition.assistance {
            CodeRecallAssistance::None if !definition.scaffold.is_empty() => {
                return Err(validation(
                    format!("{base}.scaffold"),
                    "must be empty when assistance is `none`",
                ));
            }
            CodeRecallAssistance::None => {}
            _ if definition.scaffold.is_empty() => {
                return Err(validation(
                    format!("{base}.scaffold"),
                    "must contain at least one item when assistance is enabled",
                ));
            }
            _ => {}
        }
        validated.push(CodeRecallDefinition {
            id: definition.id,
            implementation: definition.implementation,
            assistance: definition.assistance,
            prompt: definition.prompt,
            scaffold: definition.scaffold,
        });
    }
    Ok(validated)
}

fn validate_reasoning_recall(
    definitions: Vec<RawReasoningRecallDefinition>,
) -> Result<Vec<ReasoningRecallDefinition>, LoadError> {
    let mut ids = HashSet::new();
    let mut validated = Vec::with_capacity(definitions.len());
    for (index, definition) in definitions.into_iter().enumerate() {
        let base = format!("practice.reasoning_recall[{index}]");
        validate_slug(&definition.id, &format!("{base}.id"))?;
        if !ids.insert(definition.id.clone()) {
            return Err(validation(
                format!("{base}.id"),
                "duplicates a prior reasoning recall ID",
            ));
        }
        validate_text(&definition.prompt, &format!("{base}.prompt"))?;
        validate_concepts(&definition.concepts, &format!("{base}.concepts"))?;
        validate_optional_texts(&definition.aliases, &format!("{base}.aliases"))?;
        validated.push(ReasoningRecallDefinition {
            id: definition.id,
            aspect: definition.aspect,
            prompt: definition.prompt,
            concepts: definition.concepts,
            aliases: definition.aliases,
        });
    }
    Ok(validated)
}

fn validate_transfer_practice(
    definitions: Vec<RawTransferPracticeDefinition>,
    patterns: &[Pattern],
) -> Result<Vec<TransferPracticeDefinition>, LoadError> {
    let pattern_ids: HashSet<&str> = patterns.iter().map(|pattern| pattern.id.as_str()).collect();
    let mut ids = HashSet::new();
    let mut validated = Vec::with_capacity(definitions.len());
    for (index, definition) in definitions.into_iter().enumerate() {
        let base = format!("practice.transfer_practice[{index}]");
        validate_slug(&definition.id, &format!("{base}.id"))?;
        if !ids.insert(definition.id.clone()) {
            return Err(validation(
                format!("{base}.id"),
                "duplicates a prior transfer practice ID",
            ));
        }
        validate_slug(&definition.pattern, &format!("{base}.pattern"))?;
        if !pattern_ids.contains(definition.pattern.as_str()) {
            return Err(validation(
                format!("{base}.pattern"),
                "does not reference a declared pattern",
            ));
        }
        validate_text(&definition.new_case, &format!("{base}.new_case"))?;
        validate_text(&definition.prompt, &format!("{base}.prompt"))?;
        validate_concepts(&definition.concepts, &format!("{base}.concepts"))?;
        require_nonempty(&definition.transfers, &format!("{base}.transfers"))?;
        validate_optional_texts(&definition.transfers, &format!("{base}.transfers"))?;
        require_nonempty(&definition.differences, &format!("{base}.differences"))?;
        validate_optional_texts(&definition.differences, &format!("{base}.differences"))?;
        require_nonempty(&definition.boundaries, &format!("{base}.boundaries"))?;
        validate_optional_texts(&definition.boundaries, &format!("{base}.boundaries"))?;
        validated.push(TransferPracticeDefinition {
            id: definition.id,
            pattern: definition.pattern,
            new_case: definition.new_case,
            prompt: definition.prompt,
            concepts: definition.concepts,
            transfers: definition.transfers,
            differences: definition.differences,
            boundaries: definition.boundaries,
        });
    }
    Ok(validated)
}

fn validate_concepts(values: &[String], path: &str) -> Result<(), LoadError> {
    require_nonempty(values, path)?;
    let mut seen = HashSet::new();
    for (index, value) in values.iter().enumerate() {
        validate_slug(value, &format!("{path}[{index}]"))?;
        if !seen.insert(value.as_str()) {
            return Err(validation(
                format!("{path}[{index}]"),
                "duplicates a prior concept",
            ));
        }
    }
    Ok(())
}

fn validate_patterns(patterns: Vec<RawPattern>) -> Result<Vec<Pattern>, LoadError> {
    let mut ids = HashSet::new();
    let mut validated = Vec::with_capacity(patterns.len());
    for (index, pattern) in patterns.into_iter().enumerate() {
        let base = format!("patterns[{index}]");
        validate_slug(&pattern.id, &format!("{base}.id"))?;
        if !ids.insert(pattern.id.clone()) {
            return Err(validation(
                format!("{base}.id"),
                "duplicates a prior pattern ID",
            ));
        }
        validate_text(&pattern.summary, &format!("{base}.summary"))?;
        require_nonempty(&pattern.applicability, &format!("{base}.applicability"))?;
        validate_optional_texts(&pattern.applicability, &format!("{base}.applicability"))?;
        validate_optional_texts(&pattern.boundaries, &format!("{base}.boundaries"))?;
        validated.push(Pattern {
            id: pattern.id,
            summary: pattern.summary,
            applicability: pattern.applicability,
            boundaries: pattern.boundaries,
        });
    }
    Ok(validated)
}

fn validate_relationships(
    relationships: Vec<RawRelationship>,
    unit_id: &UnitId,
) -> Result<Vec<Relationship>, LoadError> {
    let mut validated = Vec::with_capacity(relationships.len());
    for (index, relationship) in relationships.into_iter().enumerate() {
        let base = format!("relationships[{index}]");
        let target = parse_unit_id(relationship.target, &format!("{base}.target"))?;
        if &target == unit_id {
            return Err(validation(
                format!("{base}.target"),
                "must not reference the current unit",
            ));
        }
        validate_text(&relationship.reason, &format!("{base}.reason"))?;
        validate_text(&relationship.boundary, &format!("{base}.boundary"))?;
        validated.push(Relationship {
            target,
            relationship_type: relationship.relationship_type,
            reason: relationship.reason,
            boundary: relationship.boundary,
        });
    }
    Ok(validated)
}

fn validate_validation(validation_state: RawValidation) -> Result<ValidationState, LoadError> {
    let last_validated_at = match validation_state.last_validated_at {
        RawNullableString::Value(value) => {
            validate_text(&value, "validation.last_validated_at")?;
            Some(value)
        }
        RawNullableString::Null(()) => None,
    };
    Ok(ValidationState {
        schema: validation_state.schema,
        code: validation_state.code,
        content_review: validation_state.content_review,
        transfer_review: validation_state.transfer_review,
        last_validated_at,
    })
}

fn validate_provenance(provenance: RawProvenance) -> Result<Provenance, LoadError> {
    require_nonempty(&provenance.authors, "provenance.authors")?;
    validate_optional_texts(&provenance.authors, "provenance.authors")?;
    validate_optional_texts(&provenance.reviewed_by, "provenance.reviewed_by")?;
    validate_text(&provenance.license, "provenance.license")?;
    let generated_by = match provenance.generated_by {
        RawNullableGenerator::Value(generator) => {
            validate_text(&generator.provider, "provenance.generated_by.provider")?;
            validate_text(&generator.model, "provenance.generated_by.model")?;
            validate_text(
                &generator.task_version,
                "provenance.generated_by.task_version",
            )?;
            validate_text(
                &generator.generated_at,
                "provenance.generated_by.generated_at",
            )?;
            Some(Generator {
                provider: generator.provider,
                model: generator.model,
                task_version: generator.task_version,
                generated_at: generator.generated_at,
            })
        }
        RawNullableGenerator::Null(()) => None,
    };
    let mut sources = Vec::with_capacity(provenance.sources.len());
    for (index, source) in provenance.sources.into_iter().enumerate() {
        let base = format!("provenance.sources[{index}]");
        validate_text(&source.title, &format!("{base}.title"))?;
        validate_text(&source.url, &format!("{base}.url"))?;
        validate_source_role(&source.role, &format!("{base}.role"))?;
        validate_text(&source.accessed_at, &format!("{base}.accessed_at"))?;
        sources.push(Source {
            title: source.title,
            url: source.url,
            role: source.role,
            accessed_at: source.accessed_at,
        });
    }
    Ok(Provenance {
        authors: provenance.authors,
        generated_by,
        reviewed_by: provenance.reviewed_by,
        sources,
        license: provenance.license,
    })
}

fn validate_source_role(value: &str, path: &str) -> Result<(), LoadError> {
    if matches!(value, "primary" | "synthesis" | "lead") {
        Ok(())
    } else {
        Err(validation(path, "must be a supported source role"))
    }
}

fn validate_supersedes(
    raw_supersedes: Vec<RawSupersededRevision>,
    revision: Revision,
) -> Result<Vec<SupersededRevision>, LoadError> {
    let mut seen = HashSet::new();
    let mut supersedes = Vec::with_capacity(raw_supersedes.len());
    for (index, raw) in raw_supersedes.into_iter().enumerate() {
        let base = format!("supersedes[{index}]");
        let replaced = parse_revision(raw.revision, &format!("{base}.revision"))?;
        if replaced >= revision {
            return Err(validation(
                format!("{base}.revision"),
                "must reference an earlier revision",
            ));
        }
        if !seen.insert(replaced) {
            return Err(validation(
                format!("{base}.revision"),
                "duplicates a prior revision link",
            ));
        }
        validate_text(&raw.reason, &format!("{base}.reason"))?;
        supersedes.push(SupersededRevision {
            revision: replaced,
            reason: raw.reason,
        });
    }
    Ok(supersedes)
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RawAlgorithmUnit {
    schema_version: String,
    id: String,
    revision: u64,
    status: ContentStatus,
    title: String,
    #[serde(default)]
    tags: Vec<String>,
    position: RawPosition,
    problem: RawProblem,
    understanding: RawUnderstanding,
    implementations: Vec<RawImplementation>,
    #[serde(default)]
    patterns: Vec<RawPattern>,
    #[serde(default)]
    relationships: Vec<RawRelationship>,
    practice: RawPractice,
    validation: RawValidation,
    provenance: RawProvenance,
    supersedes: Vec<RawSupersededRevision>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RawPosition {
    domain: String,
    category: String,
    prerequisites: Vec<String>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RawProblem {
    question: String,
    scope: Vec<String>,
    out_of_scope: Vec<String>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RawUnderstanding {
    summary: String,
    confidence: Confidence,
    alternatives: Vec<String>,
    failure_conditions: Vec<String>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RawImplementation {
    key: String,
    language: String,
    source: String,
    purpose: String,
    #[serde(default)]
    strategy: Option<String>,
    #[serde(default)]
    complexity: Option<RawImplementationComplexity>,
    #[serde(default)]
    assumptions: Vec<String>,
    #[serde(default)]
    test_references: Vec<String>,
    normalization: RawNormalization,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RawImplementationComplexity {
    time: String,
    space: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RawNormalization {
    line_endings: String,
    trailing_newline: bool,
    whitespace: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RawPattern {
    id: String,
    summary: String,
    applicability: Vec<String>,
    boundaries: Vec<String>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RawRelationship {
    target: String,
    #[serde(rename = "type")]
    relationship_type: RelationshipType,
    reason: String,
    boundary: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RawPractice {
    shadow_typing: Vec<RawShadowTypingDefinition>,
    flow_recall: RawFlowRecall,
    #[serde(default)]
    code_recall: Vec<RawCodeRecallDefinition>,
    #[serde(default)]
    reasoning_recall: Vec<RawReasoningRecallDefinition>,
    #[serde(default)]
    transfer_practice: Vec<RawTransferPracticeDefinition>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RawShadowTypingDefinition {
    implementation: String,
    strict: bool,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RawFlowRecall {
    steps: Vec<RawFlowStep>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RawFlowStep {
    id: String,
    prompt: String,
    concepts: Vec<String>,
    aliases: Vec<String>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RawCodeRecallDefinition {
    id: String,
    implementation: String,
    assistance: CodeRecallAssistance,
    prompt: String,
    scaffold: Vec<String>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RawReasoningRecallDefinition {
    id: String,
    aspect: ReasoningAspect,
    prompt: String,
    concepts: Vec<String>,
    aliases: Vec<String>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RawTransferPracticeDefinition {
    id: String,
    pattern: String,
    new_case: String,
    prompt: String,
    concepts: Vec<String>,
    transfers: Vec<String>,
    differences: Vec<String>,
    boundaries: Vec<String>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RawValidation {
    schema: CheckStatus,
    code: CheckStatus,
    content_review: CheckStatus,
    transfer_review: CheckStatus,
    last_validated_at: RawNullableString,
}

#[derive(Deserialize)]
#[serde(untagged)]
enum RawNullableString {
    Value(String),
    Null(()),
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RawProvenance {
    authors: Vec<String>,
    generated_by: RawNullableGenerator,
    reviewed_by: Vec<String>,
    sources: Vec<RawSource>,
    license: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RawGenerator {
    provider: String,
    model: String,
    task_version: String,
    generated_at: String,
}

#[derive(Deserialize)]
#[serde(untagged)]
enum RawNullableGenerator {
    Value(RawGenerator),
    Null(()),
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RawSource {
    title: String,
    url: String,
    role: String,
    accessed_at: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RawSupersededRevision {
    revision: u64,
    reason: String,
}
