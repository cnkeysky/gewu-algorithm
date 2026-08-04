use std::time::Duration;

use gewu_domain::{Normalization, PracticeMode, Revision, UnitId};
use gewu_practice::{
    CharacterRange, ENGINE_VERSION, ElapsedTime, SessionStatus, ShadowTypingConfig,
    ShadowTypingEvent, ShadowTypingSession, StartError, TerminalReason, TimedEvent,
    TransitionError, TransitionOutcome, UnsupportedEvent,
};

fn config(source: &str, trailing_newline: bool) -> ShadowTypingConfig {
    let unit_id = match UnitId::parse("graph.bfs") {
        Ok(value) => value,
        Err(error) => panic!("test unit ID must be valid: {error}"),
    };
    let revision = match Revision::new(3) {
        Ok(value) => value,
        Err(error) => panic!("test revision must be valid: {error}"),
    };
    ShadowTypingConfig::new(
        unit_id,
        revision,
        "1",
        "python-teaching",
        source,
        Normalization {
            line_endings: "lf".to_owned(),
            trailing_newline,
            whitespace: "strict".to_owned(),
        },
    )
}

fn elapsed(active_seconds: u64, wall_seconds: u64) -> ElapsedTime {
    match ElapsedTime::new(
        Duration::from_secs(active_seconds),
        Duration::from_secs(wall_seconds),
    ) {
        Ok(value) => value,
        Err(error) => panic!("test elapsed time must be valid: {error}"),
    }
}

fn timed(event: ShadowTypingEvent, active_seconds: u64, wall_seconds: u64) -> TimedEvent {
    TimedEvent::new(event, elapsed(active_seconds, wall_seconds))
}

fn range(start: usize, end: usize) -> CharacterRange {
    match CharacterRange::new(start, end) {
        Ok(value) => value,
        Err(error) => panic!("test range must be valid: {error}"),
    }
}

fn started(source: &str) -> ShadowTypingSession {
    match ShadowTypingSession::start(config(source, false)) {
        Ok(value) => value,
        Err(error) => panic!("test session must start: {error}"),
    }
}

#[test]
fn start_normalizes_line_endings_and_preserves_unicode_and_strict_whitespace() {
    let session = match ShadowTypingSession::start(config("é\r\n\tβ\r\n\r\n", true)) {
        Ok(value) => value,
        Err(error) => panic!("test session must start: {error}"),
    };

    assert_eq!(session.target(), "é\n\tβ\n");
    assert_eq!(session.target_character_count(), 5);
    assert_eq!(session.cursor_character_offset(), 0);
}

#[test]
fn start_rejects_unsupported_normalization_and_empty_targets() {
    let unsupported = ShadowTypingConfig::new(
        UnitId::parse("graph.bfs").unwrap_or_else(|error| panic!("invalid test ID: {error}")),
        Revision::new(1).unwrap_or_else(|error| panic!("invalid test revision: {error}")),
        "1",
        "python",
        "x",
        Normalization {
            line_endings: "preserve".to_owned(),
            trailing_newline: false,
            whitespace: "strict".to_owned(),
        },
    );
    assert_eq!(
        ShadowTypingSession::start(unsupported),
        Err(StartError::UnsupportedLineEndings {
            value: "preserve".to_owned()
        })
    );
    assert_eq!(
        ShadowTypingSession::start(config("\n\r\n", false)),
        Err(StartError::EmptyTarget)
    );
}

#[test]
fn insertion_rejects_a_mismatch_atomically_then_completes() {
    let mut session = started("fn");

    assert_eq!(
        session.apply(timed(ShadowTypingEvent::InsertText("f".to_owned()), 1, 1)),
        Ok(TransitionOutcome::Accepted)
    );
    assert_eq!(
        session.apply(timed(ShadowTypingEvent::InsertText("xy".to_owned()), 2, 3)),
        Ok(TransitionOutcome::RejectedMismatch {
            character_offset: 1
        })
    );
    assert_eq!(session.accepted_text(), "f");
    assert_eq!(session.accepted_input_count(), 1);
    assert_eq!(session.rejected_input_count(), 2);
    assert_eq!(session.elapsed(), elapsed(2, 3));
    assert_eq!(
        session.apply(timed(ShadowTypingEvent::InsertText("n".to_owned()), 3, 5)),
        Ok(TransitionOutcome::Completed)
    );

    let attempt = session
        .attempt()
        .unwrap_or_else(|| panic!("completion must create attempt"));
    assert_eq!(attempt.accepted_input_count(), 2);
    assert_eq!(attempt.rejected_input_count(), 2);
    assert_eq!(attempt.active_duration(), Duration::from_secs(3));
    assert_eq!(attempt.wall_clock_duration(), Duration::from_secs(5));
    assert_eq!(attempt.terminal_reason(), TerminalReason::Completed);
}

#[test]
fn exact_multi_character_paste_is_one_atomic_completion() {
    let mut session = started("界🙂");

    assert_eq!(
        session.apply(timed(
            ShadowTypingEvent::InsertText("界🙂".to_owned()),
            1,
            1
        )),
        Ok(TransitionOutcome::Completed)
    );
    assert_eq!(session.cursor_character_offset(), 2);
    assert_eq!(
        session.attempt().map(|value| value.accepted_input_count()),
        Some(2)
    );
}

#[test]
fn deletion_and_replacement_preserve_the_canonical_prefix() {
    let mut session = started("abc");
    assert_eq!(
        session.apply(timed(ShadowTypingEvent::InsertText("ab".to_owned()), 1, 1)),
        Ok(TransitionOutcome::Accepted)
    );
    assert_eq!(
        session.apply(timed(
            ShadowTypingEvent::DeleteBackward { characters: 1 },
            2,
            2
        )),
        Ok(TransitionOutcome::Accepted)
    );
    assert_eq!(session.accepted_text(), "a");
    assert_eq!(
        session.apply(timed(
            ShadowTypingEvent::ReplaceRange {
                range: range(0, 1),
                text: "abc".to_owned(),
            },
            3,
            3
        )),
        Ok(TransitionOutcome::Completed)
    );

    let attempt = session
        .attempt()
        .unwrap_or_else(|| panic!("completion must create attempt"));
    assert_eq!(attempt.correction_count(), 2);
    assert_eq!(attempt.accepted_input_count(), 5);
}

#[test]
fn deleting_inside_a_prefix_rewinds_to_the_edit_position() {
    let mut session = started("abcd");
    assert_eq!(
        session.apply(timed(ShadowTypingEvent::InsertText("abc".to_owned()), 1, 1)),
        Ok(TransitionOutcome::Accepted)
    );
    assert_eq!(
        session.apply(timed(ShadowTypingEvent::DeleteRange(range(1, 2)), 2, 2)),
        Ok(TransitionOutcome::Accepted)
    );
    assert_eq!(session.accepted_text(), "a");
    assert_eq!(session.correction_count(), 1);
}

#[test]
fn mismatching_replacement_is_atomic_and_reports_a_character_offset() {
    let mut session = started("abcd");
    assert_eq!(
        session.apply(timed(ShadowTypingEvent::InsertText("abc".to_owned()), 1, 1)),
        Ok(TransitionOutcome::Accepted)
    );

    assert_eq!(
        session.apply(timed(
            ShadowTypingEvent::ReplaceRange {
                range: range(2, 3),
                text: "x".to_owned(),
            },
            2,
            2
        )),
        Ok(TransitionOutcome::RejectedMismatch {
            character_offset: 2
        })
    );
    assert_eq!(session.accepted_text(), "abc");
    assert_eq!(session.rejected_input_count(), 1);
    assert_eq!(session.correction_count(), 0);
}

#[test]
fn unicode_deletion_uses_scalar_offsets_instead_of_utf8_bytes() {
    let mut session = started("界🙂a");
    assert_eq!(
        session.apply(timed(
            ShadowTypingEvent::InsertText("界🙂".to_owned()),
            1,
            1
        )),
        Ok(TransitionOutcome::Accepted)
    );
    assert_eq!(
        session.apply(timed(
            ShadowTypingEvent::DeleteBackward { characters: 1 },
            2,
            2
        )),
        Ok(TransitionOutcome::Accepted)
    );
    assert_eq!(session.accepted_text(), "界");
    assert_eq!(session.cursor_character_offset(), 1);
}

#[test]
fn restart_retains_facts_and_stop_creates_one_idempotent_attempt() {
    let mut session = started("abc");
    assert_eq!(
        session.apply(timed(ShadowTypingEvent::InsertText("a".to_owned()), 1, 2)),
        Ok(TransitionOutcome::Accepted)
    );
    assert_eq!(
        session.apply(timed(ShadowTypingEvent::RevealHint(range(1, 3)), 2, 4)),
        Ok(TransitionOutcome::Accepted)
    );
    assert_eq!(
        session.apply(timed(ShadowTypingEvent::Restart, 3, 6)),
        Ok(TransitionOutcome::Accepted)
    );
    assert_eq!(session.accepted_text(), "");
    assert_eq!(
        session.apply(timed(ShadowTypingEvent::Stop, 4, 9)),
        Ok(TransitionOutcome::Stopped)
    );

    let first = session
        .attempt()
        .unwrap_or_else(|| panic!("stop must create attempt"));
    let second = session
        .attempt()
        .unwrap_or_else(|| panic!("attempt must remain available"));
    assert!(std::ptr::eq(first, second));
    assert_eq!(first.restart_count(), 1);
    assert_eq!(first.hint_count(), 1);
    assert_eq!(first.revealed_regions(), &[range(1, 3)]);
    assert_eq!(first.accepted_input_count(), 1);
    assert_eq!(first.terminal_reason(), TerminalReason::Stopped);
    assert_eq!(first.unit_id().as_str(), "graph.bfs");
    assert_eq!(first.revision().get(), 3);
    assert_eq!(first.schema_version(), "1");
    assert_eq!(first.implementation(), "python-teaching");
    assert_eq!(first.engine_version(), ENGINE_VERSION);
    assert_eq!(first.mode(), PracticeMode::ShadowTyping);
    assert_eq!(first.target_character_count(), 3);
    assert_eq!(first.normalization().whitespace, "strict");
}

#[test]
fn terminal_and_unsupported_events_return_typed_errors_without_mutation() {
    let mut session = started("x");
    let active = session.clone();
    assert_eq!(
        session.apply(timed(ShadowTypingEvent::ExternalMutation, 1, 1)),
        Err(TransitionError::UnsupportedEvent {
            event: UnsupportedEvent::ExternalMutation
        })
    );
    assert_eq!(session, active);
    assert_eq!(
        session.apply(timed(ShadowTypingEvent::MultiCursorEdit, 1, 1)),
        Err(TransitionError::UnsupportedEvent {
            event: UnsupportedEvent::MultiCursorEdit
        })
    );
    assert_eq!(session, active);

    assert_eq!(
        session.apply(timed(ShadowTypingEvent::Stop, 1, 1)),
        Ok(TransitionOutcome::Stopped)
    );
    let stopped = session.clone();
    assert_eq!(
        session.apply(timed(ShadowTypingEvent::Restart, 2, 2)),
        Err(TransitionError::TerminalSession {
            status: SessionStatus::Stopped
        })
    );
    assert_eq!(session, stopped);
}

#[test]
fn elapsed_time_must_be_valid_and_monotonic() {
    assert!(ElapsedTime::new(Duration::from_secs(2), Duration::from_secs(1)).is_err());
    let mut session = started("xy");
    assert_eq!(
        session.apply(timed(ShadowTypingEvent::InsertText("x".to_owned()), 2, 3)),
        Ok(TransitionOutcome::Accepted)
    );
    let before = session.clone();
    assert!(matches!(
        session.apply(timed(ShadowTypingEvent::Restart, 1, 4)),
        Err(TransitionError::ElapsedTimeRegressed { .. })
    ));
    assert_eq!(session, before);
}

#[test]
fn replaying_the_same_events_produces_identical_state_and_attempt_facts() {
    let events = vec![
        timed(ShadowTypingEvent::InsertText("a".to_owned()), 1, 1),
        timed(ShadowTypingEvent::InsertText("x".to_owned()), 2, 3),
        timed(ShadowTypingEvent::DeleteBackward { characters: 1 }, 3, 4),
        timed(ShadowTypingEvent::InsertText("ab".to_owned()), 4, 6),
    ];

    let first = ShadowTypingSession::replay(config("ab", false), events.clone())
        .unwrap_or_else(|error| panic!("first replay failed: {error}"));
    let second = ShadowTypingSession::replay(config("ab", false), events)
        .unwrap_or_else(|error| panic!("second replay failed: {error}"));

    assert_eq!(first, second);
    assert_eq!(first.status(), SessionStatus::Completed);
    assert_eq!(first.attempt(), second.attempt());
}

#[test]
fn invalid_ranges_and_empty_mutations_are_rejected_without_progress() {
    let mut session = started("abc");
    assert_eq!(
        session.apply(timed(ShadowTypingEvent::InsertText(String::new()), 1, 1)),
        Err(TransitionError::EmptyText)
    );
    assert_eq!(
        session.apply(timed(
            ShadowTypingEvent::ReplaceRange {
                range: range(0, 1),
                text: String::new(),
            },
            1,
            1,
        )),
        Err(TransitionError::EmptyText)
    );
    assert_eq!(
        session.apply(timed(
            ShadowTypingEvent::DeleteBackward { characters: 0 },
            1,
            1
        )),
        Err(TransitionError::ZeroDelete)
    );
    assert_eq!(
        session.apply(timed(ShadowTypingEvent::RevealHint(range(1, 4)), 1, 1)),
        Err(TransitionError::RangeOutOfBounds {
            range_start: 1,
            range_end: 4,
            current_characters: 3
        })
    );
    assert_eq!(session.accepted_text(), "");
    assert_eq!(session.status(), SessionStatus::Active);
}
