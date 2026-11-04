//! ネームデータ（正本）: the project file of the name tool.
//!
//! A project holds pages with panels, lines (セリフ) and rough strokes, plus
//! story structure (scenes, characters, emotion values) for the overview
//! views. CSP files are imported from and exported to; this is the source of
//! truth.

pub mod atomic;
pub mod model;
pub mod pdf;
pub mod series;
pub mod validate;
pub mod versions;

use std::path::Path;

pub use model::*;
pub use series::{SERIES_EXTENSION, SERIES_VERSION, Series, SeriesEpisode, SeriesShared};
pub use validate::validate;

/// File extension of project files.
pub const EXTENSION: &str = "namestudio";

/// Errors while loading or saving a project file.
#[derive(Debug)]
pub enum ProjectError {
    Io(std::io::Error),
    Json(serde_json::Error),
    Invalid(Vec<String>),
}

impl std::fmt::Display for ProjectError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            // Said in words: the start screen shows it on the name's row.
            ProjectError::Io(error) if error.kind() == std::io::ErrorKind::NotFound => {
                write!(
                    f,
                    "ファイルが見つかりません。移したか消したか、外付けのドライブがつながっていないようです（{error}）"
                )
            }
            ProjectError::Io(error) if error.kind() == std::io::ErrorKind::PermissionDenied => {
                write!(f, "ファイルを読む権限がありません（{error}）")
            }
            ProjectError::Io(error) => write!(f, "{error}"),
            // A choice a newer version added (a new kind of balloon, say) cannot be read here.
            ProjectError::Json(error) if error.to_string().starts_with("unknown variant") => write!(
                f,
                "新しい版のツールで足された選択肢があるため開けません。設定の「更新」から新しい版にしてください（{error}）"
            ),
            ProjectError::Json(error) => write!(f, "ファイルの形式が正しくありません: {error}"),
            ProjectError::Invalid(problems) => write!(f, "{}", problems.join(" / ")),
        }
    }
}

impl std::error::Error for ProjectError {}

impl Project {
    pub fn from_json(text: &str) -> Result<Self, ProjectError> {
        let project: Project = serde_json::from_str(text).map_err(ProjectError::Json)?;
        let problems = validate(&project);
        if problems.is_empty() {
            Ok(project)
        } else {
            Err(ProjectError::Invalid(problems))
        }
    }

    pub fn to_json(&self) -> Result<String, ProjectError> {
        let problems = validate(self);
        if !problems.is_empty() {
            return Err(ProjectError::Invalid(problems));
        }
        serde_json::to_string(self).map_err(ProjectError::Json)
    }

    pub fn load(path: impl AsRef<Path>) -> Result<Self, ProjectError> {
        Self::from_json(&std::fs::read_to_string(path).map_err(ProjectError::Io)?)
    }

    /// The text of a project file, checked like [`Project::load`] but kept as
    /// it is: fields this side does not know (added by the app) stay.
    pub fn load_text(path: impl AsRef<Path>) -> Result<String, ProjectError> {
        let text = std::fs::read_to_string(path).map_err(ProjectError::Io)?;
        Self::from_json(&text)?;
        Ok(text)
    }

    /// [`Project::load_text`], with the name sheet the project was taken from
    /// ([`SourceSheet`]) found again when the two were moved together: when
    /// the sheet is not where the project says but a file of its name lies
    /// beside the project file, the text points there (and is saved so).
    pub fn load_text_finding_source(path: impl AsRef<Path>) -> Result<String, ProjectError> {
        let path = path.as_ref();
        let text = Self::load_text(path)?;
        let mut value: serde_json::Value = serde_json::from_str(&text).map_err(ProjectError::Json)?;
        let Some(found) = value
            .pointer("/source/path")
            .and_then(|source| source.as_str())
            .and_then(|source| moved_source(path, source))
        else {
            return Ok(text);
        };
        value["source"]["path"] = found.to_string_lossy().into_owned().into();
        serde_json::to_string(&value).map_err(ProjectError::Json)
    }

    /// The fields of a project's text this version does not know, each once
    /// and without list positions (`pages.strokes.mark`): parts a newer
    /// version added. The app saves the text as it holds it, so they are
    /// kept, but this version neither shows nor writes them out.
    pub fn unknown_fields(text: &str) -> Result<Vec<String>, ProjectError> {
        let mut found = std::collections::BTreeSet::new();
        let mut deserializer = serde_json::Deserializer::from_str(text);
        serde_ignored::deserialize::<_, _, Project>(&mut deserializer, |path| {
            found.insert(field_path(&path));
        })
        .map_err(ProjectError::Json)?;
        Ok(found.into_iter().collect())
    }

    /// Save `text` (the project as the app wrote it) after checking it like a
    /// loaded file; nothing is written when it has problems. The parsed project
    /// is returned for its title and pages.
    pub fn save_text(path: impl AsRef<Path>, text: &str) -> Result<Self, ProjectError> {
        let project = Self::from_json(text)?;
        write_through_temporary(path.as_ref(), text)?;
        Ok(project)
    }

    /// Save whole or not at all ([`atomic`]): a crash never leaves half a project.
    pub fn save(&self, path: impl AsRef<Path>) -> Result<(), ProjectError> {
        let path = path.as_ref();
        write_through_temporary(path, &self.to_json()?)
    }
}

/// `pages.?.strokes.?.mark` as `pages.strokes.mark`: the field, wherever in a list.
/// Where a name sheet now is, when it is not at `source` (written on this or
/// another computer) but a file of the same name lies beside the project
/// file `project`; None when it is where it was, or nowhere to be found.
pub fn moved_source(project: &Path, source: &str) -> Option<std::path::PathBuf> {
    if Path::new(source).is_file() {
        return None;
    }
    let name = source.rsplit(['/', '\\']).next().filter(|name| !name.is_empty())?;
    let beside = project.parent()?.join(name);
    beside.is_file().then_some(beside)
}

fn field_path(path: &serde_ignored::Path) -> String {
    let mut parts = Vec::new();
    let mut at = Some(path);
    while let Some(part) = at {
        at = match part {
            serde_ignored::Path::Root => None,
            serde_ignored::Path::Seq { parent, .. }
            | serde_ignored::Path::Some { parent }
            | serde_ignored::Path::NewtypeStruct { parent }
            | serde_ignored::Path::NewtypeVariant { parent } => Some(*parent),
            serde_ignored::Path::Map { parent, key } => {
                parts.push(key.as_str());
                Some(*parent)
            }
        };
    }
    parts.reverse();
    parts.join(".")
}

pub(crate) fn write_through_temporary(path: &Path, text: &str) -> Result<(), ProjectError> {
    atomic::write(path, text.as_bytes()).map_err(ProjectError::Io)
}
