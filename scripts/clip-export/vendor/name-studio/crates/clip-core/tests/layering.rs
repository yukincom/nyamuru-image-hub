//! The Rust crates in layers, slowest first (README 「構成」):
//! name-model (the name data itself) ← clip-core (CSP files, through
//! csp-format) ← name-cli and the app. A crate leans only on slower ones, so
//! the name data never changes because CSP's format or the window did.

use std::path::Path;

fn manifest(crate_dir: &str) -> String {
    std::fs::read_to_string(
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join(crate_dir)
            .join("Cargo.toml"),
    )
    .unwrap()
}

/// The names in a manifest's [dependencies] (not dev-dependencies: tests may build CSP files).
fn dependencies(manifest: &str) -> Vec<String> {
    let mut names = Vec::new();
    let mut inside = false;
    for line in manifest.lines().map(str::trim) {
        if line.starts_with('[') {
            inside = line == "[dependencies]";
        } else if inside && let Some((name, _)) = line.split_once('=') {
            names.push(name.trim().trim_end_matches(".workspace").to_owned());
        }
    }
    names
}

fn sources(dir: &Path, out: &mut Vec<(String, String)>) {
    for entry in std::fs::read_dir(dir).unwrap().flatten() {
        let path = entry.path();
        if path.is_dir() {
            sources(&path, out);
        } else if path.extension().is_some_and(|e| e == "rs") {
            out.push((path.display().to_string(), std::fs::read_to_string(&path).unwrap()));
        }
    }
}

#[test]
fn the_name_data_knows_nothing_of_csp_or_the_app() {
    let deps = dependencies(&manifest("name-model"));
    for slower in [
        "clip-core",
        "csp-format",
        "csp-assets",
        "name-cli",
        "name-studio-app",
        "tauri",
        "rusqlite",
    ] {
        assert!(
            !deps.iter().any(|dep| dep == slower),
            "name-model depends on {slower}: {deps:?}"
        );
    }
    let mut files = Vec::new();
    sources(
        &Path::new(env!("CARGO_MANIFEST_DIR")).join("../name-model/src"),
        &mut files,
    );
    for (path, text) in files {
        for word in ["clip_core", "csp_format", "csp_assets", "tauri"] {
            assert!(!text.contains(word), "{path} uses {word}");
        }
    }
}

#[test]
fn csp_files_know_nothing_of_the_app() {
    let deps = dependencies(&manifest("clip-core"));
    assert!(deps.iter().any(|dep| dep == "name-model"), "{deps:?}");
    for faster in ["name-cli", "name-studio-app", "tauri"] {
        assert!(
            !deps.iter().any(|dep| dep.starts_with(faster)),
            "clip-core depends on {faster}: {deps:?}"
        );
    }
}
