//! Deterministic, editor-independent Code Recall practice.
//!
//! Code Recall intentionally keeps the canonical target in the core so that
//! completion and attempt facts remain deterministic. Clients decide how the
//! reviewed prompt and scaffold are rendered. The assistance policy changes
//! what a client may show; it does not change the exact-prefix completion
//! contract in this first slice.

use std::time::Duration;

use gewu_domain::{
    CodeRecallAssistance, CodeRecallLayout, CodeRecallSlotDefinition, Normalization, PracticeMode,
    Revision, UnitId,
};
use thiserror::Error;

use crate::{CharacterRange, ENGINE_VERSION, ElapsedTime, SessionStatus, TerminalReason};

/// Inputs that identify one Code Recall session and its reviewed content.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CodeRecallConfig {
    unit_id: UnitId,
    revision: Revision,
    schema_version: String,
    implementation: String,
    target: String,
    layout: CodeRecallLayout,
    assistance: CodeRecallAssistance,
    prompt: String,
    scaffold: Vec<String>,
    source_template: Option<String>,
    slots: Vec<CodeRecallSlotDefinition>,
    normalization: Normalization,
}

/// Reviewed prompt and assistance content for one Code Recall session.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CodeRecallGuidance {
    layout: CodeRecallLayout,
    assistance: CodeRecallAssistance,
    prompt: String,
    scaffold: Vec<String>,
    source_template: Option<String>,
    slots: Vec<CodeRecallSlotDefinition>,
}

impl CodeRecallGuidance {
    pub fn new(
        assistance: CodeRecallAssistance,
        prompt: impl Into<String>,
        scaffold: Vec<String>,
    ) -> Self {
        Self {
            layout: CodeRecallLayout::FullRecall,
            assistance,
            prompt: prompt.into(),
            scaffold,
            source_template: None,
            slots: Vec::new(),
        }
    }

    pub fn assistance(&self) -> CodeRecallAssistance {
        self.assistance
    }

    pub fn with_layout(mut self, layout: CodeRecallLayout) -> Self {
        self.layout = layout;
        self
    }

    pub fn layout(&self) -> CodeRecallLayout {
        self.layout
    }

    pub fn with_structured_layout(
        mut self,
        source_template: impl Into<String>,
        slots: Vec<CodeRecallSlotDefinition>,
    ) -> Self {
        self.source_template = Some(source_template.into());
        self.slots = slots;
        self
    }

    pub fn prompt(&self) -> &str {
        &self.prompt
    }

    pub fn scaffold(&self) -> &[String] {
        &self.scaffold
    }
}

impl CodeRecallConfig {
    /// Creates a Code Recall configuration.
    ///
    /// `target` is the reviewed implementation selected by the content
    /// definition. `scaffold` contains reviewed assistance items and is
    /// validated against the selected [`CodeRecallAssistance`] policy when the
    /// session starts.
    pub fn new(
        unit_id: UnitId,
        revision: Revision,
        schema_version: impl Into<String>,
        implementation: impl Into<String>,
        target: impl Into<String>,
        guidance: CodeRecallGuidance,
        normalization: Normalization,
    ) -> Self {
        Self {
            unit_id,
            revision,
            schema_version: schema_version.into(),
            implementation: implementation.into(),
            target: target.into(),
            layout: guidance.layout,
            assistance: guidance.assistance,
            prompt: guidance.prompt,
            scaffold: guidance.scaffold,
            source_template: guidance.source_template,
            slots: guidance.slots,
            normalization,
        }
    }

    pub fn unit_id(&self) -> &UnitId {
        &self.unit_id
    }

    pub fn revision(&self) -> Revision {
        self.revision
    }

    pub fn schema_version(&self) -> &str {
        &self.schema_version
    }

    pub fn implementation(&self) -> &str {
        &self.implementation
    }

    pub fn target(&self) -> &str {
        &self.target
    }

    pub fn assistance(&self) -> CodeRecallAssistance {
        self.assistance
    }

    pub fn layout(&self) -> CodeRecallLayout {
        self.layout
    }

    pub fn prompt(&self) -> &str {
        &self.prompt
    }

    pub fn scaffold(&self) -> &[String] {
        &self.scaffold
    }

    pub fn source_template(&self) -> Option<&str> {
        self.source_template.as_deref()
    }

    pub fn slots(&self) -> &[CodeRecallSlotDefinition] {
        &self.slots
    }

    pub fn normalization(&self) -> &Normalization {
        &self.normalization
    }
}

/// One editor-independent Code Recall input.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum CodeRecallEvent {
    /// Inserts text at the current end of the accepted canonical prefix.
    InsertText(String),
    /// Deletes Unicode scalar values immediately before the cursor.
    DeleteBackward { characters: usize },
    /// Deletes a range from the accepted prefix and rewinds later input.
    DeleteRange(CharacterRange),
    /// Atomically replaces a range in the accepted prefix.
    ReplaceRange { range: CharacterRange, text: String },
    /// Records explicitly requesting the reviewed prompt.
    RevealPrompt,
    /// Records explicitly revealing one reviewed scaffold item.
    RevealScaffold { index: usize },
    /// Resets progress while retaining facts accumulated by this session.
    Restart,
    /// Stops the session and creates its immutable attempt.
    Stop,
}

/// An event paired with caller-observed elapsed time for deterministic replay.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CodeRecallTimedEvent {
    pub event: CodeRecallEvent,
    pub elapsed: ElapsedTime,
}

impl CodeRecallTimedEvent {
    pub fn new(event: CodeRecallEvent, elapsed: ElapsedTime) -> Self {
        Self { event, elapsed }
    }
}

/// Observable result of an applied Code Recall event.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum CodeRecallOutcome {
    Accepted,
    /// The complete edit was rejected atomically at this character offset.
    RejectedMismatch {
        character_offset: usize,
    },
    PromptRevealed,
    ScaffoldRevealed {
        index: usize,
    },
    Restarted,
    Completed,
    Stopped,
}

/// Immutable facts emitted once for a completed or stopped Code Recall session.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CodeRecallAttempt {
    unit_id: UnitId,
    revision: Revision,
    schema_version: String,
    implementation: String,
    engine_version: &'static str,
    assistance: CodeRecallAssistance,
    target_character_count: usize,
    accepted_input_count: u64,
    rejected_input_count: u64,
    correction_count: u64,
    prompt_count: u64,
    scaffold_reveal_count: u64,
    revealed_scaffold_indices: Vec<usize>,
    restart_count: u64,
    active_duration: Duration,
    wall_clock_duration: Duration,
    terminal_reason: TerminalReason,
    normalization: Normalization,
}

impl CodeRecallAttempt {
    pub fn unit_id(&self) -> &UnitId {
        &self.unit_id
    }

    pub fn revision(&self) -> Revision {
        self.revision
    }

    pub fn schema_version(&self) -> &str {
        &self.schema_version
    }

    pub fn implementation(&self) -> &str {
        &self.implementation
    }

    pub fn engine_version(&self) -> &str {
        self.engine_version
    }

    pub fn mode(&self) -> PracticeMode {
        PracticeMode::CodeRecall
    }

    pub fn assistance(&self) -> CodeRecallAssistance {
        self.assistance
    }

    pub fn target_character_count(&self) -> usize {
        self.target_character_count
    }

    pub fn accepted_input_count(&self) -> u64 {
        self.accepted_input_count
    }

    pub fn rejected_input_count(&self) -> u64 {
        self.rejected_input_count
    }

    pub fn correction_count(&self) -> u64 {
        self.correction_count
    }

    pub fn prompt_count(&self) -> u64 {
        self.prompt_count
    }

    pub fn scaffold_reveal_count(&self) -> u64 {
        self.scaffold_reveal_count
    }

    pub fn revealed_scaffold_indices(&self) -> &[usize] {
        &self.revealed_scaffold_indices
    }

    pub fn restart_count(&self) -> u64 {
        self.restart_count
    }

    pub fn active_duration(&self) -> Duration {
        self.active_duration
    }

    pub fn wall_clock_duration(&self) -> Duration {
        self.wall_clock_duration
    }

    pub fn terminal_reason(&self) -> TerminalReason {
        self.terminal_reason
    }

    pub fn normalization(&self) -> &Normalization {
        &self.normalization
    }
}

/// Deterministic strict-prefix state for one Code Recall session.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CodeRecallSession {
    config: CodeRecallConfig,
    target: String,
    accepted: String,
    status: SessionStatus,
    accepted_input_count: u64,
    rejected_input_count: u64,
    correction_count: u64,
    prompt_count: u64,
    scaffold_reveal_count: u64,
    revealed_scaffold_indices: Vec<usize>,
    restart_count: u64,
    elapsed: ElapsedTime,
    attempt: Option<CodeRecallAttempt>,
}

impl CodeRecallSession {
    /// Starts an active session after canonicalizing the target once.
    pub fn start(config: CodeRecallConfig) -> Result<Self, CodeRecallStartError> {
        validate_nonempty("schema version", &config.schema_version)?;
        validate_nonempty("implementation key", &config.implementation)?;
        validate_nonempty("prompt", &config.prompt)?;
        validate_scaffold(&config.assistance, &config.scaffold)?;
        let structured = matches!(
            config.layout,
            CodeRecallLayout::Cloze | CodeRecallLayout::CommentGuided
        );
        let target_source = if structured {
            config
                .slots
                .iter()
                .map(|slot| slot.expected.as_str())
                .collect::<String>()
        } else {
            config.target.clone()
        };
        let target = if structured {
            normalize_slot_target(&target_source, &config.normalization)?
        } else {
            normalize_target(&target_source, &config.normalization)?
        };
        if target.is_empty() {
            return Err(CodeRecallStartError::EmptyTarget);
        }

        Ok(Self {
            config,
            target,
            accepted: String::new(),
            status: SessionStatus::Active,
            accepted_input_count: 0,
            rejected_input_count: 0,
            correction_count: 0,
            prompt_count: 0,
            scaffold_reveal_count: 0,
            revealed_scaffold_indices: Vec::new(),
            restart_count: 0,
            elapsed: ElapsedTime::default(),
            attempt: None,
        })
    }

    /// Replays a deterministic timed event sequence.
    pub fn replay(
        config: CodeRecallConfig,
        events: impl IntoIterator<Item = CodeRecallTimedEvent>,
    ) -> Result<Self, CodeRecallReplayError> {
        let mut session = Self::start(config).map_err(CodeRecallReplayError::Start)?;
        for (event_index, event) in events.into_iter().enumerate() {
            session
                .apply_timed(event)
                .map_err(|source| CodeRecallReplayError::Transition {
                    event_index,
                    source,
                })?;
        }
        Ok(session)
    }

    /// Applies one event using caller-observed cumulative elapsed time.
    pub fn apply(
        &mut self,
        event: CodeRecallEvent,
        elapsed: ElapsedTime,
    ) -> Result<CodeRecallOutcome, CodeRecallTransitionError> {
        self.apply_timed(CodeRecallTimedEvent::new(event, elapsed))
    }

    /// Applies one pre-timed event.
    pub fn apply_timed(
        &mut self,
        timed: CodeRecallTimedEvent,
    ) -> Result<CodeRecallOutcome, CodeRecallTransitionError> {
        self.ensure_active()?;
        self.validate_elapsed(timed.elapsed)?;

        let outcome = match timed.event {
            CodeRecallEvent::InsertText(text) => self.insert_text(text)?,
            CodeRecallEvent::DeleteBackward { characters } => self.delete_backward(characters)?,
            CodeRecallEvent::DeleteRange(range) => self.delete_range(range)?,
            CodeRecallEvent::ReplaceRange { range, text } => self.replace_range(range, text)?,
            CodeRecallEvent::RevealPrompt => {
                self.prompt_count += 1;
                CodeRecallOutcome::PromptRevealed
            }
            CodeRecallEvent::RevealScaffold { index } => self.reveal_scaffold(index)?,
            CodeRecallEvent::Restart => {
                self.accepted.clear();
                self.restart_count += 1;
                CodeRecallOutcome::Restarted
            }
            CodeRecallEvent::Stop => {
                self.elapsed = timed.elapsed;
                self.status = SessionStatus::Stopped;
                self.create_attempt(TerminalReason::Stopped);
                return Ok(CodeRecallOutcome::Stopped);
            }
        };

        self.elapsed = timed.elapsed;
        if self.accepted == self.target {
            self.status = SessionStatus::Completed;
            self.create_attempt(TerminalReason::Completed);
            Ok(CodeRecallOutcome::Completed)
        } else {
            Ok(outcome)
        }
    }

    pub fn status(&self) -> SessionStatus {
        self.status
    }

    pub fn target(&self) -> &str {
        &self.target
    }

    pub fn accepted_text(&self) -> &str {
        &self.accepted
    }

    pub fn cursor_character_offset(&self) -> usize {
        self.accepted.chars().count()
    }

    pub fn target_character_count(&self) -> usize {
        self.target.chars().count()
    }

    pub fn assistance(&self) -> CodeRecallAssistance {
        self.config.assistance
    }

    pub fn layout(&self) -> CodeRecallLayout {
        self.config.layout
    }

    pub fn prompt(&self) -> &str {
        &self.config.prompt
    }

    pub fn scaffold(&self) -> &[String] {
        &self.config.scaffold
    }

    pub fn source_template(&self) -> Option<&str> {
        self.config.source_template()
    }

    pub fn slots(&self) -> &[CodeRecallSlotDefinition] {
        self.config.slots()
    }

    pub fn completed_slot_count(&self) -> usize {
        let accepted = self.accepted.chars().count();
        let mut consumed = 0;
        self.config
            .slots
            .iter()
            .take_while(|slot| {
                consumed += slot.expected.chars().count();
                consumed <= accepted
            })
            .count()
    }

    pub fn accepted_input_count(&self) -> u64 {
        self.accepted_input_count
    }

    pub fn rejected_input_count(&self) -> u64 {
        self.rejected_input_count
    }

    pub fn correction_count(&self) -> u64 {
        self.correction_count
    }

    pub fn prompt_count(&self) -> u64 {
        self.prompt_count
    }

    pub fn scaffold_reveal_count(&self) -> u64 {
        self.scaffold_reveal_count
    }

    pub fn revealed_scaffold_indices(&self) -> &[usize] {
        &self.revealed_scaffold_indices
    }

    pub fn restart_count(&self) -> u64 {
        self.restart_count
    }

    pub fn elapsed(&self) -> ElapsedTime {
        self.elapsed
    }

    pub fn attempt(&self) -> Option<&CodeRecallAttempt> {
        self.attempt.as_ref()
    }

    fn ensure_active(&self) -> Result<(), CodeRecallTransitionError> {
        if self.status == SessionStatus::Active {
            Ok(())
        } else {
            Err(CodeRecallTransitionError::TerminalSession {
                status: self.status,
            })
        }
    }

    fn validate_elapsed(&self, elapsed: ElapsedTime) -> Result<(), CodeRecallTransitionError> {
        if elapsed.active() < self.elapsed.active() || elapsed.wall() < self.elapsed.wall() {
            Err(CodeRecallTransitionError::ElapsedTimeRegressed {
                previous: self.elapsed,
                received: elapsed,
            })
        } else {
            Ok(())
        }
    }

    fn insert_text(
        &mut self,
        text: String,
    ) -> Result<CodeRecallOutcome, CodeRecallTransitionError> {
        if text.is_empty() {
            return Err(CodeRecallTransitionError::EmptyText);
        }
        let start = self.accepted.chars().count();
        self.try_candidate(
            format!("{}{text}", self.accepted),
            text.chars().count(),
            start,
        )
    }

    fn delete_backward(
        &mut self,
        characters: usize,
    ) -> Result<CodeRecallOutcome, CodeRecallTransitionError> {
        if characters == 0 {
            return Err(CodeRecallTransitionError::ZeroDelete);
        }
        let end = self.accepted.chars().count();
        let start =
            end.checked_sub(characters)
                .ok_or(CodeRecallTransitionError::RangeOutOfBounds {
                    range_start: 0,
                    range_end: characters,
                    current_characters: end,
                })?;
        self.delete_range_indices(start, end)
    }

    fn delete_range(
        &mut self,
        range: CharacterRange,
    ) -> Result<CodeRecallOutcome, CodeRecallTransitionError> {
        self.ensure_range_in_accepted(range)?;
        self.delete_range_indices(range.start(), range.end())
    }

    fn delete_range_indices(
        &mut self,
        start: usize,
        _end: usize,
    ) -> Result<CodeRecallOutcome, CodeRecallTransitionError> {
        self.accepted = self.accepted.chars().take(start).collect();
        self.correction_count += 1;
        Ok(CodeRecallOutcome::Accepted)
    }

    fn replace_range(
        &mut self,
        range: CharacterRange,
        text: String,
    ) -> Result<CodeRecallOutcome, CodeRecallTransitionError> {
        if text.is_empty() {
            return Err(CodeRecallTransitionError::EmptyText);
        }
        self.ensure_range_in_accepted(range)?;
        let candidate = replace_char_range(&self.accepted, range.start(), range.end(), &text);
        if candidate == self.accepted {
            return Err(CodeRecallTransitionError::NoOpReplacement);
        }
        let outcome = self.try_candidate(candidate, text.chars().count(), range.start())?;
        if outcome == CodeRecallOutcome::Accepted {
            self.correction_count += 1;
        }
        Ok(outcome)
    }

    fn try_candidate(
        &mut self,
        candidate: String,
        input_characters: usize,
        comparison_start: usize,
    ) -> Result<CodeRecallOutcome, CodeRecallTransitionError> {
        if self.target.starts_with(&candidate) {
            self.accepted = candidate;
            self.accepted_input_count = self
                .accepted_input_count
                .saturating_add(input_characters as u64);
            Ok(CodeRecallOutcome::Accepted)
        } else {
            self.rejected_input_count = self
                .rejected_input_count
                .saturating_add(input_characters as u64);
            Ok(CodeRecallOutcome::RejectedMismatch {
                character_offset: first_mismatch(&candidate, &self.target, comparison_start),
            })
        }
    }

    fn reveal_scaffold(
        &mut self,
        index: usize,
    ) -> Result<CodeRecallOutcome, CodeRecallTransitionError> {
        if index >= self.config.scaffold.len() {
            return Err(CodeRecallTransitionError::ScaffoldIndexOutOfBounds {
                index,
                scaffold_count: self.config.scaffold.len(),
            });
        }
        self.scaffold_reveal_count += 1;
        self.revealed_scaffold_indices.push(index);
        Ok(CodeRecallOutcome::ScaffoldRevealed { index })
    }

    fn ensure_range_in_accepted(
        &self,
        range: CharacterRange,
    ) -> Result<(), CodeRecallTransitionError> {
        let current_characters = self.accepted.chars().count();
        if range.end() <= current_characters {
            Ok(())
        } else {
            Err(CodeRecallTransitionError::RangeOutOfBounds {
                range_start: range.start(),
                range_end: range.end(),
                current_characters,
            })
        }
    }

    fn create_attempt(&mut self, terminal_reason: TerminalReason) {
        if self.attempt.is_some() {
            return;
        }
        self.attempt = Some(CodeRecallAttempt {
            unit_id: self.config.unit_id.clone(),
            revision: self.config.revision,
            schema_version: self.config.schema_version.clone(),
            implementation: self.config.implementation.clone(),
            engine_version: ENGINE_VERSION,
            assistance: self.config.assistance,
            target_character_count: self.target.chars().count(),
            accepted_input_count: self.accepted_input_count,
            rejected_input_count: self.rejected_input_count,
            correction_count: self.correction_count,
            prompt_count: self.prompt_count,
            scaffold_reveal_count: self.scaffold_reveal_count,
            revealed_scaffold_indices: self.revealed_scaffold_indices.clone(),
            restart_count: self.restart_count,
            active_duration: self.elapsed.active(),
            wall_clock_duration: self.elapsed.wall(),
            terminal_reason,
            normalization: self.config.normalization.clone(),
        });
    }
}

/// Invalid Code Recall session inputs.
#[derive(Clone, Debug, Error, Eq, PartialEq)]
pub enum CodeRecallStartError {
    #[error("{field} must not be empty")]
    EmptyMetadata { field: &'static str },
    #[error("assistance policy `none` must not declare scaffold items")]
    ScaffoldNotAllowedForNone,
    #[error("assistance policy requires at least one scaffold item")]
    MissingScaffold,
    #[error("unsupported line-ending policy `{value}`; only `lf` is supported")]
    UnsupportedLineEndings { value: String },
    #[error("unsupported whitespace policy `{value}`; only `strict` is supported")]
    UnsupportedWhitespace { value: String },
    #[error("canonical target must not be empty")]
    EmptyTarget,
}

/// A Code Recall transition rejected by the state machine.
#[derive(Clone, Debug, Error, Eq, PartialEq)]
pub enum CodeRecallTransitionError {
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
    #[error("replacement must change the accepted text")]
    NoOpReplacement,
    #[error("scaffold index {index} exceeds scaffold count {scaffold_count}")]
    ScaffoldIndexOutOfBounds { index: usize, scaffold_count: usize },
}

/// Failure while starting or replaying a Code Recall event sequence.
#[derive(Clone, Debug, Error, Eq, PartialEq)]
pub enum CodeRecallReplayError {
    #[error("could not start replay: {0}")]
    Start(CodeRecallStartError),
    #[error("could not apply replay event {event_index}: {source}")]
    Transition {
        event_index: usize,
        #[source]
        source: CodeRecallTransitionError,
    },
}

fn validate_nonempty(field: &'static str, value: &str) -> Result<(), CodeRecallStartError> {
    if value.trim().is_empty() {
        Err(CodeRecallStartError::EmptyMetadata { field })
    } else {
        Ok(())
    }
}

fn validate_scaffold(
    assistance: &CodeRecallAssistance,
    scaffold: &[String],
) -> Result<(), CodeRecallStartError> {
    match assistance {
        CodeRecallAssistance::None if !scaffold.is_empty() => {
            Err(CodeRecallStartError::ScaffoldNotAllowedForNone)
        }
        CodeRecallAssistance::None => Ok(()),
        _ if scaffold.is_empty() => Err(CodeRecallStartError::MissingScaffold),
        _ if scaffold.iter().any(|item| item.trim().is_empty()) => {
            Err(CodeRecallStartError::EmptyMetadata {
                field: "scaffold item",
            })
        }
        _ => Ok(()),
    }
}

fn normalize_target(target: &str, policy: &Normalization) -> Result<String, CodeRecallStartError> {
    if policy.line_endings != "lf" {
        return Err(CodeRecallStartError::UnsupportedLineEndings {
            value: policy.line_endings.clone(),
        });
    }
    if policy.whitespace != "strict" {
        return Err(CodeRecallStartError::UnsupportedWhitespace {
            value: policy.whitespace.clone(),
        });
    }

    let mut normalized = target.replace("\r\n", "\n").replace('\r', "\n");
    while normalized.ends_with('\n') {
        normalized.pop();
    }
    if policy.trailing_newline {
        normalized.push('\n');
    }
    Ok(normalized)
}

fn normalize_slot_target(
    target: &str,
    policy: &Normalization,
) -> Result<String, CodeRecallStartError> {
    if policy.line_endings != "lf" {
        return Err(CodeRecallStartError::UnsupportedLineEndings {
            value: policy.line_endings.clone(),
        });
    }
    if policy.whitespace != "strict" {
        return Err(CodeRecallStartError::UnsupportedWhitespace {
            value: policy.whitespace.clone(),
        });
    }
    Ok(target.replace("\r\n", "\n").replace('\r', "\n"))
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
