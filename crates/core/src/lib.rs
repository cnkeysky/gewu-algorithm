#![forbid(unsafe_code)]
//! Core application services. This is the only layer that combines templates,
//! deterministic practice transitions, and local persistence.

use std::{
    collections::{BTreeMap, HashSet},
    fs,
    path::{Path, PathBuf},
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use gewu_domain::{AlgorithmUnit, CodeRecallAssistance, CodeRecallLayout};
use gewu_practice::{
    CharacterRange, CodeRecallConfig, CodeRecallEvent, CodeRecallGuidance, CodeRecallSession,
    ElapsedTime, FlowRecallConfig, FlowRecallEvent, FlowRecallSession, ReasoningRecallConfig,
    ReasoningRecallEvent, ReasoningRecallSession, SessionStatus, ShadowTypingConfig,
    ShadowTypingEvent, ShadowTypingSession, TerminalReason, TimedEvent, TransferPracticeConfig,
    TransferPracticeEvent, TransferPracticeSession,
};
use gewu_protocol::{
    ApplyEventParams, AttemptSummary, CheckpointSummary, ElapsedDto, PracticeEventDto,
    PracticeModeDto, PracticeOptionDto, PracticeSelectorDto, SessionStatusDto, SessionView,
    StartSessionParams, TerminalReasonDto, UnitSummary,
};
use gewu_review::{
    AttemptFact, ReviewRecommendation, ReviewState, TerminalReason as ReviewTerminalReason,
    recommend, update_state,
};
use gewu_storage::{LocalStore, StoredAttempt, StoredCheckpoint, StoredEvent, StoredReviewState};
use gewu_template::{LoadError, load_algorithm_unit};
use thiserror::Error;

/// Version of the application service and protocol implementation.
pub const CORE_VERSION: &str = env!("CARGO_PKG_VERSION");

/// Offline application service configured with a content root and local data root.
pub struct Core {
    content_roots: Vec<PathBuf>,
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
    Code {
        unit: Box<AlgorithmUnit>,
        implementation: String,
        practice_id: String,
        session: Box<CodeRecallSession>,
        events: Vec<StoredEvent>,
    },
    Reasoning {
        unit: Box<AlgorithmUnit>,
        practice_id: String,
        session: Box<ReasoningRecallSession>,
        events: Vec<StoredEvent>,
    },
    Transfer {
        unit: Box<AlgorithmUnit>,
        practice_id: String,
        session: Box<TransferPracticeSession>,
        events: Vec<StoredEvent>,
    },
}

impl Core {
    /// Opens a portable local core. Callers choose paths; no editor API leaks here.
    pub fn open(
        content_root: impl Into<PathBuf>,
        data_root: impl Into<PathBuf>,
    ) -> Result<Self, CoreError> {
        Self::open_roots(vec![content_root.into()], data_root)
    }

    /// Opens a portable local core over one or more content roots. Callers choose paths; no editor API leaks here.
    pub fn open_roots(
        content_roots: Vec<PathBuf>,
        data_root: impl Into<PathBuf>,
    ) -> Result<Self, CoreError> {
        if content_roots.is_empty() {
            return Err(CoreError::ContentRoot {
                path: PathBuf::from("<empty>"),
                source: std::io::Error::new(std::io::ErrorKind::InvalidInput, "no content roots"),
            });
        }
        Ok(Self {
            content_roots,
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
                title: unit.title.clone(),
                modes: modes_for(&unit),
                practice_options: practice_options_for(&unit),
            })
            .collect())
    }

    /// Loads one unit summary through the same validated local-content path.
    pub fn load_unit(&self, id: &str) -> Result<UnitSummary, CoreError> {
        let unit = self.find_unit(id)?;
        Ok(UnitSummary {
            id: unit.id.to_string(),
            revision: unit.revision.get(),
            title: unit.title.clone(),
            modes: modes_for(&unit),
            practice_options: practice_options_for(&unit),
        })
    }

    pub fn start_session(&mut self, params: StartSessionParams) -> Result<SessionView, CoreError> {
        let unit = self.find_unit(&params.unit_id)?;
        let session_id = self.allocate_session_id();
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
            PracticeModeDto::CodeRecall => {
                let definition = select_code_recall(&unit, params.practice_id.as_deref())?;
                let practice_id = definition.id.clone();
                let implementation = definition.implementation.clone();
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
                let mut guidance = CodeRecallGuidance::new(
                    definition.assistance,
                    definition.prompt.clone(),
                    definition.scaffold.clone(),
                )
                .with_layout(definition.layout);
                if let Some(template) = &definition.source_template {
                    guidance =
                        guidance.with_structured_layout(template.clone(), definition.slots.clone());
                }
                let session = CodeRecallSession::start(CodeRecallConfig::new(
                    unit.id.clone(),
                    unit.revision,
                    unit.schema_version.clone(),
                    implementation.clone(),
                    source,
                    guidance,
                    implementation_data.normalization.clone(),
                ))?;
                ActiveSession::Code {
                    unit: Box::new(unit),
                    implementation,
                    practice_id,
                    session: Box::new(session),
                    events: Vec::new(),
                }
            }
            PracticeModeDto::ReasoningRecall => {
                let definition = select_reasoning_recall(&unit, params.practice_id.as_deref())?;
                let practice_id = definition.id.clone();
                let session = ReasoningRecallSession::start(ReasoningRecallConfig::new(
                    unit.id.clone(),
                    unit.revision,
                    unit.schema_version.clone(),
                    vec![definition.clone()],
                ))?;
                ActiveSession::Reasoning {
                    unit: Box::new(unit),
                    practice_id,
                    session: Box::new(session),
                    events: Vec::new(),
                }
            }
            PracticeModeDto::TransferPractice => {
                let definition = select_transfer_practice(&unit, params.practice_id.as_deref())?;
                let practice_id = definition.id.clone();
                let session = TransferPracticeSession::start(TransferPracticeConfig::new(
                    unit.id.clone(),
                    unit.revision,
                    unit.schema_version.clone(),
                    vec![definition.clone()],
                ))?;
                ActiveSession::Transfer {
                    unit: Box::new(unit),
                    practice_id,
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
        self.store.clear_checkpoint(&checkpoint_id(session_id))?;
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

    /// Lists recoverable active sessions without exposing replayable event contents.
    pub fn list_checkpoints(&self) -> Result<Vec<CheckpointSummary>, CoreError> {
        let mut seen = HashSet::new();
        let mut summaries = Vec::new();
        for checkpoint in self.store.list_checkpoints()? {
            let key = format!(
                "{}:{}:{}:{:?}:{:?}",
                checkpoint.unit_id,
                checkpoint.revision,
                checkpoint.mode,
                checkpoint.implementation,
                checkpoint.practice_id
            );
            if !seen.insert(key) {
                continue;
            }
            summaries.push(CheckpointSummary {
                id: checkpoint.id,
                unit_id: checkpoint.unit_id,
                unit_title: checkpoint.unit_title,
                revision: checkpoint.revision,
                mode: parse_mode(&checkpoint.mode)?,
                implementation: checkpoint.implementation,
                practice_id: checkpoint.practice_id,
                completed_steps: checkpoint.completed_steps,
                total_steps: checkpoint.total_steps,
                accepted_characters: checkpoint.accepted_characters,
                target_characters: checkpoint.target_characters,
                saved_at: checkpoint.saved_at,
            });
        }
        Ok(summaries)
    }

    /// Resumes one selected local checkpoint. It is never a terminal practice attempt.
    pub fn resume_checkpoint(
        &mut self,
        checkpoint_id: &str,
    ) -> Result<Option<SessionView>, CoreError> {
        let Some(checkpoint) = self.store.load_checkpoint(checkpoint_id)? else {
            return Ok(None);
        };
        if let Some(session) = self.sessions.get(&checkpoint.session_id) {
            return Ok(Some(session.view(&checkpoint.session_id)));
        }
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
            practice_id: checkpoint.practice_id.clone(),
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

    pub fn discard_checkpoint(&mut self, checkpoint_id: &str) -> Result<bool, CoreError> {
        let selected = self.store.load_checkpoint(checkpoint_id)?;
        let Some(selected) = selected else {
            return Ok(false);
        };
        // One recoverable state is kept per unit revision, mode, and selected
        // implementation/practice variant.
        // Older clients could leave duplicate records behind, so discarding a
        // visible item also cleans its logical peers.
        let peers = self
            .store
            .list_checkpoints()?
            .into_iter()
            .filter(|checkpoint| {
                checkpoint.unit_id == selected.unit_id
                    && checkpoint.revision == selected.revision
                    && checkpoint.mode == selected.mode
                    && checkpoint.implementation == selected.implementation
                    && checkpoint.practice_id == selected.practice_id
            })
            .collect::<Vec<_>>();
        let mut removed = false;
        for checkpoint in peers {
            removed |= self.store.clear_checkpoint(&checkpoint.id)?;
            self.sessions.remove(&checkpoint.session_id);
        }
        Ok(removed)
    }
    pub fn recent_attempts(&self, limit: usize) -> Result<Vec<AttemptSummary>, CoreError> {
        let values = self.store.list_attempts(limit)?;
        values
            .into_iter()
            .map(stored_attempt_view)
            .collect::<Result<Vec<_>, _>>()
    }

    /// Derives deterministic delayed-review and progression recommendations.
    /// Recommendations are projections; this method never mutates attempt history.
    pub fn review_recommendations(
        &self,
        limit: usize,
    ) -> Result<Vec<ReviewRecommendation>, CoreError> {
        let attempts = self.store.list_attempts(limit)?;
        let facts = attempts
            .into_iter()
            .map(review_fact_from_stored)
            .collect::<Result<Vec<_>, CoreError>>()?;
        let states = self
            .store
            .list_review_states()?
            .into_iter()
            .map(review_state_from_stored)
            .collect::<Result<Vec<_>, _>>()?;
        Ok(recommend(&facts)
            .into_iter()
            .map(|mut recommendation| {
                recommendation.due_at_ms = states
                    .iter()
                    .find(|state| {
                        state.unit_id == recommendation.unit_id
                            && state.revision == recommendation.revision
                            && state.mode == recommendation.mode
                            && state.implementation == recommendation.implementation
                            && state.practice_id == recommendation.practice_id
                    })
                    .map(|state| state.next_due_at_ms);
                recommendation
            })
            .collect())
    }
    pub fn delete_history(&self) -> Result<usize, CoreError> {
        let deleted = self.store.delete_history()?;
        self.store.delete_all_review_states()?;
        Ok(deleted)
    }
    pub fn delete_attempts(&self, ids: &[String]) -> Result<usize, CoreError> {
        let before = self.store.list_attempts(usize::MAX)?;
        let deleted = self.store.delete_attempts(ids)?;
        let remaining = self.store.list_attempts(usize::MAX)?;
        let keys = before
            .into_iter()
            .filter(|attempt| ids.contains(&attempt.id))
            .filter(|attempt| {
                !remaining.iter().any(|other| {
                    other.unit_id == attempt.unit_id
                        && other.revision == attempt.revision
                        && other.mode == attempt.mode
                })
            })
            .map(|attempt| (attempt.unit_id, attempt.revision, attempt.mode))
            .collect::<Vec<_>>();
        self.store.delete_review_states(&keys)?;
        Ok(deleted)
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
            PracticeModeDto::CodeRecall => {
                let definition = select_code_recall(&unit, params.practice_id.as_deref())?;
                let practice_id = definition.id.clone();
                let implementation = definition.implementation.clone();
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
                let mut guidance = CodeRecallGuidance::new(
                    definition.assistance,
                    definition.prompt.clone(),
                    definition.scaffold.clone(),
                )
                .with_layout(definition.layout);
                if let Some(template) = &definition.source_template {
                    guidance =
                        guidance.with_structured_layout(template.clone(), definition.slots.clone());
                }
                ActiveSession::Code {
                    session: Box::new(CodeRecallSession::start(CodeRecallConfig::new(
                        unit.id.clone(),
                        unit.revision,
                        unit.schema_version.clone(),
                        implementation.clone(),
                        source,
                        guidance,
                        data.normalization.clone(),
                    ))?),
                    unit: Box::new(unit),
                    implementation,
                    practice_id,
                    events: Vec::new(),
                }
            }
            PracticeModeDto::ReasoningRecall => {
                let definition = select_reasoning_recall(&unit, params.practice_id.as_deref())?;
                let practice_id = definition.id.clone();
                ActiveSession::Reasoning {
                    session: Box::new(ReasoningRecallSession::start(ReasoningRecallConfig::new(
                        unit.id.clone(),
                        unit.revision,
                        unit.schema_version.clone(),
                        vec![definition.clone()],
                    ))?),
                    unit: Box::new(unit),
                    practice_id,
                    events: Vec::new(),
                }
            }
            PracticeModeDto::TransferPractice => {
                let definition = select_transfer_practice(&unit, params.practice_id.as_deref())?;
                let practice_id = definition.id.clone();
                ActiveSession::Transfer {
                    session: Box::new(TransferPracticeSession::start(
                        TransferPracticeConfig::new(
                            unit.id.clone(),
                            unit.revision,
                            unit.schema_version.clone(),
                            vec![definition.clone()],
                        ),
                    )?),
                    unit: Box::new(unit),
                    practice_id,
                    events: Vec::new(),
                }
            }
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
            self.store.append_attempt(attempt.clone())?;
            self.update_review_state(&attempt)?;
            self.store.clear_checkpoint(&checkpoint_id(session_id))?;
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
    fn update_review_state(&self, attempt: &StoredAttempt) -> Result<(), CoreError> {
        let fact = review_fact_from_stored(attempt.clone())?;
        let previous = self
            .store
            .list_review_states()?
            .into_iter()
            .find(|state| {
                state.unit_id == attempt.unit_id
                    && state.revision == attempt.revision
                    && state.mode == attempt.mode
            })
            .map(review_state_from_stored)
            .transpose()?;
        let state = update_state(previous.as_ref(), &fact, unix_millis());
        self.store
            .upsert_review_state(stored_state_from_review(&state))?;
        Ok(())
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
        for root in &self.content_roots {
            collect_unit_paths(root, &mut paths)?;
        }
        let mut units = paths
            .into_iter()
            .map(load_algorithm_unit)
            .collect::<Result<Vec<_>, LoadError>>()
            .map_err(CoreError::Template)?;
        // Keep only the newest revision per unit id so merged roots cannot expose stale content.
        units.sort_by(|left, right| {
            right
                .revision
                .get()
                .cmp(&left.revision.get())
                .then_with(|| left.id.as_str().cmp(right.id.as_str()))
        });
        let mut seen = HashSet::new();
        units.retain(|unit| seen.insert(unit.id.clone()));
        Ok(units)
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
                practice_id: None,
            },
            Self::Flow { unit, .. } => StartSessionParams {
                unit_id: unit.id.to_string(),
                mode: PracticeModeDto::FlowRecall,
                implementation: None,
                practice_id: None,
            },
            Self::Code {
                unit,
                implementation,
                practice_id,
                ..
            } => StartSessionParams {
                unit_id: unit.id.to_string(),
                mode: PracticeModeDto::CodeRecall,
                implementation: Some(implementation.clone()),
                practice_id: Some(practice_id.clone()),
            },
            Self::Reasoning {
                unit, practice_id, ..
            } => StartSessionParams {
                unit_id: unit.id.to_string(),
                mode: PracticeModeDto::ReasoningRecall,
                implementation: None,
                practice_id: Some(practice_id.clone()),
            },
            Self::Transfer {
                unit, practice_id, ..
            } => StartSessionParams {
                unit_id: unit.id.to_string(),
                mode: PracticeModeDto::TransferPractice,
                implementation: None,
                practice_id: Some(practice_id.clone()),
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
            Self::Code {
                session, events, ..
            } => {
                let event = code_event(event)?;
                let _ = session.apply(event, elapsed)?;
                events.push(StoredEvent {
                    event: serialized,
                    active_ms: elapsed.active().as_millis() as u64,
                    wall_ms: elapsed.wall().as_millis() as u64,
                });
            }
            Self::Reasoning {
                session, events, ..
            } => {
                let event = reasoning_event(event)?;
                let _ = session.apply(event, elapsed)?;
                events.push(StoredEvent {
                    event: serialized,
                    active_ms: elapsed.active().as_millis() as u64,
                    wall_ms: elapsed.wall().as_millis() as u64,
                });
            }
            Self::Transfer {
                session, events, ..
            } => {
                let event = transfer_event(event)?;
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
            Self::Code { session, .. } => {
                let _ = session.apply(CodeRecallEvent::Stop, elapsed)?;
            }
            Self::Reasoning { session, .. } => {
                let _ = session.apply(ReasoningRecallEvent::Stop, elapsed)?;
            }
            Self::Transfer { session, .. } => {
                let _ = session.apply(TransferPracticeEvent::Stop, elapsed)?;
            }
        }
        Ok(())
    }
    fn view(&self, session_id: &str) -> SessionView {
        match self {
            Self::Shadow {
                unit,
                implementation,
                session,
                ..
            } => SessionView {
                session_id: session_id.to_owned(),
                unit_id: unit.id.to_string(),
                unit_title: unit.title.clone(),
                problem_question: unit.problem.question.clone(),
                problem_statement: unit.problem.statement.clone(),
                revision: unit.revision.get(),
                mode: PracticeModeDto::ShadowTyping,
                language: language_for(unit, Some(implementation)),
                code_layout: None,
                code_template: None,
                code_slot_ids: Vec::new(),
                current_code_slot: None,
                implementation: Some(implementation.clone()),
                practice_id: None,
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
                scaffold_reveal_count: 0,
                active_ms: duration_ms(session.elapsed().active()),
                wall_ms: duration_ms(session.elapsed().wall()),
                terminal_reason: terminal(session.status()),
                code_assistance: None,
                scaffold_count: 0,
                visible_scaffold: Vec::new(),
                revealed_scaffold_indices: Vec::new(),
            },
            Self::Flow { unit, session, .. } => SessionView {
                session_id: session_id.to_owned(),
                unit_id: unit.id.to_string(),
                unit_title: unit.title.clone(),
                problem_question: unit.problem.question.clone(),
                problem_statement: unit.problem.statement.clone(),
                revision: unit.revision.get(),
                mode: PracticeModeDto::FlowRecall,
                language: language_for(unit, None),
                code_layout: None,
                code_template: None,
                code_slot_ids: Vec::new(),
                current_code_slot: None,
                implementation: None,
                practice_id: None,
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
                scaffold_reveal_count: 0,
                active_ms: duration_ms(session.elapsed().active()),
                wall_ms: duration_ms(session.elapsed().wall()),
                terminal_reason: terminal(session.status()),
                code_assistance: None,
                scaffold_count: 0,
                visible_scaffold: Vec::new(),
                revealed_scaffold_indices: Vec::new(),
            },
            Self::Code {
                unit,
                implementation,
                practice_id,
                session,
                ..
            } => SessionView {
                session_id: session_id.to_owned(),
                unit_id: unit.id.to_string(),
                unit_title: unit.title.clone(),
                problem_question: unit.problem.question.clone(),
                problem_statement: unit.problem.statement.clone(),
                revision: unit.revision.get(),
                mode: PracticeModeDto::CodeRecall,
                language: language_for(unit, Some(implementation)),
                code_layout: Some(code_layout_label(session.layout()).to_owned()),
                code_template: session.source_template().map(str::to_owned),
                code_slot_ids: session.slots().iter().map(|slot| slot.id.clone()).collect(),
                current_code_slot: session
                    .slots()
                    .get(session.completed_slot_count())
                    .map(|slot| slot.id.clone()),
                implementation: Some(implementation.clone()),
                practice_id: Some(practice_id.clone()),
                status: status(session.status()),
                accepted_text: session.accepted_text().to_owned(),
                target_text: session.target().to_owned(),
                current_prompt: Some(session.prompt().to_owned()),
                completed_prompts: Vec::new(),
                completed_steps: session.completed_slot_count(),
                total_steps: session.slots().len(),
                accepted_input_count: session.accepted_input_count(),
                rejected_input_count: session.rejected_input_count(),
                correction_count: session.correction_count(),
                prompt_count: session.prompt_count(),
                scaffold_reveal_count: session.scaffold_reveal_count(),
                active_ms: duration_ms(session.elapsed().active()),
                wall_ms: duration_ms(session.elapsed().wall()),
                terminal_reason: terminal(session.status()),
                code_assistance: Some(assistance_label(session.assistance()).to_owned()),
                scaffold_count: session.scaffold().len(),
                visible_scaffold: match session.layout() {
                    CodeRecallLayout::CommentToCode => session.scaffold().to_vec(),
                    CodeRecallLayout::CommentGuided => session
                        .slots()
                        .get(session.completed_slot_count())
                        .and_then(|slot| slot.cue.clone())
                        .into_iter()
                        .collect(),
                    _ => session
                        .revealed_scaffold_indices()
                        .iter()
                        .filter_map(|index| session.scaffold().get(*index))
                        .cloned()
                        .collect(),
                },
                revealed_scaffold_indices: session.revealed_scaffold_indices().to_vec(),
            },
            Self::Reasoning {
                unit,
                practice_id,
                session,
                ..
            } => SessionView {
                session_id: session_id.to_owned(),
                unit_id: unit.id.to_string(),
                unit_title: unit.title.clone(),
                problem_question: unit.problem.question.clone(),
                problem_statement: unit.problem.statement.clone(),
                revision: unit.revision.get(),
                mode: PracticeModeDto::ReasoningRecall,
                language: language_for(unit, None),
                code_layout: None,
                code_template: None,
                code_slot_ids: Vec::new(),
                current_code_slot: None,
                implementation: None,
                practice_id: Some(practice_id.clone()),
                status: status(session.status()),
                accepted_text: String::new(),
                target_text: String::new(),
                current_prompt: session
                    .current_definition()
                    .map(|value| value.prompt.clone()),
                completed_prompts: Vec::new(),
                completed_steps: session.completed_step_count(),
                total_steps: session.total_step_count(),
                accepted_input_count: session.completed_step_count() as u64,
                rejected_input_count: session.rejected_answer_count(),
                correction_count: 0,
                prompt_count: session.prompt_count(),
                scaffold_reveal_count: 0,
                active_ms: duration_ms(session.elapsed().active()),
                wall_ms: duration_ms(session.elapsed().wall()),
                terminal_reason: terminal(session.status()),
                code_assistance: None,
                scaffold_count: 0,
                visible_scaffold: Vec::new(),
                revealed_scaffold_indices: Vec::new(),
            },
            Self::Transfer {
                unit,
                practice_id,
                session,
                ..
            } => SessionView {
                session_id: session_id.to_owned(),
                unit_id: unit.id.to_string(),
                unit_title: unit.title.clone(),
                problem_question: unit.problem.question.clone(),
                problem_statement: unit.problem.statement.clone(),
                revision: unit.revision.get(),
                mode: PracticeModeDto::TransferPractice,
                language: language_for(unit, None),
                code_layout: None,
                code_template: None,
                code_slot_ids: Vec::new(),
                current_code_slot: None,
                implementation: None,
                practice_id: Some(practice_id.clone()),
                status: status(session.status()),
                accepted_text: String::new(),
                target_text: String::new(),
                current_prompt: session
                    .current_definition()
                    .map(|value| value.prompt.clone()),
                completed_prompts: Vec::new(),
                completed_steps: session.completed_case_count(),
                total_steps: session.total_case_count(),
                accepted_input_count: session.completed_case_count() as u64,
                rejected_input_count: session.rejected_answer_count(),
                correction_count: 0,
                prompt_count: session.prompt_count(),
                scaffold_reveal_count: 0,
                active_ms: duration_ms(session.elapsed().active()),
                wall_ms: duration_ms(session.elapsed().wall()),
                terminal_reason: terminal(session.status()),
                code_assistance: None,
                scaffold_count: 0,
                visible_scaffold: Vec::new(),
                revealed_scaffold_indices: Vec::new(),
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
                    id: checkpoint_id(session_id),
                    session_id: session_id.to_owned(),
                    unit_id: unit.id.to_string(),
                    unit_title: unit.title.clone(),
                    revision: unit.revision.get(),
                    mode: "shadow_typing".to_owned(),
                    implementation: Some(implementation.clone()),
                    practice_id: None,
                    events: events.clone(),
                    completed_steps: 0,
                    total_steps: 0,
                    accepted_characters: session.accepted_text().chars().count(),
                    target_characters: session.target().chars().count(),
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
                    id: checkpoint_id(session_id),
                    session_id: session_id.to_owned(),
                    unit_id: unit.id.to_string(),
                    unit_title: unit.title.clone(),
                    revision: unit.revision.get(),
                    mode: "flow_recall".to_owned(),
                    implementation: None,
                    practice_id: None,
                    events: events.clone(),
                    completed_steps: session.completed_step_count(),
                    total_steps: session.total_step_count(),
                    accepted_characters: 0,
                    target_characters: 0,
                    saved_at: utc_now(),
                })
            }
            Self::Code {
                unit,
                implementation,
                practice_id,
                events,
                session,
            } => {
                ensure_active(session.status())?;
                Ok(StoredCheckpoint {
                    id: checkpoint_id(session_id),
                    session_id: session_id.to_owned(),
                    unit_id: unit.id.to_string(),
                    unit_title: unit.title.clone(),
                    revision: unit.revision.get(),
                    mode: "code_recall".to_owned(),
                    implementation: Some(implementation.clone()),
                    practice_id: Some(practice_id.clone()),
                    events: events.clone(),
                    completed_steps: 0,
                    total_steps: session.scaffold().len(),
                    accepted_characters: session.accepted_text().chars().count(),
                    target_characters: session.target().chars().count(),
                    saved_at: utc_now(),
                })
            }
            Self::Reasoning {
                unit,
                practice_id,
                events,
                session,
            } => {
                ensure_active(session.status())?;
                Ok(StoredCheckpoint {
                    id: checkpoint_id(session_id),
                    session_id: session_id.to_owned(),
                    unit_id: unit.id.to_string(),
                    unit_title: unit.title.clone(),
                    revision: unit.revision.get(),
                    mode: "reasoning_recall".to_owned(),
                    implementation: None,
                    practice_id: Some(practice_id.clone()),
                    events: events.clone(),
                    completed_steps: session.completed_step_count(),
                    total_steps: session.total_step_count(),
                    accepted_characters: 0,
                    target_characters: 0,
                    saved_at: utc_now(),
                })
            }
            Self::Transfer {
                unit,
                practice_id,
                events,
                session,
            } => {
                ensure_active(session.status())?;
                Ok(StoredCheckpoint {
                    id: checkpoint_id(session_id),
                    session_id: session_id.to_owned(),
                    unit_id: unit.id.to_string(),
                    unit_title: unit.title.clone(),
                    revision: unit.revision.get(),
                    mode: "transfer_practice".to_owned(),
                    implementation: None,
                    practice_id: Some(practice_id.clone()),
                    events: events.clone(),
                    completed_steps: session.completed_case_count(),
                    total_steps: session.total_case_count(),
                    accepted_characters: 0,
                    target_characters: 0,
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
            Self::Code {
                session,
                practice_id,
                ..
            } => session.attempt().map(|attempt| {
                let mut stored = code_attempt(attempt, session_id);
                stored.practice_id = Some(practice_id.clone());
                stored
            }),
            Self::Reasoning {
                session,
                practice_id,
                ..
            } => session.attempt().map(|attempt| {
                let mut stored = reasoning_attempt(attempt, session_id);
                stored.practice_id = Some(practice_id.clone());
                stored
            }),
            Self::Transfer {
                session,
                practice_id,
                ..
            } => session.attempt().map(|attempt| {
                let mut stored = transfer_attempt(attempt, session_id);
                stored.practice_id = Some(practice_id.clone());
                stored
            }),
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
fn code_event(event: PracticeEventDto) -> Result<CodeRecallEvent, CoreError> {
    match event {
        PracticeEventDto::InsertText { text } => Ok(CodeRecallEvent::InsertText(text)),
        PracticeEventDto::DeleteRange { start, end } => Ok(CodeRecallEvent::DeleteRange(
            CharacterRange::new(start, end)?,
        )),
        PracticeEventDto::ReplaceRange { start, end, text } => Ok(CodeRecallEvent::ReplaceRange {
            range: CharacterRange::new(start, end)?,
            text,
        }),
        PracticeEventDto::RevealPrompt => Ok(CodeRecallEvent::RevealPrompt),
        PracticeEventDto::RevealScaffold { index } => Ok(CodeRecallEvent::RevealScaffold { index }),
        PracticeEventDto::Restart => Ok(CodeRecallEvent::Restart),
        other => Err(CoreError::UnsupportedEvent {
            mode: "code_recall",
            event: format!("{other:?}"),
        }),
    }
}
fn reasoning_event(event: PracticeEventDto) -> Result<ReasoningRecallEvent, CoreError> {
    match event {
        PracticeEventDto::SubmitAnswer { answer } => Ok(ReasoningRecallEvent::SubmitAnswer(answer)),
        PracticeEventDto::RevealPrompt => Ok(ReasoningRecallEvent::RevealPrompt),
        PracticeEventDto::Restart => Ok(ReasoningRecallEvent::Restart),
        other => Err(CoreError::UnsupportedEvent {
            mode: "reasoning_recall",
            event: format!("{other:?}"),
        }),
    }
}
fn transfer_event(event: PracticeEventDto) -> Result<TransferPracticeEvent, CoreError> {
    match event {
        PracticeEventDto::SubmitAnswer { answer } => {
            Ok(TransferPracticeEvent::SubmitAnswer(answer))
        }
        PracticeEventDto::RevealPrompt => Ok(TransferPracticeEvent::RevealPrompt),
        PracticeEventDto::Restart => Ok(TransferPracticeEvent::Restart),
        other => Err(CoreError::UnsupportedEvent {
            mode: "transfer_practice",
            event: format!("{other:?}"),
        }),
    }
}
fn modes_for(unit: &AlgorithmUnit) -> Vec<PracticeModeDto> {
    let mut modes = vec![PracticeModeDto::ShadowTyping, PracticeModeDto::FlowRecall];
    if !unit.practice.code_recall.is_empty() {
        modes.push(PracticeModeDto::CodeRecall);
    }
    if !unit.practice.reasoning_recall.is_empty() {
        modes.push(PracticeModeDto::ReasoningRecall);
    }
    if !unit.practice.transfer_practice.is_empty() {
        modes.push(PracticeModeDto::TransferPractice);
    }
    modes
}
fn language_for(unit: &AlgorithmUnit, implementation: Option<&str>) -> String {
    implementation
        .and_then(|key| unit.implementations.iter().find(|item| item.key == key))
        .or_else(|| unit.implementations.first())
        .map(|item| item.language.clone())
        .unwrap_or_else(|| "plaintext".to_owned())
}
fn practice_options_for(unit: &AlgorithmUnit) -> Vec<PracticeOptionDto> {
    let mut options = Vec::new();
    for definition in &unit.practice.shadow_typing {
        let implementation = unit
            .implementations
            .iter()
            .find(|item| item.key == definition.implementation);
        let label = implementation
            .map(|item| format!("{} · {}", item.purpose, item.language))
            .unwrap_or_else(|| definition.implementation.clone());
        options.push(PracticeOptionDto {
            id: definition.implementation.clone(),
            label,
            language: implementation
                .map(|item| item.language.clone())
                .unwrap_or_else(|| "plaintext".to_owned()),
            code_layout: None,
            mode: PracticeModeDto::ShadowTyping,
            selector: PracticeSelectorDto::Implementation,
        });
    }
    for definition in &unit.practice.code_recall {
        options.push(PracticeOptionDto {
            id: definition.id.clone(),
            label: format!(
                "{} · {} · {}",
                definition.id.replace('-', " "),
                code_layout_label(definition.layout),
                assistance_label(definition.assistance)
            ),
            language: unit
                .implementations
                .first()
                .map(|item| item.language.clone())
                .unwrap_or_else(|| "plaintext".to_owned()),
            code_layout: Some(code_layout_label(definition.layout).to_owned()),
            mode: PracticeModeDto::CodeRecall,
            selector: PracticeSelectorDto::PracticeId,
        });
    }
    for definition in &unit.practice.reasoning_recall {
        let implementation = definition
            .implementation
            .as_deref()
            .and_then(|key| unit.implementations.iter().find(|item| item.key == key));
        options.push(PracticeOptionDto {
            id: definition.id.clone(),
            label: match implementation {
                Some(item) => format!("{} · {}", definition.id.replace('-', " "), item.key),
                None => definition.id.replace('-', " "),
            },
            language: implementation
                .map(|item| item.language.clone())
                .or_else(|| unit.implementations.first().map(|item| item.language.clone()))
                .unwrap_or_else(|| "plaintext".to_owned()),
            code_layout: None,
            mode: PracticeModeDto::ReasoningRecall,
            selector: PracticeSelectorDto::PracticeId,
        });
    }
    for definition in &unit.practice.transfer_practice {
        let implementation = definition
            .implementation
            .as_deref()
            .and_then(|key| unit.implementations.iter().find(|item| item.key == key));
        options.push(PracticeOptionDto {
            id: definition.id.clone(),
            label: match implementation {
                Some(item) => format!("{} · {}", definition.id.replace('-', " "), item.key),
                None => definition.id.replace('-', " "),
            },
            language: implementation
                .map(|item| item.language.clone())
                .or_else(|| unit.implementations.first().map(|item| item.language.clone()))
                .unwrap_or_else(|| "plaintext".to_owned()),
            code_layout: None,
            mode: PracticeModeDto::TransferPractice,
            selector: PracticeSelectorDto::PracticeId,
        });
    }
    options
}
fn select_code_recall<'a>(
    unit: &'a AlgorithmUnit,
    requested: Option<&str>,
) -> Result<&'a gewu_domain::CodeRecallDefinition, CoreError> {
    let definitions = &unit.practice.code_recall;
    if definitions.is_empty() {
        return Err(CoreError::UnsupportedPractice {
            unit_id: unit.id.to_string(),
            mode: "code_recall",
        });
    }
    match requested {
        Some(id) => definitions
            .iter()
            .find(|definition| definition.id == id)
            .ok_or_else(|| CoreError::UnknownPracticeDefinition {
                unit_id: unit.id.to_string(),
                practice_id: id.to_owned(),
            }),
        None => Ok(&definitions[0]),
    }
}
fn select_reasoning_recall<'a>(
    unit: &'a AlgorithmUnit,
    requested: Option<&str>,
) -> Result<&'a gewu_domain::ReasoningRecallDefinition, CoreError> {
    select_definition(
        &unit.practice.reasoning_recall,
        requested,
        unit.id.as_str(),
        "reasoning_recall",
    )
}
fn select_transfer_practice<'a>(
    unit: &'a AlgorithmUnit,
    requested: Option<&str>,
) -> Result<&'a gewu_domain::TransferPracticeDefinition, CoreError> {
    select_definition(
        &unit.practice.transfer_practice,
        requested,
        unit.id.as_str(),
        "transfer_practice",
    )
}
fn select_definition<'a, T: HasPracticeId>(
    definitions: &'a [T],
    requested: Option<&str>,
    unit_id: &str,
    mode: &'static str,
) -> Result<&'a T, CoreError> {
    if definitions.is_empty() {
        return Err(CoreError::UnsupportedPractice {
            unit_id: unit_id.to_owned(),
            mode,
        });
    }
    match requested {
        Some(id) => definitions
            .iter()
            .find(|definition| definition.practice_id() == id)
            .ok_or_else(|| CoreError::UnknownPracticeDefinition {
                unit_id: unit_id.to_owned(),
                practice_id: id.to_owned(),
            }),
        None => Ok(&definitions[0]),
    }
}
trait HasPracticeId {
    fn practice_id(&self) -> &str;
}
impl HasPracticeId for gewu_domain::ReasoningRecallDefinition {
    fn practice_id(&self) -> &str {
        &self.id
    }
}
impl HasPracticeId for gewu_domain::TransferPracticeDefinition {
    fn practice_id(&self) -> &str {
        &self.id
    }
}
fn assistance_label(value: CodeRecallAssistance) -> &'static str {
    match value {
        CodeRecallAssistance::Skeleton => "skeleton",
        CodeRecallAssistance::Comments => "comments",
        CodeRecallAssistance::Keywords => "keywords",
        CodeRecallAssistance::Cloze => "cloze",
        CodeRecallAssistance::None => "none",
    }
}

fn code_layout_label(value: CodeRecallLayout) -> &'static str {
    match value {
        CodeRecallLayout::FullRecall => "full_recall",
        CodeRecallLayout::CommentGuided => "comment_guided",
        CodeRecallLayout::CommentToCode => "comment_to_code",
        CodeRecallLayout::Cloze => "cloze",
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
        "code_recall" => Ok(PracticeModeDto::CodeRecall),
        "reasoning_recall" => Ok(PracticeModeDto::ReasoningRecall),
        "transfer_practice" => Ok(PracticeModeDto::TransferPractice),
        _ => Err(CoreError::UnsupportedCheckpointMode(value.to_owned())),
    }
}

fn checkpoint_id(session_id: &str) -> String {
    format!("checkpoint-{session_id}")
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
        implementation: Some(value.implementation().to_owned()),
        practice_id: None,
        terminal_reason: match value.terminal_reason() {
            TerminalReason::Completed => "completed".to_owned(),
            TerminalReason::Stopped => "stopped".to_owned(),
        },
        accepted_input_count: value.accepted_input_count(),
        rejected_input_count: value.rejected_input_count(),
        correction_count: value.correction_count(),
        prompt_count: value.hint_count(),
        scaffold_reveal_count: 0,
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
        implementation: None,
        practice_id: None,
        terminal_reason: match value.terminal_reason() {
            TerminalReason::Completed => "completed".to_owned(),
            TerminalReason::Stopped => "stopped".to_owned(),
        },
        accepted_input_count: value.accepted_step_count(),
        rejected_input_count: value.rejected_answer_count(),
        correction_count: 0,
        prompt_count: value.prompt_count(),
        scaffold_reveal_count: 0,
        active_ms: duration_ms(value.active_duration()),
        wall_ms: duration_ms(value.wall_clock_duration()),
    }
}
fn code_attempt(value: &gewu_practice::CodeRecallAttempt, session_id: &str) -> StoredAttempt {
    StoredAttempt {
        id: format!("attempt-{session_id}"),
        created_at: utc_now(),
        unit_id: value.unit_id().to_string(),
        revision: value.revision().get(),
        schema_version: value.schema_version().to_owned(),
        mode: "code_recall".to_owned(),
        implementation: Some(value.implementation().to_owned()),
        practice_id: None,
        terminal_reason: match value.terminal_reason() {
            TerminalReason::Completed => "completed".to_owned(),
            TerminalReason::Stopped => "stopped".to_owned(),
        },
        accepted_input_count: value.accepted_input_count(),
        rejected_input_count: value.rejected_input_count(),
        correction_count: value.correction_count(),
        prompt_count: value.prompt_count(),
        scaffold_reveal_count: value.scaffold_reveal_count(),
        active_ms: duration_ms(value.active_duration()),
        wall_ms: duration_ms(value.wall_clock_duration()),
    }
}
fn reasoning_attempt(
    value: &gewu_practice::ReasoningRecallAttempt,
    session_id: &str,
) -> StoredAttempt {
    StoredAttempt {
        id: format!("attempt-{session_id}"),
        created_at: utc_now(),
        unit_id: value.unit_id().to_string(),
        revision: value.revision().get(),
        schema_version: value.schema_version().to_owned(),
        mode: "reasoning_recall".to_owned(),
        implementation: None,
        practice_id: None,
        terminal_reason: match value.terminal_reason() {
            TerminalReason::Completed => "completed".to_owned(),
            TerminalReason::Stopped => "stopped".to_owned(),
        },
        accepted_input_count: value.accepted_step_count(),
        rejected_input_count: value.rejected_answer_count(),
        correction_count: 0,
        prompt_count: value.prompt_count(),
        scaffold_reveal_count: 0,
        active_ms: duration_ms(value.active_duration()),
        wall_ms: duration_ms(value.wall_clock_duration()),
    }
}
fn transfer_attempt(
    value: &gewu_practice::TransferPracticeAttempt,
    session_id: &str,
) -> StoredAttempt {
    StoredAttempt {
        id: format!("attempt-{session_id}"),
        created_at: utc_now(),
        unit_id: value.unit_id().to_string(),
        revision: value.revision().get(),
        schema_version: value.schema_version().to_owned(),
        mode: "transfer_practice".to_owned(),
        implementation: None,
        practice_id: None,
        terminal_reason: match value.terminal_reason() {
            TerminalReason::Completed => "completed".to_owned(),
            TerminalReason::Stopped => "stopped".to_owned(),
        },
        accepted_input_count: value.accepted_case_count(),
        rejected_input_count: value.rejected_answer_count(),
        correction_count: 0,
        prompt_count: value.prompt_count(),
        scaffold_reveal_count: 0,
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
        implementation: value.implementation,
        practice_id: value.practice_id,
        terminal_reason: parse_stored_terminal_reason(&value.terminal_reason)?,
        accepted_input_count: value.accepted_input_count,
        rejected_input_count: value.rejected_input_count,
        correction_count: value.correction_count,
        prompt_count: value.prompt_count,
        scaffold_reveal_count: value.scaffold_reveal_count,
        active_ms: value.active_ms,
        wall_ms: value.wall_ms,
    })
}
fn parse_stored_mode(value: &str) -> Result<PracticeModeDto, CoreError> {
    match value {
        "shadow_typing" => Ok(PracticeModeDto::ShadowTyping),
        "flow_recall" => Ok(PracticeModeDto::FlowRecall),
        "code_recall" => Ok(PracticeModeDto::CodeRecall),
        "reasoning_recall" => Ok(PracticeModeDto::ReasoningRecall),
        "transfer_practice" => Ok(PracticeModeDto::TransferPractice),
        _ => Err(CoreError::UnsupportedStoredMode(value.to_owned())),
    }
}
fn parse_stored_mode_for_review(value: &str) -> Result<gewu_domain::PracticeMode, CoreError> {
    match value {
        "shadow_typing" => Ok(gewu_domain::PracticeMode::ShadowTyping),
        "flow_recall" => Ok(gewu_domain::PracticeMode::FlowRecall),
        "code_recall" => Ok(gewu_domain::PracticeMode::CodeRecall),
        "reasoning_recall" => Ok(gewu_domain::PracticeMode::ReasoningRecall),
        "transfer_practice" => Ok(gewu_domain::PracticeMode::TransferPractice),
        _ => Err(CoreError::UnsupportedStoredMode(value.to_owned())),
    }
}
fn review_fact_from_stored(value: StoredAttempt) -> Result<AttemptFact, CoreError> {
    let terminal_reason = match value.terminal_reason.as_str() {
        "completed" => ReviewTerminalReason::Completed,
        "stopped" => ReviewTerminalReason::Stopped,
        other => return Err(CoreError::UnsupportedStoredTerminalReason(other.to_owned())),
    };
    Ok(AttemptFact {
        id: value.id,
        unit_id: gewu_domain::UnitId::parse(value.unit_id)
            .map_err(|error| CoreError::InvalidReviewUnit(error.to_string()))?,
        revision: gewu_domain::Revision::new(value.revision)
            .map_err(|error| CoreError::InvalidReviewRevision(error.to_string()))?,
        mode: parse_stored_mode_for_review(&value.mode)?,
        implementation: value.implementation,
        practice_id: value.practice_id,
        terminal_reason,
        accepted: value.accepted_input_count,
        rejected: value.rejected_input_count,
        prompts: value.prompt_count,
        scaffold_reveals: value.scaffold_reveal_count,
        active_ms: value.active_ms,
        wall_ms: value.wall_ms,
    })
}
fn review_state_from_stored(value: StoredReviewState) -> Result<ReviewState, CoreError> {
    Ok(ReviewState {
        unit_id: gewu_domain::UnitId::parse(value.unit_id)
            .map_err(|error| CoreError::InvalidReviewUnit(error.to_string()))?,
        revision: gewu_domain::Revision::new(value.revision)
            .map_err(|error| CoreError::InvalidReviewRevision(error.to_string()))?,
        mode: parse_stored_mode_for_review(&value.mode)?,
        implementation: value.implementation,
        practice_id: value.practice_id,
        last_reviewed_at_ms: value.last_reviewed_at_ms,
        next_due_at_ms: value.next_due_at_ms,
        stability_days: value.stability_days,
        difficulty: value.difficulty,
        scheduler_version: value.scheduler_version,
        model_version: value.model_version,
        success_count: value.success_count,
        failure_count: value.failure_count,
    })
}
fn stored_state_from_review(value: &ReviewState) -> StoredReviewState {
    StoredReviewState {
        unit_id: value.unit_id.to_string(),
        revision: value.revision.get(),
        mode: serde_json::to_value(value.mode)
            .expect("practice mode serialization is infallible")
            .as_str()
            .expect("practice mode serializes to a string")
            .to_owned(),
        implementation: value.implementation.clone(),
        practice_id: value.practice_id.clone(),
        last_reviewed_at_ms: value.last_reviewed_at_ms,
        next_due_at_ms: value.next_due_at_ms,
        stability_days: value.stability_days,
        difficulty: value.difficulty,
        scheduler_version: value.scheduler_version.clone(),
        model_version: value.model_version.clone(),
        success_count: value.success_count,
        failure_count: value.failure_count,
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
fn unix_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |value| value.as_millis().try_into().unwrap_or(u64::MAX))
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
    #[error("practice definition `{practice_id}` is not available for unit `{unit_id}`")]
    UnknownPracticeDefinition {
        unit_id: String,
        practice_id: String,
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
    #[error("code recall transition failed: {0}")]
    CodePractice(#[from] gewu_practice::CodeRecallTransitionError),
    #[error("reasoning recall transition failed: {0}")]
    ReasoningPractice(#[from] gewu_practice::ReasoningRecallTransitionError),
    #[error("transfer practice transition failed: {0}")]
    TransferPractice(#[from] gewu_practice::TransferPracticeTransitionError),
    #[error("practice start failed: {0}")]
    Start(#[from] gewu_practice::StartError),
    #[error("flow recall start failed: {0}")]
    FlowStart(#[from] gewu_practice::FlowRecallStartError),
    #[error("code recall start failed: {0}")]
    CodeStart(#[from] gewu_practice::CodeRecallStartError),
    #[error("reasoning recall start failed: {0}")]
    ReasoningStart(#[from] gewu_practice::ReasoningRecallStartError),
    #[error("transfer practice start failed: {0}")]
    TransferStart(#[from] gewu_practice::TransferPracticeStartError),
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
    #[error("stored attempt has invalid review unit ID: {0}")]
    InvalidReviewUnit(String),
    #[error("stored attempt has invalid review revision: {0}")]
    InvalidReviewRevision(String),
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
                practice_id: None,
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
        let recommendations = core
            .review_recommendations(10)
            .unwrap_or_else(|error| panic!("recommendations: {error}"));
        assert_eq!(recommendations.len(), 1);
        assert!(recommendations[0].due_at_ms.is_some());
        assert_eq!(
            core.store
                .list_review_states()
                .unwrap_or_else(|error| panic!("review state: {error}"))
                .len(),
            1
        );
        assert!(
            core.store
                .list_checkpoints()
                .unwrap_or_else(|error| panic!("checkpoints: {error}"))
                .is_empty()
        );
        fs::remove_dir_all(data).unwrap_or_else(|error| panic!("cleanup: {error}"));
    }

    #[test]
    fn starts_and_completes_code_recall_through_the_host_free_core() {
        let data = data_root();
        let mut core =
            Core::open(fixture_root(), &data).unwrap_or_else(|error| panic!("open: {error}"));
        let unit = core
            .list_units()
            .unwrap_or_else(|error| panic!("list units: {error}"))
            .into_iter()
            .find(|unit| unit.id == "graph.bfs")
            .unwrap_or_else(|| panic!("BFS unit must be listed"));
        assert!(unit.modes.contains(&PracticeModeDto::CodeRecall));

        let selected = core
            .start_session(StartSessionParams {
                unit_id: "graph.bfs".to_owned(),
                mode: PracticeModeDto::CodeRecall,
                implementation: None,
                practice_id: Some("bfs-no-hints".to_owned()),
            })
            .unwrap_or_else(|error| panic!("start selected code recall: {error}"));
        assert_eq!(selected.code_assistance.as_deref(), Some("none"));
        assert_eq!(selected.code_layout.as_deref(), Some("full_recall"));
        assert_eq!(selected.scaffold_count, 0);
        assert!(
            core.discard_checkpoint(&checkpoint_id(&selected.session_id))
                .unwrap_or_else(|error| panic!("discard selected: {error}"))
        );

        let session = core
            .start_session(StartSessionParams {
                unit_id: "graph.bfs".to_owned(),
                mode: PracticeModeDto::CodeRecall,
                implementation: None,
                practice_id: None,
            })
            .unwrap_or_else(|error| panic!("start code recall: {error}"));
        assert_eq!(session.mode, PracticeModeDto::CodeRecall);
        assert!(session.current_prompt.is_some());
        assert!(!session.target_text.is_empty());
        assert_eq!(
            session.visible_scaffold,
            vec![
                "Initialize the FIFO frontier and discovered set.".to_owned(),
                "Expand one frontier state at a time.".to_owned(),
                "Mark each neighbor before enqueueing it.".to_owned(),
            ]
        );
        assert_eq!(session.scaffold_count, 3);

        let prompted = core
            .apply_event(ApplyEventParams {
                session_id: session.session_id.clone(),
                event: PracticeEventDto::RevealPrompt,
                elapsed: elapsed(1),
            })
            .unwrap_or_else(|error| panic!("reveal prompt: {error}"));
        assert_eq!(prompted.prompt_count, 1);

        let complete = core
            .apply_event(ApplyEventParams {
                session_id: session.session_id,
                event: PracticeEventDto::InsertText {
                    text: prompted.target_text,
                },
                elapsed: elapsed(2),
            })
            .unwrap_or_else(|error| panic!("complete code recall: {error}"));
        assert_eq!(complete.status, SessionStatusDto::Completed);
        assert_eq!(complete.mode, PracticeModeDto::CodeRecall);
        let attempts = core
            .recent_attempts(10)
            .unwrap_or_else(|error| panic!("attempts: {error}"));
        assert_eq!(attempts.len(), 1);
        assert_eq!(attempts[0].mode, PracticeModeDto::CodeRecall);
        assert!(
            core.store
                .list_checkpoints()
                .unwrap_or_else(|error| panic!("checkpoints: {error}"))
                .is_empty()
        );
    }

    #[test]
    fn cloze_code_recall_exposes_slots_and_accepts_slot_text() {
        let data = data_root();
        let mut core = Core::open(fixture_root(), &data).expect("open core");
        let session = core
            .start_session(StartSessionParams {
                unit_id: "graph.bfs".to_owned(),
                mode: PracticeModeDto::CodeRecall,
                implementation: None,
                practice_id: Some("bfs-cloze-frontier".to_owned()),
            })
            .expect("start cloze");
        assert_eq!(session.code_layout.as_deref(), Some("cloze"));
        assert_eq!(session.code_slot_ids, vec!["frontier-pop".to_owned()]);
        assert_eq!(session.current_code_slot.as_deref(), Some("frontier-pop"));
        assert_eq!(session.completed_steps, 0);
        let completed = core
            .apply_event(ApplyEventParams {
                session_id: session.session_id,
                event: PracticeEventDto::InsertText {
                    text: "queue.popleft()".to_owned(),
                },
                elapsed: elapsed(1),
            })
            .expect("complete cloze slot");
        assert_eq!(completed.status, SessionStatusDto::Completed);
        assert_eq!(completed.completed_steps, 1);
        fs::remove_dir_all(data).expect("cleanup");
    }

    #[test]
    fn comment_guided_code_recall_exposes_the_current_cue_and_accepts_its_slot() {
        let data = data_root();
        let mut core = Core::open(fixture_root(), &data).expect("open core");
        let session = core
            .start_session(StartSessionParams {
                unit_id: "graph.bfs".to_owned(),
                mode: PracticeModeDto::CodeRecall,
                implementation: None,
                practice_id: Some("bfs-comment-guided-frontier".to_owned()),
            })
            .expect("start comment guided recall");
        assert_eq!(session.code_layout.as_deref(), Some("comment_guided"));
        assert_eq!(
            session.visible_scaffold,
            vec!["Remove the next FIFO frontier node.".to_owned()]
        );
        assert_eq!(session.current_code_slot.as_deref(), Some("frontier-pop"));
        let completed = core
            .apply_event(ApplyEventParams {
                session_id: session.session_id,
                event: PracticeEventDto::InsertText {
                    text: "queue.popleft()".to_owned(),
                },
                elapsed: elapsed(1),
            })
            .expect("complete comment guided slot");
        assert_eq!(completed.status, SessionStatusDto::Completed);
        assert!(completed.visible_scaffold.is_empty());
        fs::remove_dir_all(data).expect("cleanup");
    }

    #[test]
    fn resumes_comment_guided_progress_with_its_layout_and_cue() {
        let data = data_root();
        let mut core = Core::open(fixture_root(), &data).expect("open core");
        let session = core
            .start_session(StartSessionParams {
                unit_id: "graph.bfs".to_owned(),
                mode: PracticeModeDto::CodeRecall,
                implementation: None,
                practice_id: Some("bfs-comment-guided-frontier".to_owned()),
            })
            .expect("start comment guided recall");
        let partial = core
            .apply_event(ApplyEventParams {
                session_id: session.session_id,
                event: PracticeEventDto::InsertText {
                    text: "queue.".to_owned(),
                },
                elapsed: elapsed(1),
            })
            .expect("accept partial slot");
        let checkpoint = core
            .list_checkpoints()
            .expect("list checkpoints")
            .into_iter()
            .find(|value| value.practice_id.as_deref() == Some("bfs-comment-guided-frontier"))
            .expect("comment guided checkpoint");
        assert_eq!(partial.accepted_text, "queue.");
        drop(core);

        let mut reopened = Core::open(fixture_root(), &data).expect("reopen core");
        let resumed = reopened
            .resume_checkpoint(&checkpoint.id)
            .expect("resume checkpoint")
            .expect("resumed session");
        assert_eq!(resumed.code_layout.as_deref(), Some("comment_guided"));
        assert_eq!(resumed.accepted_text, "queue.");
        assert_eq!(
            resumed.visible_scaffold,
            vec!["Remove the next FIFO frontier node.".to_owned()]
        );
        fs::remove_dir_all(data).expect("cleanup");
    }

    #[test]
    fn resumes_a_code_recall_checkpoint_without_exposing_unrevealed_scaffold() {
        let data = data_root();
        let mut core =
            Core::open(fixture_root(), &data).unwrap_or_else(|error| panic!("open: {error}"));
        let session = core
            .start_session(StartSessionParams {
                unit_id: "graph.bfs".to_owned(),
                mode: PracticeModeDto::CodeRecall,
                implementation: None,
                practice_id: Some("bfs-no-hints".to_owned()),
            })
            .unwrap_or_else(|error| panic!("start: {error}"));
        let partial = core
            .apply_event(ApplyEventParams {
                session_id: session.session_id,
                event: PracticeEventDto::InsertText {
                    text: "from ".to_owned(),
                },
                elapsed: elapsed(1),
            })
            .unwrap_or_else(|error| panic!("partial: {error}"));
        assert!(partial.visible_scaffold.is_empty());
        let checkpoint = core
            .list_checkpoints()
            .unwrap_or_else(|error| panic!("list: {error}"))
            .into_iter()
            .find(|value| value.mode == PracticeModeDto::CodeRecall)
            .unwrap_or_else(|| panic!("code recall checkpoint"));
        drop(core);

        let mut reopened =
            Core::open(fixture_root(), &data).unwrap_or_else(|error| panic!("reopen: {error}"));
        let resumed = reopened
            .resume_checkpoint(&checkpoint.id)
            .unwrap_or_else(|error| panic!("resume: {error}"))
            .unwrap_or_else(|| panic!("resumed session"));
        assert_eq!(resumed.mode, PracticeModeDto::CodeRecall);
        assert_eq!(resumed.accepted_text, "from ");
        assert!(resumed.visible_scaffold.is_empty());
    }

    #[test]
    fn completes_reasoning_and_transfer_practice_with_separate_attempt_modes() {
        let data = data_root();
        let mut core =
            Core::open(fixture_root(), &data).unwrap_or_else(|error| panic!("open: {error}"));
        let unit = core
            .load_unit("search.binary-search")
            .unwrap_or_else(|error| panic!("load: {error}"));
        assert!(unit.modes.contains(&PracticeModeDto::ReasoningRecall));
        assert!(unit.modes.contains(&PracticeModeDto::TransferPractice));

        let reasoning = core
            .start_session(StartSessionParams {
                unit_id: "search.binary-search".to_owned(),
                mode: PracticeModeDto::ReasoningRecall,
                implementation: None,
                practice_id: Some("preserve-candidate-interval".to_owned()),
            })
            .unwrap_or_else(|error| panic!("start reasoning: {error}"));
        assert_eq!(reasoning.completed_steps, 0);
        let reasoning = core
            .apply_event(ApplyEventParams {
                session_id: reasoning.session_id,
                event: PracticeEventDto::SubmitAnswer {
                    answer: "interval ordered target".to_owned(),
                },
                elapsed: elapsed(1),
            })
            .unwrap_or_else(|error| panic!("complete reasoning: {error}"));
        assert_eq!(reasoning.mode, PracticeModeDto::ReasoningRecall);
        assert_eq!(reasoning.status, SessionStatusDto::Completed);

        let transfer = core
            .start_session(StartSessionParams {
                unit_id: "search.binary-search".to_owned(),
                mode: PracticeModeDto::TransferPractice,
                implementation: None,
                practice_id: Some("first-true".to_owned()),
            })
            .unwrap_or_else(|error| panic!("start transfer: {error}"));
        let transfer = core
            .apply_event(ApplyEventParams {
                session_id: transfer.session_id,
                event: PracticeEventDto::SubmitAnswer {
                    answer: "monotonic interval predicate Retain an interval that contains the first true position. The comparison is replaced by a monotonic boolean predicate. The predicate must be monotonic over the search interval.".to_owned(),
                },
                elapsed: elapsed(1),
            })
            .unwrap_or_else(|error| panic!("complete transfer: {error}"));
        assert_eq!(transfer.mode, PracticeModeDto::TransferPractice);
        assert_eq!(transfer.status, SessionStatusDto::Completed);

        let attempts = core
            .recent_attempts(10)
            .unwrap_or_else(|error| panic!("attempts: {error}"));
        assert!(attempts.iter().any(|attempt| {
            attempt.mode == PracticeModeDto::ReasoningRecall
                && attempt.terminal_reason == TerminalReasonDto::Completed
        }));
        assert!(attempts.iter().any(|attempt| {
            attempt.mode == PracticeModeDto::TransferPractice
                && attempt.terminal_reason == TerminalReasonDto::Completed
        }));
        fs::remove_dir_all(data).unwrap_or_else(|error| panic!("cleanup: {error}"));
    }

    #[test]
    fn resumes_reasoning_and_transfer_checkpoints_by_practice_id() {
        let data = data_root();
        let mut core =
            Core::open(fixture_root(), &data).unwrap_or_else(|error| panic!("open: {error}"));
        let reasoning = core
            .start_session(StartSessionParams {
                unit_id: "search.binary-search".to_owned(),
                mode: PracticeModeDto::ReasoningRecall,
                implementation: None,
                practice_id: Some("preserve-candidate-interval".to_owned()),
            })
            .unwrap_or_else(|error| panic!("start reasoning: {error}"));
        core.apply_event(ApplyEventParams {
            session_id: reasoning.session_id,
            event: PracticeEventDto::RevealPrompt,
            elapsed: elapsed(1),
        })
        .unwrap_or_else(|error| panic!("reveal reasoning: {error}"));
        let reasoning_checkpoint = core
            .list_checkpoints()
            .unwrap_or_else(|error| panic!("list reasoning checkpoints: {error}"))
            .into_iter()
            .find(|value| value.mode == PracticeModeDto::ReasoningRecall)
            .unwrap_or_else(|| panic!("reasoning checkpoint"));

        let transfer = core
            .start_session(StartSessionParams {
                unit_id: "search.binary-search".to_owned(),
                mode: PracticeModeDto::TransferPractice,
                implementation: None,
                practice_id: Some("first-true".to_owned()),
            })
            .unwrap_or_else(|error| panic!("start transfer: {error}"));
        core.apply_event(ApplyEventParams {
            session_id: transfer.session_id,
            event: PracticeEventDto::RevealPrompt,
            elapsed: elapsed(1),
        })
        .unwrap_or_else(|error| panic!("reveal transfer: {error}"));
        let transfer_checkpoint = core
            .list_checkpoints()
            .unwrap_or_else(|error| panic!("list transfer checkpoints: {error}"))
            .into_iter()
            .find(|value| value.mode == PracticeModeDto::TransferPractice)
            .unwrap_or_else(|| panic!("transfer checkpoint"));
        drop(core);

        let mut reopened =
            Core::open(fixture_root(), &data).unwrap_or_else(|error| panic!("reopen: {error}"));
        let resumed_reasoning = reopened
            .resume_checkpoint(&reasoning_checkpoint.id)
            .unwrap_or_else(|error| panic!("resume reasoning: {error}"))
            .unwrap_or_else(|| panic!("resumed reasoning"));
        assert_eq!(resumed_reasoning.mode, PracticeModeDto::ReasoningRecall);
        assert_eq!(resumed_reasoning.prompt_count, 1);
        let resumed_transfer = reopened
            .resume_checkpoint(&transfer_checkpoint.id)
            .unwrap_or_else(|error| panic!("resume transfer: {error}"))
            .unwrap_or_else(|| panic!("resumed transfer"));
        assert_eq!(resumed_transfer.mode, PracticeModeDto::TransferPractice);
        assert_eq!(resumed_transfer.prompt_count, 1);
        fs::remove_dir_all(data).unwrap_or_else(|error| panic!("cleanup: {error}"));
    }

    #[test]
    fn resumes_reasoning_checkpoint_with_selected_practice_id() {
        let data = data_root();
        let mut core =
            Core::open(fixture_root(), &data).unwrap_or_else(|error| panic!("open: {error}"));
        let session = core
            .start_session(StartSessionParams {
                unit_id: "search.binary-search".to_owned(),
                mode: PracticeModeDto::ReasoningRecall,
                implementation: None,
                practice_id: Some("preserve-candidate-interval".to_owned()),
            })
            .unwrap_or_else(|error| panic!("start: {error}"));
        let rejected = core
            .apply_event(ApplyEventParams {
                session_id: session.session_id,
                event: PracticeEventDto::SubmitAnswer {
                    answer: "not enough evidence".to_owned(),
                },
                elapsed: elapsed(1),
            })
            .unwrap_or_else(|error| panic!("reject: {error}"));
        assert_eq!(rejected.rejected_input_count, 1);
        let checkpoint = core
            .list_checkpoints()
            .unwrap_or_else(|error| panic!("list: {error}"))
            .into_iter()
            .find(|value| value.mode == PracticeModeDto::ReasoningRecall)
            .unwrap_or_else(|| panic!("reasoning checkpoint"));
        drop(core);

        let mut reopened =
            Core::open(fixture_root(), &data).unwrap_or_else(|error| panic!("reopen: {error}"));
        let resumed = reopened
            .resume_checkpoint(&checkpoint.id)
            .unwrap_or_else(|error| panic!("resume: {error}"))
            .unwrap_or_else(|| panic!("resumed session"));
        assert_eq!(resumed.mode, PracticeModeDto::ReasoningRecall);
        assert_eq!(resumed.completed_steps, 0);
        assert_eq!(resumed.rejected_input_count, 1);
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
                practice_id: None,
            })
            .unwrap_or_else(|error| panic!("start: {error}"));
        let checkpoint_id = checkpoint_id(&session.session_id);
        let _ = core
            .apply_event(ApplyEventParams {
                session_id: session.session_id.clone(),
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
                .list_checkpoints()
                .unwrap_or_else(|error| panic!("checkpoints: {error}"))
                .iter()
                .any(|checkpoint| checkpoint.id == checkpoint_id)
        );
        let state = resumed
            .resume_checkpoint(&checkpoint_id)
            .unwrap_or_else(|error| panic!("resume: {error}"))
            .unwrap_or_else(|| panic!("checkpoint"));
        assert_eq!(state.accepted_text, "from");
        assert_eq!(state.unit_title, "Breadth-First Search");
        assert!(state.problem_statement.contains("frontier"));
        assert_eq!(
            state.problem_statement,
            resumed
                .session_view(&state.session_id)
                .unwrap()
                .problem_statement
        );
        fs::remove_dir_all(data).unwrap_or_else(|error| panic!("cleanup: {error}"));
    }

    #[test]
    fn persists_a_checkpoint_before_the_first_event() {
        let data = data_root();
        let mut core =
            Core::open(fixture_root(), &data).unwrap_or_else(|error| panic!("open: {error}"));
        let started = core
            .start_session(StartSessionParams {
                unit_id: "search.binary-search".to_owned(),
                mode: PracticeModeDto::FlowRecall,
                implementation: None,
                practice_id: None,
            })
            .unwrap_or_else(|error| panic!("start: {error}"));

        let mut reopened =
            Core::open(fixture_root(), &data).unwrap_or_else(|error| panic!("reopen: {error}"));
        let resumed = reopened
            .resume_checkpoint(&checkpoint_id(&started.session_id))
            .unwrap_or_else(|error| panic!("resume: {error}"))
            .unwrap_or_else(|| panic!("new session checkpoint"));
        assert_eq!(resumed.session_id, started.session_id);
        assert_eq!(resumed.completed_steps, 0);
        assert_eq!(resumed.status, SessionStatusDto::Active);

        fs::remove_dir_all(data).unwrap_or_else(|error| panic!("cleanup: {error}"));
    }

    #[test]
    fn loads_real_host_boundary_fixtures_canonically() {
        let data = data_root();
        let mut core =
            Core::open(fixture_root(), &data).unwrap_or_else(|error| panic!("open: {error}"));
        let crlf = core
            .start_session(StartSessionParams {
                unit_id: "validation.crlf".to_owned(),
                mode: PracticeModeDto::ShadowTyping,
                implementation: None,
                practice_id: None,
            })
            .unwrap_or_else(|error| panic!("CRLF start: {error}"));
        assert!(!crlf.target_text.contains('\r'));
        assert!(crlf.target_text.ends_with('\n'));

        let unicode = core
            .start_session(StartSessionParams {
                unit_id: "validation.unicode".to_owned(),
                mode: PracticeModeDto::ShadowTyping,
                implementation: None,
                practice_id: None,
            })
            .unwrap_or_else(|error| panic!("Unicode start: {error}"));
        assert!(
            unicode
                .target_text
                .contains("\u{5df2}\u{8bbf}\u{95ee}\u{1f642}")
        );
        assert!(unicode.target_text.contains("Cafe\u{301}"));

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
                practice_id: None,
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
        let checkpoints = core
            .list_checkpoints()
            .unwrap_or_else(|error| panic!("list after restart: {error}"));
        assert_eq!(checkpoints.len(), 1);
        assert_eq!(checkpoints[0].id, checkpoint_id(&restarted.session_id));

        let mut reopened =
            Core::open(fixture_root(), &data).unwrap_or_else(|error| panic!("reopen: {error}"));
        let checkpoint = reopened
            .resume_checkpoint(&checkpoint_id(&restarted.session_id))
            .unwrap_or_else(|error| panic!("resume: {error}"))
            .unwrap_or_else(|| panic!("restart checkpoint"));
        assert_eq!(checkpoint.session_id, restarted.session_id);
        assert!(checkpoint.accepted_text.is_empty());

        fs::remove_dir_all(data).unwrap_or_else(|error| panic!("cleanup: {error}"));
    }

    #[test]
    fn selectively_recovers_and_discards_persisted_checkpoints_without_touching_history() {
        let data = data_root();
        let mut core =
            Core::open(fixture_root(), &data).unwrap_or_else(|error| panic!("open: {error}"));
        let shadow = core
            .start_session(StartSessionParams {
                unit_id: "graph.bfs".to_owned(),
                mode: PracticeModeDto::ShadowTyping,
                implementation: None,
                practice_id: None,
            })
            .unwrap_or_else(|error| panic!("shadow start: {error}"));
        let shadow_checkpoint = checkpoint_id(&shadow.session_id);
        core.apply_event(ApplyEventParams {
            session_id: shadow.session_id.clone(),
            event: PracticeEventDto::InsertText {
                text: "from".to_owned(),
            },
            elapsed: elapsed(1),
        })
        .unwrap_or_else(|error| panic!("shadow event: {error}"));
        let flow = core
            .start_session(StartSessionParams {
                unit_id: "search.binary-search".to_owned(),
                mode: PracticeModeDto::FlowRecall,
                implementation: None,
                practice_id: None,
            })
            .unwrap_or_else(|error| panic!("flow start: {error}"));
        let flow_checkpoint = checkpoint_id(&flow.session_id);

        let mut reopened =
            Core::open(fixture_root(), &data).unwrap_or_else(|error| panic!("reopen: {error}"));
        let checkpoints = reopened
            .list_checkpoints()
            .unwrap_or_else(|error| panic!("list: {error}"));
        assert_eq!(checkpoints.len(), 2);
        assert!(checkpoints.iter().any(|checkpoint| {
            checkpoint.id == shadow_checkpoint
                && checkpoint.mode == PracticeModeDto::ShadowTyping
                && checkpoint.accepted_characters == 4
                && checkpoint.target_characters > checkpoint.accepted_characters
        }));
        assert!(checkpoints.iter().any(|checkpoint| {
            checkpoint.id == flow_checkpoint
                && checkpoint.mode == PracticeModeDto::FlowRecall
                && checkpoint.completed_steps == 0
                && checkpoint.total_steps > 0
        }));

        let resumed = reopened
            .resume_checkpoint(&shadow_checkpoint)
            .unwrap_or_else(|error| panic!("resume selected: {error}"))
            .unwrap_or_else(|| panic!("selected checkpoint"));
        assert_eq!(resumed.accepted_text, "from");
        reopened
            .stop_session(&shadow.session_id, elapsed(2))
            .unwrap_or_else(|error| panic!("stop selected: {error}"));
        let remaining = reopened
            .list_checkpoints()
            .unwrap_or_else(|error| panic!("list after stop: {error}"));
        assert_eq!(remaining.len(), 1);
        assert_eq!(remaining[0].id, flow_checkpoint);
        assert_eq!(
            reopened
                .recent_attempts(10)
                .unwrap_or_else(|error| panic!("history: {error}"))
                .len(),
            1
        );
        assert!(
            reopened
                .discard_checkpoint(&flow_checkpoint)
                .unwrap_or_else(|error| panic!("discard selected: {error}"))
        );
        assert!(
            reopened
                .list_checkpoints()
                .unwrap_or_else(|error| panic!("final checkpoints: {error}"))
                .is_empty()
        );

        fs::remove_dir_all(data).unwrap_or_else(|error| panic!("cleanup: {error}"));
    }

    #[test]
    fn discarding_shadow_checkpoint_does_not_create_a_stopped_attempt() {
        let data = data_root();
        let mut core =
            Core::open(fixture_root(), &data).unwrap_or_else(|error| panic!("open: {error}"));
        let session = core
            .start_session(StartSessionParams {
                unit_id: "graph.bfs".to_owned(),
                mode: PracticeModeDto::ShadowTyping,
                implementation: None,
                practice_id: None,
            })
            .unwrap_or_else(|error| panic!("start: {error}"));
        core.apply_event(ApplyEventParams {
            session_id: session.session_id.clone(),
            event: PracticeEventDto::InsertText {
                text: "from".to_owned(),
            },
            elapsed: elapsed(1),
        })
        .unwrap_or_else(|error| panic!("event: {error}"));

        assert!(
            core.discard_checkpoint(&checkpoint_id(&session.session_id))
                .unwrap_or_else(|error| panic!("discard: {error}"))
        );
        assert!(matches!(
            core.stop_session(&session.session_id, elapsed(2)),
            Err(CoreError::UnknownSession(_))
        ));
        assert!(
            core.recent_attempts(10)
                .unwrap_or_else(|error| panic!("history: {error}"))
                .is_empty()
        );

        fs::remove_dir_all(data).unwrap_or_else(|error| panic!("cleanup: {error}"));
    }

    #[test]
    fn converts_unix_days_to_utc_civil_dates() {
        assert_eq!(civil_date_from_unix_days(0), (1970, 1, 1));
        assert_eq!(civil_date_from_unix_days(20_000), (2024, 10, 4));
    }
}
