//! Names saved by earlier versions must open in this one, whole.
//!
//! `fixtures/past` holds files as earlier versions wrote them: the front
//! end's full project at the pull request that last changed it, and names
//! saved by the app. They are never regenerated; when the data changes, a
//! new one is added (see its README). Each must load and pass the save
//! check (the saved names), with every field known to the model (the app saves the front
//! end's text as it is, so an unknown field is one Rust cannot check), and
//! read the same after Rust writes it.

use std::path::{Path, PathBuf};

use name_model::Project;

fn past_files() -> Vec<PathBuf> {
    let folder = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/past");
    let mut files: Vec<PathBuf> = std::fs::read_dir(&folder)
        .unwrap()
        .map(|entry| entry.unwrap().path())
        .filter(|path| matches!(path.extension().and_then(|e| e.to_str()), Some("json" | "namestudio")))
        .collect();
    files.push(Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/data/editor-project.namestudio"));
    files.sort();
    files
}

#[test]
fn names_saved_by_earlier_versions_open_and_keep_everything() {
    let files = past_files();
    assert!(files.len() >= 10, "past names missing: {files:?}");
    let mut found = Vec::new();
    for path in &files {
        let name = path.file_name().unwrap().to_string_lossy();
        let text = std::fs::read_to_string(path).unwrap();
        let mut deserializer = serde_json::Deserializer::from_str(&text);
        let mut unknown = Vec::new();
        let parsed: Result<Project, _> =
            serde_ignored::deserialize(&mut deserializer, |path| unknown.push(path.to_string()));
        for path in unknown {
            found.push(format!("{name}: {path} is not in the model"));
        }
        if let Err(error) = parsed {
            found.push(format!("{name}: does not open: {error}"));
            continue;
        }
        // The full-field samples fill every field, not a consistent name: only saved names face the save check.
        if path.extension().is_some_and(|e| e == "json") {
            continue;
        }
        match Project::from_json(&text) {
            Ok(project) => {
                let again = Project::from_json(&project.to_json().unwrap()).unwrap();
                if again != project {
                    found.push(format!("{name}: reads differently once Rust writes it"));
                }
            }
            Err(error) => found.push(format!("{name}: does not pass the save check: {error}")),
        }
    }
    assert!(found.is_empty(), "earlier names changed:\n{}", found.join("\n"));
}

#[test]
fn the_current_data_is_kept_as_a_past_name_too() {
    // When the front end's fields change, the new full-field sample joins the past ones (see their README).
    let current = include_str!("fixtures/full-project.json");
    let kept = past_files().iter().any(|path| {
        std::fs::read_to_string(path).is_ok_and(|text| text.replace("\r\n", "\n") == current.replace("\r\n", "\n"))
    });
    assert!(
        kept,
        "fixtures/full-project.json changed: copy it to fixtures/past/full-project-pr<この PR の番号>.json"
    );
}
