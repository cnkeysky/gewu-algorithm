use std::{error::Error, path::PathBuf};

use gewu_domain::{
    CheckStatus, CodeRecallAssistance, CodeRecallLayout, Confidence, ReasoningAspect,
    RelationshipType,
};
use gewu_template::{LoadError, load_algorithm_unit};

fn fixture(path: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../fixtures/algorithm-units")
        .join(path)
}

#[test]
fn loads_bfs_with_a_contained_source_file() -> Result<(), Box<dyn Error>> {
    let unit = load_algorithm_unit(fixture("valid/graph/bfs/unit.json"))?;

    assert_eq!(unit.id.as_str(), "graph.bfs");
    assert_eq!(unit.revision.get(), 1);
    assert_eq!(unit.tags, ["graph", "queue", "traversal"]);
    assert_eq!(unit.position.domain, "graph");
    assert_eq!(
        unit.position.prerequisites[0].as_str(),
        "graph.representation"
    );
    assert!(unit.problem.question.contains("nondecreasing distance"));
    assert_eq!(unit.understanding.confidence, Confidence::Medium);
    assert_eq!(unit.implementations.len(), 1);
    assert_eq!(unit.implementations[0].source, "code/python.py");
    assert_eq!(unit.implementations[0].purpose, "teaching");
    assert_eq!(
        unit.implementations[0].strategy.as_deref(),
        Some("fifo-frontier")
    );
    assert_eq!(
        unit.implementations[0]
            .complexity
            .as_ref()
            .map(|value| value.time.as_str()),
        Some("O(V + E)")
    );
    assert_eq!(
        unit.implementations[0].test_references,
        ["tests/python_test.py"]
    );
    assert!(unit.implementations[0].normalization.trailing_newline);
    assert!(
        unit.implementations[0]
            .source_path
            .ends_with("code/python.py")
    );
    assert_eq!(
        unit.practice.shadow_typing[0].implementation,
        "python-teaching"
    );
    assert_eq!(unit.practice.code_recall.len(), 4);
    assert_eq!(
        unit.practice.code_recall[0].assistance,
        CodeRecallAssistance::Comments
    );
    assert_eq!(
        unit.practice.code_recall[0].layout,
        CodeRecallLayout::CommentToCode
    );
    assert_eq!(
        unit.practice.code_recall[1].layout,
        CodeRecallLayout::CommentGuided
    );
    assert_eq!(
        unit.practice.code_recall[1].slots[0].cue.as_deref(),
        Some("Remove the next FIFO frontier node.")
    );
    assert!(unit.practice.code_recall[2].scaffold.is_empty());
    assert_eq!(unit.practice.code_recall[3].layout, CodeRecallLayout::Cloze);
    assert_eq!(unit.practice.code_recall[3].slots.len(), 1);
    assert_eq!(
        unit.practice.reasoning_recall[0].id,
        "fifo-shortest-distance"
    );
    assert_eq!(
        unit.practice.reasoning_recall[0].aspect,
        ReasoningAspect::Invariant
    );
    assert_eq!(
        unit.practice.transfer_practice[0].pattern,
        "frontier-expansion"
    );
    assert!(unit.practice.transfer_practice[0].new_case.contains("grid"));
    assert_eq!(unit.practice.transfer_practice[0].transfers.len(), 1);
    assert_eq!(unit.patterns[0].id, "frontier-expansion");
    assert_eq!(
        unit.relationships[0].relationship_type,
        RelationshipType::ContrastsWith
    );
    assert!(unit.relationships[0].boundary.contains("DFS"));
    assert_eq!(unit.validation.schema, CheckStatus::Passed);
    assert_eq!(unit.provenance.license, "MIT");
    Ok(())
}

#[test]
fn loads_a_contrasting_binary_search_unit() -> Result<(), Box<dyn Error>> {
    let unit = load_algorithm_unit(fixture("valid/search/binary-search/unit.json"))?;

    assert_eq!(unit.id.as_str(), "search.binary-search");
    assert_eq!(unit.practice.flow_recall_steps.len(), 2);
    assert_eq!(unit.practice.code_recall.len(), 1);
    assert_eq!(
        unit.practice.code_recall[0].assistance,
        CodeRecallAssistance::Keywords
    );
    assert_eq!(unit.practice.transfer_practice[0].id, "first-true");
    assert_eq!(unit.patterns[0].id, "interval-halving");
    assert_eq!(
        unit.relationships[0].target.as_str(),
        "search.linear-search"
    );
    Ok(())
}

#[test]
fn rejects_a_non_dotted_unit_id() {
    let result = load_algorithm_unit(fixture("invalid/invalid-id.json"));

    match result {
        Err(LoadError::Validation { path, .. }) => assert_eq!(path, "id"),
        other => panic!("expected an ID validation error, got {other:?}"),
    }
}

#[test]
fn rejects_an_unsupported_schema_version() {
    let result = load_algorithm_unit(fixture("invalid/unsupported-schema.json"));

    match result {
        Err(LoadError::UnsupportedSchemaVersion { found }) => assert_eq!(found, "1"),
        other => panic!("expected an unsupported schema error, got {other:?}"),
    }
}

#[test]
fn rejects_schema_v2_without_a_problem_statement() {
    let result = load_algorithm_unit(fixture("invalid/missing-statement.json"));

    match result {
        Err(LoadError::InvalidJson { source, .. }) => {
            assert!(source.to_string().contains("missing field `statement`"));
        }
        other => panic!("expected a required statement error, got {other:?}"),
    }
}

#[test]
fn rejects_a_missing_implementation_source() {
    let result = load_algorithm_unit(fixture("invalid/missing-source.json"));

    assert!(matches!(result, Err(LoadError::SourceUnavailable { .. })));
}

#[test]
fn rejects_a_traversing_implementation_source() {
    let result = load_algorithm_unit(fixture("invalid/traversing-source.json"));

    match result {
        Err(LoadError::Validation { path, .. }) => assert_eq!(path, "implementations[0].source"),
        other => panic!("expected a source path validation error, got {other:?}"),
    }
}

#[test]
fn rejects_shadow_typing_that_references_an_unknown_implementation() {
    let result = load_algorithm_unit(fixture("invalid/unknown-shadow/unit.json"));

    match result {
        Err(LoadError::Validation { path, .. }) => {
            assert_eq!(path, "practice.shadow_typing[0].implementation");
        }
        other => panic!("expected a shadow typing reference error, got {other:?}"),
    }
}

#[test]
fn rejects_code_recall_that_references_an_unknown_implementation() {
    let result = load_algorithm_unit(fixture("invalid/unknown-code-recall/unit.json"));

    match result {
        Err(LoadError::Validation { path, .. }) => {
            assert_eq!(path, "practice.code_recall[0].implementation");
        }
        other => panic!("expected a code recall reference error, got {other:?}"),
    }
}

#[test]
fn rejects_duplicate_reasoning_recall_ids() {
    let result = load_algorithm_unit(fixture("invalid/duplicate-reasoning-recall/unit.json"));

    match result {
        Err(LoadError::Validation { path, .. }) => {
            assert_eq!(path, "practice.reasoning_recall[1].id");
        }
        other => panic!("expected a reasoning recall ID error, got {other:?}"),
    }
}
