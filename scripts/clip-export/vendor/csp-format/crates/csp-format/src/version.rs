//! Which CSP version saved a file, and what older versions will make of it.
//!
//! CSP writes no version number of its own (`Project.ProjectInternalVersion`
//! is "1.1.0" in every file from 2017 to 2026). What changes is the schema
//! registry: each CSP release registers every column it knows in
//! `ParamScheme`, and labels a file has are never removed. So the registered
//! labels tell the newest CSP generation that saved the file.
//!
//! How an older file shows that a newer CSP saved it again depends on the
//! saver: CSP up to 2.x (and .cmc saves up to 4.2) appended the new labels
//! after the old rows, while CSP 3.0 and newer rewrite a .clip's registry in
//! their own order, keeping labels they retired (CSP 5.1.4 was seen doing
//! this). Appended blocks and retired labels both mark a resaved file.
//!
//! Since 1.12 CSP marks its own file format level with `Layer.Has1_0_N`
//! columns (N = 6 … 19 so far). They are registered with lock type 4 and
//! lock scope 2 (the canvas): a CSP that meets a set column it does not know
//! locks that scope, or only the layer when the alternative lock (1, 0,
//! from `Has1_0_8` on) is registered. Without the alternative it locks the
//! whole canvas, unless the file carries version compatibility information
//! (Preferences > File > Version compatibility, since 1.13.0).
//!
//! The generation table and the CSP versions are learnt from the corpus and
//! CSP's release notes; see `docs/spec/09-versions.md`.

use std::collections::{BTreeSet, HashSet};

use rusqlite::Connection;

use crate::database::{has_column, quote};
use crate::error::Result;
use crate::schema::Schema;

/// A group of CSP releases that register the same new columns.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
pub struct Generation {
    /// CSP versions estimated for this generation (from release notes and
    /// the earliest saves in the corpus).
    pub csp: &'static str,
    /// Month of the earliest file of this generation in the corpus.
    pub first_seen: &'static str,
    /// Labels (`table`, `column`) first registered by this generation.
    pub markers: &'static [(&'static str, &'static str)],
}

/// Known generations, newest first. A file belongs to the first one whose
/// markers are all registered; files without any marker are older than all.
pub const GENERATIONS: &[Generation] = &[
    Generation {
        csp: "5.1",
        first_seen: "2026-10",
        markers: &[("Layer", "Has1_0_19"), ("BrushStyle", "WaterEdgeStyle")],
    },
    Generation { csp: "5.0", first_seen: "2026-05", markers: &[("Layer", "Has1_0_18"), ("BrushStyle", "BlurKind")] },
    Generation { csp: "4.2", first_seen: "2025-12", markers: &[("Layer", "Has1_0_15"), ("Canvas", "TimeLapseCodec")] },
    Generation {
        csp: "3.0-4.1",
        first_seen: "2024-12",
        markers: &[("Layer", "Has1_0_12"), ("Canvas", "CanvasWorkTime")],
    },
    Generation {
        csp: "2.1-2.x",
        first_seen: "2024-01",
        markers: &[("Layer", "Has1_0_8"), ("BrushStyle", "BrushColorMixingMode")],
    },
    Generation { csp: "2.0", first_seen: "2023-04", markers: &[("Layer", "WebCooperationLayerEditable")] },
    Generation {
        csp: "1.12-1.13",
        first_seen: "2022-10",
        markers: &[("Layer", "Has1_0_7"), ("CameraNodeInfo", "CameraNodeUUID")],
    },
    Generation {
        csp: "1.11-1.12",
        first_seen: "2022-02",
        markers: &[("Layer", "HasPrimitive"), ("PrimitiveInfo", "PrimitiveUUID")],
    },
    Generation { csp: "1.10.10-1.11", first_seen: "2021-06", markers: &[("BrushStyle", "DualStyleIndex")] },
    Generation { csp: "1.10.5-1.10.9", first_seen: "2020-12", markers: &[("Canvas", "TimeLapseManagerIndex")] },
    Generation { csp: "1.8-1.10.3", first_seen: "2020-10", markers: &[("Layer", "TextLayerVersion")] },
];

/// Labels older CSP versions registered and newer ones no longer do, with the
/// first generation that stopped registering them. They stay in files made
/// before (saves never remove labels).
pub const RETIRED_LABELS: &[(&str, &str, &str)] = &[("CameraInfo", "CameraZoomWithDolly", "3.0-4.1")];

const KNOWN_SCHEME: &str = include_str!("data/param_scheme.tsv");

/// Labels only .cmc files register (the work settings in `Project`).
const CMC_LABELS: &[&str] = &[
    "ComicBindPosition",
    "ComicCoverExist",
    "ComicShowStyle",
    "ComicStartPage",
    "ComicWebtoonWrapDirection",
    "Cover1Prefix",
    "Cover1Suffix",
    "Cover4Prefix",
    "Cover4Suffix",
    "MaxCanvasFileIndex",
    "PrintingCompanyID",
    "SentencePrefix",
    "SentenceSuffix",
];

/// What a file tells about the CSP versions that saved it.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct VersionInfo {
    /// Newest generation whose labels are registered (the last saver, at least).
    pub saved_by: Option<Generation>,
    /// Generation of the first block of `ParamScheme` rows (the creator).
    /// `None` when that block has no marker, or when a CSP that rewrites the
    /// registry saved the file again (`resaved` and the creator is lost).
    pub created_by: Option<Generation>,
    /// Whether the file was made by an older CSP and saved again by a newer
    /// one: rows appended after the first block, or a label the saving
    /// generation no longer registers.
    pub resaved: bool,
    /// Highest N of the registered `Layer.Has1_0_N` columns (the format level
    /// of the saving CSP), if any.
    pub format_level: Option<u32>,
    /// Columns with lock type 4 and no link whose value is set in some row:
    /// a CSP that does not know such a column locks the scope its
    /// registration names (the canvas for scope 2), or the layer when the
    /// alternative lock is 1 (checked in CSP 5.1.4).
    pub locking_features: Vec<String>,
    /// Highest N among set `Has1_0_N` columns: CSP needs format level N or
    /// newer to edit the file without a lock.
    pub needs_format_level: Option<u32>,
    /// Registered labels this library does not know (a newer CSP).
    pub unknown_labels: Vec<String>,
    /// Whether `ParamScheme` has the `AlternativeLock*` columns (since 2.x).
    pub alternative_lock_columns: bool,
    /// `SQLITE_VERSION_NUMBER` of the library that last wrote the database.
    pub sqlite_version: Option<u32>,
}

impl VersionInfo {
    /// Read the version facts of an open database. `image` is the raw SQLite
    /// database (for the writer's SQLite version), when available.
    pub fn read(connection: &Connection, image: Option<&[u8]>) -> Result<Self> {
        let schema = Schema::read(connection)?;
        let labels: HashSet<(&str, &str)> =
            schema.params.iter().map(|param| (param.table.as_str(), param.column.as_str())).collect();
        let saved_by = generation_of(&labels);
        let blocks = registration_blocks(&schema);
        let first: HashSet<(&str, &str)> = blocks
            .first()
            .map(|block| {
                block.iter().map(|&i| (schema.params[i].table.as_str(), schema.params[i].column.as_str())).collect()
            })
            .unwrap_or_default();
        let mut created_by = generation_of(&first);
        let mut resaved = blocks.len() > 1;
        if retired_label_kept(&labels, saved_by) {
            resaved = true;
            if created_by == saved_by {
                created_by = None;
            }
        }
        let format_level =
            schema.params.iter().filter(|p| p.table == "Layer").filter_map(|p| has_level(&p.column)).max();

        let mut locking_features = Vec::new();
        let mut needs_format_level = None;
        for param in schema.params.iter().filter(|p| p.lock_type == 4 && p.flag == 0 && p.link_table.is_none()) {
            if !has_column(connection, &param.table, &param.column)? {
                continue;
            }
            let sql = format!(
                "SELECT COUNT(*) FROM {} WHERE {} IS NOT NULL AND {} != 0",
                quote(&param.table),
                quote(&param.column),
                quote(&param.column)
            );
            let set: i64 = connection.query_row(&sql, [], |row| row.get(0))?;
            if set > 0 {
                locking_features.push(format!("{}.{}", param.table, param.column));
                if let Some(level) = has_level(&param.column) {
                    needs_format_level = needs_format_level.max(Some(level));
                }
            }
        }

        let known = known_labels();
        let unknown_labels: BTreeSet<String> = schema
            .params
            .iter()
            .filter(|p| !known.contains(&(p.table.clone(), p.column.clone())))
            .filter(|p| !RETIRED_LABELS.iter().any(|&(t, c, _)| (t, c) == (p.table.as_str(), p.column.as_str())))
            .map(|p| format!("{}.{}", p.table, p.column))
            .collect();
        let alternative_lock_columns = has_column(connection, "ParamScheme", "AlternativeLockType")?;
        let sqlite_version = image
            .filter(|bytes| bytes.len() >= 100 && bytes.starts_with(b"SQLite format 3\0"))
            .map(|bytes| u32::from_be_bytes([bytes[96], bytes[97], bytes[98], bytes[99]]));
        Ok(VersionInfo {
            saved_by,
            created_by,
            resaved,
            format_level,
            locking_features,
            needs_format_level,
            unknown_labels: unknown_labels.into_iter().collect(),
            alternative_lock_columns,
            sqlite_version,
        })
    }
}

/// The newest generation whose markers are all in `labels`.
pub fn generation_of(labels: &HashSet<(&str, &str)>) -> Option<Generation> {
    GENERATIONS.iter().copied().find(|generation| generation.markers.iter().all(|marker| labels.contains(marker)))
}

/// Whether `labels` keep a label that `saved_by` (or an older generation it
/// descends from) had already retired: the file was made before.
fn retired_label_kept(labels: &HashSet<(&str, &str)>, saved_by: Option<Generation>) -> bool {
    let Some(saved_by) = saved_by else { return false };
    let age = |csp: &str| GENERATIONS.iter().position(|g| g.csp == csp);
    RETIRED_LABELS
        .iter()
        .any(|&(table, column, retired_in)| labels.contains(&(table, column)) && age(saved_by.csp) <= age(retired_in))
}

/// N of a `Has1_0_N` / `LayerEffectHas1_0_N` column.
fn has_level(column: &str) -> Option<u32> {
    let rest = column.strip_prefix("Has1_0_").or_else(|| column.strip_prefix("LayerEffectHas1_0_"))?;
    rest.parse().ok()
}

/// `ParamScheme` rows split where a table name comes back after other tables:
/// CSP writes the registry table by table, and a newer CSP appends the
/// labels it adds as a new run of tables.
fn registration_blocks(schema: &Schema) -> Vec<Vec<usize>> {
    let mut blocks: Vec<Vec<usize>> = vec![Vec::new()];
    let mut seen: HashSet<&str> = HashSet::new();
    let mut last: Option<&str> = None;
    for (index, param) in schema.params.iter().enumerate() {
        let table = param.table.as_str();
        if last != Some(table) {
            if seen.contains(table) {
                blocks.push(Vec::new());
                seen.clear();
            }
            seen.insert(table);
        }
        blocks.last_mut().expect("one block").push(index);
        last = Some(table);
    }
    blocks.retain(|block| !block.is_empty());
    blocks
}

/// The labels of the newest CSP this library was checked against.
fn known_labels() -> HashSet<(String, String)> {
    let mut known: HashSet<(String, String)> = KNOWN_SCHEME
        .lines()
        .filter_map(|line| {
            let mut fields = line.split('\t');
            Some((fields.next()?.to_owned(), fields.next()?.to_owned()))
        })
        .collect();
    known.extend(CMC_LABELS.iter().map(|label| ("Project".to_owned(), (*label).to_owned())));
    known
}

#[cfg(test)]
mod tests {
    use super::*;

    fn labels<'a>(items: &[(&'a str, &'a str)]) -> HashSet<(&'a str, &'a str)> {
        items.iter().copied().collect()
    }

    #[test]
    fn generation_needs_every_marker() {
        let only_level = labels(&[("Layer", "Has1_0_19")]);
        assert_eq!(generation_of(&only_level), None);
        let both = labels(&[("Layer", "Has1_0_19"), ("BrushStyle", "WaterEdgeStyle")]);
        assert_eq!(generation_of(&both).map(|g| g.csp), Some("5.1"));
        let older = labels(&[("Layer", "WebCooperationLayerEditable"), ("Canvas", "TimeLapseManagerIndex")]);
        assert_eq!(generation_of(&older).map(|g| g.csp), Some("2.0"));
    }

    #[test]
    fn has_levels() {
        assert_eq!(has_level("Has1_0_19"), Some(19));
        assert_eq!(has_level("LayerEffectHas1_0_19"), Some(19));
        assert_eq!(has_level("HasPrimitive"), None);
    }

    #[test]
    fn new_files_are_the_newest_generation() {
        let file = crate::ClipFile::create(&crate::NewCanvas { width: 16, height: 16, ..Default::default() }).unwrap();
        let info = file.version_info().unwrap();
        assert_eq!(info.saved_by.map(|g| g.csp), Some(GENERATIONS[0].csp));
        assert_eq!(info.created_by, info.saved_by);
        assert!(!info.resaved);
        assert_eq!(info.format_level, Some(19));
        assert!(info.locking_features.is_empty());
        assert!(info.unknown_labels.is_empty());
    }

    #[test]
    fn appended_rows_and_set_markers() {
        let file = crate::ClipFile::create(&crate::NewCanvas { width: 16, height: 16, ..Default::default() }).unwrap();
        let db = file.database();
        db.execute(
            "INSERT INTO ParamScheme(TableName, LabelName, DataType, Flag, OwnerType, LockType, LockSpecified, LinkTable) \
             VALUES ('Layer', 'Has1_0_20', 1, 0, 0, 4, 2, '')",
            [],
        )
        .unwrap();
        db.execute("ALTER TABLE Layer ADD COLUMN Has1_0_20 INTEGER DEFAULT NULL", []).unwrap();
        db.execute("UPDATE Layer SET Has1_0_20 = 1 WHERE MainId = (SELECT MAX(MainId) FROM Layer)", []).unwrap();
        let info = file.version_info().unwrap();
        assert!(info.resaved, "a Layer row after other tables starts a new block");
        assert_eq!(info.format_level, Some(20));
        assert_eq!(info.locking_features, vec!["Layer.Has1_0_20".to_owned()]);
        assert_eq!(info.needs_format_level, Some(20));
        assert_eq!(info.unknown_labels, vec!["Layer.Has1_0_20".to_owned()]);
    }

    #[test]
    fn retired_label_marks_a_rewritten_older_file() {
        let file = crate::ClipFile::create(&crate::NewCanvas { width: 16, height: 16, ..Default::default() }).unwrap();
        // As CSP 5.1.4 leaves a 2020 file it saved again: the retired label kept.
        file.database()
            .execute(
                "INSERT INTO ParamScheme(TableName, LabelName, DataType, Flag, OwnerType, LockType, LockSpecified, LinkTable) \
                 VALUES ('CameraInfo', 'CameraZoomWithDolly', 1, 0, 0, 0, 0, '')",
                [],
            )
            .unwrap();
        let info = file.version_info().unwrap();
        assert!(info.resaved);
        assert_eq!(info.created_by, None);
        assert!(info.unknown_labels.is_empty());

        let old = labels(&[
            ("Layer", "Has1_0_8"),
            ("BrushStyle", "BrushColorMixingMode"),
            ("CameraInfo", "CameraZoomWithDolly"),
        ]);
        assert!(!retired_label_kept(&old, generation_of(&old)), "2.x still registered it");
    }

    #[test]
    fn newest_known_scheme_is_the_newest_generation() {
        let known = known_labels();
        let refs: HashSet<(&str, &str)> = known.iter().map(|(t, c)| (t.as_str(), c.as_str())).collect();
        assert_eq!(generation_of(&refs).map(|g| g.csp), Some(GENERATIONS[0].csp));
    }
}
