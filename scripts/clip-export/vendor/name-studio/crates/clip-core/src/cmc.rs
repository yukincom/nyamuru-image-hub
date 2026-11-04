//! Multi-page work (.cmc): a plain SQLite database.
//!
//! `Project` holds work-wide settings and `CanvasNode` the page list as a
//! linked list: the root node's `FirstChildIndex` points at the first page
//! and each page's `NextIndex` at the following one. Pages are referenced by
//! `LinkPath` such as ".:page0001.clip" (":" is CSP's path separator).
//! The file is opened by csp-format; this module keeps what the tool reads
//! from it.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};

use crate::error::{CspError, Result};
use csp_format::database::{Row, select as select_rows};

pub const SQLITE_MAGIC: &[u8; 16] = b"SQLite format 3\0";
pub const PAGE_NODE_TYPE: i64 = 2;

#[derive(Debug, Clone, PartialEq)]
pub struct CmcPage {
    pub order: usize,
    pub main_id: i64,
    pub link_path: String,
    pub file_name: String,
    pub page_flag: i64,
    pub memo: String,
}

/// Settings CSP uses when it adds a page.
#[derive(Debug, Clone, PartialEq)]
pub struct CmcDefaultPage {
    pub unit: i64,
    pub width: f64,
    pub height: f64,
    pub resolution: f64,
    pub is_double_page: bool,
    pub template_name: String,
}

#[derive(Debug, Clone, PartialEq)]
pub struct CmcProject {
    pub path: PathBuf,
    pub internal_version: String,
    pub story_name: String,
    pub author_name: String,
    pub binding_position: i64,
    pub start_page: i64,
    pub has_cover: bool,
    pub max_canvas_file_index: i64,
    pub default_page: CmcDefaultPage,
    pub pages: Vec<CmcPage>,
}

impl CmcProject {
    /// Read a .cmc without modifying it.
    pub fn read(path: impl AsRef<Path>) -> Result<Self> {
        let path = path.as_ref();
        let data = std::fs::read(path)
            .map_err(|error| CspError::format(format!("Cannot read {}: {error}", path.display())))?;
        if !data.starts_with(SQLITE_MAGIC) {
            return Err(CspError::format(format!(
                "Not a .cmc (SQLite) file: {}",
                path.display()
            )));
        }
        let file = csp_format::CmcFile::from_bytes(data)?;
        let connection = file.database();
        let project = select_rows(connection, "SELECT * FROM Project", [])?
            .into_iter()
            .next()
            .ok_or_else(|| CspError::format(format!("Project row not found: {}", path.display())))?;
        let nodes: HashMap<i64, Row> = select_rows(connection, "SELECT * FROM CanvasNode", [])?
            .into_iter()
            .map(|row| (row.int("MainId"), row))
            .collect();
        let text = |column: &str| project.text(column).unwrap_or_default();
        Ok(CmcProject {
            path: path.to_path_buf(),
            internal_version: text("ProjectInternalVersion"),
            story_name: text("ComicStoryStoryName"),
            author_name: text("ComicStoryAuthorName"),
            binding_position: project.int("ComicBindPosition"),
            start_page: project.int("ComicStartPage"),
            has_cover: project.truthy("ComicCoverExist"),
            max_canvas_file_index: project.int("MaxCanvasFileIndex"),
            default_page: CmcDefaultPage {
                unit: project.int("DefaultPageUnit"),
                width: project.real("DefaultPageWidth"),
                height: project.real("DefaultPageHeight"),
                resolution: project.real("DefaultPageResolution"),
                is_double_page: project.truthy("DefaultPageDoublePage"),
                template_name: text("DefaultPageTemplateName"),
            },
            pages: ordered_pages(&nodes, project.int("ProjectRootCanvasNode"))?,
        })
    }

    /// Each page's .clip path, relative to the .cmc folder.
    pub fn page_file_paths(&self) -> Vec<PathBuf> {
        let folder = self.path.parent().unwrap_or(Path::new(""));
        self.pages.iter().map(|page| folder.join(&page.file_name)).collect()
    }
}

/// ".:page0001.clip" -> "page0001.clip" (sub folders joined with "/").
pub fn link_path_to_file_name(link_path: &str) -> Result<String> {
    let parts: Vec<&str> = link_path
        .split(':')
        .filter(|part| !part.is_empty() && *part != ".")
        .collect();
    if parts.is_empty() {
        return Err(CspError::format(format!("Empty page link path: {link_path:?}")));
    }
    Ok(parts.join("/"))
}

fn ordered_pages(nodes: &HashMap<i64, Row>, root_id: i64) -> Result<Vec<CmcPage>> {
    let root = nodes
        .get(&root_id)
        .ok_or_else(|| CspError::format(format!("Root canvas node {root_id} not found")))?;
    let mut pages = Vec::new();
    let mut seen = HashSet::new();
    let mut node_id = root.int("FirstChildIndex");
    while node_id != 0 {
        let row = nodes
            .get(&node_id)
            .filter(|_| seen.insert(node_id))
            .ok_or_else(|| CspError::format(format!("Broken page link to node {node_id}")))?;
        if row.int("Type") == PAGE_NODE_TYPE {
            let link_path = row.text("LinkPath").unwrap_or_default();
            pages.push(CmcPage {
                order: pages.len() + 1,
                main_id: node_id,
                file_name: link_path_to_file_name(&link_path)?,
                link_path,
                page_flag: row.int("PageFlag"),
                memo: row.text("Memo").unwrap_or_default(),
            });
        }
        node_id = row.int("NextIndex");
    }
    Ok(pages)
}
