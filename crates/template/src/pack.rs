use std::{
    fs, io,
    path::{Path, PathBuf},
};

use gewu_domain::{Revision, UnitId};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use thiserror::Error;

pub const PACK_SCHEMA_VERSION: &str = "1";

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct ContentPackManifest {
    pub schema_version: String,
    pub pack_id: String,
    pub pack_version: String,
    pub algorithm_unit_schema: String,
    pub units: Vec<ContentPackUnit>,
    pub checksum: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct ContentPackUnit {
    pub path: String,
    pub id: UnitId,
    pub revision: Revision,
    pub checksum: String,
}

#[derive(Debug, Error)]
pub enum PackError {
    #[error("content pack I/O failed at {path}: {source}")]
    Io {
        path: PathBuf,
        #[source]
        source: io::Error,
    },
    #[error("content pack manifest is invalid: {0}")]
    Invalid(String),
    #[error("content pack unit failed validation: {0}")]
    Unit(#[from] crate::LoadError),
}

pub fn build_manifest(
    root: impl AsRef<Path>,
    pack_id: impl Into<String>,
    pack_version: impl Into<String>,
) -> Result<ContentPackManifest, PackError> {
    let root = root.as_ref();
    let mut paths = Vec::new();
    collect_unit_manifests(root, &mut paths)?;
    let mut units = Vec::new();
    for path in paths {
        let unit = crate::load_algorithm_unit(&path)?;
        let relative = path
            .strip_prefix(root)
            .map_err(|_| PackError::Invalid("unit path is outside pack root".to_owned()))?;
        let relative = relative.to_string_lossy().replace('\\', "/");
        units.push(ContentPackUnit {
            path: relative,
            id: unit.id,
            revision: unit.revision,
            checksum: hash_directory(path.parent().expect("manifest has parent"))?,
        });
    }
    units.sort_by(|left, right| left.path.cmp(&right.path));
    let checksum = hash_entries(
        &units
            .iter()
            .map(|unit| {
                format!(
                    "{}\0{}\0{}\0{}",
                    unit.path, unit.id, unit.revision, unit.checksum
                )
            })
            .collect::<Vec<_>>(),
    );
    Ok(ContentPackManifest {
        schema_version: PACK_SCHEMA_VERSION.to_owned(),
        pack_id: pack_id.into(),
        pack_version: pack_version.into(),
        algorithm_unit_schema: "2".to_owned(),
        units,
        checksum,
    })
}

pub fn verify_manifest(
    root: impl AsRef<Path>,
    manifest: &ContentPackManifest,
) -> Result<(), PackError> {
    if manifest.schema_version != PACK_SCHEMA_VERSION {
        return Err(PackError::Invalid(format!(
            "unsupported pack schema {}",
            manifest.schema_version
        )));
    }
    let expected = build_manifest(
        root.as_ref(),
        manifest.pack_id.clone(),
        manifest.pack_version.clone(),
    )?;
    if expected.algorithm_unit_schema != manifest.algorithm_unit_schema
        || expected.units != manifest.units
        || expected.checksum != manifest.checksum
    {
        return Err(PackError::Invalid(
            "content pack checksum or unit inventory does not match".to_owned(),
        ));
    }
    Ok(())
}

fn collect_unit_manifests(root: &Path, paths: &mut Vec<PathBuf>) -> Result<(), PackError> {
    for entry in fs::read_dir(root).map_err(|source| PackError::Io {
        path: root.to_owned(),
        source,
    })? {
        let entry = entry.map_err(|source| PackError::Io {
            path: root.to_owned(),
            source,
        })?;
        let path = entry.path();
        if path.is_dir() {
            collect_unit_manifests(&path, paths)?;
        } else if path.file_name().is_some_and(|name| name == "unit.json") {
            paths.push(path);
        }
    }
    paths.sort();
    Ok(())
}

fn hash_directory(root: &Path) -> Result<String, PackError> {
    let mut files = Vec::new();
    collect_files(root, &mut files)?;
    files.sort();
    let mut hasher = Sha256::new();
    for path in files {
        let relative = path
            .strip_prefix(root)
            .map_err(|_| PackError::Invalid("file path is outside unit".to_owned()))?;
        hasher.update(relative.to_string_lossy().replace('\\', "/").as_bytes());
        hasher.update([0]);
        hasher.update(fs::read(&path).map_err(|source| PackError::Io {
            path: path.clone(),
            source,
        })?);
        hasher.update([0]);
    }
    Ok(format!("sha256:{}", hex(&hasher.finalize())))
}

fn collect_files(root: &Path, files: &mut Vec<PathBuf>) -> Result<(), PackError> {
    for entry in fs::read_dir(root).map_err(|source| PackError::Io {
        path: root.to_owned(),
        source,
    })? {
        let entry = entry.map_err(|source| PackError::Io {
            path: root.to_owned(),
            source,
        })?;
        let path = entry.path();
        if path.is_dir() {
            collect_files(&path, files)?;
        } else {
            files.push(path);
        }
    }
    Ok(())
}

fn hash_entries(entries: &[String]) -> String {
    let mut hasher = Sha256::new();
    for entry in entries {
        hasher.update(entry.as_bytes());
        hasher.update([0]);
    }
    format!("sha256:{}", hex(&hasher.finalize()))
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn manifest_round_trips_for_real_pack() {
        let root =
            PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/algorithm-units/valid");
        let manifest = build_manifest(&root, "gewu-fixtures", "0.1.0").unwrap();
        assert_eq!(manifest.units.len(), 4);
        assert!(manifest.checksum.starts_with("sha256:"));
        verify_manifest(&root, &manifest).unwrap();
    }
}
