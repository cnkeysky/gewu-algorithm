#![forbid(unsafe_code)]
//! Stable domain types shared by GEWU application crates.

use std::{fmt, num::NonZeroU64, path::PathBuf, str::FromStr};

use serde::{Deserialize, Serialize};
use thiserror::Error;

/// A stable, dotted identifier for an algorithm unit, such as `graph.bfs`.
#[derive(Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(transparent)]
pub struct UnitId(String);

impl UnitId {
    /// Parses a dotted lowercase ASCII identifier.
    pub fn parse(value: impl AsRef<str>) -> Result<Self, UnitIdError> {
        let value = value.as_ref();
        if is_valid_unit_id(value) {
            Ok(Self(value.to_owned()))
        } else {
            Err(UnitIdError {
                value: value.to_owned(),
            })
        }
    }

    /// Returns the canonical serialized identifier.
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl fmt::Display for UnitId {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.0)
    }
}

impl FromStr for UnitId {
    type Err = UnitIdError;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        Self::parse(value)
    }
}

impl<'de> Deserialize<'de> for UnitId {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        let value = String::deserialize(deserializer)?;
        Self::parse(value).map_err(serde::de::Error::custom)
    }
}

fn is_valid_unit_id(value: &str) -> bool {
    let mut components = value.split('.');
    let Some(first) = components.next() else {
        return false;
    };

    is_valid_component(first)
        && components.next().is_some_and(is_valid_component)
        && components.all(is_valid_component)
}

fn is_valid_component(component: &str) -> bool {
    let mut characters = component.bytes();
    let Some(first) = characters.next() else {
        return false;
    };
    if !first.is_ascii_lowercase() && !first.is_ascii_digit() {
        return false;
    }

    let mut previous_hyphen = false;
    for character in characters {
        if character == b'-' {
            if previous_hyphen {
                return false;
            }
            previous_hyphen = true;
        } else if character.is_ascii_lowercase() || character.is_ascii_digit() {
            previous_hyphen = false;
        } else {
            return false;
        }
    }
    !previous_hyphen
}

/// An error returned when a [`UnitId`] does not use its canonical syntax.
#[derive(Clone, Debug, Error, Eq, PartialEq)]
#[error("`{value}` is not a dotted lowercase algorithm unit ID")]
pub struct UnitIdError {
    value: String,
}

/// A positive, immutable revision within one [`UnitId`].
#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(transparent)]
pub struct Revision(NonZeroU64);

impl Revision {
    /// Creates a revision when `value` is at least one.
    pub fn new(value: u64) -> Result<Self, RevisionError> {
        NonZeroU64::new(value)
            .map(Self)
            .ok_or(RevisionError { value })
    }

    /// Returns the serialized revision number.
    pub fn get(self) -> u64 {
        self.0.get()
    }
}

impl fmt::Display for Revision {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.get().fmt(formatter)
    }
}

impl TryFrom<u64> for Revision {
    type Error = RevisionError;

    fn try_from(value: u64) -> Result<Self, Self::Error> {
        Self::new(value)
    }
}

impl<'de> Deserialize<'de> for Revision {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        let value = u64::deserialize(deserializer)?;
        Self::new(value).map_err(serde::de::Error::custom)
    }
}

/// An error returned when a revision is zero.
#[derive(Clone, Copy, Debug, Error, Eq, PartialEq)]
#[error("revision must be at least 1, got {value}")]
pub struct RevisionError {
    value: u64,
}

/// Publication lifecycle for an algorithm unit.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ContentStatus {
    Draft,
    Reviewed,
    Validated,
    Deprecated,
    Revised,
}

/// The reviewed confidence associated with a unit's understanding summary.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Confidence {
    Low,
    Medium,
    High,
}

/// A directed semantic relationship between algorithm units.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum RelationshipType {
    DependsOn,
    Influences,
    AnalogousTo,
    ContrastsWith,
    ComposesWith,
    Generalizes,
    Specializes,
    Supersedes,
}

/// Outcome of one declared content validation check.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum CheckStatus {
    Pending,
    Passed,
    Failed,
    NotApplicable,
}

/// A stable practice interaction and scoring contract.
#[derive(Clone, Copy, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum PracticeMode {
    ShadowTyping,
    FlowRecall,
    CodeRecall,
    ReasoningRecall,
    TransferPractice,
}

/// A validated, versioned algorithm learning unit.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AlgorithmUnit {
    pub schema_version: String,
    pub id: UnitId,
    pub revision: Revision,
    pub status: ContentStatus,
    pub title: String,
    pub tags: Vec<String>,
    pub position: Position,
    pub problem: Problem,
    pub understanding: Understanding,
    pub implementations: Vec<Implementation>,
    pub patterns: Vec<Pattern>,
    pub relationships: Vec<Relationship>,
    pub practice: PracticeDefinition,
    pub validation: ValidationState,
    pub provenance: Provenance,
    pub supersedes: Vec<SupersededRevision>,
}

/// Position of an algorithm unit in the broader knowledge system.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Position {
    pub domain: String,
    pub category: String,
    pub prerequisites: Vec<UnitId>,
}

/// Problem statement and explicit applicability scope.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Problem {
    pub question: String,
    /// Markdown statement shown during practice.
    pub statement: String,
    pub scope: Vec<String>,
    pub out_of_scope: Vec<String>,
}

/// Current reviewed understanding, alternatives, and failure conditions.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Understanding {
    pub summary: String,
    pub confidence: Confidence,
    pub alternatives: Vec<String>,
    pub failure_conditions: Vec<String>,
}

/// A validated implementation and its resolved source path.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Implementation {
    pub key: String,
    pub language: String,
    pub source: String,
    pub source_path: PathBuf,
    pub purpose: String,
    pub strategy: Option<String>,
    pub complexity: Option<ImplementationComplexity>,
    pub assumptions: Vec<String>,
    pub test_references: Vec<String>,
    pub normalization: Normalization,
}

/// Reviewed asymptotic bounds for one implementation variant.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ImplementationComplexity {
    pub time: String,
    pub space: String,
}

/// Text-normalization contract for exact reconstruction.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Normalization {
    pub line_endings: String,
    pub trailing_newline: bool,
    pub whitespace: String,
}

/// A transferable algorithm pattern and its boundaries.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Pattern {
    pub id: String,
    pub summary: String,
    pub applicability: Vec<String>,
    pub boundaries: Vec<String>,
}

/// A directed relationship with an explicit reason and boundary.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Relationship {
    pub target: UnitId,
    pub relationship_type: RelationshipType,
    pub reason: String,
    pub boundary: String,
}

/// Practice definitions that can be consumed without the template loader.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PracticeDefinition {
    pub shadow_typing: Vec<ShadowTypingDefinition>,
    pub flow_recall_steps: Vec<FlowStep>,
    pub code_recall: Vec<CodeRecallDefinition>,
    pub reasoning_recall: Vec<ReasoningRecallDefinition>,
    pub transfer_practice: Vec<TransferPracticeDefinition>,
}

/// One exact-match practice configuration.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ShadowTypingDefinition {
    pub implementation: String,
    pub strict: bool,
}

/// One conceptual recall step.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct FlowStep {
    pub id: String,
    pub prompt: String,
    pub concepts: Vec<String>,
    pub aliases: Vec<String>,
}

/// The visible support retained while reconstructing an implementation.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum CodeRecallAssistance {
    Skeleton,
    Comments,
    Keywords,
    Cloze,
    None,
}

/// The interaction layout for a Code Recall projection.
#[derive(Clone, Copy, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum CodeRecallLayout {
    #[default]
    FullRecall,
    CommentGuided,
    CommentToCode,
    Cloze,
}

/// One reduced-guidance code reconstruction configuration.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CodeRecallDefinition {
    pub id: String,
    pub implementation: String,
    pub layout: CodeRecallLayout,
    pub assistance: CodeRecallAssistance,
    pub prompt: String,
    pub scaffold: Vec<String>,
    pub source_template: Option<String>,
    pub slots: Vec<CodeRecallSlotDefinition>,
}

/// One reviewed editable region in a structured Code Recall layout.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CodeRecallSlotDefinition {
    pub id: String,
    pub cue: Option<String>,
    pub expected: String,
}

/// One deterministic recall prompt about an algorithm's mechanism or boundaries.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ReasoningAspect {
    Mechanism,
    Invariant,
    TradeOff,
    Boundary,
    FailureCondition,
}

/// One deterministic recall prompt about an algorithm's mechanism or boundaries.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ReasoningRecallDefinition {
    pub id: String,
    pub aspect: ReasoningAspect,
    pub prompt: String,
    pub concepts: Vec<String>,
    pub aliases: Vec<String>,
}

/// One new-case practice configuration grounded in a declared algorithm pattern.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TransferPracticeDefinition {
    pub id: String,
    pub pattern: String,
    pub new_case: String,
    pub prompt: String,
    pub concepts: Vec<String>,
    pub transfers: Vec<String>,
    pub differences: Vec<String>,
    pub boundaries: Vec<String>,
}

/// A link from this revision to a prior revision.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SupersededRevision {
    pub revision: Revision,
    pub reason: String,
}

/// Declared validation outcomes for one content revision.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ValidationState {
    pub schema: CheckStatus,
    pub code: CheckStatus,
    pub content_review: CheckStatus,
    pub transfer_review: CheckStatus,
    pub last_validated_at: Option<String>,
}

/// Authorship, generation, review, sources, and license information.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Provenance {
    pub authors: Vec<String>,
    pub generated_by: Option<Generator>,
    pub reviewed_by: Vec<String>,
    pub sources: Vec<Source>,
    pub license: String,
}

/// Model provenance for generated draft content.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Generator {
    pub provider: String,
    pub model: String,
    pub task_version: String,
    pub generated_at: String,
}

/// A source cited by reusable content.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Source {
    pub title: String,
    pub url: String,
    pub role: String,
    pub accessed_at: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unit_id_accepts_dotted_lowercase_components() {
        let id = UnitId::parse("data-structure.queue");
        assert_eq!(
            id.map(|value| value.to_string()),
            Ok("data-structure.queue".to_owned())
        );
    }

    #[test]
    fn unit_id_rejects_noncanonical_values() {
        for value in [
            "graph",
            "Graph.bfs",
            "graph..bfs",
            "graph.-bfs",
            "graph.bfs-",
        ] {
            assert!(UnitId::parse(value).is_err(), "{value} should be rejected");
        }
    }

    #[test]
    fn revision_rejects_zero() {
        assert_eq!(Revision::new(0), Err(RevisionError { value: 0 }));
    }

    #[test]
    fn practice_mode_uses_canonical_serialization() {
        match serde_json::to_string(&PracticeMode::ShadowTyping) {
            Ok(serialized) => assert_eq!(serialized, "\"shadow_typing\""),
            Err(error) => panic!("practice mode serialization failed: {error}"),
        }
    }
}
