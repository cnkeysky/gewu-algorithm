use std::time::Duration;

use gewu_domain::{
    ReasoningAspect, ReasoningRecallDefinition, Revision, TransferPracticeDefinition, UnitId,
};
use gewu_practice::{
    ElapsedTime, ReasoningRecallConfig, ReasoningRecallEvent, ReasoningRecallOutcome,
    ReasoningRecallSession, TerminalReason, TransferPracticeConfig, TransferPracticeEvent,
    TransferPracticeOutcome, TransferPracticeSession,
};

fn elapsed(seconds: u64) -> ElapsedTime {
    ElapsedTime::new(Duration::from_secs(seconds), Duration::from_secs(seconds))
        .unwrap_or_else(|error| panic!("elapsed: {error}"))
}

fn unit() -> UnitId {
    UnitId::parse("graph.bfs").unwrap_or_else(|error| panic!("unit: {error}"))
}

fn reasoning() -> ReasoningRecallSession {
    ReasoningRecallSession::start(ReasoningRecallConfig::new(
        unit(),
        Revision::new(1).unwrap_or_else(|error| panic!("revision: {error}")),
        "1",
        vec![ReasoningRecallDefinition {
            id: "queue-invariant".to_owned(),
            implementation: None,
            aspect: ReasoningAspect::Invariant,
            prompt: "Why does the queue preserve breadth-first order?".to_owned(),
            concepts: vec!["queue".to_owned(), "invariant".to_owned()],
            aliases: vec!["frontier invariant".to_owned()],
        }],
    ))
    .unwrap_or_else(|error| panic!("reasoning: {error}"))
}

fn transfer() -> TransferPracticeSession {
    TransferPracticeSession::start(TransferPracticeConfig::new(
        unit(),
        Revision::new(1).unwrap_or_else(|error| panic!("revision: {error}")),
        "1",
        vec![TransferPracticeDefinition {
            id: "grid-frontier".to_owned(),
            implementation: None,
            pattern: "frontier-expansion".to_owned(),
            new_case: "Expand a grid frontier with obstacles.".to_owned(),
            prompt: "Describe the transferred pattern and its limits.".to_owned(),
            concepts: vec!["frontier".to_owned()],
            transfers: vec!["queue".to_owned()],
            differences: vec!["obstacles".to_owned()],
            boundaries: vec!["visited".to_owned()],
        }],
    ))
    .unwrap_or_else(|error| panic!("transfer: {error}"))
}

#[test]
fn reasoning_requires_reviewed_concepts_and_records_prompt_and_rejections() {
    let mut session = reasoning();
    assert_eq!(
        session.apply(ReasoningRecallEvent::RevealPrompt, elapsed(1)),
        Ok(ReasoningRecallOutcome::PromptRevealed)
    );
    assert_eq!(
        session.apply(
            ReasoningRecallEvent::SubmitAnswer("enqueue invariant".to_owned()),
            elapsed(2)
        ),
        Ok(ReasoningRecallOutcome::RejectedAnswer)
    );
    assert_eq!(
        session.apply(
            ReasoningRecallEvent::SubmitAnswer("The queue invariant holds".to_owned()),
            elapsed(3),
        ),
        Ok(ReasoningRecallOutcome::Completed)
    );
    let attempt = session.attempt().unwrap_or_else(|| panic!("attempt"));
    assert_eq!(attempt.prompt_count(), 1);
    assert_eq!(attempt.rejected_answer_count(), 1);
    assert_eq!(attempt.terminal_reason(), TerminalReason::Completed);
}

#[test]
fn reasoning_alias_and_restart_are_deterministic() {
    let mut session = reasoning();
    assert_eq!(
        session.apply(
            ReasoningRecallEvent::SubmitAnswer("frontier invariant".to_owned()),
            elapsed(1)
        ),
        Ok(ReasoningRecallOutcome::Completed)
    );
    assert_eq!(
        session.attempt().map(|attempt| attempt.restart_count()),
        Some(0)
    );
}

#[test]
fn transfer_requires_all_reviewed_facets() {
    let mut session = transfer();
    assert_eq!(
        session.apply(
            TransferPracticeEvent::SubmitAnswer("frontier queue".to_owned()),
            elapsed(1)
        ),
        Ok(TransferPracticeOutcome::RejectedAnswer)
    );
    assert_eq!(
        session.apply(
            TransferPracticeEvent::SubmitAnswer("frontier queue obstacles visited".to_owned()),
            elapsed(2),
        ),
        Ok(TransferPracticeOutcome::Completed)
    );
    assert_eq!(
        session
            .attempt()
            .map(|attempt| attempt.accepted_case_count()),
        Some(1)
    );
}

#[test]
fn transfer_stop_emits_terminal_attempt_without_completion() {
    let mut session = transfer();
    assert_eq!(
        session.apply(TransferPracticeEvent::Stop, elapsed(4)),
        Ok(TransferPracticeOutcome::Stopped)
    );
    assert_eq!(
        session.attempt().map(|attempt| attempt.terminal_reason()),
        Some(TerminalReason::Stopped)
    );
}
