//! Deterministic, editor-independent Transfer Practice.
//!
//! A response must cover every reviewed transfer, difference, and boundary
//! term. This is intentionally a conservative content contract; richer human
//! review can be layered on top without changing the recorded facts.

use std::time::Duration;

use gewu_domain::{PracticeMode, Revision, TransferPracticeDefinition, UnitId};
use thiserror::Error;

use crate::{ElapsedTime, SessionStatus, TerminalReason};

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TransferPracticeConfig {
    unit_id: UnitId,
    revision: Revision,
    schema_version: String,
    definitions: Vec<TransferPracticeDefinition>,
}

impl TransferPracticeConfig {
    pub fn new(
        unit_id: UnitId,
        revision: Revision,
        schema_version: impl Into<String>,
        definitions: Vec<TransferPracticeDefinition>,
    ) -> Self {
        Self {
            unit_id,
            revision,
            schema_version: schema_version.into(),
            definitions,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum TransferPracticeEvent {
    SubmitAnswer(String),
    RevealPrompt,
    Restart,
    Stop,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum TransferPracticeOutcome {
    AcceptedCase,
    RejectedAnswer,
    PromptRevealed,
    Restarted,
    Completed,
    Stopped,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TransferPracticeAttempt {
    unit_id: UnitId,
    revision: Revision,
    schema_version: String,
    accepted_case_count: u64,
    rejected_answer_count: u64,
    prompt_count: u64,
    restart_count: u64,
    active_duration: Duration,
    wall_clock_duration: Duration,
    terminal_reason: TerminalReason,
}

impl TransferPracticeAttempt {
    pub fn unit_id(&self) -> &UnitId {
        &self.unit_id
    }
    pub fn revision(&self) -> Revision {
        self.revision
    }
    pub fn schema_version(&self) -> &str {
        &self.schema_version
    }
    pub fn mode(&self) -> PracticeMode {
        PracticeMode::TransferPractice
    }
    pub fn accepted_case_count(&self) -> u64 {
        self.accepted_case_count
    }
    pub fn rejected_answer_count(&self) -> u64 {
        self.rejected_answer_count
    }
    pub fn prompt_count(&self) -> u64 {
        self.prompt_count
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
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TransferPracticeSession {
    config: TransferPracticeConfig,
    next_definition: usize,
    status: SessionStatus,
    accepted_case_count: u64,
    rejected_answer_count: u64,
    prompt_count: u64,
    restart_count: u64,
    elapsed: ElapsedTime,
    attempt: Option<TransferPracticeAttempt>,
}

impl TransferPracticeSession {
    pub fn start(config: TransferPracticeConfig) -> Result<Self, TransferPracticeStartError> {
        if config.schema_version.trim().is_empty() {
            return Err(TransferPracticeStartError::EmptySchemaVersion);
        }
        if config.definitions.is_empty() {
            return Err(TransferPracticeStartError::EmptyDefinitions);
        }
        Ok(Self {
            config,
            next_definition: 0,
            status: SessionStatus::Active,
            accepted_case_count: 0,
            rejected_answer_count: 0,
            prompt_count: 0,
            restart_count: 0,
            elapsed: ElapsedTime::default(),
            attempt: None,
        })
    }

    pub fn apply(
        &mut self,
        event: TransferPracticeEvent,
        elapsed: ElapsedTime,
    ) -> Result<TransferPracticeOutcome, TransferPracticeTransitionError> {
        if self.status != SessionStatus::Active {
            return Err(TransferPracticeTransitionError::TerminalSession {
                status: self.status,
            });
        }
        if elapsed.active() < self.elapsed.active() || elapsed.wall() < self.elapsed.wall() {
            return Err(TransferPracticeTransitionError::ElapsedTimeRegressed);
        }
        self.elapsed = elapsed;
        match event {
            TransferPracticeEvent::SubmitAnswer(answer) => self.submit(answer),
            TransferPracticeEvent::RevealPrompt => {
                self.prompt_count += 1;
                Ok(TransferPracticeOutcome::PromptRevealed)
            }
            TransferPracticeEvent::Restart => {
                self.next_definition = 0;
                self.restart_count += 1;
                Ok(TransferPracticeOutcome::Restarted)
            }
            TransferPracticeEvent::Stop => {
                self.status = SessionStatus::Stopped;
                self.create_attempt(TerminalReason::Stopped);
                Ok(TransferPracticeOutcome::Stopped)
            }
        }
    }

    pub fn status(&self) -> SessionStatus {
        self.status
    }
    pub fn current_definition(&self) -> Option<&TransferPracticeDefinition> {
        self.config.definitions.get(self.next_definition)
    }
    pub fn completed_case_count(&self) -> usize {
        self.next_definition
    }
    pub fn total_case_count(&self) -> usize {
        self.config.definitions.len()
    }
    pub fn prompt_count(&self) -> u64 {
        self.prompt_count
    }
    pub fn rejected_answer_count(&self) -> u64 {
        self.rejected_answer_count
    }
    pub fn elapsed(&self) -> ElapsedTime {
        self.elapsed
    }
    pub fn attempt(&self) -> Option<&TransferPracticeAttempt> {
        self.attempt.as_ref()
    }

    fn submit(
        &mut self,
        answer: String,
    ) -> Result<TransferPracticeOutcome, TransferPracticeTransitionError> {
        if answer.trim().is_empty() {
            return Err(TransferPracticeTransitionError::EmptyAnswer);
        }
        let definition = self
            .current_definition()
            .ok_or(TransferPracticeTransitionError::MissingCurrentDefinition)?;
        if !matches_definition(definition, &answer) {
            self.rejected_answer_count += 1;
            return Ok(TransferPracticeOutcome::RejectedAnswer);
        }
        self.next_definition += 1;
        self.accepted_case_count += 1;
        if self.next_definition == self.config.definitions.len() {
            self.status = SessionStatus::Completed;
            self.create_attempt(TerminalReason::Completed);
            Ok(TransferPracticeOutcome::Completed)
        } else {
            Ok(TransferPracticeOutcome::AcceptedCase)
        }
    }

    fn create_attempt(&mut self, terminal_reason: TerminalReason) {
        if self.attempt.is_some() {
            return;
        }
        self.attempt = Some(TransferPracticeAttempt {
            unit_id: self.config.unit_id.clone(),
            revision: self.config.revision,
            schema_version: self.config.schema_version.clone(),
            accepted_case_count: self.accepted_case_count,
            rejected_answer_count: self.rejected_answer_count,
            prompt_count: self.prompt_count,
            restart_count: self.restart_count,
            active_duration: self.elapsed.active(),
            wall_clock_duration: self.elapsed.wall(),
            terminal_reason,
        });
    }
}

#[derive(Clone, Debug, Error, Eq, PartialEq)]
pub enum TransferPracticeStartError {
    #[error("schema version must not be empty")]
    EmptySchemaVersion,
    #[error("transfer practice must contain at least one definition")]
    EmptyDefinitions,
}

#[derive(Clone, Debug, Error, Eq, PartialEq)]
pub enum TransferPracticeTransitionError {
    #[error("cannot apply an event to a terminal {status:?} session")]
    TerminalSession { status: SessionStatus },
    #[error("event elapsed time regressed")]
    ElapsedTimeRegressed,
    #[error("answer must not be empty")]
    EmptyAnswer,
    #[error("active transfer practice has no current definition")]
    MissingCurrentDefinition,
}

fn matches_definition(definition: &TransferPracticeDefinition, answer: &str) -> bool {
    let answer = normalize(answer);
    [
        &definition.concepts,
        &definition.transfers,
        &definition.differences,
        &definition.boundaries,
    ]
    .into_iter()
    .flatten()
    .all(|term| matches_term(&answer, &normalize(term)))
}

fn matches_term(answer: &str, term: &str) -> bool {
    if term.is_empty() {
        return false;
    }
    if term.is_ascii() {
        let answer_tokens: Vec<&str> = answer.split_whitespace().collect();
        term.split_whitespace()
            .all(|token| answer_tokens.contains(&token))
    } else {
        answer.contains(term)
    }
}

fn normalize(value: &str) -> String {
    value
        .chars()
        .map(|character| {
            if character.is_alphanumeric() {
                character.to_lowercase().collect::<String>()
            } else {
                " ".to_owned()
            }
        })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}
