//! Deterministic, editor-independent Reasoning Recall practice.
//!
//! Answers are evaluated against reviewed identifiers, aliases, and concepts.
//! The engine deliberately does not ask an LLM to grade the response: the
//! content definition is the scoring contract and every transition is replayable.

use std::time::Duration;

use gewu_domain::{PracticeMode, ReasoningRecallDefinition, Revision, UnitId};
use thiserror::Error;

use crate::{ElapsedTime, SessionStatus, TerminalReason};

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ReasoningRecallConfig {
    unit_id: UnitId,
    revision: Revision,
    schema_version: String,
    definitions: Vec<ReasoningRecallDefinition>,
}

impl ReasoningRecallConfig {
    pub fn new(
        unit_id: UnitId,
        revision: Revision,
        schema_version: impl Into<String>,
        definitions: Vec<ReasoningRecallDefinition>,
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
pub enum ReasoningRecallEvent {
    SubmitAnswer(String),
    RevealPrompt,
    Restart,
    Stop,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ReasoningRecallOutcome {
    AcceptedStep,
    RejectedAnswer,
    PromptRevealed,
    Restarted,
    Completed,
    Stopped,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ReasoningRecallAttempt {
    unit_id: UnitId,
    revision: Revision,
    schema_version: String,
    accepted_step_count: u64,
    rejected_answer_count: u64,
    prompt_count: u64,
    restart_count: u64,
    active_duration: Duration,
    wall_clock_duration: Duration,
    terminal_reason: TerminalReason,
}

impl ReasoningRecallAttempt {
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
        PracticeMode::ReasoningRecall
    }
    pub fn accepted_step_count(&self) -> u64 {
        self.accepted_step_count
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
pub struct ReasoningRecallSession {
    config: ReasoningRecallConfig,
    next_definition: usize,
    status: SessionStatus,
    accepted_step_count: u64,
    rejected_answer_count: u64,
    prompt_count: u64,
    restart_count: u64,
    elapsed: ElapsedTime,
    attempt: Option<ReasoningRecallAttempt>,
}

impl ReasoningRecallSession {
    pub fn start(config: ReasoningRecallConfig) -> Result<Self, ReasoningRecallStartError> {
        if config.schema_version.trim().is_empty() {
            return Err(ReasoningRecallStartError::EmptySchemaVersion);
        }
        if config.definitions.is_empty() {
            return Err(ReasoningRecallStartError::EmptyDefinitions);
        }
        Ok(Self {
            config,
            next_definition: 0,
            status: SessionStatus::Active,
            accepted_step_count: 0,
            rejected_answer_count: 0,
            prompt_count: 0,
            restart_count: 0,
            elapsed: ElapsedTime::default(),
            attempt: None,
        })
    }

    pub fn apply(
        &mut self,
        event: ReasoningRecallEvent,
        elapsed: ElapsedTime,
    ) -> Result<ReasoningRecallOutcome, ReasoningRecallTransitionError> {
        if self.status != SessionStatus::Active {
            return Err(ReasoningRecallTransitionError::TerminalSession {
                status: self.status,
            });
        }
        if elapsed.active() < self.elapsed.active() || elapsed.wall() < self.elapsed.wall() {
            return Err(ReasoningRecallTransitionError::ElapsedTimeRegressed);
        }
        self.elapsed = elapsed;
        match event {
            ReasoningRecallEvent::SubmitAnswer(answer) => self.submit(answer),
            ReasoningRecallEvent::RevealPrompt => {
                self.prompt_count += 1;
                Ok(ReasoningRecallOutcome::PromptRevealed)
            }
            ReasoningRecallEvent::Restart => {
                self.next_definition = 0;
                self.restart_count += 1;
                Ok(ReasoningRecallOutcome::Restarted)
            }
            ReasoningRecallEvent::Stop => {
                self.status = SessionStatus::Stopped;
                self.create_attempt(TerminalReason::Stopped);
                Ok(ReasoningRecallOutcome::Stopped)
            }
        }
    }

    pub fn status(&self) -> SessionStatus {
        self.status
    }
    pub fn current_definition(&self) -> Option<&ReasoningRecallDefinition> {
        self.config.definitions.get(self.next_definition)
    }
    pub fn completed_step_count(&self) -> usize {
        self.next_definition
    }
    pub fn total_step_count(&self) -> usize {
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
    pub fn attempt(&self) -> Option<&ReasoningRecallAttempt> {
        self.attempt.as_ref()
    }

    fn submit(
        &mut self,
        answer: String,
    ) -> Result<ReasoningRecallOutcome, ReasoningRecallTransitionError> {
        if answer.trim().is_empty() {
            return Err(ReasoningRecallTransitionError::EmptyAnswer);
        }
        let definition = self
            .current_definition()
            .ok_or(ReasoningRecallTransitionError::MissingCurrentDefinition)?;
        if !matches_definition(definition, &answer) {
            self.rejected_answer_count += 1;
            return Ok(ReasoningRecallOutcome::RejectedAnswer);
        }
        self.next_definition += 1;
        self.accepted_step_count += 1;
        if self.next_definition == self.config.definitions.len() {
            self.status = SessionStatus::Completed;
            self.create_attempt(TerminalReason::Completed);
            Ok(ReasoningRecallOutcome::Completed)
        } else {
            Ok(ReasoningRecallOutcome::AcceptedStep)
        }
    }

    fn create_attempt(&mut self, terminal_reason: TerminalReason) {
        if self.attempt.is_some() {
            return;
        }
        self.attempt = Some(ReasoningRecallAttempt {
            unit_id: self.config.unit_id.clone(),
            revision: self.config.revision,
            schema_version: self.config.schema_version.clone(),
            accepted_step_count: self.accepted_step_count,
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
pub enum ReasoningRecallStartError {
    #[error("schema version must not be empty")]
    EmptySchemaVersion,
    #[error("reasoning recall must contain at least one definition")]
    EmptyDefinitions,
}

#[derive(Clone, Debug, Error, Eq, PartialEq)]
pub enum ReasoningRecallTransitionError {
    #[error("cannot apply an event to a terminal {status:?} session")]
    TerminalSession { status: SessionStatus },
    #[error("event elapsed time regressed")]
    ElapsedTimeRegressed,
    #[error("answer must not be empty")]
    EmptyAnswer,
    #[error("active reasoning recall has no current definition")]
    MissingCurrentDefinition,
}

fn matches_definition(definition: &ReasoningRecallDefinition, answer: &str) -> bool {
    let answer = normalize(answer);
    if answer == normalize(&definition.id)
        || definition
            .aliases
            .iter()
            .any(|alias| answer == normalize(alias))
    {
        return true;
    }
    definition.concepts.iter().all(|concept| {
        let concept = normalize(concept);
        matches_term(&answer, &concept)
    })
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
