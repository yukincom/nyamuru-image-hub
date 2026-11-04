//! A work (.cmc) for given page files, made from a template work (from
//! name-studio's clip-core `write_cmc`).
//!
//! Page files only become one work in CSP EX once a .cmc next to them lists
//! them in order. A CSP-made .cmc is the template, so every work-wide
//! setting (binding, start page, story info, default page) is kept; its page
//! list (`CanvasNode`, a linked list under the root node) is replaced by one
//! node per page file. Page nodes copy the template's first page node and
//! get the new link, order and size (the `Link*` columns are CSP's cache of
//! the page file's size and save time, written only when the template has
//! them; readers do not use them, see `docs/spec/07-cmc.md`).

use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::types::Value;

use crate::clip::ClipFile;
use crate::cmc::{CmcFile, NODE_PAGE};
use crate::copy::insert_row;
use crate::database::{Row, has_column, has_table, quote, select, select_all};
use crate::error::{Error, Result, bail};

/// What a page node records about its page file.
#[derive(Debug, Clone, PartialEq)]
pub struct PageLink {
    /// File name, in the folder of the .cmc.
    pub file_name: String,
    /// A two-page spread (`Canvas.CanvasDoublePage`).
    pub spread: bool,
    /// `CanvasUnit`, `CanvasWidth`, `CanvasHeight`, `CanvasResolution`.
    pub unit: i64,
    /// `CanvasWidth`, in `unit`.
    pub width: f64,
    /// `CanvasHeight`, in `unit`.
    pub height: f64,
    /// `CanvasResolution`, in dpi.
    pub resolution: f64,
    /// Save time as year, month, day, hour, minute, second (CSP writes the
    /// PC's local time; [`PageLink::read`] uses UTC, having no time zone).
    pub modified: [i64; 6],
}

impl PageLink {
    /// Read the size and modification time of a page file.
    pub fn read(path: &Path) -> Result<PageLink> {
        let file = ClipFile::open(path)?;
        let row = select_all(file.database(), "Canvas")?
            .into_iter()
            .next()
            .ok_or_else(|| Error::format(format!("No Canvas row in {}", path.display())))?;
        let seconds = std::fs::metadata(path)?.modified()?.duration_since(UNIX_EPOCH).map_or(0, |d| d.as_secs());
        Ok(PageLink {
            file_name: path.file_name().map(|name| name.to_string_lossy().into_owned()).unwrap_or_default(),
            spread: row.int("CanvasDoublePage") != 0,
            unit: row.int("CanvasUnit"),
            width: row.real("CanvasWidth"),
            height: row.real("CanvasHeight"),
            resolution: row.real("CanvasResolution"),
            modified: civil_time(seconds as i64),
        })
    }
}

/// Seconds since 1970 as UTC year, month, day, hour, minute, second.
pub fn civil_time(seconds: i64) -> [i64; 6] {
    let (days, rest) = (seconds.div_euclid(86_400), seconds.rem_euclid(86_400));
    // Howard Hinnant's days-to-civil.
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + (month <= 2) as i64;
    [year, month, day, rest / 3600, rest / 60 % 60, rest % 60]
}

/// The highest number in the page file names (`page0012.clip` → 12).
fn max_file_index(links: &[PageLink]) -> i64 {
    links
        .iter()
        .filter_map(|link| {
            let lower = link.file_name.to_lowercase();
            let stem = lower.strip_suffix(".clip")?;
            let digits: String = stem.chars().rev().take_while(char::is_ascii_digit).collect();
            digits.chars().rev().collect::<String>().parse().ok()
        })
        .max()
        .unwrap_or(links.len() as i64)
}

fn node_values(link: &PageLink) -> Vec<(&'static str, Value)> {
    let int = Value::Integer;
    let [year, month, day, hour, minute, second] = link.modified;
    vec![
        ("FirstChildIndex", int(0)),
        ("SelectedIndex", int(0)),
        ("CanvasIndex", int(0)),
        ("PageFlag", int(link.spread as i64)),
        ("Memo", Value::Text(String::new())),
        ("BookBindMemo", Value::Text(String::new())),
        ("LinkPath", Value::Text(format!(".:{}", link.file_name))),
        ("LinkWriteYear", int(year)),
        ("LinkWriteMonth", int(month)),
        ("LinkWriteDay", int(day)),
        ("LinkWriteHour", int(hour)),
        ("LinkWriteMinute", int(minute)),
        ("LinkWriteSecond", int(second)),
        ("LinkIsFolder", int(0)),
        ("LinkUnit", int(link.unit)),
        ("LinkWidth", Value::Real(link.width)),
        ("LinkHeight", Value::Real(link.height)),
        ("LinkResolution", Value::Real(link.resolution)),
    ]
}

impl CmcFile {
    /// Replace the page list with one page per link, in order, keeping
    /// every work setting. The page files must be (or be put) in the
    /// folder of the saved .cmc.
    pub fn set_pages(&mut self, links: &[PageLink]) -> Result<()> {
        if links.is_empty() {
            bail!("A work needs at least one page");
        }
        let connection = &self.connection;
        let root = self.project.root_node;
        let base = select(connection, "SELECT * FROM CanvasNode WHERE Type = ?1 ORDER BY MainId LIMIT 1", [NODE_PAGE])?
            .into_iter()
            .next()
            .unwrap_or_else(|| Row::new(Vec::new(), Vec::new()));
        connection.execute("DELETE FROM CanvasNode WHERE MainId != ?1", [root])?;
        let ids: Vec<i64> = (1..=links.len() as i64 + 1).filter(|id| *id != root).take(links.len()).collect();
        for (position, (id, link)) in ids.iter().zip(links).enumerate() {
            let mut columns: Vec<String> = base.columns().iter().filter(|c| *c != "_PW_ID").cloned().collect();
            let mut values: Vec<Value> = columns.iter().map(|c| base.get(c).cloned().unwrap_or(Value::Null)).collect();
            let next = ids.get(position + 1).copied().unwrap_or(0);
            let mut set = |column: &str, value: Value| match columns.iter().position(|c| c == column) {
                Some(i) => values[i] = value,
                None => {
                    columns.push(column.to_owned());
                    values.push(value);
                }
            };
            for (column, value) in node_values(link) {
                set(column, value);
            }
            // CSP's own page rows have `_PW_ID` = `MainId`.
            set("_PW_ID", Value::Integer(*id));
            set("MainId", Value::Integer(*id));
            set("Type", Value::Integer(NODE_PAGE));
            set("NextIndex", Value::Integer(next));
            insert_row(connection, "CanvasNode", &Row::new(columns, values))?;
        }
        for column in ["FirstChildIndex", "SelectedIndex"] {
            if has_column(connection, "CanvasNode", column)? {
                connection.execute(
                    &format!("UPDATE CanvasNode SET {} = ?1 WHERE MainId = ?2", quote(column)),
                    (ids[0], root),
                )?;
            }
        }
        if has_table(connection, "ElemScheme")? {
            let top = ids.iter().copied().chain([root]).max().unwrap_or(root);
            connection.execute("UPDATE ElemScheme SET MaxIndex = ?1 WHERE TableName = 'CanvasNode'", [top])?;
        }
        if has_column(connection, "Project", "MaxCanvasFileIndex")? {
            connection.execute("UPDATE Project SET MaxCanvasFileIndex = ?1", [max_file_index(links)])?;
        }
        self.modified = true;
        self.reload()
    }

    /// Set one `Project` column; false when the work file does not have it.
    pub fn set_project_value(&mut self, column: &str, value: Value) -> Result<bool> {
        if !has_column(&self.connection, "Project", column)? {
            return Ok(false);
        }
        self.connection.execute(&format!("UPDATE Project SET {} = ?1", quote(column)), [value])?;
        self.modified = true;
        self.reload()?;
        Ok(true)
    }

    /// The work settings the pages keep a copy of in their `Canvas` row:
    /// the story info (`ComicStory*`: 作品名, 話数, 作者名, ノンブル) and
    /// `ComicBindPosition`. Pages made from another work's template would
    /// otherwise show that work's.
    pub fn page_canvas_values(&self) -> Result<Vec<(String, Value)>> {
        let project = select_all(&self.connection, "Project")?
            .into_iter()
            .next()
            .ok_or_else(|| Error::format(".cmc has no Project row"))?;
        Ok(project
            .iter()
            .filter(|(column, _)| column.starts_with("ComicStory") || *column == "ComicBindPosition")
            .map(|(column, value)| (column.to_owned(), value.clone()))
            .collect())
    }

    /// Save this work (a template) as `output` listing `pages` in order.
    /// Every page file must already be in the folder of `output`, because
    /// CSP finds pages relative to the .cmc.
    pub fn save_with_pages(&mut self, output: &Path, pages: &[PathBuf]) -> Result<()> {
        let folder = match output.parent() {
            Some(parent) if !parent.as_os_str().is_empty() => parent.canonicalize()?,
            _ => Path::new(".").canonicalize()?,
        };
        let mut links = Vec::with_capacity(pages.len());
        for page in pages {
            if page.canonicalize()?.parent() != Some(folder.as_path()) {
                bail!("Page {} must be in the folder of {}", page.display(), output.display());
            }
            links.push(PageLink::read(page)?);
        }
        self.set_pages(&links)?;
        self.save(output)
    }
}

/// Seconds since 1970 of `time`, for [`civil_time`].
pub fn unix_seconds(time: SystemTime) -> i64 {
    time.duration_since(UNIX_EPOCH).map_or(0, |d| d.as_secs() as i64)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::work::NewWork;

    fn link(name: &str, spread: bool) -> PageLink {
        PageLink {
            file_name: name.into(),
            spread,
            unit: 2,
            width: 192.0,
            height: 267.0,
            resolution: 600.0,
            modified: [2026, 10, 26, 12, 0, 0],
        }
    }

    #[test]
    fn civil_times() {
        assert_eq!(civil_time(0), [1970, 1, 1, 0, 0, 0]);
        assert_eq!(civil_time(951_782_400 + 3661), [2000, 2, 29, 1, 1, 1]);
        assert_eq!(civil_time(1_792_972_800), [2026, 10, 26, 0, 0, 0]);
    }

    #[test]
    fn pages_replace_the_list_and_keep_the_settings() {
        let work = NewWork { pages: 4, title: "t".into(), ..Default::default() }.build().unwrap();
        let mut file = CmcFile::from_bytes(work.cmc).unwrap();
        let before = file.project.clone();
        let links = [link("page0003.clip", false), link("page0010.clip", true), link("a.clip", false)];
        file.set_pages(&links).unwrap();
        assert!(file.set_project_value("ComicStoryNombreStart", Value::Integer(5)).unwrap());
        assert!(!file.set_project_value("NoSuchColumn", Value::Integer(5)).unwrap());
        let mut file = CmcFile::from_bytes(file.to_bytes().unwrap()).unwrap();
        let pages = file.pages().unwrap();
        let names: Vec<String> = pages.iter().map(|n| n.relative_path().unwrap().display().to_string()).collect();
        assert_eq!(names, ["page0003.clip", "page0010.clip", "a.clip"]);
        assert_eq!(pages.iter().map(|n| n.spread).collect::<Vec<_>>(), [false, true, false]);
        assert_eq!(file.project.max_canvas_file_index, 10);
        assert_eq!(file.project.bind_position, before.bind_position);
        assert_eq!(file.root().unwrap().selected, pages[0].main_id);
        assert!(file.findings(None).is_empty(), "{:?}", file.findings(None));
        let values = file.page_canvas_values().unwrap();
        assert!(values.iter().any(|(c, v)| c == "ComicStoryNombreStart" && *v == Value::Integer(5)));
        assert!(values.iter().any(|(c, _)| c == "ComicBindPosition"));
        assert!(file.set_pages(&[]).is_err());
    }
}
