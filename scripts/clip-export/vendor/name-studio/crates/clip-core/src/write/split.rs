//! Split a name sheet into page files and, optionally, one CSP EX work.
//!
//! Port of the Python `split` command. The page size and frames come from
//! the template page (an empty page saved by CSP for the same work); work
//! settings come from a template .cmc. Inputs are only read; new files are
//! written to `out_dir`, which must differ from every input folder.

use std::collections::BTreeSet;
use std::path::{Path, PathBuf};

use rusqlite::types::Value;
use serde::Serialize;

use super::Values;
use super::cmc::{work_canvas_values, write_cmc};
use super::page::write_page;
use crate::clip::ClipDocument;
use crate::error::{CspError, Result};
use crate::layout::ReadingOrder;
use crate::plan::{Fit, PlanOptions, centered_frame, plan_sheet};

pub const DEFAULT_NAME_PATTERN: &str = "page{page:04d}.clip";

#[derive(Debug, Clone)]
pub struct SplitOptions {
    pub sheet: PathBuf,
    pub template: PathBuf,
    pub out_dir: PathBuf,
    /// Page numbers to write; None = pages with content (all pages with a work).
    pub pages: Option<BTreeSet<i64>>,
    pub fit: Fit,
    pub order: ReadingOrder,
    pub first_page: i64,
    /// File name pattern with `{page}` or `{page:04d}`.
    pub name_pattern: String,
    /// Name of the .cmc to write (without extension), with its template.
    pub work: Option<(String, PathBuf)>,
    pub story_index: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
pub struct WrittenPage {
    pub number: i64,
    pub path: PathBuf,
    pub layers: usize,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct SplitReport {
    pub pages: Vec<WrittenPage>,
    pub work: Option<PathBuf>,
    pub warnings: Vec<String>,
}

/// `pattern` with `{page}` / `{page:0Nd}` replaced by `number`.
pub fn page_file_name(pattern: &str, number: i64) -> String {
    let mut result = pattern.replace("{page}", &number.to_string());
    while let Some(start) = result.find("{page:0") {
        let Some(end) = result[start..].find("d}").map(|end| start + end) else {
            break;
        };
        let width: usize = result[start + 7..end].parse().unwrap_or(0);
        result.replace_range(start..end + 2, &format!("{number:0width$}"));
    }
    result
}

fn folder_of(path: &Path) -> Result<PathBuf> {
    Ok(path.canonicalize()?.parent().map(Path::to_path_buf).unwrap_or_default())
}

pub fn split_sheet(options: &SplitOptions) -> Result<SplitReport> {
    let mut inputs = vec![options.sheet.as_path(), options.template.as_path()];
    if let Some((_, cmc)) = &options.work {
        inputs.push(cmc);
    }
    for input in &inputs {
        if !input.exists() {
            return Err(CspError::format(format!("Input file not found: {}", input.display())));
        }
    }
    std::fs::create_dir_all(&options.out_dir)?;
    // Compare canonical paths, but write to the folder as given: on Windows
    // the canonical form is a `\\?\` path, which would show in reports.
    let canonical_out = options.out_dir.canonicalize()?;
    for input in &inputs {
        if folder_of(input)? == canonical_out {
            return Err(CspError::format(
                "The output folder must differ from the input folders so originals are never overwritten",
            ));
        }
    }
    let sheet = ClipDocument::read(&options.sheet)?;
    let template = ClipDocument::read(&options.template)?;
    let canvas = &template.canvas;
    let (width, height) = (canvas.width_px, canvas.height_px);
    let trim = canvas
        .crop_size_px
        .map(|size| centered_frame(width, height, size, (0, 0)));
    let basic = canvas
        .basic_size_px
        .map(|size| centered_frame(width, height, size, canvas.basic_offset_px));
    let plan = plan_sheet(
        &sheet,
        width,
        height,
        PlanOptions {
            order: options.order,
            first_page: options.first_page,
            fit: options.fit,
            trim,
            basic,
        },
    )?;
    let mut pages: Vec<_> = plan
        .pages
        .iter()
        .filter(|page| match &options.pages {
            Some(wanted) => wanted.contains(&page.number),
            None => options.work.is_some() || !page.contents.is_empty(),
        })
        .collect();
    pages.sort_by_key(|page| page.number);
    let mut work_values: Values = match &options.work {
        Some((_, cmc)) => work_canvas_values(cmc)?,
        None => Vec::new(),
    };
    let overrides: Values = match options.story_index {
        Some(index) => vec![
            ("ComicStoryUseStoryIndex".to_owned(), Value::Integer(1)),
            ("ComicStoryStoryIndex".to_owned(), Value::Integer(index)),
        ],
        None => Vec::new(),
    };
    for (column, value) in &overrides {
        super::set_value(&mut work_values, column, value.clone());
    }
    let mut report = SplitReport {
        pages: Vec::new(),
        work: None,
        warnings: plan.warnings.clone(),
    };
    for (position, page) in pages.iter().enumerate() {
        let output = options.out_dir.join(page_file_name(&options.name_pattern, page.number));
        let index = options.work.is_some().then_some(position as i64);
        let result = write_page(&options.template, &sheet, page, &output, index, &work_values)?;
        report.pages.push(WrittenPage {
            number: page.number,
            path: result.path,
            layers: result.layer_ids.len(),
            warnings: result.warnings,
        });
    }
    if let Some((name, cmc)) = &options.work {
        if report.pages.is_empty() {
            return Err(CspError::format("No pages to put in the work"));
        }
        let paths: Vec<PathBuf> = report.pages.iter().map(|page| page.path.clone()).collect();
        report.work = Some(write_cmc(
            cmc,
            &paths,
            &options.out_dir.join(format!("{name}.cmc")),
            &overrides,
        )?);
    }
    Ok(report)
}

#[cfg(test)]
mod tests {
    use super::page_file_name;

    #[test]
    fn formats_page_numbers() {
        assert_eq!(page_file_name("page{page:04d}.clip", 7), "page0007.clip");
        assert_eq!(page_file_name("{page}.clip", 12), "12.clip");
    }
}
