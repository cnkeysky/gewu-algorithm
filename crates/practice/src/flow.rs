//! Deterministic ordered Flow Recall practice.

use std::time::Duration;

use gewu_domain::{FlowStep, PracticeMode, Revision, UnitId};
use thiserror::Error;

use crate::{ElapsedTime, SessionStatus, TerminalReason};

/// Inputs that identify one ordered Flow Recall session.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct FlowRecallConfig {
    unit_id: UnitId,
    revision: Revision,
    schema_version: String,
    steps: Vec<FlowStep>,
}

impl FlowRecallConfig {
    /// Creates a configuration from reviewed flow steps.
    pub fn new(
        unit_id: UnitId,
        revision: Revision,
        schema_version: impl Into<String>,
        steps: Vec<FlowStep>,
    ) -> Self {
        Self {
            unit_id,
            revision,
            schema_version: schema_version.into(),
            steps,
        }
    }
}

/// One input to an ordered Flow Recall session.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum FlowRecallEvent {
    /// Submits an answer for the current reviewed step.
    SubmitAnswer(String),
    /// Records explicitly requesting the current step's prompt.
    RevealPrompt,
    /// Resets to the first step while retaining session facts.
    Restart,
    /// Stops the session and emits an immutable attempt.
    Stop,
}

/// Observable result of a Flow Recall transition.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum FlowRecallOutcome {
    AcceptedStep,
    RejectedAnswer,
    PromptRevealed,
    Restarted,
    Completed,
    Stopped,
}

/// Immutable facts emitted once for a completed or stopped Flow Recall session.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct FlowRecallAttempt {
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

impl FlowRecallAttempt {
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
        PracticeMode::FlowRecall
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

/// Ordered reviewed-flow reconstruction without exact-prose matching.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct FlowRecallSession {
    config: FlowRecallConfig,
    next_step: usize,
    status: SessionStatus,
    accepted_step_count: u64,
    rejected_answer_count: u64,
    prompt_count: u64,
    restart_count: u64,
    elapsed: ElapsedTime,
    attempt: Option<FlowRecallAttempt>,
}

impl FlowRecallSession {
    /// Starts a session from non-empty reviewed flow steps.
    pub fn start(config: FlowRecallConfig) -> Result<Self, FlowRecallStartError> {
        if config.schema_version.trim().is_empty() {
            return Err(FlowRecallStartError::EmptySchemaVersion);
        }
        if config.steps.is_empty() {
            return Err(FlowRecallStartError::EmptySteps);
        }
        Ok(Self {
            config,
            next_step: 0,
            status: SessionStatus::Active,
            accepted_step_count: 0,
            rejected_answer_count: 0,
            prompt_count: 0,
            restart_count: 0,
            elapsed: ElapsedTime::default(),
            attempt: None,
        })
    }

    /// Applies an event. Answers are matched against reviewed identifiers,
    /// aliases, or all reviewed concepts, never against one canonical prose text.
    pub fn apply(
        &mut self,
        event: FlowRecallEvent,
        elapsed: ElapsedTime,
    ) -> Result<FlowRecallOutcome, FlowRecallTransitionError> {
        if self.status != SessionStatus::Active {
            return Err(FlowRecallTransitionError::TerminalSession {
                status: self.status,
            });
        }
        if elapsed.active() < self.elapsed.active() || elapsed.wall() < self.elapsed.wall() {
            return Err(FlowRecallTransitionError::ElapsedTimeRegressed);
        }
        self.elapsed = elapsed;
        match event {
            FlowRecallEvent::SubmitAnswer(answer) => self.submit(answer),
            FlowRecallEvent::RevealPrompt => {
                self.prompt_count += 1;
                Ok(FlowRecallOutcome::PromptRevealed)
            }
            FlowRecallEvent::Restart => {
                self.next_step = 0;
                self.restart_count += 1;
                Ok(FlowRecallOutcome::Restarted)
            }
            FlowRecallEvent::Stop => {
                self.status = SessionStatus::Stopped;
                self.create_attempt(TerminalReason::Stopped);
                Ok(FlowRecallOutcome::Stopped)
            }
        }
    }

    pub fn status(&self) -> SessionStatus {
        self.status
    }
    pub fn current_step(&self) -> Option<&FlowStep> {
        self.config.steps.get(self.next_step)
    }
    pub fn completed_step_count(&self) -> usize {
        self.next_step
    }
    pub fn completed_steps(&self) -> &[FlowStep] {
        &self.config.steps[..self.next_step]
    }
    pub fn total_step_count(&self) -> usize {
        self.config.steps.len()
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
    pub fn attempt(&self) -> Option<&FlowRecallAttempt> {
        self.attempt.as_ref()
    }

    fn submit(&mut self, answer: String) -> Result<FlowRecallOutcome, FlowRecallTransitionError> {
        if answer.trim().is_empty() {
            return Err(FlowRecallTransitionError::EmptyAnswer);
        }
        let step = self
            .current_step()
            .ok_or(FlowRecallTransitionError::MissingCurrentStep)?;
        if !matches_reviewed_step(step, &answer) {
            self.rejected_answer_count += 1;
            return Ok(FlowRecallOutcome::RejectedAnswer);
        }
        self.next_step += 1;
        self.accepted_step_count += 1;
        if self.next_step == self.config.steps.len() {
            self.status = SessionStatus::Completed;
            self.create_attempt(TerminalReason::Completed);
            Ok(FlowRecallOutcome::Completed)
        } else {
            Ok(FlowRecallOutcome::AcceptedStep)
        }
    }

    fn create_attempt(&mut self, terminal_reason: TerminalReason) {
        if self.attempt.is_some() {
            return;
        }
        self.attempt = Some(FlowRecallAttempt {
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

/// Invalid Flow Recall session inputs.
#[derive(Clone, Debug, Error, Eq, PartialEq)]
pub enum FlowRecallStartError {
    #[error("schema version must not be empty")]
    EmptySchemaVersion,
    #[error("reviewed flow must contain at least one step")]
    EmptySteps,
}

/// A Flow Recall transition rejected by the state machine.
#[derive(Clone, Debug, Error, Eq, PartialEq)]
pub enum FlowRecallTransitionError {
    #[error("cannot apply an event to a terminal {status:?} session")]
    TerminalSession { status: SessionStatus },
    #[error("event elapsed time regressed")]
    ElapsedTimeRegressed,
    #[error("answer must not be empty")]
    EmptyAnswer,
    #[error("active flow session has no current step")]
    MissingCurrentStep,
}

fn matches_reviewed_step(step: &FlowStep, answer: &str) -> bool {
    let answer = normalize(answer);
    if answer == normalize(&step.id) || step.aliases.iter().any(|alias| answer == normalize(alias))
    {
        return true;
    }
    let answer_tokens: Vec<&str> = answer.split_whitespace().collect();
    step.concepts.iter().all(|concept| {
        let concept = normalize(concept);
        if !concept.is_ascii() {
            return !concept.is_empty() && answer.contains(&concept);
        }
        concept
            .split_whitespace()
            .all(|token| answer_tokens.contains(&token))
    })
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

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use gewu_domain::{FlowStep, Revision, UnitId};

    use super::*;

    fn session() -> FlowRecallSession {
        let config = FlowRecallConfig::new(
            UnitId::parse("graph.bfs").unwrap_or_else(|error| panic!("test unit ID: {error}")),
            Revision::new(1).unwrap_or_else(|error| panic!("test revision: {error}")),
            "1",
            vec![
                FlowStep {
                    id: "seed-frontier".to_owned(),
                    prompt: "seed".to_owned(),
                    concepts: vec!["queue".to_owned(), "start".to_owned()],
                    aliases: vec!["initialize the queue".to_owned()],
                },
                FlowStep {
                    id: "expand-neighbors".to_owned(),
                    prompt: "expand".to_owned(),
                    concepts: vec!["neighbor".to_owned()],
                    aliases: vec![],
                },
            ],
        );
        FlowRecallSession::start(config).unwrap_or_else(|error| panic!("test session: {error}"))
    }

    fn elapsed(seconds: u64) -> ElapsedTime {
        ElapsedTime::new(Duration::from_secs(seconds), Duration::from_secs(seconds))
            .unwrap_or_else(|error| panic!("test elapsed: {error}"))
    }

    #[test]
    fn accepts_reviewed_aliases_identifiers_and_concepts_without_exact_prose() {
        let mut session = session();
        assert_eq!(
            session.apply(
                FlowRecallEvent::SubmitAnswer("Initialize the queue".to_owned()),
                elapsed(1)
            ),
            Ok(FlowRecallOutcome::AcceptedStep)
        );
        assert_eq!(
            session.apply(
                FlowRecallEvent::SubmitAnswer("expand-neighbors".to_owned()),
                elapsed(2)
            ),
            Ok(FlowRecallOutcome::Completed)
        );
        assert_eq!(
            session.attempt().map(FlowRecallAttempt::terminal_reason),
            Some(TerminalReason::Completed)
        );
    }

    #[test]
    fn records_prompt_usage_separately_from_rejected_answers() {
        let mut session = session();
        assert_eq!(
            session.apply(FlowRecallEvent::RevealPrompt, elapsed(1)),
            Ok(FlowRecallOutcome::PromptRevealed)
        );
        assert_eq!(
            session.apply(
                FlowRecallEvent::SubmitAnswer("depth first".to_owned()),
                elapsed(2)
            ),
            Ok(FlowRecallOutcome::RejectedAnswer)
        );
        assert_eq!(session.prompt_count(), 1);
        assert_eq!(session.rejected_answer_count(), 1);
    }

    #[test]
    fn matches_non_ascii_reviewed_concepts_without_vacuous_acceptance() {
        let config = FlowRecallConfig::new(
            UnitId::parse("graph.bfs").unwrap_or_else(|error| panic!("test unit ID: {error}")),
            Revision::new(1).unwrap_or_else(|error| panic!("test revision: {error}")),
            "1",
            vec![FlowStep {
                id: "expand-frontier".to_owned(),
                prompt: "\u{6269}\u{5c55}\u{4e0b}\u{4e00}\u{5c42}".to_owned(),
                concepts: vec!["\u{961f}\u{5217}".to_owned(), "\u{90bb}\u{5c45}".to_owned()],
                aliases: vec![],
            }],
        );
        let mut session = FlowRecallSession::start(config)
            .unwrap_or_else(|error| panic!("test session: {error}"));

        assert_eq!(
            session.apply(
                FlowRecallEvent::SubmitAnswer("\u{968f}\u{4fbf}".to_owned()),
                elapsed(1),
            ),
            Ok(FlowRecallOutcome::RejectedAnswer)
        );
        assert_eq!(
            session.apply(
                FlowRecallEvent::SubmitAnswer(
                    "\u{628a}\u{90bb}\u{5c45}\u{52a0}\u{5165}\u{961f}\u{5217}".to_owned(),
                ),
                elapsed(2)
            ),
            Ok(FlowRecallOutcome::Completed)
        );
    }
}
