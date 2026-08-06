#![forbid(unsafe_code)]
//! Deterministic, platform-independent review scheduling and progression policy.

use std::collections::BTreeMap;

use gewu_domain::{PracticeMode, Revision, UnitId};
use serde::{Deserialize, Serialize};

pub const POLICY_VERSION: &str = "review-v1";
const MIN_STABILITY_DAYS: f64 = 1.0;
const MAX_STABILITY_DAYS: f64 = 180.0;

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AttemptFact {
    pub id: String,
    pub unit_id: UnitId,
    pub revision: Revision,
    pub mode: PracticeMode,
    pub implementation: Option<String>,
    pub practice_id: Option<String>,
    pub terminal_reason: TerminalReason,
    pub accepted: u64,
    pub rejected: u64,
    pub prompts: u64,
    pub scaffold_reveals: u64,
    pub active_ms: u64,
    pub wall_ms: u64,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum TerminalReason {
    Completed,
    Stopped,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum RecommendationKind {
    Review,
    Progress,
    Inconclusive,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum RecommendationPriority {
    Low,
    Normal,
    High,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct ReviewRecommendation {
    pub policy_version: String,
    pub unit_id: UnitId,
    pub revision: Revision,
    pub mode: PracticeMode,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub implementation: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub practice_id: Option<String>,
    pub kind: RecommendationKind,
    pub priority: RecommendationPriority,
    pub reason: String,
    /// The minimum delay before the recommendation is due.
    pub due_after_days: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub due_at_ms: Option<u64>,
    pub source_attempt_ids: Vec<String>,
}

/// Persisted per-unit scheduler state. This is intentionally small and
/// contains only values that affect future scheduling.
#[derive(Clone, Debug, PartialEq)]
pub struct ReviewState {
    pub unit_id: UnitId,
    pub revision: Revision,
    pub mode: PracticeMode,
    pub implementation: Option<String>,
    pub practice_id: Option<String>,
    pub last_reviewed_at_ms: u64,
    pub next_due_at_ms: u64,
    pub stability_days: f64,
    pub difficulty: f64,
    pub scheduler_version: String,
    pub model_version: Option<String>,
    pub success_count: u64,
    pub failure_count: u64,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum UserChoice {
    FollowRecommendation,
    OverrideMode(PracticeMode),
    Dismiss,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct ReviewDecision {
    pub recommendation: ReviewRecommendation,
    pub choice: UserChoice,
}

/// Derives one stable recommendation per unit/revision/mode from terminal attempts.
pub fn recommend(attempts: &[AttemptFact]) -> Vec<ReviewRecommendation> {
    let mut groups: BTreeMap<(UnitId, Revision, PracticeMode, Option<String>, Option<String>), Vec<&AttemptFact>> = BTreeMap::new();
    for attempt in attempts {
        groups
            .entry((attempt.unit_id.clone(), attempt.revision, attempt.mode, attempt.implementation.clone(), attempt.practice_id.clone()))
            .or_default()
            .push(attempt);
    }
    groups.into_iter().map(|((unit_id, revision, mode, implementation, practice_id), mut values)| {
        values.sort_by(|left, right| left.id.cmp(&right.id));
        let source_attempt_ids = values.iter().map(|value| value.id.clone()).collect();
        let completed = values.iter().filter(|value| value.terminal_reason == TerminalReason::Completed).count();
        let stopped = values.len() - completed;
        if completed == 0 {
            return ReviewRecommendation { policy_version: POLICY_VERSION.to_owned(), unit_id, revision, mode, implementation, practice_id, kind: RecommendationKind::Inconclusive, priority: RecommendationPriority::Low, reason: "Only interrupted attempts are available; no progression decision is made.".to_owned(), due_after_days: 0, due_at_ms: None, source_attempt_ids };
        }
        let rejected: u64 = values.iter().map(|value| value.rejected).sum();
        let dependence: u64 = values.iter().map(|value| value.prompts + value.scaffold_reveals).sum();
        let (kind, priority, due_after_days, reason) = if dependence > 0 || rejected > 0 {
            (RecommendationKind::Review, RecommendationPriority::High, 1, "Review the same unit with less assistance and verify reconstruction.".to_owned())
        } else if completed >= 2 && stopped == 0 {
            (RecommendationKind::Progress, RecommendationPriority::Normal, 7, "Progress to a related or transfer practice after repeated independent completion.".to_owned())
        } else {
            (RecommendationKind::Review, RecommendationPriority::Normal, 3, "Schedule a delayed independent review to test retention.".to_owned())
        };
        ReviewRecommendation { policy_version: POLICY_VERSION.to_owned(), unit_id, revision, mode, implementation, practice_id, kind, priority, reason, due_after_days, due_at_ms: None, source_attempt_ids }
    }).collect()
}

/// Updates a scheduler state using an Ebbinghaus-inspired stability estimate.
/// The model is deliberately bounded and deterministic so it is safe on CPU
/// and reproducible without a remote service.
pub fn update_state(
    previous: Option<&ReviewState>,
    attempt: &AttemptFact,
    now_ms: u64,
) -> ReviewState {
    let previous_stability = previous.map_or(1.0, |state| state.stability_days);
    let assistance = attempt.prompts + attempt.scaffold_reveals;
    let difficulty = if attempt.terminal_reason == TerminalReason::Completed {
        (previous.map_or(0.5, |state| state.difficulty) * 0.9
            + if attempt.rejected > 0 || assistance > 0 {
                0.7
            } else {
                0.2
            })
        .clamp(0.1, 1.0)
    } else {
        previous
            .map_or(0.7, |state| state.difficulty)
            .clamp(0.1, 1.0)
    };
    let stability_days = if attempt.terminal_reason == TerminalReason::Completed {
        let success_factor = if attempt.rejected == 0 && assistance == 0 {
            2.2
        } else {
            1.25
        };
        (previous_stability * success_factor * (1.05 - difficulty * 0.25))
            .clamp(MIN_STABILITY_DAYS, MAX_STABILITY_DAYS)
    } else {
        (previous_stability * 0.75).clamp(MIN_STABILITY_DAYS, MAX_STABILITY_DAYS)
    };
    ReviewState {
        unit_id: attempt.unit_id.clone(),
        revision: attempt.revision,
        mode: attempt.mode,
        implementation: attempt.implementation.clone(),
        practice_id: attempt.practice_id.clone(),
        last_reviewed_at_ms: now_ms,
        next_due_at_ms: now_ms.saturating_add((stability_days * 86_400_000.0) as u64),
        stability_days,
        difficulty,
        scheduler_version: POLICY_VERSION.to_owned(),
        model_version: previous.and_then(|state| state.model_version.clone()),
        success_count: previous.map_or(0, |state| state.success_count)
            + u64::from(attempt.terminal_reason == TerminalReason::Completed),
        failure_count: previous.map_or(0, |state| state.failure_count)
            + u64::from(attempt.terminal_reason == TerminalReason::Stopped || attempt.rejected > 0),
    }
}

pub fn apply_choice(recommendation: ReviewRecommendation, choice: UserChoice) -> ReviewDecision {
    ReviewDecision {
        recommendation,
        choice,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fact(
        id: &str,
        mode: PracticeMode,
        terminal_reason: TerminalReason,
        rejected: u64,
        prompts: u64,
    ) -> AttemptFact {
        AttemptFact {
            id: id.to_owned(),
            unit_id: UnitId::parse("graph.bfs").unwrap(),
            revision: Revision::new(1).unwrap(),
            mode,
            implementation: None,
            practice_id: None,
            terminal_reason,
            accepted: 10,
            rejected,
            prompts,
            scaffold_reveals: 0,
            active_ms: 100,
            wall_ms: 100,
        }
    }

    #[test]
    fn assistance_dependence_requires_high_priority_review() {
        let result = recommend(&[fact(
            "a",
            PracticeMode::CodeRecall,
            TerminalReason::Completed,
            0,
            1,
        )]);
        assert_eq!(result[0].priority, RecommendationPriority::High);
        assert_eq!(result[0].due_after_days, 1);
    }

    #[test]
    fn interrupted_only_history_is_inconclusive() {
        let result = recommend(&[fact(
            "a",
            PracticeMode::ShadowTyping,
            TerminalReason::Stopped,
            0,
            0,
        )]);
        assert_eq!(result[0].kind, RecommendationKind::Inconclusive);
        assert_eq!(result[0].source_attempt_ids, vec!["a"]);
    }

    #[test]
    fn repeated_independent_completion_allows_progression() {
        let history = [
            fact(
                "b",
                PracticeMode::ShadowTyping,
                TerminalReason::Completed,
                0,
                0,
            ),
            fact(
                "a",
                PracticeMode::ShadowTyping,
                TerminalReason::Completed,
                0,
                0,
            ),
        ];
        let result = recommend(&history);
        assert_eq!(result[0].kind, RecommendationKind::Progress);
        assert_eq!(result[0].due_after_days, 7);
        let reversed = [history[1].clone(), history[0].clone()];
        assert_eq!(recommend(&history), recommend(&reversed));
    }

    #[test]
    fn user_override_does_not_change_source_history() {
        let recommendation = recommend(&[fact(
            "a",
            PracticeMode::CodeRecall,
            TerminalReason::Completed,
            0,
            0,
        )])
        .remove(0);
        let decision = apply_choice(
            recommendation.clone(),
            UserChoice::OverrideMode(PracticeMode::TransferPractice),
        );
        assert_eq!(
            decision.recommendation.source_attempt_ids,
            recommendation.source_attempt_ids
        );
        assert_eq!(
            decision.choice,
            UserChoice::OverrideMode(PracticeMode::TransferPractice)
        );
    }

    #[test]
    fn stability_grows_for_independent_completion_and_shrinks_for_interruption() {
        let completed = fact(
            "a",
            PracticeMode::CodeRecall,
            TerminalReason::Completed,
            0,
            0,
        );
        let first = update_state(None, &completed, 1_000);
        let second = update_state(Some(&first), &completed, 2_000);
        assert!(second.stability_days > first.stability_days);
        let stopped = fact("b", PracticeMode::CodeRecall, TerminalReason::Stopped, 0, 0);
        let interrupted = update_state(Some(&second), &stopped, 3_000);
        assert!(interrupted.stability_days < second.stability_days);
    }
}
