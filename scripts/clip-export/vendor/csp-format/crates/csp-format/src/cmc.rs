//! Comic / multi-page projects (.cmc): a plain SQLite file next to the pages.
//!
//! `Project` holds the work settings (binding, default page size, …) and
//! `CanvasNode` the page list (spec: `docs/spec/07-cmc.md`):
//!
//! ```text
//! root node (Type 0): FirstChildIndex → first page, SelectedIndex → selected page
//! page node (Type 2): NextIndex → next page (0 ends the list),
//!                     LinkPath ".:pageNNNN.clip" (relative to the .cmc folder),
//!                     PageFlag 1 = two-page spread
//! ```
//!
//! The order of the pages is the order of the linked list, not of the file
//! names: page files keep their name when pages are moved. New page files
//! take `Project.MaxCanvasFileIndex + 1`.

use std::collections::HashSet;
use std::path::{Path, PathBuf};

use rusqlite::Connection;

use crate::database::{self, Row, select_all};
use crate::error::{Result, bail};

/// `CanvasNode.Type` values.
pub const NODE_ROOT: i64 = 0;
/// `CanvasNode.Type` of a page.
pub const NODE_PAGE: i64 = 2;

/// One `CanvasNode` row.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct CanvasNode {
    /// `MainId` of the row.
    pub main_id: i64,
    /// `Type`: [`NODE_ROOT`] or [`NODE_PAGE`].
    pub kind: i64,
    /// `MainId` of the next page (`NextIndex`, 0 ends the list).
    pub next: i64,
    /// `MainId` of the first page (`FirstChildIndex`, root node only).
    pub first_child: i64,
    /// `MainId` of the page selected in CSP (`SelectedIndex`, root node only).
    pub selected: i64,
    /// The page is a two-page spread (`PageFlag` bit 0).
    pub spread: bool,
    /// `LinkPath` as stored (".:page0001.clip"); see [`CanvasNode::relative_path`].
    pub link_path: Option<String>,
}

impl CanvasNode {
    fn from_row(row: &Row) -> Self {
        CanvasNode {
            main_id: row.int("MainId"),
            kind: row.int("Type"),
            next: row.int("NextIndex"),
            first_child: row.int("FirstChildIndex"),
            selected: row.int("SelectedIndex"),
            spread: row.int("PageFlag") & 1 != 0,
            link_path: row.text("LinkPath"),
        }
    }

    /// The page file path relative to the .cmc folder ("page0001.clip").
    pub fn relative_path(&self) -> Option<PathBuf> {
        let link = self.link_path.as_deref()?;
        let rest = link.strip_prefix(".:").unwrap_or(link);
        Some(rest.split(':').collect())
    }
}

/// Work settings from `Project` (the common subset; the row has more).
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct CmcProject {
    /// `ProjectInternalVersion`.
    pub version: Option<String>,
    /// `MainId` of the root `CanvasNode` (`ProjectRootCanvasNode`).
    pub root_node: i64,
    /// `ComicBindPosition`: 1 right binding (右綴じ), 0 left ([`crate::work::Binding`]).
    pub bind_position: i64,
    /// `ComicStartPage`: 0 the first page is on the left, 1 on the right.
    pub start_page: i64,
    /// The work has covers (`ComicCoverExist`).
    pub cover: bool,
    /// `DefaultPageUnit` (0 = px, 2 = mm in the samples).
    pub page_unit: i64,
    /// Default page width in `page_unit` (`DefaultPageWidth`).
    pub page_width: f64,
    /// Default page height in `page_unit` (`DefaultPageHeight`).
    pub page_height: f64,
    /// Default page resolution in dpi (`DefaultPageResolution`).
    pub page_resolution: f64,
    /// New pages are spreads (`DefaultPageDoublePage`).
    pub double_page: bool,
    /// Highest NNNN used by a page file (`MaxCanvasFileIndex`); new files take the next one.
    pub max_canvas_file_index: i64,
}

impl CmcProject {
    fn from_row(row: &Row) -> Self {
        CmcProject {
            version: row.text("ProjectInternalVersion"),
            root_node: row.int("ProjectRootCanvasNode"),
            bind_position: row.int("ComicBindPosition"),
            start_page: row.int("ComicStartPage"),
            cover: row.truthy("ComicCoverExist"),
            page_unit: row.int("DefaultPageUnit"),
            page_width: row.real("DefaultPageWidth"),
            page_height: row.real("DefaultPageHeight"),
            page_resolution: row.real("DefaultPageResolution"),
            double_page: row.truthy("DefaultPageDoublePage"),
            max_canvas_file_index: row.int("MaxCanvasFileIndex"),
        }
    }
}

/// An open .cmc. Changes stay in memory until [`CmcFile::save`].
pub struct CmcFile {
    original: Vec<u8>,
    pub(crate) connection: Connection,
    pub(crate) modified: bool,
    /// The work settings.
    pub project: CmcProject,
    /// Every `CanvasNode` row, in table order (the page order is [`CmcFile::pages`]).
    pub nodes: Vec<CanvasNode>,
}

impl CmcFile {
    /// Reads a .cmc. The file is not kept open or changed.
    pub fn open(path: impl AsRef<Path>) -> Result<Self> {
        Self::from_bytes(std::fs::read(path)?)
    }

    /// Parses the bytes of a .cmc (a plain SQLite file).
    pub fn from_bytes(data: Vec<u8>) -> Result<Self> {
        if !data.starts_with(b"SQLite format 3\0") {
            bail!("Not a .cmc (SQLite) file");
        }
        let connection = database::open_bytes(&data)?;
        let mut file =
            CmcFile { original: data, connection, modified: false, project: empty_project(), nodes: Vec::new() };
        file.reload()?;
        Ok(file)
    }

    pub(crate) fn reload(&mut self) -> Result<()> {
        let project = select_all(&self.connection, "Project")?;
        let Some(project) = project.first() else { bail!(".cmc has no Project row") };
        self.project = CmcProject::from_row(project);
        self.nodes = select_all(&self.connection, "CanvasNode")?.iter().map(CanvasNode::from_row).collect();
        Ok(())
    }

    /// The database (in memory; changes are saved by [`CmcFile::save`]).
    pub fn database(&self) -> &Connection {
        &self.connection
    }

    /// Which CSP generation saved the work file (see [`crate::version`]).
    pub fn version_info(&self) -> Result<crate::VersionInfo> {
        crate::VersionInfo::read(&self.connection, Some(&self.original))
    }

    /// The node with this `MainId`.
    pub fn node(&self, main_id: i64) -> Option<&CanvasNode> {
        self.nodes.iter().find(|node| node.main_id == main_id)
    }

    /// The root node (`Project.ProjectRootCanvasNode`, else the first node of type [`NODE_ROOT`]).
    pub fn root(&self) -> Result<&CanvasNode> {
        self.node(self.project.root_node)
            .or_else(|| self.nodes.iter().find(|node| node.kind == NODE_ROOT))
            .ok_or_else(|| crate::Error::format(".cmc has no root canvas node"))
    }

    /// Pages in reading order (the linked list from the root).
    pub fn pages(&self) -> Result<Vec<&CanvasNode>> {
        let mut pages = Vec::new();
        let mut seen = HashSet::new();
        let mut id = self.root()?.first_child;
        while id != 0 {
            if !seen.insert(id) {
                bail!("Page list loops at canvas node {id}");
            }
            let Some(node) = self.node(id) else { bail!("Page list points to missing canvas node {id}") };
            pages.push(node);
            id = node.next;
        }
        Ok(pages)
    }

    /// Each page's position in the work (pages counted from 0, a spread
    /// counts 2) and side, from the page list: what CSP writes into the
    /// page files' `ComicPageIndex` / `ComicIsLeftPage` when it opens them.
    /// Works with a cover number their 表3・表4 pages differently.
    pub fn positions(&self) -> Result<Vec<crate::work::PageSlot>> {
        let start = crate::work::StartSide::from_code(self.project.start_page);
        let mut position = 0;
        let mut slots = Vec::new();
        for page in self.pages()? {
            slots.push(crate::work::PageSlot {
                position,
                spread: page.spread,
                left: crate::work::is_left_page(position, start),
            });
            position += if page.spread { 2 } else { 1 };
        }
        Ok(slots)
    }

    /// Absolute path of each page file, given the .cmc's folder.
    pub fn page_paths(&self, folder: &Path) -> Result<Vec<PathBuf>> {
        Ok(self.pages()?.iter().filter_map(|node| node.relative_path()).map(|path| folder.join(path)).collect())
    }

    /// The thumbnail CSP shows for a page in the work's page list: the page
    /// file's `CanvasPreview` (`CanvasNode.CanvasThumbnail` is unset in every
    /// .cmc seen). None when the page has no file or no preview.
    pub fn page_thumbnail(&self, folder: &Path, node: &CanvasNode) -> Result<Option<crate::RgbaImage>> {
        let Some(path) = node.relative_path().map(|path| folder.join(path)) else { return Ok(None) };
        if !path.is_file() {
            return Ok(None);
        }
        crate::ClipFile::open(path)?.preview()
    }

    /// Structural problems; with `folder`, also page files that are missing.
    pub fn findings(&self, folder: Option<&Path>) -> Vec<String> {
        let mut findings = Vec::new();
        let pages = match self.pages() {
            Ok(pages) => pages,
            Err(error) => return vec![error.to_string()],
        };
        let listed: HashSet<i64> = pages.iter().map(|node| node.main_id).collect();
        let root = self.root().map(|root| root.main_id).unwrap_or(0);
        for node in &self.nodes {
            if node.main_id != root && !listed.contains(&node.main_id) {
                findings.push(format!("Canvas node {} is not in the page list", node.main_id));
            }
        }
        let mut paths = HashSet::new();
        for node in &pages {
            match node.relative_path() {
                None => findings.push(format!("Page node {} has no LinkPath", node.main_id)),
                Some(path) => {
                    if let Some(index) = file_index(&path)
                        && index > self.project.max_canvas_file_index
                    {
                        findings.push(format!("{} is above MaxCanvasFileIndex", path.display()));
                    }
                    if !paths.insert(path.clone()) {
                        findings.push(format!("{} is used by two pages", path.display()));
                    }
                    if let Some(folder) = folder
                        && !folder.join(&path).is_file()
                    {
                        findings.push(format!("{} is missing", path.display()));
                    }
                }
            }
        }
        if let Ok(selected) = self.root().map(|root| root.selected)
            && selected != 0
            && !listed.contains(&selected)
        {
            findings.push(format!("Selected node {selected} is not a page"));
        }
        let max_index = self
            .connection
            .query_row("SELECT MaxIndex FROM ElemScheme WHERE TableName = 'CanvasNode'", [], |row| row.get::<_, i64>(0))
            .unwrap_or(i64::MAX);
        if let Some(largest) = self.nodes.iter().map(|node| node.main_id).max()
            && largest > max_index
        {
            findings.push(format!("CanvasNode MainId {largest} is above ElemScheme.MaxIndex {max_index}"));
        }
        findings
    }

    fn set_links(&mut self, order: &[i64]) -> Result<()> {
        let root = self.root()?.main_id;
        let first = order.first().copied().unwrap_or(0);
        self.connection.execute("UPDATE CanvasNode SET FirstChildIndex = ?1 WHERE MainId = ?2", (first, root))?;
        for (i, id) in order.iter().enumerate() {
            let next = order.get(i + 1).copied().unwrap_or(0);
            self.connection.execute("UPDATE CanvasNode SET NextIndex = ?1 WHERE MainId = ?2", (next, id))?;
        }
        let selected = self.root()?.selected;
        if !order.contains(&selected) {
            self.connection.execute("UPDATE CanvasNode SET SelectedIndex = ?1 WHERE MainId = ?2", (first, root))?;
        }
        self.modified = true;
        self.reload()
    }

    /// Put the pages in the given order (every page exactly once).
    pub fn reorder(&mut self, order: &[i64]) -> Result<()> {
        let current: HashSet<i64> = self.pages()?.iter().map(|node| node.main_id).collect();
        let wanted: HashSet<i64> = order.iter().copied().collect();
        if wanted.len() != order.len() || wanted != current {
            bail!("The new order must list every page exactly once");
        }
        self.set_links(order)
    }

    /// Add a page after `after` (None = at the end). Returns the new node's
    /// MainId and the page file name to create next to the .cmc (for
    /// example a copy of another page).
    pub fn add_page(&mut self, after: Option<i64>, spread: bool) -> Result<(i64, String)> {
        let mut order: Vec<i64> = self.pages()?.iter().map(|node| node.main_id).collect();
        let position = match after {
            None => order.len(),
            Some(id) => order
                .iter()
                .position(|page| *page == id)
                .map(|i| i + 1)
                .ok_or_else(|| crate::Error::format(format!("Canvas node {id} is not a page")))?,
        };
        let main_id = crate::schema::allocate_main_id(&self.connection, "CanvasNode")?;
        let file_index = self.project.max_canvas_file_index + 1;
        let name = format!("page{file_index:04}.clip");
        // Copy the settings columns from an existing page, as CSP's new pages
        // share them.
        let template = order.last().copied();
        let warning: (i64, i64) = match template {
            Some(id) => self.connection.query_row(
                "SELECT COALESCE(BookBindWarning, 0), COALESCE(BookBindWarningDef, 1) FROM CanvasNode WHERE MainId = ?1",
                [id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )?,
            None => (0, 1),
        };
        self.connection.execute(
            "INSERT INTO CanvasNode(MainId, Type, NextIndex, FirstChildIndex, SelectedIndex, CanvasIndex, PageFlag, \
             Memo, BookBindMemo, BookBindWarning, BookBindWarningDef, LinkPath) \
             VALUES (?1, ?2, 0, 0, 0, 0, ?3, '', '', ?4, ?5, ?6)",
            (main_id, NODE_PAGE, spread as i64, warning.0, warning.1, format!(".:{name}")),
        )?;
        self.connection.execute("UPDATE Project SET MaxCanvasFileIndex = ?1", [file_index])?;
        self.reload()?;
        order.insert(position, main_id);
        self.set_links(&order)?;
        Ok((main_id, name))
    }

    /// Take a page out of the list and delete its node. The page file is
    /// left alone (the caller decides whether to delete it).
    pub fn remove_page(&mut self, main_id: i64) -> Result<Option<PathBuf>> {
        let mut order: Vec<i64> = self.pages()?.iter().map(|node| node.main_id).collect();
        let Some(position) = order.iter().position(|id| *id == main_id) else {
            bail!("Canvas node {main_id} is not a page");
        };
        let path = self.node(main_id).and_then(CanvasNode::relative_path);
        order.remove(position);
        self.connection.execute("DELETE FROM CanvasNode WHERE MainId = ?1", [main_id])?;
        self.reload()?;
        self.set_links(&order)?;
        Ok(path)
    }

    /// Something was changed since the file was read.
    pub fn is_modified(&self) -> bool {
        self.modified
    }

    /// The file bytes: the original bytes when nothing changed.
    pub fn to_bytes(&self) -> Result<Vec<u8>> {
        if !self.modified {
            return Ok(self.original.clone());
        }
        database::serialize(&self.connection)
    }

    /// Writes [`CmcFile::to_bytes`] to a file.
    ///
    /// `path` is replaced if it exists, and nothing checks whether it is
    /// the file this was read from. Saving over the source is possible (its
    /// bytes were read into memory), but a failed or interrupted write then
    /// loses the original; keeping inputs intact is the caller's job. The
    /// `cspf` tool refuses an output that is one of its inputs.
    pub fn save(&self, path: impl AsRef<Path>) -> Result<()> {
        std::fs::write(path, self.to_bytes()?)?;
        Ok(())
    }
}

/// The NNNN of "pageNNNN.clip".
fn file_index(path: &Path) -> Option<i64> {
    let stem = path.file_stem()?.to_str()?;
    stem.strip_prefix("page")?.parse().ok()
}

fn empty_project() -> CmcProject {
    CmcProject {
        version: None,
        root_node: 0,
        bind_position: 0,
        start_page: 0,
        cover: false,
        page_unit: 0,
        page_width: 0.0,
        page_height: 0.0,
        page_resolution: 0.0,
        double_page: false,
        max_canvas_file_index: 0,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A synthetic .cmc with the tables and columns CSP writes.
    fn sample(pages: usize) -> Vec<u8> {
        let connection = Connection::open_in_memory().unwrap();
        connection
            .execute_batch(
                "CREATE TABLE Project(_PW_ID INTEGER PRIMARY KEY AUTOINCREMENT, ProjectInternalVersion TEXT DEFAULT NULL, \
                 ProjectRootCanvasNode INTEGER DEFAULT NULL, ComicBindPosition INTEGER DEFAULT NULL, ComicStartPage INTEGER DEFAULT NULL, \
                 ComicCoverExist INTEGER DEFAULT NULL, DefaultPageUnit INTEGER DEFAULT NULL, DefaultPageWidth REAL DEFAULT NULL, \
                 DefaultPageHeight REAL DEFAULT NULL, DefaultPageResolution REAL DEFAULT NULL, DefaultPageDoublePage INTEGER DEFAULT NULL, \
                 MaxCanvasFileIndex INTEGER DEFAULT NULL);
                 CREATE TABLE CanvasNode(_PW_ID INTEGER PRIMARY KEY AUTOINCREMENT, MainId INTEGER DEFAULT NULL, Type INTEGER DEFAULT NULL, \
                 NextIndex INTEGER DEFAULT NULL, FirstChildIndex INTEGER DEFAULT NULL, SelectedIndex INTEGER DEFAULT NULL, \
                 CanvasIndex INTEGER DEFAULT NULL, PageFlag INTEGER DEFAULT NULL, Memo TEXT DEFAULT NULL, BookBindMemo TEXT DEFAULT NULL, \
                 BookBindWarning INTEGER DEFAULT NULL, BookBindWarningDef INTEGER DEFAULT NULL, LinkPath TEXT DEFAULT NULL);
                 CREATE TABLE ElemScheme(_PW_ID INTEGER PRIMARY KEY AUTOINCREMENT, TableName TEXT DEFAULT NULL, ElemType INTEGER DEFAULT NULL, \
                 MaxIndex INTEGER DEFAULT NULL);",
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO Project VALUES (1, '1.1.0', 1, 0, 0, 0, 2, 257.0, 364.0, 350.0, 0, ?1)",
                [pages as i64],
            )
            .unwrap();
        let first = if pages > 0 { 2 } else { 0 };
        connection
            .execute("INSERT INTO CanvasNode VALUES (1, 1, 0, 0, ?1, ?1, 0, 0, '', '', 0, 0, NULL)", [first])
            .unwrap();
        for page in 1..=pages as i64 {
            let next = if page < pages as i64 { page + 2 } else { 0 };
            connection
                .execute(
                    "INSERT INTO CanvasNode VALUES (?1, ?1, 2, ?2, 0, 0, 0, 0, '', '', 0, 1, ?3)",
                    (page + 1, next, format!(".:page{page:04}.clip")),
                )
                .unwrap();
        }
        connection.execute("INSERT INTO ElemScheme VALUES (1, 'CanvasNode', 0, ?1)", [pages as i64 + 1]).unwrap();
        database::serialize(&connection).unwrap()
    }

    #[test]
    fn reads_the_page_list() {
        let file = CmcFile::from_bytes(sample(3)).unwrap();
        let pages: Vec<String> =
            file.pages().unwrap().iter().map(|node| node.relative_path().unwrap().display().to_string()).collect();
        assert_eq!(pages, ["page0001.clip", "page0002.clip", "page0003.clip"]);
        assert!(file.findings(None).is_empty(), "{:?}", file.findings(None));
        assert_eq!(file.to_bytes().unwrap(), sample(3));
    }

    #[test]
    fn edits_keep_the_list_consistent() {
        let mut file = CmcFile::from_bytes(sample(3)).unwrap();
        file.reorder(&[4, 2, 3]).unwrap();
        let (id, name) = file.add_page(Some(2), false).unwrap();
        assert_eq!((id, name.as_str()), (5, "page0004.clip"));
        assert_eq!(file.remove_page(3).unwrap(), Some(PathBuf::from("page0002.clip")));
        let file = CmcFile::from_bytes(file.to_bytes().unwrap()).unwrap();
        let order: Vec<i64> = file.pages().unwrap().iter().map(|node| node.main_id).collect();
        assert_eq!(order, [4, 2, 5]);
        assert_eq!(file.project.max_canvas_file_index, 4);
        assert!(file.findings(None).is_empty(), "{:?}", file.findings(None));
        let mut file = file;
        assert!(file.reorder(&[4, 2]).is_err());
        assert!(file.reorder(&[4, 2, 2]).is_err());
    }

    #[test]
    fn loops_are_reported() {
        let mut file = CmcFile::from_bytes(sample(2)).unwrap();
        file.connection.execute("UPDATE CanvasNode SET NextIndex = 2 WHERE MainId = 3", []).unwrap();
        file.reload().unwrap();
        assert!(file.pages().is_err());
        assert!(!file.findings(None).is_empty());
    }
}
