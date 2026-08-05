#![forbid(unsafe_code)]
//! Deterministic, editor-independent practice state machines.

mod code_recall;
mod flow;

pub use code_recall::{
    CodeRecallAttempt, CodeRecallConfig, CodeRecallEvent, CodeRecallGuidance, CodeRecallOutcome,
    CodeRecallReplayError, CodeRecallSession, CodeRecallStartError, CodeRecallTimedEvent,
    CodeRecallTransitionError,
};
pub use flow::{
    FlowRecallAttempt, FlowRecallConfig, FlowRecallEvent, FlowRecallOutcome, FlowRecallSession,
    FlowRecallStartError, FlowRecallTransitionError,
};

use std::time::Duration;

use gewu_domain::{Normalization, PracticeMode, Revision, UnitId};
use thiserror::Error;

pub use gewu_domain::CodeRecallAssistance;

/// Version of the practice transition and attempt-fact contract.
pub const ENGINE_VERSION: &str = env!("CARGO_PKG_VERSION");

/// Inputs that identify one Shadow Typing session and its canonical source.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ShadowTypingConfig {
    unit_id: UnitId,
    revision: Revision,
    schema_version: String,
    implementation: String,
    source: String,
    normalization: Normalization,
}

impl ShadowTypingConfig {
    /// Creates session inputs. Text normalization is deferred until session start.
    pub fn new(
        unit_id: UnitId,
        revision: Revision,
        schema_version: impl Into<String>,
        implementation: impl Into<String>,
        source: impl Into<String>,
        normalization: Normalization,
    ) -> Self {
        Self {
            unit_id,
            revision,
            schema_version: schema_version.into(),
            implementation: implementation.into(),
            source: source.into(),
            normalization,
        }
    }
}

/// A half-open range measured in Unicode scalar values, not UTF-8 bytes.
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub struct CharacterRange {
    start: usize,
    end: usize,
}

impl CharacterRange {
    /// Creates a non-empty range when `start < end`.
    pub fn new(start: usize, end: usize) -> Result<Self, RangeError> {
        if start < end {
            Ok(Self { start, end })
        } else {
            Err(RangeError { start, end })
        }
    }

    /// Returns the inclusive start character offset.
    pub fn start(self) -> usize {
        self.start
    }

    /// Returns the exclusive end character offset.
    pub fn end(self) -> usize {
        self.end
    }
}

/// An invalid half-open character range.
#[derive(Clone, Copy, Debug, Error, Eq, PartialEq)]
#[error("character range must be non-empty and ordered, got {start}..{end}")]
pub struct RangeError {
    start: usize,
    end: usize,
}

/// Caller-observed elapsed time for a practice event.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct ElapsedTime {
    active: Duration,
    wall: Duration,
}

impl ElapsedTime {
    /// Creates elapsed times when active time does not exceed wall-clock time.
    pub fn new(active: Duration, wall: Duration) -> Result<Self, ElapsedTimeError> {
        if active <= wall {
            Ok(Self { active, wall })
        } else {
            Err(ElapsedTimeError { active, wall })
        }
    }

    /// Returns time spent actively practicing.
    pub fn active(self) -> Duration {
        self.active
    }

    /// Returns total elapsed wall-clock time supplied by the caller.
    pub fn wall(self) -> Duration {
        self.wall
    }
}

impl Default for ElapsedTime {
    fn default() -> Self {
        Self {
            active: Duration::ZERO,
            wall: Duration::ZERO,
        }
    }
}

/// Elapsed time whose active component exceeds wall-clock time.
#[derive(Clone, Copy, Debug, Error, Eq, PartialEq)]
#[error("active elapsed time {active:?} exceeds wall-clock elapsed time {wall:?}")]
pub struct ElapsedTimeError {
    active: Duration,
    wall: Duration,
}

/// One editor-independent Shadow Typing input.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ShadowTypingEvent {
    /// Inserts text at the current end of the accepted canonical prefix.
    InsertText(String),
    /// Deletes Unicode scalar values immediately before the cursor.
    DeleteBackward { characters: usize },
    /// Deletes a range from the accepted prefix.
    DeleteRange(CharacterRange),
    /// Atomically replaces a range in the accepted prefix.
    ReplaceRange { range: CharacterRange, text: String },
    /// Records an explicitly revealed target region without advancing progress.
    RevealHint(CharacterRange),
    /// Resets progress while retaining facts accumulated by this session.
    Restart,
    /// Stops the session and creates its immutable attempt.
    Stop,
    /// Represents an edit made outside the controlled practice transaction.
    ExternalMutation,
    /// Represents one editor transaction that targets multiple selections.
    MultiCursorEdit,
}

/// An event paired with caller-observed elapsed time for deterministic replay.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TimedEvent {
    pub event: ShadowTypingEvent,
    pub elapsed: ElapsedTime,
}

impl TimedEvent {
    /// Pairs an event with elapsed facts captured outside the deterministic core.
    pub fn new(event: ShadowTypingEvent, elapsed: ElapsedTime) -> Self {
        Self { event, elapsed }
    }
}

/// Lifecycle of a started Shadow Typing session.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum SessionStatus {
    Active,
    Completed,
    Stopped,
}

/// Observable result of an applied event.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum TransitionOutcome {
    Accepted,
    /// The complete edit was rejected atomically at this character offset.
    RejectedMismatch {
        character_offset: usize,
    },
    Completed,
    Stopped,
}

/// Why a terminal practice attempt ended.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum TerminalReason {
    Completed,
    Stopped,
}

/// Immutable facts emitted once for a completed or stopped session.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PracticeAttempt {
    unit_id: UnitId,
    revision: Revision,
    schema_version: String,
    implementation: String,
    engine_version: &'static str,
    mode: PracticeMode,
    target_character_count: usize,
    accepted_input_count: u64,
    rejected_input_count: u64,
    correction_count: u64,
    hint_count: u64,
    revealed_regions: Vec<CharacterRange>,
    restart_count: u64,
    active_duration: Duration,
    wall_clock_duration: Duration,
    terminal_reason: TerminalReason,
    normalization: Normalization,
}

impl PracticeAttempt {
    /// Returns the exact algorithm-unit ID used by the session.
    pub fn unit_id(&self) -> &UnitId {
        &self.unit_id
    }

    /// Returns the exact content revision used by the session.
    pub fn revision(&self) -> Revision {
        self.revision
    }

    /// Returns the content schema version used by the session.
    pub fn schema_version(&self) -> &str {
        &self.schema_version
    }

    /// Returns the selected implementation-variant key.
    pub fn implementation(&self) -> &str {
        &self.implementation
    }

    /// Returns the transition and attempt-fact contract version.
    pub fn engine_version(&self) -> &str {
        self.engine_version
    }

    /// Returns the canonical practice mode.
    pub fn mode(&self) -> PracticeMode {
        self.mode
    }

    /// Returns the canonical target length in Unicode scalar values.
    pub fn target_character_count(&self) -> usize {
        self.target_character_count
    }

    /// Returns the number of inserted Unicode scalar values accepted.
    pub fn accepted_input_count(&self) -> u64 {
        self.accepted_input_count
    }

    /// Returns the number of inserted Unicode scalar values rejected atomically.
    pub fn rejected_input_count(&self) -> u64 {
        self.rejected_input_count
    }

    /// Returns the number of accepted deletions or replacements.
    pub fn correction_count(&self) -> u64 {
        self.correction_count
    }

    /// Returns the number of explicit hint-reveal events.
    pub fn hint_count(&self) -> u64 {
        self.hint_count
    }

    /// Returns every revealed target region in event order.
    pub fn revealed_regions(&self) -> &[CharacterRange] {
        &self.revealed_regions
    }

    /// Returns the number of times progress was restarted.
    pub fn restart_count(&self) -> u64 {
        self.restart_count
    }

    /// Returns active elapsed time supplied by the caller at termination.
    pub fn active_duration(&self) -> Duration {
        self.active_duration
    }

    /// Returns wall-clock elapsed time supplied by the caller at termination.
    pub fn wall_clock_duration(&self) -> Duration {
        self.wall_clock_duration
    }

    /// Returns the terminal reason.
    pub fn terminal_reason(&self) -> TerminalReason {
        self.terminal_reason
    }

    /// Returns the normalization contract applied at session start.
    pub fn normalization(&self) -> &Normalization {
        &self.normalization
    }
}

/// Deterministic strict-prefix state for one Shadow Typing session.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ShadowTypingSession {
    config: ShadowTypingConfig,
    target: String,
    accepted: String,
    status: SessionStatus,
    accepted_input_count: u64,
    rejected_input_count: u64,
    correction_count: u64,
    hint_count: u64,
    revealed_regions: Vec<CharacterRange>,
    restart_count: u64,
    elapsed: ElapsedTime,
    attempt: Option<PracticeAttempt>,
}

impl ShadowTypingSession {
    /// Starts an active session after canonicalizing its source exactly once.
    pub fn start(config: ShadowTypingConfig) -> Result<Self, StartError> {
        validate_nonempty("schema version", &config.schema_version)?;
        validate_nonempty("implementation key", &config.implementation)?;
        let target = normalize_source(&config.source, &config.normalization)?;
        if target.is_empty() {
            return Err(StartError::EmptyTarget);
        }

        Ok(Self {
            config,
            target,
            accepted: String::new(),
            status: SessionStatus::Active,
            accepted_input_count: 0,
            rejected_input_count: 0,
            correction_count: 0,
            hint_count: 0,
            revealed_regions: Vec::new(),
            restart_count: 0,
            elapsed: ElapsedTime::default(),
            attempt: None,
        })
    }

    /// Replays the same timed events using the ordinary transition function.
    pub fn replay(
        config: ShadowTypingConfig,
        events: impl IntoIterator<Item = TimedEvent>,
    ) -> Result<Self, ReplayError> {
        let mut session = Self::start(config).map_err(ReplayError::Start)?;
        for (event_index, event) in events.into_iter().enumerate() {
            session
                .apply(event)
                .map_err(|source| ReplayError::Transition {
                    event_index,
                    source,
                })?;
        }
        Ok(session)
    }

    /// Applies one deterministic event. Invalid events leave the state unchanged.
    pub fn apply(&mut self, timed: TimedEvent) -> Result<TransitionOutcome, TransitionError> {
        self.ensure_active()?;
        self.validate_elapsed(timed.elapsed)?;

        let outcome = match timed.event {
            ShadowTypingEvent::InsertText(text) => self.insert_text(text)?,
            ShadowTypingEvent::DeleteBackward { characters } => self.delete_backward(characters)?,
            ShadowTypingEvent::DeleteRange(range) => self.delete_range(range)?,
            ShadowTypingEvent::ReplaceRange { range, text } => self.replace_range(range, text)?,
            ShadowTypingEvent::RevealHint(range) => self.reveal_hint(range)?,
            ShadowTypingEvent::Restart => self.restart(),
            ShadowTypingEvent::Stop => {
                self.elapsed = timed.elapsed;
                self.status = SessionStatus::Stopped;
                self.create_attempt(TerminalReason::Stopped);
                return Ok(TransitionOutcome::Stopped);
            }
            ShadowTypingEvent::ExternalMutation => {
                return Err(TransitionError::UnsupportedEvent {
                    event: UnsupportedEvent::ExternalMutation,
                });
            }
            ShadowTypingEvent::MultiCursorEdit => {
                return Err(TransitionError::UnsupportedEvent {
                    event: UnsupportedEvent::MultiCursorEdit,
                });
            }
        };

        self.elapsed = timed.elapsed;
        if self.accepted == self.target {
            self.status = SessionStatus::Completed;
            self.create_attempt(TerminalReason::Completed);
            Ok(TransitionOutcome::Completed)
        } else {
            Ok(outcome)
        }
    }

    /// Returns the current lifecycle state.
    pub fn status(&self) -> SessionStatus {
        self.status
    }

    /// Returns canonical text after the configured one-time normalization.
    pub fn target(&self) -> &str {
        &self.target
    }

    /// Returns the accepted canonical prefix.
    pub fn accepted_text(&self) -> &str {
        &self.accepted
    }

    /// Returns the cursor offset in Unicode scalar values.
    pub fn cursor_character_offset(&self) -> usize {
        self.accepted.chars().count()
    }

    /// Returns the target length in Unicode scalar values.
    pub fn target_character_count(&self) -> usize {
        self.target.chars().count()
    }

    /// Returns inserted Unicode scalar values accepted so far.
    pub fn accepted_input_count(&self) -> u64 {
        self.accepted_input_count
    }

    /// Returns inserted Unicode scalar values rejected so far.
    pub fn rejected_input_count(&self) -> u64 {
        self.rejected_input_count
    }

    /// Returns accepted deletion or replacement operations so far.
    pub fn correction_count(&self) -> u64 {
        self.correction_count
    }

    /// Returns explicit hint reveals so far.
    pub fn hint_count(&self) -> u64 {
        self.hint_count
    }

    /// Returns elapsed time from the most recently accepted or rejected event.
    pub fn elapsed(&self) -> ElapsedTime {
        self.elapsed
    }

    /// Returns the immutable terminal attempt, if the session has ended.
    /// Repeated calls return the same record.
    pub fn attempt(&self) -> Option<&PracticeAttempt> {
        self.attempt.as_ref()
    }

    fn ensure_active(&self) -> Result<(), TransitionError> {
        if self.status == SessionStatus::Active {
            Ok(())
        } else {
            Err(TransitionError::TerminalSession {
                status: self.status,
            })
        }
    }

    fn validate_elapsed(&self, elapsed: ElapsedTime) -> Result<(), TransitionError> {
        if elapsed.active < self.elapsed.active || elapsed.wall < self.elapsed.wall {
            Err(TransitionError::ElapsedTimeRegressed {
                previous: self.elapsed,
                received: elapsed,
            })
        } else {
            Ok(())
        }
    }

    fn insert_text(&mut self, text: String) -> Result<TransitionOutcome, TransitionError> {
        if text.is_empty() {
            return Err(TransitionError::EmptyText);
        }
        let start = self.accepted.chars().count();
        self.try_candidate(
            format!("{}{text}", self.accepted),
            text.chars().count(),
            start,
        )
    }

    fn delete_backward(&mut self, characters: usize) -> Result<TransitionOutcome, TransitionError> {
        if characters == 0 {
            return Err(TransitionError::ZeroDelete);
        }
        let end = self.accepted.chars().count();
        let start = end
            .checked_sub(characters)
            .ok_or(TransitionError::RangeOutOfBounds {
                range_start: 0,
                range_end: characters,
                current_characters: end,
            })?;
        self.delete_range_indices(start, end)
    }

    fn delete_range(
        &mut self,
        range: CharacterRange,
    ) -> Result<TransitionOutcome, TransitionError> {
        self.ensure_range_in_accepted(range)?;
        self.delete_range_indices(range.start, range.end)
    }

    fn delete_range_indices(
        &mut self,
        start: usize,
        _end: usize,
    ) -> Result<TransitionOutcome, TransitionError> {
        self.accepted = self.accepted.chars().take(start).collect();
        self.correction_count += 1;
        Ok(TransitionOutcome::Accepted)
    }

    fn replace_range(
        &mut self,
        range: CharacterRange,
        text: String,
    ) -> Result<TransitionOutcome, TransitionError> {
        if text.is_empty() {
            return Err(TransitionError::EmptyText);
        }
        self.ensure_range_in_accepted(range)?;
        let candidate = replace_char_range(&self.accepted, range.start, range.end, &text);
        if candidate == self.accepted {
            return Err(TransitionError::NoOpReplacement);
        }
        let outcome = self.try_candidate(candidate, text.chars().count(), range.start)?;
        if outcome == TransitionOutcome::Accepted {
            self.correction_count += 1;
        }
        Ok(outcome)
    }

    fn try_candidate(
        &mut self,
        candidate: String,
        input_characters: usize,
        comparison_start: usize,
    ) -> Result<TransitionOutcome, TransitionError> {
        if self.target.starts_with(&candidate) {
            self.accepted = candidate;
            self.accepted_input_count = self
                .accepted_input_count
                .saturating_add(input_characters as u64);
            Ok(TransitionOutcome::Accepted)
        } else {
            self.rejected_input_count = self
                .rejected_input_count
                .saturating_add(input_characters as u64);
            Ok(TransitionOutcome::RejectedMismatch {
                character_offset: first_mismatch(&candidate, &self.target, comparison_start),
            })
        }
    }

    fn reveal_hint(&mut self, range: CharacterRange) -> Result<TransitionOutcome, TransitionError> {
        let target_characters = self.target.chars().count();
        if range.end > target_characters {
            return Err(TransitionError::RangeOutOfBounds {
                range_start: range.start,
                range_end: range.end,
                current_characters: target_characters,
            });
        }
        self.hint_count += 1;
        self.revealed_regions.push(range);
        Ok(TransitionOutcome::Accepted)
    }

    fn restart(&mut self) -> TransitionOutcome {
        self.accepted.clear();
        self.restart_count += 1;
        TransitionOutcome::Accepted
    }

    fn ensure_range_in_accepted(&self, range: CharacterRange) -> Result<(), TransitionError> {
        let current_characters = self.accepted.chars().count();
        if range.end <= current_characters {
            Ok(())
        } else {
            Err(TransitionError::RangeOutOfBounds {
                range_start: range.start,
                range_end: range.end,
                current_characters,
            })
        }
    }

    fn create_attempt(&mut self, terminal_reason: TerminalReason) {
        if self.attempt.is_some() {
            return;
        }
        self.attempt = Some(PracticeAttempt {
            unit_id: self.config.unit_id.clone(),
            revision: self.config.revision,
            schema_version: self.config.schema_version.clone(),
            implementation: self.config.implementation.clone(),
            engine_version: ENGINE_VERSION,
            mode: PracticeMode::ShadowTyping,
            target_character_count: self.target.chars().count(),
            accepted_input_count: self.accepted_input_count,
            rejected_input_count: self.rejected_input_count,
            correction_count: self.correction_count,
            hint_count: self.hint_count,
            revealed_regions: self.revealed_regions.clone(),
            restart_count: self.restart_count,
            active_duration: self.elapsed.active,
            wall_clock_duration: self.elapsed.wall,
            terminal_reason,
            normalization: self.config.normalization.clone(),
        });
    }
}

/// A session configuration that cannot start deterministically.
#[derive(Clone, Debug, Error, Eq, PartialEq)]
pub enum StartError {
    #[error("{field} must not be empty")]
    EmptyMetadata { field: &'static str },
    #[error("unsupported line-ending policy `{value}`; only `lf` is supported")]
    UnsupportedLineEndings { value: String },
    #[error("unsupported whitespace policy `{value}`; only `strict` is supported")]
    UnsupportedWhitespace { value: String },
    #[error("canonical target must not be empty")]
    EmptyTarget,
}

/// A transition that cannot be applied to the current session.
#[derive(Clone, Debug, Error, Eq, PartialEq)]
pub enum TransitionError {
    #[error("cannot apply an event to a terminal {status:?} session")]
    TerminalSession { status: SessionStatus },
    #[error("event elapsed time regressed from {previous:?} to {received:?}")]
    ElapsedTimeRegressed {
        previous: ElapsedTime,
        received: ElapsedTime,
    },
    #[error("inserted text must not be empty")]
    EmptyText,
    #[error("delete-backward character count must be positive")]
    ZeroDelete,
    #[error("character range {range_start}..{range_end} exceeds text length {current_characters}")]
    RangeOutOfBounds {
        range_start: usize,
        range_end: usize,
        current_characters: usize,
    },
    #[error("the mutation would break the canonical-prefix invariant")]
    WouldBreakCanonicalPrefix,
    #[error("replacement must change the accepted text")]
    NoOpReplacement,
    #[error("{event:?} is not supported by Shadow Typing MVP")]
    UnsupportedEvent { event: UnsupportedEvent },
}

/// Editor behaviors intentionally rejected by the Stage 1 engine.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum UnsupportedEvent {
    ExternalMutation,
    MultiCursorEdit,
}

/// Failure while starting or replaying a deterministic event sequence.
#[derive(Clone, Debug, Error, Eq, PartialEq)]
pub enum ReplayError {
    #[error("could not start replay: {0}")]
    Start(StartError),
    #[error("could not apply replay event {event_index}: {source}")]
    Transition {
        event_index: usize,
        #[source]
        source: TransitionError,
    },
}

fn validate_nonempty(field: &'static str, value: &str) -> Result<(), StartError> {
    if value.is_empty() {
        Err(StartError::EmptyMetadata { field })
    } else {
        Ok(())
    }
}

fn normalize_source(source: &str, policy: &Normalization) -> Result<String, StartError> {
    if policy.line_endings != "lf" {
        return Err(StartError::UnsupportedLineEndings {
            value: policy.line_endings.clone(),
        });
    }
    if policy.whitespace != "strict" {
        return Err(StartError::UnsupportedWhitespace {
            value: policy.whitespace.clone(),
        });
    }

    let mut normalized = source.replace("\r\n", "\n").replace('\r', "\n");
    while normalized.ends_with('\n') {
        normalized.pop();
    }
    if policy.trailing_newline {
        normalized.push('\n');
    }
    Ok(normalized)
}

fn replace_char_range(text: &str, start: usize, end: usize, replacement: &str) -> String {
    let start_byte = char_to_byte(text, start);
    let end_byte = char_to_byte(text, end);
    let mut result = String::with_capacity(text.len() + replacement.len());
    result.push_str(&text[..start_byte]);
    result.push_str(replacement);
    result.push_str(&text[end_byte..]);
    result
}

fn char_to_byte(text: &str, character_offset: usize) -> usize {
    text.char_indices()
        .nth(character_offset)
        .map_or(text.len(), |(byte, _)| byte)
}

fn first_mismatch(candidate: &str, target: &str, start: usize) -> usize {
    candidate
        .chars()
        .zip(target.chars())
        .enumerate()
        .skip(start)
        .find_map(|(index, (actual, expected))| (actual != expected).then_some(index))
        .unwrap_or_else(|| candidate.chars().count().min(target.chars().count()))
}
