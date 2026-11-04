//! シリーズ: several names (話) of one work that share their characters,
//! brushes, fonts, look and CSP page settings. The series file holds what is
//! shared and the list of its names; each name keeps a copy of the shared
//! parts too, so it still opens on its own.

use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::{
    Brush, Character, CspPage, Gutters, LineFonts, LineShapes, NameStyle, ProjectError, RoughLayer,
    write_through_temporary,
};

/// File extension of series files.
pub const SERIES_EXTENSION: &str = "nameseries";
/// The newest series format this side reads.
pub const SERIES_VERSION: u32 = 1;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(optional_fields))]
#[serde(rename_all = "camelCase")]
pub struct Series {
    pub format_version: u32,
    pub title: String,
    #[serde(default)]
    pub author: String,
    /// The names of the series, in story order.
    #[serde(default)]
    pub episodes: Vec<SeriesEpisode>,
    pub shared: SeriesShared,
}

/// A name of the series as last saved.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(optional_fields))]
#[serde(rename_all = "camelCase")]
pub struct SeriesEpisode {
    /// The name's file, from the series file's folder (`/` between folders).
    pub path: String,
    pub title: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub story_index: Option<u32>,
    #[serde(default)]
    pub pages: u32,
}

/// What every name of the series shares (the same fields as in a project).
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(optional_fields))]
#[serde(rename_all = "camelCase")]
pub struct SeriesShared {
    #[serde(default)]
    pub characters: Vec<Character>,
    #[serde(default)]
    pub brushes: Vec<Brush>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fonts: Option<LineFonts>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub style: Option<NameStyle>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub csp_page: Option<CspPage>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub line_shapes: Option<LineShapes>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub gutters: Option<Gutters>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub rough_layers: Vec<RoughLayer>,
}

/// A path from the series' folder, on any system: no root ("/x", "\\x") and no drive ("C:x").
fn is_relative(path: &str) -> bool {
    !(path.starts_with(['/', '\\']) || path.as_bytes().get(1) == Some(&b':') || Path::new(path).has_root())
}

impl Series {
    pub fn from_json(text: &str) -> Result<Self, ProjectError> {
        let series: Series = serde_json::from_str(text).map_err(ProjectError::Json)?;
        let mut problems = Vec::new();
        if series.format_version > SERIES_VERSION {
            problems.push(format!(
                "新しい版のシリーズです（形式 {}）。アプリを更新してください",
                series.format_version
            ));
        }
        for episode in &series.episodes {
            if episode.path.trim().is_empty() || !is_relative(&episode.path) {
                problems.push(format!("話「{}」のファイルの場所が正しくありません", episode.title));
            }
        }
        if problems.is_empty() {
            Ok(series)
        } else {
            Err(ProjectError::Invalid(problems))
        }
    }

    /// The text of a series file, checked but kept as it is.
    pub fn load_text(path: impl AsRef<Path>) -> Result<String, ProjectError> {
        let text = std::fs::read_to_string(path).map_err(ProjectError::Io)?;
        Self::from_json(&text)?;
        Ok(text)
    }

    /// Save `text` (as the app wrote it) after checking it; nothing is written when it has problems.
    pub fn save_text(path: impl AsRef<Path>, text: &str) -> Result<Self, ProjectError> {
        let series = Self::from_json(text)?;
        write_through_temporary(path.as_ref(), text)?;
        Ok(series)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn refuses_a_newer_series_and_names_outside_it() {
        let text = |version: u32, path: &str| {
            format!(
                r#"{{"formatVersion":{version},"title":"t","episodes":[{{"path":"{path}","title":"1話","pages":3}}],"shared":{{}}}}"#
            )
        };
        assert!(Series::from_json(&text(1, "1話.namestudio")).is_ok());
        assert!(Series::from_json(&text(2, "1話.namestudio")).is_err());
        assert!(Series::from_json(&text(1, "/abs/1話.namestudio")).is_err());
        assert!(Series::from_json(&text(1, "C:/abs/1話.namestudio")).is_err());
    }

    #[test]
    fn saves_through_a_temporary_file() {
        let folder = tempfile::tempdir().unwrap();
        let path = folder.path().join("作品.nameseries");
        let text =
            r#"{"formatVersion":1,"title":"作品","episodes":[],"shared":{"characters":[{"id":"c1","name":"ミナ"}]}}"#;
        let series = Series::save_text(&path, text).unwrap();
        assert_eq!(series.shared.characters[0].name, "ミナ");
        assert_eq!(Series::load_text(&path).unwrap(), text);
        assert!(Series::save_text(&path, "{").is_err());
        assert_eq!(std::fs::read_to_string(&path).unwrap(), text);
    }
}
