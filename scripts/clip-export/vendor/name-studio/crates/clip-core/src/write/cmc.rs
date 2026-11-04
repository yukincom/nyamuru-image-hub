//! Write a CLIP STUDIO PAINT EX multi-page work (.cmc) for page files.
//!
//! The page .clip files only become one work in CSP EX once a .cmc next to
//! them lists them in order. A CSP-made .cmc of the same work is the
//! template, so every work-wide setting (binding, start page, story info,
//! default page) is kept; csp-format replaces its page list.

use std::path::{Path, PathBuf};

use chrono::{DateTime, Datelike, Local, Timelike};
use csp_format::CmcFile;
use csp_format::cmc_pages::PageLink;

use super::Values;
use crate::error::{CspError, Result};

/// The work settings a .cmc shares with its pages' Canvas rows.
///
/// Each page .clip keeps a copy of the work's story info (作品名, 話数, 作者名,
/// ノンブル); pages made from another episode's template would otherwise
/// show that episode.
pub fn work_canvas_values(path: &Path) -> Result<Values> {
    Ok(CmcFile::open(path)?.page_canvas_values()?)
}

/// Write `output` (.cmc) listing `pages` in order, with `template`'s settings.
///
/// Every page file must already exist in the folder of `output`, because
/// CSP resolves page links relative to the .cmc. `project_values` overrides
/// Project columns the template has (for example the 話数).
pub fn write_cmc(template: &Path, pages: &[PathBuf], output: &Path, project_values: &Values) -> Result<PathBuf> {
    if pages.is_empty() {
        return Err(CspError::format("A work needs at least one page"));
    }
    let folder = match output.parent() {
        Some(parent) if !parent.as_os_str().is_empty() => parent.canonicalize()?,
        _ => Path::new(".").canonicalize()?,
    };
    let mut links = Vec::with_capacity(pages.len());
    for page in pages {
        if page.canonicalize()?.parent() != Some(folder.as_path()) {
            return Err(CspError::format(format!(
                "Page {} must be in the folder of {}",
                page.display(),
                output.display()
            )));
        }
        let mut link = PageLink::read(page)?;
        // CSP writes the PC's own time there.
        let stamp = DateTime::<Local>::from(std::fs::metadata(page)?.modified()?);
        link.modified = [
            stamp.year() as i64,
            stamp.month() as i64,
            stamp.day() as i64,
            stamp.hour() as i64,
            stamp.minute() as i64,
            stamp.second() as i64,
        ];
        links.push(link);
    }
    let mut work = CmcFile::open(template)?;
    work.set_pages(&links)?;
    for (column, value) in project_values {
        work.set_project_value(column, value.clone())?;
    }
    name_model::atomic::replace_with(output, |temporary| work.save(temporary))?;
    Ok(output.to_path_buf())
}
