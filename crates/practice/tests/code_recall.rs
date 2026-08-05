use std::time::Duration;

use gewu_domain::{CodeRecallAssistance, Normalization, PracticeMode, Revision, UnitId};
use gewu_practice::{
    CharacterRange, CodeRecallConfig, CodeRecallEvent, CodeRecallGuidance, CodeRecallOutcome,
    CodeRecallSession, CodeRecallStartError, CodeRecallTimedEvent, CodeRecallTransitionError,
    ElapsedTime, SessionStatus, TerminalReason,
};

fn elapsed(seconds: u64) -> ElapsedTime {
    ElapsedTime::new(Duration::from_secs(seconds), Duration::from_secs(seconds))
        .unwrap_or_else(|error| panic!("test elapsed: {error}"))
}

fn config(assistance: CodeRecallAssistance, scaffold: Vec<&str>) -> CodeRecallConfig {
    CodeRecallConfig::new(
        UnitId::parse("graph.bfs").unwrap_or_else(|error| panic!("test unit ID: {error}")),
        Revision::new(1).unwrap_or_else(|error| panic!("test revision: {error}")),
        "1",
        "python",
        "é🙂\nreturn True",
        CodeRecallGuidance::new(
            assistance,
            "Reconstruct the implementation",
            scaffold.into_iter().map(str::to_owned).collect(),
        ),
        Normalization {
            line_endings: "lf".to_owned(),
            whitespace: "strict".to_owned(),
            trailing_newline: false,
        },
    )
}

#[test]
fn every_assistance_policy_exposes_reviewed_content_and_starts() {
    let cases = [
        (CodeRecallAssistance::Skeleton, vec!["def solve(values):"]),
        (
            CodeRecallAssistance::Comments,
            vec!["# initialize the frontier"],
        ),
        (CodeRecallAssistance::Keywords, vec!["queue", "visited"]),
        (CodeRecallAssistance::Cloze, vec!["return ____"]),
        (CodeRecallAssistance::None, vec![]),
    ];

    for (assistance, scaffold) in cases {
        let session = CodeRecallSession::start(config(assistance, scaffold.clone()))
            .unwrap_or_else(|error| panic!("start {assistance:?}: {error}"));
        assert_eq!(session.assistance(), assistance);
        assert_eq!(session.scaffold().len(), scaffold.len());
        assert_eq!(session.prompt(), "Reconstruct the implementation");
        assert_eq!(session.status(), SessionStatus::Active);
    }
}

#[test]
fn assistance_policy_requires_the_declared_scaffold_shape() {
    let missing = CodeRecallSession::start(config(CodeRecallAssistance::Keywords, vec![]));
    assert_eq!(missing, Err(CodeRecallStartError::MissingScaffold));

    let unexpected = CodeRecallSession::start(config(CodeRecallAssistance::None, vec!["extra"]));
    assert_eq!(
        unexpected,
        Err(CodeRecallStartError::ScaffoldNotAllowedForNone)
    );

    let empty_prompt = CodeRecallSession::start(CodeRecallConfig::new(
        UnitId::parse("graph.bfs").unwrap_or_else(|error| panic!("test unit ID: {error}")),
        Revision::new(1).unwrap_or_else(|error| panic!("test revision: {error}")),
        "1",
        "python",
        "return True",
        CodeRecallGuidance::new(CodeRecallAssistance::None, "  ", Vec::new()),
        Normalization {
            line_endings: "lf".to_owned(),
            whitespace: "strict".to_owned(),
            trailing_newline: false,
        },
    ));
    assert_eq!(
        empty_prompt,
        Err(CodeRecallStartError::EmptyMetadata { field: "prompt" })
    );
}

#[test]
fn exact_prefix_validation_is_atomic_and_counts_unicode_scalars() {
    let mut session =
        CodeRecallSession::start(config(CodeRecallAssistance::Comments, vec!["unicode"]))
            .unwrap_or_else(|error| panic!("test session: {error}"));

    assert_eq!(
        session.apply(CodeRecallEvent::InsertText("éx".to_owned()), elapsed(1)),
        Ok(CodeRecallOutcome::RejectedMismatch {
            character_offset: 1
        })
    );
    assert_eq!(session.accepted_text(), "");
    assert_eq!(session.rejected_input_count(), 2);

    assert_eq!(
        session.apply(CodeRecallEvent::InsertText("é🙂".to_owned()), elapsed(2)),
        Ok(CodeRecallOutcome::Accepted)
    );
    assert_eq!(session.cursor_character_offset(), 2);
    assert_eq!(session.accepted_input_count(), 2);
}

#[test]
fn deletion_and_replacement_rewind_to_a_valid_prefix() {
    let mut session = CodeRecallSession::start(config(CodeRecallAssistance::None, vec![]))
        .unwrap_or_else(|error| panic!("test session: {error}"));

    session
        .apply(
            CodeRecallEvent::InsertText("é🙂\nreturn".to_owned()),
            elapsed(1),
        )
        .unwrap_or_else(|error| panic!("insert: {error}"));
    assert_eq!(
        session.apply(
            CodeRecallEvent::DeleteRange(
                CharacterRange::new(1, 2).unwrap_or_else(|error| panic!("range: {error}")),
            ),
            elapsed(2),
        ),
        Ok(CodeRecallOutcome::Accepted)
    );
    assert_eq!(session.accepted_text(), "é");

    assert_eq!(
        session.apply(
            CodeRecallEvent::ReplaceRange {
                range: CharacterRange::new(0, 1).unwrap_or_else(|error| panic!("range: {error}")),
                text: "é🙂".to_owned(),
            },
            elapsed(3),
        ),
        Ok(CodeRecallOutcome::Accepted)
    );
    assert_eq!(session.accepted_text(), "é🙂");
    assert_eq!(session.correction_count(), 2);
}

#[test]
fn prompt_and_scaffold_reveals_are_separate_facts() {
    let mut session = CodeRecallSession::start(config(
        CodeRecallAssistance::Keywords,
        vec!["queue", "visited"],
    ))
    .unwrap_or_else(|error| panic!("test session: {error}"));

    assert_eq!(
        session.apply(CodeRecallEvent::RevealPrompt, elapsed(1)),
        Ok(CodeRecallOutcome::PromptRevealed)
    );
    assert_eq!(
        session.apply(CodeRecallEvent::RevealScaffold { index: 1 }, elapsed(2)),
        Ok(CodeRecallOutcome::ScaffoldRevealed { index: 1 })
    );
    assert_eq!(
        session.apply(CodeRecallEvent::RevealScaffold { index: 1 }, elapsed(3)),
        Ok(CodeRecallOutcome::ScaffoldRevealed { index: 1 })
    );
    assert_eq!(session.prompt_count(), 1);
    assert_eq!(session.scaffold_reveal_count(), 2);
    assert_eq!(session.revealed_scaffold_indices(), &[1, 1]);
    assert_eq!(
        session.apply(CodeRecallEvent::RevealScaffold { index: 2 }, elapsed(4)),
        Err(CodeRecallTransitionError::ScaffoldIndexOutOfBounds {
            index: 2,
            scaffold_count: 2,
        })
    );
}

#[test]
fn completion_and_stop_create_one_immutable_terminal_attempt() {
    let mut completed = CodeRecallSession::start(config(CodeRecallAssistance::None, vec![]))
        .unwrap_or_else(|error| panic!("test session: {error}"));
    assert_eq!(
        completed.apply(
            CodeRecallEvent::InsertText("é🙂\nreturn True".to_owned()),
            elapsed(4),
        ),
        Ok(CodeRecallOutcome::Completed)
    );
    let attempt = completed
        .attempt()
        .unwrap_or_else(|| panic!("completed attempt"));
    assert_eq!(attempt.mode(), PracticeMode::CodeRecall);
    assert_eq!(attempt.terminal_reason(), TerminalReason::Completed);
    assert_eq!(attempt.target_character_count(), 14);
    assert_eq!(attempt.active_duration(), Duration::from_secs(4));
    assert_eq!(
        completed.apply(CodeRecallEvent::Stop, elapsed(5)),
        Err(CodeRecallTransitionError::TerminalSession {
            status: SessionStatus::Completed,
        })
    );

    let mut stopped = CodeRecallSession::start(config(CodeRecallAssistance::None, vec![]))
        .unwrap_or_else(|error| panic!("test session: {error}"));
    assert_eq!(
        stopped.apply(CodeRecallEvent::Stop, elapsed(2)),
        Ok(CodeRecallOutcome::Stopped)
    );
    let first = stopped
        .attempt()
        .unwrap_or_else(|| panic!("stopped attempt"))
        .clone();
    assert_eq!(first.terminal_reason(), TerminalReason::Stopped);
    assert_eq!(stopped.attempt(), Some(&first));
    assert_eq!(
        stopped.apply(CodeRecallEvent::Stop, elapsed(3)),
        Err(CodeRecallTransitionError::TerminalSession {
            status: SessionStatus::Stopped,
        })
    );
}

#[test]
fn restart_retains_facts_and_replay_is_deterministic() {
    let events = vec![
        CodeRecallTimedEvent::new(CodeRecallEvent::RevealPrompt, elapsed(1)),
        CodeRecallTimedEvent::new(CodeRecallEvent::InsertText("é🙂".to_owned()), elapsed(2)),
        CodeRecallTimedEvent::new(CodeRecallEvent::Restart, elapsed(3)),
        CodeRecallTimedEvent::new(
            CodeRecallEvent::InsertText("é🙂\nreturn True".to_owned()),
            elapsed(4),
        ),
    ];
    let first = CodeRecallSession::replay(
        config(CodeRecallAssistance::Comments, vec!["cue"]),
        events.clone(),
    )
    .unwrap_or_else(|error| panic!("first replay: {error}"));
    let second =
        CodeRecallSession::replay(config(CodeRecallAssistance::Comments, vec!["cue"]), events)
            .unwrap_or_else(|error| panic!("second replay: {error}"));
    assert_eq!(first, second);
    assert_eq!(first.status(), SessionStatus::Completed);
    assert_eq!(first.restart_count(), 1);
    assert_eq!(first.prompt_count(), 1);
    assert_eq!(
        first.attempt().map(|attempt| attempt.restart_count()),
        Some(1)
    );
}
