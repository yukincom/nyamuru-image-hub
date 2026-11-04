//! 版の履歴と自動保存の控え: earlier versions of a project and the copy kept
//! for a project that was not saved when the app stopped.
//!
//! Everything lives under one root folder (the app's local data folder), one
//! sub-folder per project file, so the user's own folders stay as they are:
//!
//! ```text
//! <root>/versions/<key>/index.json        what the versions are, newest last
//! <root>/versions/<key>/<time>-<kind>.json.gz
//! <root>/recovery/<key>.json              { path, timeMs, project }
//! ```
//!
//! `<key>` comes from the project's path ("untitled" for one never saved).

use std::io::{Read, Write};
use std::path::{Path, PathBuf};

use flate2::Compression;
use flate2::read::GzDecoder;
use flate2::write::GzEncoder;
use serde::{Deserialize, Serialize};
use serde_json::value::RawValue;

use crate::{Project, ProjectError};

/// Key of a project that has no file yet.
pub const UNTITLED: &str = "untitled";

/// How many versions of each kind are kept; older ones are removed.
const KEEP_SAVED: usize = 100;
const KEEP_AUTO: usize = 40;
const KEEP_BEFORE_RESTORE: usize = 20;
/// At most this much on disk per project; older versions go first.
const KEEP_BYTES: u64 = 300 * 1024 * 1024;
/// The newest saved versions kept whatever their size.
const KEEP_SAVED_ALWAYS: usize = 10;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum VersionKind {
    /// Saved by the user.
    Saved,
    /// Taken while autosaving.
    Auto,
    /// The state just before an earlier version was brought back.
    BeforeRestore,
}

impl VersionKind {
    fn file_tag(self) -> &'static str {
        match self {
            VersionKind::Saved => "saved",
            VersionKind::Auto => "auto",
            VersionKind::BeforeRestore => "before-restore",
        }
    }

    fn keep(self) -> usize {
        match self {
            VersionKind::Saved => KEEP_SAVED,
            VersionKind::Auto => KEEP_AUTO,
            VersionKind::BeforeRestore => KEEP_BEFORE_RESTORE,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VersionInfo {
    pub id: String,
    /// Milliseconds since the Unix epoch.
    pub time_ms: u64,
    pub kind: VersionKind,
    pub title: String,
    pub pages: usize,
    /// Compressed size on disk.
    pub bytes: u64,
    /// Hash of the project's JSON, to skip versions that change nothing.
    pub hash: String,
}

#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Index {
    /// The project file this folder belongs to (for people looking in).
    path: Option<String>,
    versions: Vec<VersionInfo>,
}

/// A project kept by autosave that may not have been saved to its file.
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Recovery {
    /// The project's file, or none for a project never saved.
    pub path: Option<String>,
    pub time_ms: u64,
    /// The project as the app wrote it (kept as it is).
    pub project: Box<RawValue>,
    /// What the check found wrong with it: kept anyway, so the work is not
    /// lost, for the app to mend when it is brought back.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub problems: Vec<String>,
}

impl Recovery {
    /// The kept project, parsed.
    pub fn parsed(&self) -> Result<Project, ProjectError> {
        serde_json::from_str(self.project.get()).map_err(ProjectError::Json)
    }
}

/// The folder name for a project file: case-insensitive on Windows paths,
/// so `C:\A\x.namestudio` and `c:\a\X.namestudio` share their history.
pub fn project_key(path: Option<&Path>) -> String {
    let Some(path) = path else {
        return UNTITLED.to_owned();
    };
    let text = path.to_string_lossy().replace('/', "\\").to_lowercase();
    // The file name without its extension, read the same way on any system.
    let original = path.to_string_lossy();
    let name = original.rsplit(['/', '\\']).next().unwrap_or_default();
    let stem = name.rsplit_once('.').map_or(name, |(stem, _)| stem);
    let stem: String = stem
        .chars()
        .filter(|c| !matches!(c, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*') && !c.is_control())
        .take(40)
        .collect();
    format!("{stem}-{:016x}", fnv1a(text.as_bytes()))
}

fn fnv1a(bytes: &[u8]) -> u64 {
    bytes.iter().fold(0xcbf2_9ce4_8422_2325, |hash, &byte| {
        (hash ^ u64::from(byte)).wrapping_mul(0x0100_0000_01b3)
    })
}

/// The versions of one project.
#[derive(Debug, Clone)]
pub struct VersionStore {
    dir: PathBuf,
    path: Option<String>,
}

impl VersionStore {
    pub fn open(root: &Path, path: Option<&Path>) -> Self {
        VersionStore {
            dir: root.join("versions").join(project_key(path)),
            path: path.map(|path| path.display().to_string()),
        }
    }

    pub fn dir(&self) -> &Path {
        &self.dir
    }

    fn index_path(&self) -> PathBuf {
        self.dir.join("index.json")
    }

    fn read_index(&self) -> Result<Index, ProjectError> {
        match std::fs::read_to_string(self.index_path()) {
            Ok(text) => serde_json::from_str(&text).map_err(ProjectError::Json),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(Index::default()),
            Err(error) => Err(ProjectError::Io(error)),
        }
    }

    fn write_index(&self, index: &Index) -> Result<(), ProjectError> {
        let text = serde_json::to_string_pretty(index).map_err(ProjectError::Json)?;
        write_atomic(&self.index_path(), text.as_bytes())
    }

    /// The versions, newest first.
    pub fn list(&self) -> Result<Vec<VersionInfo>, ProjectError> {
        let mut versions = self.read_index()?.versions;
        versions.reverse();
        Ok(versions)
    }

    /// Keep `project` as a version, unless it is the same as the newest one.
    pub fn record(
        &self,
        project: &Project,
        kind: VersionKind,
        time_ms: u64,
    ) -> Result<Option<VersionInfo>, ProjectError> {
        self.record_text(&project.to_json()?, project, kind, time_ms)
    }

    /// Keep `json` (the text of `project`, as the app wrote it) as a version,
    /// unless it is the same as the newest one.
    pub fn record_text(
        &self,
        json: &str,
        project: &Project,
        kind: VersionKind,
        time_ms: u64,
    ) -> Result<Option<VersionInfo>, ProjectError> {
        let hash = format!("{:016x}", fnv1a(json.as_bytes()));
        let mut index = self.read_index()?;
        if index.versions.last().is_some_and(|newest| newest.hash == hash) {
            return Ok(None);
        }
        std::fs::create_dir_all(&self.dir).map_err(ProjectError::Io)?;
        // Two versions in the same millisecond get different names.
        let mut time = time_ms.max(index.versions.last().map_or(0, |newest| newest.time_ms + 1));
        let mut id = version_id(time, kind);
        while self.dir.join(&id).exists() {
            time += 1;
            id = version_id(time, kind);
        }
        let mut encoder = GzEncoder::new(Vec::new(), Compression::default());
        encoder.write_all(json.as_bytes()).map_err(ProjectError::Io)?;
        let compressed = encoder.finish().map_err(ProjectError::Io)?;
        write_atomic(&self.dir.join(&id), &compressed)?;
        let info = VersionInfo {
            id,
            time_ms: time,
            kind,
            title: project.title.clone(),
            pages: project.pages.len(),
            bytes: compressed.len() as u64,
            hash,
        };
        index.path = self.path.clone().or(index.path);
        index.versions.push(info.clone());
        self.prune(&mut index, kind);
        self.write_index(&index)?;
        Ok(Some(info))
    }

    /// An autosave version, at most one per `interval_ms` (saved versions count).
    pub fn record_auto(
        &self,
        project: &Project,
        time_ms: u64,
        interval_ms: u64,
    ) -> Result<Option<VersionInfo>, ProjectError> {
        self.record_auto_text(&project.to_json()?, project, time_ms, interval_ms)
    }

    /// [`VersionStore::record_auto`] for the text the app wrote.
    pub fn record_auto_text(
        &self,
        json: &str,
        project: &Project,
        time_ms: u64,
        interval_ms: u64,
    ) -> Result<Option<VersionInfo>, ProjectError> {
        let index = self.read_index()?;
        if index
            .versions
            .last()
            .is_some_and(|newest| time_ms < newest.time_ms + interval_ms)
        {
            return Ok(None);
        }
        self.record_text(json, project, VersionKind::Auto, time_ms)
    }

    fn prune(&self, index: &mut Index, kind: VersionKind) {
        let count = index.versions.iter().filter(|v| v.kind == kind).count();
        let mut excess = count.saturating_sub(kind.keep());
        index.versions.retain(|version| {
            if excess > 0 && version.kind == kind {
                excess -= 1;
                let _ = std::fs::remove_file(self.dir.join(&version.id));
                false
            } else {
                true
            }
        });
        self.keep_within(index, KEEP_BYTES);
    }

    /// A drawn name makes large versions: past `budget` bytes on disk the
    /// oldest go, autosaved ones before saved ones, but the newest
    /// [`KEEP_SAVED_ALWAYS`] saved versions always stay.
    fn keep_within(&self, index: &mut Index, budget: u64) {
        let mut total: u64 = index.versions.iter().map(|v| v.bytes).sum();
        if total <= budget {
            return;
        }
        let saved = index.versions.iter().filter(|v| v.kind == VersionKind::Saved).count();
        let protected: Vec<String> = index
            .versions
            .iter()
            .filter(|v| v.kind == VersionKind::Saved)
            .skip(saved.saturating_sub(KEEP_SAVED_ALWAYS))
            .map(|v| v.id.clone())
            .collect();
        let newest = index.versions.last().map(|v| v.id.clone());
        let order: Vec<String> = index
            .versions
            .iter()
            .filter(|v| v.kind != VersionKind::Saved)
            .chain(index.versions.iter().filter(|v| v.kind == VersionKind::Saved))
            .map(|v| v.id.clone())
            .collect();
        let mut removed = std::collections::HashSet::new();
        for id in order {
            if total <= budget {
                break;
            }
            if protected.contains(&id) || newest.as_ref() == Some(&id) {
                continue;
            }
            if let Some(version) = index.versions.iter().find(|v| v.id == id) {
                total -= version.bytes;
                let _ = std::fs::remove_file(self.dir.join(&version.id));
                removed.insert(id);
            }
        }
        index.versions.retain(|v| !removed.contains(&v.id));
    }

    pub fn load(&self, id: &str) -> Result<Project, ProjectError> {
        Project::from_json(&self.load_text(id)?)
    }

    /// The text of a version, checked like a loaded file.
    pub fn load_text(&self, id: &str) -> Result<String, ProjectError> {
        if id.contains(['/', '\\']) || id.starts_with('.') {
            return Err(ProjectError::Invalid(vec![format!("版の名前が正しくありません: {id}")]));
        }
        let file = std::fs::File::open(self.dir.join(id)).map_err(ProjectError::Io)?;
        let mut json = String::new();
        GzDecoder::new(file)
            .read_to_string(&mut json)
            .map_err(ProjectError::Io)?;
        Project::from_json(&json)?;
        Ok(json)
    }

    /// Move the history of a project that had no file to the file it was
    /// first saved as; nothing happens when that file already has a history.
    pub fn adopt(root: &Path, from: Option<&Path>, to: &Path) -> Result<VersionStore, ProjectError> {
        let target = VersionStore::open(root, Some(to));
        let source = VersionStore::open(root, from);
        if source.dir != target.dir && source.dir.is_dir() && !target.dir.exists() {
            std::fs::rename(&source.dir, &target.dir).map_err(ProjectError::Io)?;
            let mut index = target.read_index()?;
            index.path = target.path.clone();
            target.write_index(&index)?;
        }
        Ok(target)
    }
}

fn version_id(time_ms: u64, kind: VersionKind) -> String {
    format!("{time_ms:013}-{}.json.gz", kind.file_tag())
}

fn recovery_path(root: &Path, path: Option<&Path>) -> PathBuf {
    root.join("recovery").join(format!("{}.json", project_key(path)))
}

/// Keep `project` so it can be brought back if the app stops before it is saved.
pub fn write_recovery(root: &Path, path: Option<&Path>, project: &Project, time_ms: u64) -> Result<(), ProjectError> {
    let text = serde_json::to_string(project).map_err(ProjectError::Json)?;
    write_recovery_text(root, path, &text, time_ms).map(|_| ())
}

/// Keep the project text the app wrote so it can be brought back. It is kept
/// even when the check finds problems (they are noted with it, and returned):
/// a copy that needs mending is better than work lost. Text that is not a
/// project at all is refused.
pub fn write_recovery_text(
    root: &Path,
    path: Option<&Path>,
    text: &str,
    time_ms: u64,
) -> Result<Vec<String>, ProjectError> {
    let project: Project = serde_json::from_str(text).map_err(ProjectError::Json)?;
    let problems = crate::validate(&project);
    let recovery = Recovery {
        path: path.map(|path| path.display().to_string()),
        time_ms,
        project: RawValue::from_string(text.to_owned()).map_err(ProjectError::Json)?,
        problems: problems.clone(),
    };
    let text = serde_json::to_string(&recovery).map_err(ProjectError::Json)?;
    let file = recovery_path(root, path);
    std::fs::create_dir_all(file.parent().expect("recovery folder")).map_err(ProjectError::Io)?;
    write_atomic(&file, text.as_bytes())?;
    Ok(problems)
}

pub fn clear_recovery(root: &Path, path: Option<&Path>) -> Result<(), ProjectError> {
    match std::fs::remove_file(recovery_path(root, path)) {
        Err(error) if error.kind() != std::io::ErrorKind::NotFound => Err(ProjectError::Io(error)),
        _ => Ok(()),
    }
}

/// A file in the recovery folder as the start offers it: a project to bring
/// back, or one that cannot be read, shown all the same (with why) so that
/// work is never dropped without a word.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KeptRecovery {
    /// Its name in the recovery folder: what removing it names.
    pub file: String,
    /// When autosave wrote it (the file's own time when it cannot be read).
    pub time_ms: u64,
    pub recovery: Option<Recovery>,
    /// Fields a newer version added that this one does not show (kept on saving).
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub unknown_fields: Vec<String>,
    /// Why it cannot be brought back (damaged, or a choice a newer version added).
    pub unreadable: Option<String>,
}

/// Every project kept by autosave and not saved since, newest first, the
/// ones that cannot be read included.
pub fn kept_recoveries(root: &Path) -> Vec<KeptRecovery> {
    let Ok(entries) = std::fs::read_dir(root.join("recovery")) else {
        return Vec::new();
    };
    let mut found: Vec<KeptRecovery> = entries
        .flatten()
        .filter(|entry| entry.path().extension().is_some_and(|extension| extension == "json"))
        .map(|entry| kept(&entry.path()))
        .collect();
    found.sort_by_key(|kept| std::cmp::Reverse(kept.time_ms));
    found
}

fn kept(file: &Path) -> KeptRecovery {
    let name = file
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default();
    let modified = std::fs::metadata(file)
        .and_then(|meta| meta.modified())
        .ok()
        .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
        .map_or(0, |time| time.as_millis() as u64);
    let unreadable = |why: String| KeptRecovery {
        file: name.clone(),
        time_ms: modified,
        recovery: None,
        unknown_fields: Vec::new(),
        unreadable: Some(why),
    };
    let text = match std::fs::read_to_string(file) {
        Ok(text) => text,
        Err(error) => return unreadable(ProjectError::Io(error).to_string()),
    };
    let recovery = match serde_json::from_str::<Recovery>(&text) {
        Ok(recovery) => recovery,
        Err(error) => return unreadable(format!("控えのファイルが壊れています: {error}")),
    };
    if let Err(error) = recovery.parsed() {
        return KeptRecovery {
            time_ms: recovery.time_ms,
            ..unreadable(error.to_string())
        };
    }
    KeptRecovery {
        file: name.clone(),
        time_ms: recovery.time_ms,
        unknown_fields: Project::unknown_fields(recovery.project.get()).unwrap_or_default(),
        recovery: Some(recovery),
        unreadable: None,
    }
}

/// Removes one file of the recovery folder, named as `kept_recoveries` lists
/// it; nothing outside that folder can be named.
pub fn remove_recovery(root: &Path, file: &str) -> Result<(), ProjectError> {
    let plain = !file.is_empty() && !file.contains(['/', '\\']) && file != ".." && file.ends_with(".json");
    if !plain {
        return Err(ProjectError::Invalid(vec![format!(
            "控えのファイル名が正しくありません: {file}"
        )]));
    }
    match std::fs::remove_file(root.join("recovery").join(file)) {
        Err(error) if error.kind() != std::io::ErrorKind::NotFound => Err(ProjectError::Io(error)),
        _ => Ok(()),
    }
}

fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), ProjectError> {
    crate::atomic::write(path, bytes).map_err(ProjectError::Io)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn project(title: &str, pages: usize) -> Project {
        let mut project = Project::new(title);
        for _ in 0..pages {
            let id = project.new_id("page");
            project.pages.push(crate::Page {
                id,
                ..crate::Page::default()
            });
        }
        project
    }

    #[test]
    fn keys_ignore_case_and_slashes() {
        let a = project_key(Some(Path::new(r"C:\Work\第4話.namestudio")));
        let b = project_key(Some(Path::new("c:/work/第4話.NAMESTUDIO")));
        assert_eq!(a.rsplit('-').next(), b.rsplit('-').next());
        assert!(a.starts_with("第4話-"));
        assert_eq!(project_key(None), UNTITLED);
    }

    #[test]
    fn records_lists_and_loads_versions() {
        let root = tempfile::tempdir().unwrap();
        let store = VersionStore::open(root.path(), Some(Path::new("a.namestudio")));
        assert!(store.list().unwrap().is_empty());
        let first = store
            .record(&project("一", 2), VersionKind::Saved, 1_000)
            .unwrap()
            .unwrap();
        // The same content again is not a new version.
        assert!(
            store
                .record(&project("一", 2), VersionKind::Auto, 2_000)
                .unwrap()
                .is_none()
        );
        let second = store
            .record(&project("二", 3), VersionKind::Auto, 3_000)
            .unwrap()
            .unwrap();
        let listed = store.list().unwrap();
        assert_eq!(listed, vec![second.clone(), first.clone()]);
        assert_eq!(listed[0].pages, 3);
        assert_eq!(store.load(&first.id).unwrap().title, "一");
        assert!(store.load("../index.json").is_err());
    }

    #[test]
    fn autosave_versions_are_spaced() {
        let root = tempfile::tempdir().unwrap();
        let store = VersionStore::open(root.path(), None);
        assert!(store.record_auto(&project("a", 1), 0, 300_000).unwrap().is_some());
        assert!(store.record_auto(&project("b", 1), 299_999, 300_000).unwrap().is_none());
        assert!(store.record_auto(&project("c", 1), 300_000, 300_000).unwrap().is_some());
    }

    #[test]
    fn old_versions_of_a_kind_are_removed() {
        let root = tempfile::tempdir().unwrap();
        let store = VersionStore::open(root.path(), None);
        store.record(&project("saved", 1), VersionKind::Saved, 0).unwrap();
        for i in 0..KEEP_AUTO + 5 {
            store
                .record(&project(&format!("auto {i}"), 1), VersionKind::Auto, 10 + i as u64)
                .unwrap();
        }
        let listed = store.list().unwrap();
        assert_eq!(listed.iter().filter(|v| v.kind == VersionKind::Auto).count(), KEEP_AUTO);
        assert_eq!(listed.last().unwrap().kind, VersionKind::Saved);
        assert_eq!(listed[0].title, format!("auto {}", KEEP_AUTO + 4));
        let files = std::fs::read_dir(store.dir()).unwrap().count();
        assert_eq!(files, KEEP_AUTO + 1 + 1); // versions + index
    }

    #[test]
    fn large_versions_stay_within_the_budget() {
        let root = tempfile::tempdir().unwrap();
        let store = VersionStore::open(root.path(), None);
        for i in 0..14 {
            store
                .record(&project(&format!("saved {i}"), 1), VersionKind::Saved, i)
                .unwrap();
            store
                .record(&project(&format!("auto {i}"), 1), VersionKind::Auto, 100 + i)
                .unwrap();
        }
        let mut index = store.read_index().unwrap();
        let per = index.versions[0].bytes;
        store.keep_within(&mut index, per * 12);
        let saved: Vec<&VersionInfo> = index.versions.iter().filter(|v| v.kind == VersionKind::Saved).collect();
        // Autosaved ones go first (the newest version stays), then the oldest saved ones.
        assert!(index.versions.iter().filter(|v| v.kind == VersionKind::Auto).count() <= 1);
        assert!(saved.len() >= KEEP_SAVED_ALWAYS);
        assert_eq!(saved.last().unwrap().title, "saved 13");
        assert!(index.versions.iter().map(|v| v.bytes).sum::<u64>() <= per * 12 + per / 2);
        // Over the budget, the newest saved ones still stay.
        store.keep_within(&mut index, 0);
        assert_eq!(
            index.versions.iter().filter(|v| v.kind == VersionKind::Saved).count(),
            KEEP_SAVED_ALWAYS
        );
        assert_eq!(
            std::fs::read_dir(store.dir()).unwrap().count(),
            index.versions.len() + 1
        );
    }

    #[test]
    fn adopt_moves_untitled_history() {
        let root = tempfile::tempdir().unwrap();
        let untitled = VersionStore::open(root.path(), None);
        untitled.record(&project("a", 1), VersionKind::Auto, 5).unwrap();
        let saved = VersionStore::adopt(root.path(), None, Path::new("x.namestudio")).unwrap();
        assert_eq!(saved.list().unwrap().len(), 1);
        assert!(!untitled.dir().exists());
    }

    #[test]
    fn recovery_round_trip() {
        let root = tempfile::tempdir().unwrap();
        assert!(kept_recoveries(root.path()).is_empty());
        write_recovery(root.path(), None, &project("白紙", 4), 10).unwrap();
        let path = Path::new("b.namestudio");
        write_recovery(root.path(), Some(path), &project("保存済み", 1), 20).unwrap();
        let found = kept_recoveries(root.path());
        assert_eq!(found.len(), 2);
        let newest = found[0].recovery.as_ref().unwrap();
        assert_eq!(newest.parsed().unwrap().title, "保存済み");
        assert_eq!(newest.path.as_deref(), Some("b.namestudio"));
        assert_eq!(found[1].time_ms, 10);
        clear_recovery(root.path(), Some(path)).unwrap();
        clear_recovery(root.path(), Some(path)).unwrap();
        assert_eq!(kept_recoveries(root.path()).len(), 1);
    }

    #[test]
    fn recoveries_that_cannot_be_read_are_listed_with_why() {
        let root = tempfile::tempdir().unwrap();
        write_recovery(root.path(), Some(Path::new("a.namestudio")), &project("読める", 2), 30).unwrap();
        let folder = root.path().join("recovery");
        // Cut off half way (a disk that filled up), and one with a choice a newer version added.
        std::fs::write(
            folder.join("cut-0000000000000001.json"),
            r#"{"path":"c.namestudio","timeMs":5,"proj"#,
        )
        .unwrap();
        let mut newer = serde_json::to_value(project("新しい", 1)).unwrap();
        newer["binding"] = serde_json::json!("top");
        let newer = format!(r#"{{"path":"n.namestudio","timeMs":40,"project":{newer}}}"#);
        std::fs::write(folder.join("newer-0000000000000002.json"), newer).unwrap();
        // A field a newer version added: it can be brought back, and it says so.
        let mut wobble = serde_json::to_value(project("項目つき", 1)).unwrap();
        wobble["wobble"] = serde_json::json!(1);
        std::fs::write(
            folder.join("wobble-0000000000000003.json"),
            format!(r#"{{"path":null,"timeMs":20,"project":{wobble}}}"#),
        )
        .unwrap();

        let found = kept_recoveries(root.path());
        let by_file = |name: &str| found.iter().find(|kept| kept.file.starts_with(name)).unwrap();
        assert_eq!(found.len(), 4);
        assert!(
            by_file("cut").recovery.is_none()
                && by_file("cut")
                    .unreadable
                    .as_deref()
                    .unwrap()
                    .starts_with("控えのファイルが壊れています")
        );
        let newer = by_file("newer");
        assert!(newer.recovery.is_none() && newer.time_ms == 40, "{newer:?}");
        assert!(
            newer
                .unreadable
                .as_deref()
                .unwrap()
                .starts_with("新しい版のツールで足された選択肢"),
            "{newer:?}"
        );
        assert_eq!(by_file("wobble").unknown_fields, ["wobble"]);
        assert!(by_file("wobble").recovery.is_some() && by_file("a-").unknown_fields.is_empty());
        // Newest first: the cut one by its file's time (now), then by when autosave wrote them.
        let order: Vec<&str> = found.iter().map(|kept| kept.file.split('-').next().unwrap()).collect();
        assert_eq!(order, ["cut", "newer", "a", "wobble"]);

        remove_recovery(root.path(), &by_file("cut").file).unwrap();
        assert_eq!(kept_recoveries(root.path()).len(), 3);
        for outside in ["../x.json", "..\\x.json", "", "a.namestudio", "sub/x.json"] {
            assert!(remove_recovery(root.path(), outside).is_err(), "{outside}");
        }
    }
}
