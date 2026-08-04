#![forbid(unsafe_code)]
//! Core application services. This is the only layer that combines templates,
//! deterministic practice transitions, and local persistence.

use std::{
    collections::BTreeMap,
    fs,
    path::{Path, PathBuf},
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use gewu_domain::AlgorithmUnit;
use gewu_practice::{
    CharacterRange, ElapsedTime, FlowRecallConfig, FlowRecallEvent, FlowRecallSession,
    SessionStatus, ShadowTypingConfig, ShadowTypingEvent, ShadowTypingSession, TerminalReason,
    TimedEvent,
};
use gewu_protocol::{
    ApplyEventParams, AttemptSummary, ElapsedDto, PracticeEventDto, PracticeModeDto,
    SessionStatusDto, SessionView, StartSessionParams, TerminalReasonDto, UnitSummary,
};
use gewu_storage::{LocalStore, StoredAttempt, StoredCheckpoint, StoredEvent};
use gewu_template::{LoadError, load_algorithm_unit};
use thiserror::Error;

/// Version of the application service and protocol implementation.
pub const CORE_VERSION: &str = env!("CARGO_PKG_VERSION");

/// Offline application service configured with a content root and local data root.
pub struct Core {
    content_root: PathBuf,
    store: LocalStore,
    sessions: BTreeMap<String, ActiveSession>,
    next_session: u64,
}

enum ActiveSession {
    Shadow {
        unit: Box<AlgorithmUnit>,
        implementation: String,
        session: Box<ShadowTypingSession>,
        events: Vec<StoredEvent>,
    },
    Flow {
        unit: Box<AlgorithmUnit>,
        session: Box<FlowRecallSession>,
        events: Vec<StoredEvent>,
    },
}

impl Core {
    /// Opens a portable local core. Callers choose paths; no editor API leaks here.
    pub fn open(
        content_root: impl Into<PathBuf>,
        data_root: impl Into<PathBuf>,
    ) -> Result<Self, CoreError> {
        Ok(Self {
            content_root: content_root.into(),
            store: LocalStore::open(data_root)?,
            sessions: BTreeMap::new(),
            next_session: 1,
        })
    }

    pub fn list_units(&self) -> Result<Vec<UnitSummary>, CoreError> {
        let mut units = self.load_units()?;
        units.sort_by(|left, right| left.id.as_str().cmp(right.id.as_str()));
        Ok(units
            .into_iter()
            .map(|unit| UnitSummary {
                id: unit.id.to_string(),
                revision: unit.revision.get(),
                title: unit.title,
                modes: vec![PracticeModeDto::ShadowTyping, PracticeModeDto::FlowRecall],
            })
            .collect())
    }

    /// Loads one unit summary through the same validated local-content path.
    pub fn load_unit(&self, id: &str) -> Result<UnitSummary, CoreError> {
        let unit = self.find_unit(id)?;
        Ok(UnitSummary {
            id: unit.id.to_string(),
            revision: unit.revision.get(),
            title: unit.title,
            modes: vec![PracticeModeDto::ShadowTyping, PracticeModeDto::FlowRecall],
        })
    }

    pub fn start_session(&mut self, params: StartSessionParams) -> Result<SessionView, CoreError> {
        let unit = self.find_unit(&params.unit_id)?;
        let session_id = self.allocate_session_id();
        let active =
            match params.mode {
                PracticeModeDto::ShadowTyping => {
                    let definition = unit.practice.shadow_typing.first().ok_or(
                        CoreError::UnsupportedPractice {
                            unit_id: params.unit_id.clone(),
                            mode: "shadow_typing",
                        },
                    )?;
                    let implementation = params
                        .implementation
                        .unwrap_or_else(|| definition.implementation.clone());
                    if implementation != definition.implementation {
                        return Err(CoreError::UnknownImplementation {
                            unit_id: params.unit_id,
                            implementation,
                        });
                    }
                    let implementation_data = unit
                        .implementations
                        .iter()
                        .find(|value| value.key == implementation)
                        .ok_or_else(|| CoreError::UnknownImplementation {
                            unit_id: unit.id.to_string(),
                            implementation: implementation.clone(),
                        })?;
                    let source =
                        fs::read_to_string(&implementation_data.source_path).map_err(|source| {
                            CoreError::Source {
                                path: implementation_data.source_path.clone(),
                                source,
                            }
                        })?;
                    let session = ShadowTypingSession::start(ShadowTypingConfig::new(
                        unit.id.clone(),
                        unit.revision,
                        unit.schema_version.clone(),
                        implementation.clone(),
                        source,
                        implementation_data.normalization.clone(),
                    ))?;
                    ActiveSession::Shadow {
                        unit: Box::new(unit),
                        implementation,
                        session: Box::new(session),
                        events: Vec::new(),
                    }
                }
                PracticeModeDto::FlowRecall => {
                    let session = FlowRecallSession::start(FlowRecallConfig::new(
                        unit.id.clone(),
                        unit.revision,
                        unit.schema_version.clone(),
                        unit.practice.flow_recall_steps.clone(),
                    ))?;
                    ActiveSession::Flow {
                        unit: Box::new(unit),
                        session: Box::new(session),
                        events: Vec::new(),
                    }
                }
            };
        let view = active.view(&session_id);
        self.store
            .save_checkpoint(active.checkpoint(&session_id)?)?;
        self.sessions.insert(session_id, active);
        Ok(view)
    }

    pub fn apply_event(&mut self, params: ApplyEventParams) -> Result<SessionView, CoreError> {
        let session = self
            .sessions
            .get_mut(&params.session_id)
            .ok_or_else(|| CoreError::UnknownSession(params.session_id.clone()))?;
        session.apply(params.event, params.elapsed)?;
        self.persist_after_transition(&params.session_id)?;
        self.session_view(&params.session_id)
    }

    pub fn stop_session(
        &mut self,
        session_id: &str,
        elapsed: ElapsedDto,
    ) -> Result<SessionView, CoreError> {
        let session = self
            .sessions
            .get_mut(session_id)
            .ok_or_else(|| CoreError::UnknownSession(session_id.to_owned()))?;
        session.stop(elapsed)?;
        self.persist_after_transition(session_id)?;
        self.session_view(session_id)
    }

    pub fn restart_session(&mut self, session_id: &str) -> Result<SessionView, CoreError> {
        let params = self
            .sessions
            .get(session_id)
            .ok_or_else(|| CoreError::UnknownSession(session_id.to_owned()))?
            .start_params();
        let restarted = self.start_session(params)?;
        self.sessions.remove(session_id);
        Ok(restarted)
    }

    /// Explicit save is useful before controlled close; ordinary events already checkpoint.
    pub fn save_checkpoint(&mut self, session_id: &str) -> Result<(), CoreError> {
        let checkpoint = self
            .sessions
            .get(session_id)
            .ok_or_else(|| CoreError::UnknownSession(session_id.to_owned()))?
            .checkpoint(session_id)?;
        self.store.save_checkpoint(checkpoint)?;
        Ok(())
    }

    /// Resumes the one local checkpoint. It is never a terminal practice attempt.
    pub fn resume_checkpoint(&mut self) -> Result<Option<SessionView>, CoreError> {
        let Some(checkpoint) = self.store.load_checkpoint()? else {
            return Ok(None);
        };
        let unit = self.find_unit(&checkpoint.unit_id)?;
        if unit.revision.get() != checkpoint.revision {
            return Err(CoreError::CheckpointRevisionChanged {
                unit_id: checkpoint.unit_id,
                expected: checkpoint.revision,
                found: unit.revision.get(),
            });
        }
        let mode = parse_mode(&checkpoint.mode)?;
        let params = StartSessionParams {
            unit_id: checkpoint.unit_id.clone(),
            mode,
            implementation: checkpoint.implementation.clone(),
        };
        let view = self.start_session_with_id(params, checkpoint.session_id.clone())?;
        for stored in checkpoint.events {
            let event: PracticeEventDto =
                serde_json::from_value(stored.event).map_err(CoreError::CheckpointEvent)?;
            let next = ApplyEventParams {
                session_id: checkpoint.session_id.clone(),
                event,
                elapsed: ElapsedDto {
                    active_ms: stored.active_ms,
                    wall_ms: stored.wall_ms,
                },
            };
            self.apply_event_without_persistence(next)?;
        }
        self.store.save_checkpoint(
            self.sessions
                .get(&checkpoint.session_id)
                .ok_or_else(|| CoreError::UnknownSession(checkpoint.session_id.clone()))?
                .checkpoint(&checkpoint.session_id)?,
        )?;
        Ok(Some(self.session_view(&view.session_id)?))
    }

    pub fn discard_checkpoint(&self) -> Result<(), CoreError> {
        Ok(self.store.clear_checkpoint()?)
    }
    pub fn checkpoint_saved_at(&self) -> Result<Option<String>, CoreError> {
        Ok(self
            .store
            .load_checkpoint()?
            .map(|checkpoint| checkpoint.saved_at))
    }
    pub fn recent_attempts(&self, limit: usize) -> Result<Vec<AttemptSummary>, CoreError> {
        let values = self.store.list_attempts(limit)?;
        values
            .into_iter()
            .map(stored_attempt_view)
            .collect::<Result<Vec<_>, _>>()
    }
    pub fn delete_history(&self) -> Result<usize, CoreError> {
        Ok(self.store.delete_history()?)
    }
    pub fn delete_attempts(&self, ids: &[String]) -> Result<usize, CoreError> {
        Ok(self.store.delete_attempts(ids)?)
    }

    fn start_session_with_id(
        &mut self,
        params: StartSessionParams,
        session_id: String,
    ) -> Result<SessionView, CoreError> {
        let unit = self.find_unit(&params.unit_id)?;
        let active = match params.mode {
            PracticeModeDto::ShadowTyping => {
                let definition =
                    unit.practice
                        .shadow_typing
                        .first()
                        .ok_or(CoreError::UnsupportedPractice {
                            unit_id: params.unit_id.clone(),
                            mode: "shadow_typing",
                        })?;
                let implementation = params
                    .implementation
                    .unwrap_or_else(|| definition.implementation.clone());
                let data = unit
                    .implementations
                    .iter()
                    .find(|item| item.key == implementation)
                    .ok_or_else(|| CoreError::UnknownImplementation {
                        unit_id: unit.id.to_string(),
                        implementation: implementation.clone(),
                    })?;
                let source =
                    fs::read_to_string(&data.source_path).map_err(|source| CoreError::Source {
                        path: data.source_path.clone(),
                        source,
                    })?;
                ActiveSession::Shadow {
                    session: Box::new(ShadowTypingSession::start(ShadowTypingConfig::new(
                        unit.id.clone(),
                        unit.revision,
                        unit.schema_version.clone(),
                        implementation.clone(),
                        source,
                        data.normalization.clone(),
                    ))?),
                    unit: Box::new(unit),
                    implementation,
                    events: Vec::new(),
                }
            }
            PracticeModeDto::FlowRecall => ActiveSession::Flow {
                session: Box::new(FlowRecallSession::start(FlowRecallConfig::new(
                    unit.id.clone(),
                    unit.revision,
                    unit.schema_version.clone(),
                    unit.practice.flow_recall_steps.clone(),
                ))?),
                unit: Box::new(unit),
                events: Vec::new(),
            },
        };
        let view = active.view(&session_id);
        self.sessions.insert(session_id, active);
        Ok(view)
    }

    fn apply_event_without_persistence(
        &mut self,
        params: ApplyEventParams,
    ) -> Result<(), CoreError> {
        let session = self
            .sessions
            .get_mut(&params.session_id)
            .ok_or_else(|| CoreError::UnknownSession(params.session_id.clone()))?;
        session.apply(params.event, params.elapsed)
    }
    fn persist_after_transition(&mut self, session_id: &str) -> Result<(), CoreError> {
        let session = self
            .sessions
            .get(session_id)
            .ok_or_else(|| CoreError::UnknownSession(session_id.to_owned()))?;
        if let Some(attempt) = session.terminal_attempt(session_id) {
            self.store.append_attempt(attempt)?;
            self.store.clear_checkpoint()?;
        } else {
            self.store
                .save_checkpoint(session.checkpoint(session_id)?)?;
        }
        Ok(())
    }
    fn session_view(&self, session_id: &str) -> Result<SessionView, CoreError> {
        self.sessions
            .get(session_id)
            .map(|session| session.view(session_id))
            .ok_or_else(|| CoreError::UnknownSession(session_id.to_owned()))
    }
    fn allocate_session_id(&mut self) -> String {
        let id = format!("session-{}-{}", unix_nanos(), self.next_session);
        self.next_session += 1;
        id
    }
    fn find_unit(&self, id: &str) -> Result<AlgorithmUnit, CoreError> {
        self.load_units()?
            .into_iter()
            .find(|unit| unit.id.as_str() == id)
            .ok_or_else(|| CoreError::UnknownUnit(id.to_owned()))
    }
    fn load_units(&self) -> Result<Vec<AlgorithmUnit>, CoreError> {
        let mut paths = Vec::new();
        collect_unit_paths(&self.content_root, &mut paths)?;
        paths
            .into_iter()
            .map(load_algorithm_unit)
            .collect::<Result<Vec<_>, LoadError>>()
            .map_err(CoreError::Template)
    }
}

impl ActiveSession {
    fn start_params(&self) -> StartSessionParams {
        match self {
            Self::Shadow {
                unit,
                implementation,
                ..
            } => StartSessionParams {
                unit_id: unit.id.to_string(),
                mode: PracticeModeDto::ShadowTyping,
                implementation: Some(implementation.clone()),
            },
            Self::Flow { unit, .. } => StartSessionParams {
                unit_id: unit.id.to_string(),
                mode: PracticeModeDto::FlowRecall,
                implementation: None,
            },
        }
    }

    fn apply(&mut self, event: PracticeEventDto, elapsed: ElapsedDto) -> Result<(), CoreError> {
        let elapsed = elapsed_time(elapsed)?;
        let serialized = serde_json::to_value(&event).map_err(CoreError::CheckpointEvent)?;
        match self {
            Self::Shadow {
                session, events, ..
            } => {
                let event = shadow_event(event)?;
                let _ = session.apply(TimedEvent::new(event, elapsed))?;
                events.push(StoredEvent {
                    event: serialized,
                    active_ms: elapsed.active().as_millis() as u64,
                    wall_ms: elapsed.wall().as_millis() as u64,
                });
            }
            Self::Flow {
                session, events, ..
            } => {
                let event = flow_event(event)?;
                let _ = session.apply(event, elapsed)?;
                events.push(StoredEvent {
                    event: serialized,
                    active_ms: elapsed.active().as_millis() as u64,
                    wall_ms: elapsed.wall().as_millis() as u64,
                });
            }
        }
        Ok(())
    }
    fn stop(&mut self, elapsed: ElapsedDto) -> Result<(), CoreError> {
        let elapsed = elapsed_time(elapsed)?;
        match self {
            Self::Shadow { session, .. } => {
                let _ = session.apply(TimedEvent::new(ShadowTypingEvent::Stop, elapsed))?;
            }
            Self::Flow { session, .. } => {
                let _ = session.apply(FlowRecallEvent::Stop, elapsed)?;
            }
        }
        Ok(())
    }
    fn view(&self, session_id: &str) -> SessionView {
        match self {
            Self::Shadow { unit, session, .. } => SessionView {
                session_id: session_id.to_owned(),
                unit_id: unit.id.to_string(),
                unit_title: unit.title.clone(),
                problem_question: unit.problem.question.clone(),
                revision: unit.revision.get(),
                mode: PracticeModeDto::ShadowTyping,
                status: status(session.status()),
                accepted_text: session.accepted_text().to_owned(),
                target_text: session.target().to_owned(),
                current_prompt: None,
                completed_prompts: Vec::new(),
                completed_steps: 0,
                total_steps: 0,
                accepted_input_count: session.accepted_input_count(),
                rejected_input_count: session.rejected_input_count(),
                correction_count: session.correction_count(),
                prompt_count: session.hint_count(),
                active_ms: duration_ms(session.elapsed().active()),
                wall_ms: duration_ms(session.elapsed().wall()),
                terminal_reason: terminal(session.status()),
            },
            Self::Flow { unit, session, .. } => SessionView {
                session_id: session_id.to_owned(),
                unit_id: unit.id.to_string(),
                unit_title: unit.title.clone(),
                problem_question: unit.problem.question.clone(),
                revision: unit.revision.get(),
                mode: PracticeModeDto::FlowRecall,
                status: status(session.status()),
                accepted_text: String::new(),
                target_text: String::new(),
                current_prompt: session.current_step().map(|step| step.prompt.clone()),
                completed_prompts: session
                    .completed_steps()
                    .iter()
                    .map(|step| step.prompt.clone())
                    .collect(),
                completed_steps: session.completed_step_count(),
                total_steps: session.total_step_count(),
                accepted_input_count: session.completed_step_count() as u64,
                rejected_input_count: session.rejected_answer_count(),
                correction_count: 0,
                prompt_count: session.prompt_count(),
                active_ms: duration_ms(session.elapsed().active()),
                wall_ms: duration_ms(session.elapsed().wall()),
                terminal_reason: terminal(session.status()),
            },
        }
    }
    fn checkpoint(&self, session_id: &str) -> Result<StoredCheckpoint, CoreError> {
        match self {
            Self::Shadow {
                unit,
                implementation,
                events,
                session,
            } => {
                ensure_active(session.status())?;
                Ok(StoredCheckpoint {
                    session_id: session_id.to_owned(),
                    unit_id: unit.id.to_string(),
                    revision: unit.revision.get(),
                    mode: "shadow_typing".to_owned(),
                    implementation: Some(implementation.clone()),
                    events: events.clone(),
                    saved_at: utc_now(),
                })
            }
            Self::Flow {
                unit,
                events,
                session,
            } => {
                ensure_active(session.status())?;
                Ok(StoredCheckpoint {
                    session_id: session_id.to_owned(),
                    unit_id: unit.id.to_string(),
                    revision: unit.revision.get(),
                    mode: "flow_recall".to_owned(),
                    implementation: None,
                    events: events.clone(),
                    saved_at: utc_now(),
                })
            }
        }
    }
    fn terminal_attempt(&self, session_id: &str) -> Option<StoredAttempt> {
        match self {
            Self::Shadow { session, .. } => session
                .attempt()
                .map(|attempt| shadow_attempt(attempt, session_id)),
            Self::Flow { session, .. } => session
                .attempt()
                .map(|attempt| flow_attempt(attempt, session_id)),
        }
    }
}

fn collect_unit_paths(root: &Path, paths: &mut Vec<PathBuf>) -> Result<(), CoreError> {
    for entry in fs::read_dir(root).map_err(|source| CoreError::ContentRoot {
        path: root.to_path_buf(),
        source,
    })? {
        let entry = entry.map_err(|source| CoreError::ContentRoot {
            path: root.to_path_buf(),
            source,
        })?;
        let path = entry.path();
        if path.is_dir() {
            collect_unit_paths(&path, paths)?;
        } else if path.file_name().is_some_and(|name| name == "unit.json") {
            paths.push(path);
        }
    }
    Ok(())
}
fn elapsed_time(value: ElapsedDto) -> Result<ElapsedTime, CoreError> {
    Ok(ElapsedTime::new(
        Duration::from_millis(value.active_ms),
        Duration::from_millis(value.wall_ms),
    )?)
}
fn shadow_event(event: PracticeEventDto) -> Result<ShadowTypingEvent, CoreError> {
    match event {
        PracticeEventDto::InsertText { text } => Ok(ShadowTypingEvent::InsertText(text)),
        PracticeEventDto::DeleteRange { start, end } => Ok(ShadowTypingEvent::DeleteRange(
            CharacterRange::new(start, end)?,
        )),
        PracticeEventDto::ReplaceRange { start, end, text } => {
            Ok(ShadowTypingEvent::ReplaceRange {
                range: CharacterRange::new(start, end)?,
                text,
            })
        }
        PracticeEventDto::RevealHint { start, end } => Ok(ShadowTypingEvent::RevealHint(
            CharacterRange::new(start, end)?,
        )),
        PracticeEventDto::Restart => Ok(ShadowTypingEvent::Restart),
        other => Err(CoreError::UnsupportedEvent {
            mode: "shadow_typing",
            event: format!("{other:?}"),
        }),
    }
}
fn flow_event(event: PracticeEventDto) -> Result<FlowRecallEvent, CoreError> {
    match event {
        PracticeEventDto::SubmitAnswer { answer } => Ok(FlowRecallEvent::SubmitAnswer(answer)),
        PracticeEventDto::RevealPrompt => Ok(FlowRecallEvent::RevealPrompt),
        PracticeEventDto::Restart => Ok(FlowRecallEvent::Restart),
        other => Err(CoreError::UnsupportedEvent {
            mode: "flow_recall",
            event: format!("{other:?}"),
        }),
    }
}
fn status(value: SessionStatus) -> SessionStatusDto {
    match value {
        SessionStatus::Active => SessionStatusDto::Active,
        SessionStatus::Completed => SessionStatusDto::Completed,
        SessionStatus::Stopped => SessionStatusDto::Stopped,
    }
}
fn terminal(value: SessionStatus) -> Option<TerminalReasonDto> {
    match value {
        SessionStatus::Active => None,
        SessionStatus::Completed => Some(TerminalReasonDto::Completed),
        SessionStatus::Stopped => Some(TerminalReasonDto::Stopped),
    }
}
fn ensure_active(value: SessionStatus) -> Result<(), CoreError> {
    if value == SessionStatus::Active {
        Ok(())
    } else {
        Err(CoreError::TerminalCheckpoint)
    }
}
fn parse_mode(value: &str) -> Result<PracticeModeDto, CoreError> {
    match value {
        "shadow_typing" => Ok(PracticeModeDto::ShadowTyping),
        "flow_recall" => Ok(PracticeModeDto::FlowRecall),
        _ => Err(CoreError::UnsupportedCheckpointMode(value.to_owned())),
    }
}
fn duration_ms(value: Duration) -> u64 {
    value.as_millis().try_into().unwrap_or(u64::MAX)
}
fn shadow_attempt(value: &gewu_practice::PracticeAttempt, session_id: &str) -> StoredAttempt {
    StoredAttempt {
        id: format!("attempt-{session_id}"),
        created_at: utc_now(),
        unit_id: value.unit_id().to_string(),
        revision: value.revision().get(),
        schema_version: value.schema_version().to_owned(),
        mode: "shadow_typing".to_owned(),
        terminal_reason: match value.terminal_reason() {
            TerminalReason::Completed => "completed".to_owned(),
            TerminalReason::Stopped => "stopped".to_owned(),
        },
        accepted_input_count: value.accepted_input_count(),
        rejected_input_count: value.rejected_input_count(),
        correction_count: value.correction_count(),
        prompt_count: value.hint_count(),
        active_ms: duration_ms(value.active_duration()),
        wall_ms: duration_ms(value.wall_clock_duration()),
    }
}
fn flow_attempt(value: &gewu_practice::FlowRecallAttempt, session_id: &str) -> StoredAttempt {
    StoredAttempt {
        id: format!("attempt-{session_id}"),
        created_at: utc_now(),
        unit_id: value.unit_id().to_string(),
        revision: value.revision().get(),
        schema_version: value.schema_version().to_owned(),
        mode: "flow_recall".to_owned(),
        terminal_reason: match value.terminal_reason() {
            TerminalReason::Completed => "completed".to_owned(),
            TerminalReason::Stopped => "stopped".to_owned(),
        },
        accepted_input_count: value.accepted_step_count(),
        rejected_input_count: value.rejected_answer_count(),
        correction_count: 0,
        prompt_count: value.prompt_count(),
        active_ms: duration_ms(value.active_duration()),
        wall_ms: duration_ms(value.wall_clock_duration()),
    }
}
fn stored_attempt_view(value: StoredAttempt) -> Result<AttemptSummary, CoreError> {
    Ok(AttemptSummary {
        id: value.id,
        created_at: value.created_at,
        unit_id: value.unit_id,
        revision: value.revision,
        schema_version: value.schema_version,
        mode: parse_stored_mode(&value.mode)?,
        terminal_reason: parse_stored_terminal_reason(&value.terminal_reason)?,
        accepted_input_count: value.accepted_input_count,
        rejected_input_count: value.rejected_input_count,
        correction_count: value.correction_count,
        prompt_count: value.prompt_count,
        active_ms: value.active_ms,
        wall_ms: value.wall_ms,
    })
}
fn parse_stored_mode(value: &str) -> Result<PracticeModeDto, CoreError> {
    match value {
        "shadow_typing" => Ok(PracticeModeDto::ShadowTyping),
        "flow_recall" => Ok(PracticeModeDto::FlowRecall),
        _ => Err(CoreError::UnsupportedStoredMode(value.to_owned())),
    }
}
fn parse_stored_terminal_reason(value: &str) -> Result<TerminalReasonDto, CoreError> {
    match value {
        "completed" => Ok(TerminalReasonDto::Completed),
        "stopped" => Ok(TerminalReasonDto::Stopped),
        _ => Err(CoreError::UnsupportedStoredTerminalReason(value.to_owned())),
    }
}
fn unix_nanos() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |value| value.as_nanos())
}
fn utc_now() -> String {
    let seconds = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |value| value.as_secs());
    let days = (seconds / 86_400) as i64;
    let time = seconds % 86_400;
    let (year, month, day) = civil_date_from_unix_days(days);
    format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}Z",
        time / 3_600,
        (time % 3_600) / 60,
        time % 60
    )
}

// Howard Hinnant's public-domain civil-date conversion, expressed here to
// keep the persistence format UTC without adding a time-library dependency.
fn civil_date_from_unix_days(days: i64) -> (i64, u32, u32) {
    let shifted = days + 719_468;
    let era = if shifted >= 0 {
        shifted / 146_097
    } else {
        (shifted - 146_096) / 146_097
    };
    let day_of_era = shifted - era * 146_097;
    let year_of_era =
        (day_of_era - day_of_era / 1_460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let mut year = year_of_era + era * 400;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let month_index = (5 * day_of_year + 2) / 153;
    let day = day_of_year - (153 * month_index + 2) / 5 + 1;
    let month = month_index + if month_index < 10 { 3 } else { -9 };
    if month <= 2 {
        year += 1;
    }
    (year, month as u32, day as u32)
}

/// Typed application failures converted to protocol errors by the CLI boundary.
#[derive(Debug, Error)]
pub enum CoreError {
    #[error("content root cannot be read at {path}: {source}")]
    ContentRoot {
        path: PathBuf,
        #[source]
        source: std::io::Error,
    },
    #[error("could not load AlgorithmUnit: {0}")]
    Template(#[from] LoadError),
    #[error("unit `{0}` was not found in local content")]
    UnknownUnit(String),
    #[error("session `{0}` was not found")]
    UnknownSession(String),
    #[error("unit `{unit_id}` does not support {mode}")]
    UnsupportedPractice { unit_id: String, mode: &'static str },
    #[error("implementation `{implementation}` is not available for unit `{unit_id}`")]
    UnknownImplementation {
        unit_id: String,
        implementation: String,
    },
    #[error("could not read canonical source at {path}: {source}")]
    Source {
        path: PathBuf,
        #[source]
        source: std::io::Error,
    },
    #[error("practice transition failed: {0}")]
    Practice(#[from] gewu_practice::TransitionError),
    #[error("flow recall transition failed: {0}")]
    FlowPractice(#[from] gewu_practice::FlowRecallTransitionError),
    #[error("practice start failed: {0}")]
    Start(#[from] gewu_practice::StartError),
    #[error("flow recall start failed: {0}")]
    FlowStart(#[from] gewu_practice::FlowRecallStartError),
    #[error("invalid character range: {0}")]
    Range(#[from] gewu_practice::RangeError),
    #[error("invalid elapsed time: {0}")]
    Elapsed(#[from] gewu_practice::ElapsedTimeError),
    #[error("local persistence failed: {0}")]
    Storage(#[from] gewu_storage::StorageError),
    #[error("event is unsupported in {mode}: {event}")]
    UnsupportedEvent { mode: &'static str, event: String },
    #[error("terminal sessions cannot be checkpointed")]
    TerminalCheckpoint,
    #[error("checkpoint references unsupported mode `{0}`")]
    UnsupportedCheckpointMode(String),
    #[error("checkpoint revision for `{unit_id}` changed from {expected} to {found}")]
    CheckpointRevisionChanged {
        unit_id: String,
        expected: u64,
        found: u64,
    },
    #[error("checkpoint event is invalid: {0}")]
    CheckpointEvent(serde_json::Error),
    #[error("stored attempt uses unsupported mode `{0}`")]
    UnsupportedStoredMode(String),
    #[error("stored attempt uses unsupported terminal reason `{0}`")]
    UnsupportedStoredTerminalReason(String),
}

#[cfg(test)]
mod tests {
    use super::*;
    use gewu_protocol::{PracticeEventDto, StartSessionParams};
    use std::{
        fs,
        path::PathBuf,
        time::{SystemTime, UNIX_EPOCH},
    };
    fn fixture_root() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/algorithm-units/valid")
    }
    fn data_root() -> PathBuf {
        std::env::temp_dir().join(format!(
            "gewu-core-test-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map_or(0, |value| value.as_nanos())
        ))
    }
    fn elapsed(value: u64) -> ElapsedDto {
        ElapsedDto {
            active_ms: value,
            wall_ms: value,
        }
    }
    #[test]
    fn persists_a_completed_flow_attempt_and_does_not_leave_a_checkpoint() {
        let data = data_root();
        let mut core =
            Core::open(fixture_root(), &data).unwrap_or_else(|error| panic!("open: {error}"));
        let session = core
            .start_session(StartSessionParams {
                unit_id: "search.binary-search".to_owned(),
                mode: PracticeModeDto::FlowRecall,
                implementation: None,
            })
            .unwrap_or_else(|error| panic!("start: {error}"));
        let first_step = core
            .apply_event(ApplyEventParams {
                session_id: session.session_id.clone(),
                event: PracticeEventDto::SubmitAnswer {
                    answer: "set-bounds".to_owned(),
                },
                elapsed: elapsed(1),
            })
            .unwrap_or_else(|error| panic!("step one: {error}"));
        assert_eq!(
            first_step.completed_prompts,
            vec!["Set inclusive left and right bounds around the candidate interval.".to_owned()]
        );
        let complete = core
            .apply_event(ApplyEventParams {
                session_id: session.session_id,
                event: PracticeEventDto::SubmitAnswer {
                    answer: "middle comparison".to_owned(),
                },
                elapsed: elapsed(2),
            })
            .unwrap_or_else(|error| panic!("step two: {error}"));
        assert_eq!(complete.status, SessionStatusDto::Completed);
        assert_eq!(
            core.recent_attempts(10)
                .unwrap_or_else(|error| panic!("attempts: {error}"))
                .len(),
            1
        );
        assert!(
            core.store
                .load_checkpoint()
                .unwrap_or_else(|error| panic!("checkpoint: {error}"))
                .is_none()
        );
        fs::remove_dir_all(data).unwrap_or_else(|error| panic!("cleanup: {error}"));
    }
    #[test]
    fn resumes_only_a_versioned_unit_checkpoint() {
        let data = data_root();
        let mut core =
            Core::open(fixture_root(), &data).unwrap_or_else(|error| panic!("open: {error}"));
        let session = core
            .start_session(StartSessionParams {
                unit_id: "graph.bfs".to_owned(),
                mode: PracticeModeDto::ShadowTyping,
                implementation: None,
            })
            .unwrap_or_else(|error| panic!("start: {error}"));
        let _ = core
            .apply_event(ApplyEventParams {
                session_id: session.session_id,
                event: PracticeEventDto::InsertText {
                    text: "from".to_owned(),
                },
                elapsed: elapsed(1),
            })
            .unwrap_or_else(|error| panic!("event: {error}"));
        let mut resumed =
            Core::open(fixture_root(), &data).unwrap_or_else(|error| panic!("reopen: {error}"));
        assert!(
            resumed
                .checkpoint_saved_at()
                .unwrap_or_else(|error| panic!("saved at: {error}"))
                .is_some()
        );
        let state = resumed
            .resume_checkpoint()
            .unwrap_or_else(|error| panic!("resume: {error}"))
            .unwrap_or_else(|| panic!("checkpoint"));
        assert_eq!(state.accepted_text, "from");
        assert_eq!(state.unit_title, "Breadth-First Search");
        fs::remove_dir_all(data).unwrap_or_else(|error| panic!("cleanup: {error}"));
    }

    #[test]
    fn starting_a_session_replaces_the_checkpoint_before_the_first_event() {
        let data = data_root();
        let mut core =
            Core::open(fixture_root(), &data).unwrap_or_else(|error| panic!("open: {error}"));
        let started = core
            .start_session(StartSessionParams {
                unit_id: "search.binary-search".to_owned(),
                mode: PracticeModeDto::FlowRecall,
                implementation: None,
            })
            .unwrap_or_else(|error| panic!("start: {error}"));

        let mut reopened =
            Core::open(fixture_root(), &data).unwrap_or_else(|error| panic!("reopen: {error}"));
        let resumed = reopened
            .resume_checkpoint()
            .unwrap_or_else(|error| panic!("resume: {error}"))
            .unwrap_or_else(|| panic!("new session checkpoint"));
        assert_eq!(resumed.session_id, started.session_id);
        assert_eq!(resumed.completed_steps, 0);
        assert_eq!(resumed.status, SessionStatusDto::Active);

        fs::remove_dir_all(data).unwrap_or_else(|error| panic!("cleanup: {error}"));
    }

    #[test]
    fn restarting_creates_a_fresh_active_session() {
        let data = data_root();
        let mut core =
            Core::open(fixture_root(), &data).unwrap_or_else(|error| panic!("open: {error}"));
        let started = core
            .start_session(StartSessionParams {
                unit_id: "graph.bfs".to_owned(),
                mode: PracticeModeDto::ShadowTyping,
                implementation: None,
            })
            .unwrap_or_else(|error| panic!("start: {error}"));
        let _ = core
            .apply_event(ApplyEventParams {
                session_id: started.session_id.clone(),
                event: PracticeEventDto::InsertText {
                    text: "from".to_owned(),
                },
                elapsed: elapsed(1),
            })
            .unwrap_or_else(|error| panic!("event: {error}"));

        let restarted = core
            .restart_session(&started.session_id)
            .unwrap_or_else(|error| panic!("restart: {error}"));
        assert_ne!(restarted.session_id, started.session_id);
        assert_eq!(restarted.status, SessionStatusDto::Active);
        assert!(restarted.accepted_text.is_empty());
        assert!(core.session_view(&started.session_id).is_err());

        let mut reopened =
            Core::open(fixture_root(), &data).unwrap_or_else(|error| panic!("reopen: {error}"));
        let checkpoint = reopened
            .resume_checkpoint()
            .unwrap_or_else(|error| panic!("resume: {error}"))
            .unwrap_or_else(|| panic!("restart checkpoint"));
        assert_eq!(checkpoint.session_id, restarted.session_id);
        assert!(checkpoint.accepted_text.is_empty());

        fs::remove_dir_all(data).unwrap_or_else(|error| panic!("cleanup: {error}"));
    }

    #[test]
    fn converts_unix_days_to_utc_civil_dates() {
        assert_eq!(civil_date_from_unix_days(0), (1970, 1, 1));
        assert_eq!(civil_date_from_unix_days(20_000), (2024, 10, 4));
    }
}
