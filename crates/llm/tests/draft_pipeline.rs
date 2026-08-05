use std::{
    fs,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use gewu_llm::{DraftPipeline, FakeProvider, ProviderKind, ProviderProfile, ReviewState};
use gewu_template::load_algorithm_unit;

fn fixture_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/algorithm-units/valid")
}

fn copy_dir(source: &Path, target: &Path) {
    fs::create_dir_all(target).expect("create target");
    for entry in fs::read_dir(source).expect("read source") {
        let entry = entry.expect("entry");
        let source_path = entry.path();
        let target_path = target.join(entry.file_name());
        if source_path.is_dir() {
            copy_dir(&source_path, &target_path);
        } else {
            fs::copy(source_path, target_path).expect("copy file");
        }
    }
}

#[test]
fn fake_provider_generates_reviews_and_loads_two_contrasting_units() {
    let root = fixture_root();
    let binary =
        fs::read_to_string(root.join("search/binary-search/unit.json")).expect("binary manifest");
    let bfs = fs::read_to_string(root.join("graph/bfs/unit.json")).expect("bfs manifest");
    let profile = ProviderProfile::recommended(ProviderKind::DeepSeek, "deepseek-v4-flash");
    let mut pipeline = DraftPipeline::new(FakeProvider::new(profile, vec![binary, bfs]));
    let scratch = std::env::temp_dir().join(format!(
        "gewu-draft-pipeline-{}",
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock")
            .as_nanos()
    ));

    for (relative, id, hash) in [
        ("graph/bfs", "graph.bfs", "sha256:bfs"),
        (
            "search/binary-search",
            "search.binary-search",
            "sha256:binary",
        ),
    ] {
        let target = scratch.join(relative);
        copy_dir(&root.join(relative), &target);
        let task = gewu_llm::DraftTask {
            task_id: format!("unit-{id}"),
            task_version: "1".to_owned(),
            selected_input_hash: hash.to_owned(),
            instruction: format!("Return the reviewed {id} unit manifest as JSON."),
            output_schema: serde_json::json!({"type": "object"}),
        };
        let artifact = pipeline.generate(&task).expect("generate draft");
        assert_eq!(artifact.review, ReviewState::Pending);
        let artifact = artifact
            .review(ReviewState::Accepted)
            .expect("review draft");
        artifact
            .persist_manifest(target.join("unit.json"))
            .expect("persist draft");
        let loaded = load_algorithm_unit(target.join("unit.json")).expect("load validated draft");
        assert_eq!(loaded.id.as_str(), id);
    }

    fs::remove_dir_all(scratch).expect("cleanup");
}
