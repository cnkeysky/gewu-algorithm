#![forbid(unsafe_code)]
//! Deterministic, platform-independent review scheduling and progression policy.

use std::collections::BTreeMap;

use gewu_domain::{PracticeMode, Revision, UnitId};
use serde::{Deserialize, Serialize};

pub const POLICY_VERSION: &str = "review-v1";

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AttemptFact {
    pub id: String,
    pub unit_id: UnitId,
    pub revision: Revision,
    pub mode: PracticeMode,
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
    pub kind: RecommendationKind,
    pub priority: RecommendationPriority,
    pub reason: String,
    /// The minimum delay before the recommendation is due.
    pub due_after_days: u32,
    pub source_attempt_ids: Vec<String>,
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
    let mut groups: BTreeMap<(UnitId, Revision, PracticeMode), Vec<&AttemptFact>> = BTreeMap::new();
    for attempt in attempts {
        groups
            .entry((attempt.unit_id.clone(), attempt.revision, attempt.mode))
            .or_default()
            .push(attempt);
    }
    groups.into_iter().map(|((unit_id, revision, mode), mut values)| {
        values.sort_by(|left, right| left.id.cmp(&right.id));
        let source_attempt_ids = values.iter().map(|value| value.id.clone()).collect();
        let completed = values.iter().filter(|value| value.terminal_reason == TerminalReason::Completed).count();
        let stopped = values.len() - completed;
        if completed == 0 {
            return ReviewRecommendation { policy_version: POLICY_VERSION.to_owned(), unit_id, revision, mode, kind: RecommendationKind::Inconclusive, priority: RecommendationPriority::Low, reason: "Only interrupted attempts are available; no progression decision is made.".to_owned(), due_after_days: 0, source_attempt_ids };
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
        ReviewRecommendation { policy_version: POLICY_VERSION.to_owned(), unit_id, revision, mode, kind, priority, reason, due_after_days, source_attempt_ids }
    }).collect()
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
}
