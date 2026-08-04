#![forbid(unsafe_code)]
//! Versioned local JSON persistence with atomic replacement.

use std::{
    fs, io,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};
use thiserror::Error;

const HISTORY_FILE: &str = "attempts-v1.json";
const CHECKPOINT_FILE: &str = "checkpoint-v1.json";
const FORMAT_VERSION: u32 = 1;

/// A terminal attempt persisted without user source or answer contents.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct StoredAttempt {
    pub id: String,
    pub created_at: String,
    pub unit_id: String,
    pub revision: u64,
    pub schema_version: String,
    pub mode: String,
    pub terminal_reason: String,
    pub accepted_input_count: u64,
    pub rejected_input_count: u64,
    pub correction_count: u64,
    pub prompt_count: u64,
    pub active_ms: u64,
    pub wall_ms: u64,
}

/// A recoverable active versioned-unit session. Ad-hoc source is deliberately absent.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct StoredCheckpoint {
    pub session_id: String,
    pub unit_id: String,
    pub revision: u64,
    pub mode: String,
    pub implementation: Option<String>,
    pub events: Vec<StoredEvent>,
    pub saved_at: String,
}

/// Replayed event log used only to resume a live session.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct StoredEvent {
    pub event: serde_json::Value,
    pub active_ms: u64,
    pub wall_ms: u64,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
struct HistoryDocument {
    format_version: u32,
    attempts: Vec<StoredAttempt>,
}
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
struct CheckpointDocument {
    format_version: u32,
    checkpoint: Option<StoredCheckpoint>,
}

/// Local data store rooted at a caller-selected portable directory.
#[derive(Clone, Debug)]
pub struct LocalStore {
    root: PathBuf,
}

impl LocalStore {
    pub fn open(root: impl Into<PathBuf>) -> Result<Self, StorageError> {
        let root = root.into();
        fs::create_dir_all(&root).map_err(|source| StorageError::Io {
            path: root.clone(),
            source,
        })?;
        Ok(Self { root })
    }
    pub fn root(&self) -> &Path {
        &self.root
    }
    pub fn list_attempts(&self, limit: usize) -> Result<Vec<StoredAttempt>, StorageError> {
        let mut attempts = self.read_history()?.attempts;
        attempts.reverse();
        attempts.truncate(limit);
        Ok(attempts)
    }
    pub fn append_attempt(&self, attempt: StoredAttempt) -> Result<(), StorageError> {
        let mut document = self.read_history()?;
        if document
            .attempts
            .iter()
            .any(|existing| existing.id == attempt.id)
        {
            return Ok(());
        }
        document.attempts.push(attempt);
        self.write_json(HISTORY_FILE, &document)
    }
    pub fn delete_history(&self) -> Result<usize, StorageError> {
        let count = self.read_history()?.attempts.len();
        self.write_json(
            HISTORY_FILE,
            &HistoryDocument {
                format_version: FORMAT_VERSION,
                attempts: Vec::new(),
            },
        )?;
        Ok(count)
    }
    pub fn delete_attempts(&self, ids: &[String]) -> Result<usize, StorageError> {
        let mut document = self.read_history()?;
        let before = document.attempts.len();
        document
            .attempts
            .retain(|attempt| !ids.contains(&attempt.id));
        self.write_json(HISTORY_FILE, &document)?;
        Ok(before - document.attempts.len())
    }
    pub fn load_checkpoint(&self) -> Result<Option<StoredCheckpoint>, StorageError> {
        Ok(self.read_checkpoint()?.checkpoint)
    }
    pub fn save_checkpoint(&self, checkpoint: StoredCheckpoint) -> Result<(), StorageError> {
        self.write_json(
            CHECKPOINT_FILE,
            &CheckpointDocument {
                format_version: FORMAT_VERSION,
                checkpoint: Some(checkpoint),
            },
        )
    }
    pub fn clear_checkpoint(&self) -> Result<(), StorageError> {
        self.write_json(
            CHECKPOINT_FILE,
            &CheckpointDocument {
                format_version: FORMAT_VERSION,
                checkpoint: None,
            },
        )
    }
    fn read_history(&self) -> Result<HistoryDocument, StorageError> {
        let document = self.read_json(
            HISTORY_FILE,
            HistoryDocument {
                format_version: FORMAT_VERSION,
                attempts: Vec::new(),
            },
        )?;
        self.ensure_version(HISTORY_FILE, document.format_version)?;
        Ok(document)
    }
    fn read_checkpoint(&self) -> Result<CheckpointDocument, StorageError> {
        let document = self.read_json(
            CHECKPOINT_FILE,
            CheckpointDocument {
                format_version: FORMAT_VERSION,
                checkpoint: None,
            },
        )?;
        self.ensure_version(CHECKPOINT_FILE, document.format_version)?;
        Ok(document)
    }
    fn ensure_version(&self, name: &str, found: u32) -> Result<(), StorageError> {
        if found == FORMAT_VERSION {
            Ok(())
        } else {
            Err(StorageError::UnsupportedVersion {
                path: self.root.join(name),
                found,
            })
        }
    }
    fn read_json<T: for<'de> Deserialize<'de>>(
        &self,
        name: &str,
        default: T,
    ) -> Result<T, StorageError> {
        let path = self.root.join(name);
        let contents = match fs::read_to_string(&path) {
            Ok(contents) => contents,
            Err(source) if source.kind() == io::ErrorKind::NotFound => return Ok(default),
            Err(source) => return Err(StorageError::Io { path, source }),
        };
        serde_json::from_str(&contents).map_err(|source| StorageError::Corrupt { path, source })
    }
    fn write_json<T: Serialize>(&self, name: &str, value: &T) -> Result<(), StorageError> {
        let path = self.root.join(name);
        let bytes = serde_json::to_vec_pretty(value).map_err(StorageError::Serialize)?;
        let temporary = self.root.join(format!(".{name}.{}.tmp", unique_suffix()));
        fs::write(&temporary, bytes).map_err(|source| StorageError::Io {
            path: temporary.clone(),
            source,
        })?;
        fs::rename(&temporary, &path).map_err(|source| StorageError::Io { path, source })
    }
}

/// Persistence errors distinguish invalid user data from ordinary I/O failures.
#[derive(Debug, Error)]
pub enum StorageError {
    #[error("local storage I/O failed at {path}: {source}")]
    Io {
        path: PathBuf,
        #[source]
        source: io::Error,
    },
    #[error("local storage is corrupt at {path}: {source}")]
    Corrupt {
        path: PathBuf,
        #[source]
        source: serde_json::Error,
    },
    #[error("local storage at {path} uses unsupported format version {found}")]
    UnsupportedVersion { path: PathBuf, found: u32 },
    #[error("could not serialize local storage: {0}")]
    Serialize(serde_json::Error),
}

fn unique_suffix() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |duration| duration.as_nanos())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        fs,
        time::{SystemTime, UNIX_EPOCH},
    };
    fn root() -> PathBuf {
        std::env::temp_dir().join(format!(
            "gewu-storage-test-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map_or(0, |value| value.as_nanos())
        ))
    }
    fn attempt() -> StoredAttempt {
        StoredAttempt {
            id: "a".to_owned(),
            created_at: "2026-01-01T00:00:00Z".to_owned(),
            unit_id: "graph.bfs".to_owned(),
            revision: 1,
            schema_version: "1".to_owned(),
            mode: "shadow_typing".to_owned(),
            terminal_reason: "completed".to_owned(),
            accepted_input_count: 1,
            rejected_input_count: 0,
            correction_count: 0,
            prompt_count: 0,
            active_ms: 1,
            wall_ms: 1,
        }
    }
    #[test]
    fn round_trips_history_and_deletion() {
        let root = root();
        let store = LocalStore::open(&root).unwrap_or_else(|error| panic!("open: {error}"));
        store
            .append_attempt(attempt())
            .unwrap_or_else(|error| panic!("save: {error}"));
        assert_eq!(
            store
                .list_attempts(10)
                .unwrap_or_else(|error| panic!("list: {error}"))
                .len(),
            1
        );
        assert_eq!(
            store
                .delete_history()
                .unwrap_or_else(|error| panic!("delete: {error}")),
            1
        );
        fs::remove_dir_all(root).unwrap_or_else(|error| panic!("cleanup: {error}"));
    }
    #[test]
    fn deletes_only_selected_attempts() {
        let root = root();
        let store = LocalStore::open(&root).unwrap_or_else(|error| panic!("open: {error}"));
        let first = attempt();
        let mut second = attempt();
        second.id = "b".to_owned();
        store
            .append_attempt(first)
            .unwrap_or_else(|error| panic!("first save: {error}"));
        store
            .append_attempt(second)
            .unwrap_or_else(|error| panic!("second save: {error}"));

        assert_eq!(
            store
                .delete_attempts(&["a".to_owned()])
                .unwrap_or_else(|error| panic!("delete: {error}")),
            1
        );
        let remaining = store
            .list_attempts(10)
            .unwrap_or_else(|error| panic!("list: {error}"));
        assert_eq!(remaining.len(), 1);
        assert_eq!(remaining[0].id, "b");

        fs::remove_dir_all(root).unwrap_or_else(|error| panic!("cleanup: {error}"));
    }
    #[test]
    fn reports_corrupt_history_with_a_typed_error() {
        let root = root();
        let store = LocalStore::open(&root).unwrap_or_else(|error| panic!("open: {error}"));
        fs::write(root.join(HISTORY_FILE), "not json")
            .unwrap_or_else(|error| panic!("write: {error}"));
        assert!(matches!(
            store.list_attempts(1),
            Err(StorageError::Corrupt { .. })
        ));
        fs::remove_dir_all(root).unwrap_or_else(|error| panic!("cleanup: {error}"));
    }

    #[test]
    fn rejects_unknown_versions_and_deduplicates_attempt_ids() {
        let root = root();
        let store = LocalStore::open(&root).unwrap_or_else(|error| panic!("open: {error}"));
        store
            .append_attempt(attempt())
            .unwrap_or_else(|error| panic!("first save: {error}"));
        store
            .append_attempt(attempt())
            .unwrap_or_else(|error| panic!("idempotent save: {error}"));
        assert_eq!(
            store
                .list_attempts(10)
                .unwrap_or_else(|error| panic!("list: {error}"))
                .len(),
            1
        );

        fs::write(
            root.join(CHECKPOINT_FILE),
            r#"{"format_version":2,"checkpoint":null}"#,
        )
        .unwrap_or_else(|error| panic!("write version: {error}"));
        assert!(matches!(
            store.load_checkpoint(),
            Err(StorageError::UnsupportedVersion { found: 2, .. })
        ));
        fs::remove_dir_all(root).unwrap_or_else(|error| panic!("cleanup: {error}"));
    }
}
