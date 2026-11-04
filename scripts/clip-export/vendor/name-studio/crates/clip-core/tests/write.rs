//! Writing page .clip files and the .cmc work from a name sheet.
//!
//! Only CSP can confirm a file opens; these tests check that what is written
//! reads back with the planned layers, positions, sizes and page order, and
//! that input files are never changed. `tools/compare_with_python.py`
//! additionally checks the output against the Python reference.

use std::path::{Path, PathBuf};

use clip_core::fixtures::{FixtureCanvas, FixtureLayer, OPEN, build_cmc, build_editable_clip, rectangle};
use clip_core::layout::ReadingOrder;
use clip_core::plan::{Fit, PlanOptions, plan_sheet};
use clip_core::text::{build_tlv, parse_text_attributes, parse_tlv};
use clip_core::write::split::{DEFAULT_NAME_PATTERN, SplitOptions, split_sheet};
use clip_core::{ClipDocument, CmcProject, RgbaImage};
use csp_format::ClipFile;
use csp_format::edit::NewLayer;

/// 160 x 60 mm and 40 x 56 mm at 254 dpi: 1600 x 600 and 400 x 560 px.
const SHEET: FixtureCanvas = FixtureCanvas {
    width_mm: 160.0,
    height_mm: 60.0,
    resolution: 254.0,
    double_page: true,
};
const PAGE: FixtureCanvas = FixtureCanvas {
    width_mm: 40.0,
    height_mm: 56.0,
    resolution: 254.0,
    double_page: false,
};

fn right_spread() -> Vec<clip_core::fixtures::FixtureVector> {
    vec![
        rectangle(840.0, 40.0, 1560.0, 560.0),
        rectangle(860.0, 60.0, 1190.0, 540.0),
        rectangle(1210.0, 60.0, 1540.0, 540.0),
    ]
}

fn sheet(folder: &Path) -> PathBuf {
    std::fs::create_dir_all(folder.join("sheet")).unwrap();
    let layers = vec![
        FixtureLayer::paper(2),
        FixtureLayer::folder(
            10,
            "テンプレート",
            vec![
                FixtureLayer::vector(11, "右", right_spread()),
                FixtureLayer {
                    offset: (-800, 0),
                    ..FixtureLayer::vector(12, "左", right_spread())
                },
            ],
        ),
        // A 20 px dot around (1300, 300): block 12 of the 7-block-wide grid.
        FixtureLayer::raster(20, "下描き", vec![(12, (10, 34, 30, 54))]),
        FixtureLayer::folder(
            30,
            "ネーム",
            vec![FixtureLayer::vector(
                21,
                "線",
                vec![(OPEN, vec![(1250.0, 100.0), (1500.0, 500.0)])],
            )],
        ),
        FixtureLayer::text(23, "あ", [900, 100, 960, 300], 4.0),
    ];
    build_editable_clip(&folder.join("sheet").join("sheet.clip"), SHEET, layers)
}

fn template(folder: &Path) -> PathBuf {
    std::fs::create_dir_all(folder.join("template")).unwrap();
    let runs = 1u32
        .to_le_bytes()
        .into_iter()
        .chain(0u32.to_le_bytes())
        .chain(6u32.to_le_bytes())
        .chain(26u32.to_le_bytes());
    let story = build_tlv(&[
        (0x0B, runs.collect()),
        (0x20, 900i32.to_le_bytes().to_vec()),
        (0x32, 77i32.to_le_bytes().to_vec()),
    ]);
    let layers = vec![
        FixtureLayer::paper(2),
        FixtureLayer::raster(3, "レイヤー 1", vec![(0, (0, 0, 0, 0))]),
        FixtureLayer {
            layer_type: 800,
            text: Some("作品 3話".into()),
            text_attributes: Some(story),
            ..FixtureLayer::new(4, "(作品情報)")
        },
        FixtureLayer {
            layer_type: 800,
            text: Some("1".into()),
            text_attributes: Some(nombre_attributes()),
            ..FixtureLayer::new(5, "(ノンブル)")
        },
    ];
    build_editable_clip(&folder.join("template").join("page.clip"), PAGE, layers)
}

fn le(numbers: &[i32]) -> Vec<u8> {
    numbers.iter().flat_map(|n| n.to_le_bytes()).collect()
}

/// The hidden ノンブル of a left page: one 10 px wide digit near the right
/// (binding) edge, with CSP's cached rendering in Offscreen 78.
fn nombre_attributes() -> Vec<u8> {
    build_tlv(&[
        (0x0B, le(&[1, 0, 1])),
        (0x2A, le(&[380, 540, 390, 550])),
        (0x3F, le(&[10, 10])),
        (0x40, le(&[0, 0, 1000, 0, 1000, 1000, 0, 1000])),
        (0x32, le(&[78])),
    ])
}

/// The ノンブル text, its bbox, its cached-rendering id and the page side flag.
fn nombre(path: &Path) -> (String, Vec<u8>, Vec<u8>, i64) {
    let document = ClipDocument::read(path).unwrap();
    let (string, attributes): (Vec<u8>, Vec<u8>) = document
        .database()
        .query_row(
            "SELECT TextLayerString, TextLayerAttributes FROM Layer WHERE ComicStoryInfoType = 2",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .unwrap();
    let flag: i64 = document
        .database()
        .query_row("SELECT CropFrameOptionFlag FROM Canvas", [], |row| row.get(0))
        .unwrap();
    let items = parse_tlv(&attributes).unwrap();
    let value = |id: u32| items.iter().find(|(tag, _)| *tag == id).unwrap().1.to_vec();
    (String::from_utf8(string).unwrap(), value(0x2A), value(0x32), flag)
}

#[test]
fn write_page_sets_nombre_and_side() {
    let folder = tempfile::tempdir().unwrap();
    let sheet = ClipDocument::read(sheet(folder.path())).unwrap();
    let template = template(folder.path());
    let options = PlanOptions {
        fit: Fit::Cell,
        ..PlanOptions::default()
    };
    let plan = plan_sheet(&sheet, 400, 560, options).unwrap();
    let page = &plan.pages[0];
    let write = |name: &str, index: i64| {
        let output = folder.path().join(name);
        clip_core::write::page::write_page(&template, &sheet, page, &output, Some(index), &Vec::new()).unwrap();
        nombre(&output)
    };
    // Same side as the template (left): only the number changes, keeping the binding edge.
    assert_eq!(
        write("p11.clip", 10),
        ("11".into(), le(&[370, 540, 390, 550]), le(&[0]), 2)
    );
    // A right page: CSP keeps the ノンブル at the binding edge, now on the left, and flags the side.
    assert_eq!(write("p2.clip", 1), ("2".into(), le(&[10, 540, 20, 550]), le(&[0]), 4));
}

fn digest(path: &Path) -> Vec<u8> {
    std::fs::read(path).unwrap()
}

fn canvas_page(path: &Path) -> (i64, i64) {
    let document = ClipDocument::read(path).unwrap();
    document
        .database()
        .query_row("SELECT ComicPageIndex, ComicIsLeftPage FROM Canvas", [], |row| {
            Ok((row.get(0)?, row.get(1)?))
        })
        .unwrap()
}

#[test]
fn editor_adds_a_layer_with_pixels() {
    let folder = tempfile::tempdir().unwrap();
    let template = template(folder.path());
    let before = digest(&template);
    let mut editor = ClipFile::open(&template).unwrap();
    let root = editor.canvas.root_folder;
    let new_id = editor.add_layer(root, NewLayer::Raster, "追加").unwrap();
    let red = csp_format::RgbaImage {
        width: 20,
        height: 10,
        pixels: [255, 0, 0, 255].repeat(200),
    };
    editor.set_layer_pixels(new_id, &red, (100, 200)).unwrap();
    let output = folder.path().join("out.clip");
    editor.save(&output).unwrap();
    assert_eq!(digest(&template), before);
    let document = ClipDocument::read(&output).unwrap();
    let layer = document.find_layer(new_id).unwrap();
    assert_eq!(layer.name, "追加");
    assert_eq!(document.root.children.last().unwrap().name, "追加");
    let pixels = document.render_layer_pixels(layer).unwrap().unwrap();
    assert_eq!(pixels.alpha_bbox(), Some((100, 200, 120, 210)));
    // The template's own layer keeps its (empty) pixels.
    let original = document
        .render_layer_pixels(document.find_layer(3).unwrap())
        .unwrap()
        .unwrap();
    assert_eq!(original.alpha_bbox(), None);
}

#[test]
fn writes_planned_layers_into_pages() {
    let folder = tempfile::tempdir().unwrap();
    let (sheet_path, template_path) = (sheet(folder.path()), template(folder.path()));
    let sheet = ClipDocument::read(&sheet_path).unwrap();
    let options = PlanOptions {
        fit: Fit::Cell,
        order: ReadingOrder::RightToLeft,
        ..PlanOptions::default()
    };
    let plan = plan_sheet(&sheet, 400, 560, options).unwrap();
    assert_eq!(plan.pages.len(), 4);
    assert_eq!(plan.template_layer_ids, vec![11, 12]);
    let page = &plan.pages[0];
    let output = folder.path().join("page0001.clip");
    let result = clip_core::write::page::write_page(&template_path, &sheet, page, &output, None, &Vec::new()).unwrap();
    assert_eq!(result.layer_ids.len(), 2);
    let document = ClipDocument::read(&output).unwrap();
    let names: Vec<String> = document.layers().iter().map(|layer| layer.name.clone()).collect();
    assert!(names.contains(&"下描き".into()) && names.contains(&"ネーム".into()) && names.contains(&"線".into()));
    assert!(!names.contains(&"テンプレート".into()) && !names.contains(&"あ".into()));
    let (scale, dx, dy) = (page.transform.scale, page.transform.dx, page.transform.dy);
    let sketch = document
        .layers()
        .into_iter()
        .find(|layer| layer.name == "下描き")
        .unwrap();
    let (x0, y0, x1, y1) = document
        .render_layer_pixels(sketch)
        .unwrap()
        .unwrap()
        .alpha_bbox()
        .unwrap();
    assert!(((x0 + x1) as f64 / 2.0 - (1300.0 * scale + dx)).abs() <= 2.0);
    assert!(((y0 + y1) as f64 / 2.0 - (300.0 * scale + dy)).abs() <= 2.0);
    let line_layer = document.layers().into_iter().find(|layer| layer.name == "線").unwrap();
    let line = &document.vector_objects(line_layer).unwrap()[0];
    assert!((line.points[0].0 - (1250.0 * scale + dx)).abs() < 1e-9);
    assert!((line.points[0].1 - (100.0 * scale + dy)).abs() < 1e-9);
    assert_eq!(canvas_page(&output), (0, 1));
    assert_eq!(digest(&sheet_path), std::fs::read(&sheet_path).unwrap());
}

#[test]
fn scales_text_with_the_page() {
    let folder = tempfile::tempdir().unwrap();
    let (sheet_path, template_path) = (sheet(folder.path()), template(folder.path()));
    let sheet = ClipDocument::read(&sheet_path).unwrap();
    let plan = plan_sheet(
        &sheet,
        400,
        560,
        PlanOptions {
            fit: Fit::Cell,
            ..PlanOptions::default()
        },
    )
    .unwrap();
    let page = plan
        .pages
        .iter()
        .find(|page| page.contents.iter().any(|content| content.name == "あ"))
        .unwrap();
    let output = folder.path().join("text.clip");
    let values = vec![(
        "ComicStoryStoryName".to_owned(),
        rusqlite::types::Value::Text("第4話".into()),
    )];
    clip_core::write::page::write_page(&template_path, &sheet, page, &output, Some(5), &values).unwrap();
    let document = ClipDocument::read(&output).unwrap();
    let text = document.layers().into_iter().find(|layer| layer.name == "あ").unwrap();
    let blob: Vec<u8> = document
        .database()
        .query_row(
            "SELECT TextLayerAttributes FROM Layer WHERE MainId = ?1",
            [text.main_id],
            |row| row.get(0),
        )
        .unwrap();
    let size = parse_text_attributes(&blob).unwrap().font_size_pt.unwrap();
    assert!((size - 4.0 * page.transform.scale).abs() < 0.01);
    assert_eq!(canvas_page(&output), (5, 0));
}

#[test]
fn splits_a_sheet_into_a_work() {
    let folder = tempfile::tempdir().unwrap();
    let (sheet_path, template_path) = (sheet(folder.path()), template(folder.path()));
    let cmc_path = build_cmc(&folder.path().join("sheet").join("name.cmc"), &["sheet.clip"]);
    let inputs: Vec<(PathBuf, Vec<u8>)> = [&sheet_path, &template_path, &cmc_path]
        .iter()
        .map(|path| ((*path).clone(), digest(path)))
        .collect();
    let out = folder.path().join("work");
    let options = SplitOptions {
        sheet: sheet_path.clone(),
        template: template_path.clone(),
        out_dir: out.clone(),
        pages: None,
        fit: Fit::Cell,
        order: ReadingOrder::RightToLeft,
        first_page: 1,
        name_pattern: DEFAULT_NAME_PATTERN.into(),
        work: Some(("第1話".into(), cmc_path.clone())),
        story_index: Some(12),
    };
    let report = split_sheet(&options).unwrap();
    assert_eq!(report.pages.len(), 4);
    let project = CmcProject::read(out.join("第1話.cmc")).unwrap();
    let files: Vec<String> = project.pages.iter().map(|page| page.file_name.clone()).collect();
    assert_eq!(
        files,
        (1..=4)
            .map(|number| format!("page{number:04}.clip"))
            .collect::<Vec<_>>()
    );
    assert_eq!(project.story_name, "Story");
    assert_eq!(project.max_canvas_file_index, 4);
    let indexes: Vec<i64> = files.iter().map(|file| canvas_page(&out.join(file)).0).collect();
    assert_eq!(indexes, vec![0, 1, 2, 3]);
    // Every page is its own file for CSP: distinct file ids and layer uuids.
    let mut file_ids = std::collections::HashSet::new();
    let mut uuids = Vec::new();
    for file in &files {
        let document = ClipDocument::read(out.join(file)).unwrap();
        file_ids.insert(document.file_id().to_vec());
        let mut statement = document
            .database()
            .prepare("SELECT LayerUuid FROM Layer WHERE LayerUuid IS NOT NULL")
            .unwrap();
        uuids.extend(
            statement
                .query_map([], |row| row.get::<_, String>(0))
                .unwrap()
                .map(Result::unwrap),
        );
    }
    assert_eq!(file_ids.len(), 4);
    let unique: std::collections::HashSet<&String> = uuids.iter().collect();
    assert!(unique.len() == uuids.len() && uuids.len() > 4);
    // Pages keep the template's Canvas columns: spread-only columns from the
    // sheet would make CSP rebuild the story info of right-hand pages on open.
    for file in &files {
        let document = ClipDocument::read(out.join(file)).unwrap();
        let columns: Vec<String> = document
            .database()
            .prepare("SELECT name FROM pragma_table_info('Canvas')")
            .unwrap()
            .query_map([], |row| row.get(0))
            .unwrap()
            .map(Result::unwrap)
            .collect();
        assert!(!columns.iter().any(|column| column == "ComicStoryRightLayerCreated"));
    }
    // Story info comes from the work's .cmc; --story-index overrides the episode.
    let first = ClipDocument::read(out.join("page0001.clip")).unwrap();
    let (name, index, string, attributes): (String, i64, Vec<u8>, Vec<u8>) = first
        .database()
        .query_row(
            "SELECT c.ComicStoryStoryName, c.ComicStoryStoryIndex, l.TextLayerString, l.TextLayerAttributes \
             FROM Canvas c, Layer l WHERE l.ComicStoryInfoType = 1",
            [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )
        .unwrap();
    assert_eq!((name.as_str(), index), ("Story", 12));
    assert_eq!(String::from_utf8(string).unwrap(), "作品 12話");
    let runs = parse_tlv(&attributes)
        .unwrap()
        .into_iter()
        .find(|(tag, _)| *tag == 0x0B)
        .unwrap()
        .1
        .to_vec();
    assert_eq!(u32::from_le_bytes(runs[8..12].try_into().unwrap()), 7);
    // CSP would show its cached image of "作品 3話" (TLV 0x32) instead of the text.
    let cache = parse_tlv(&attributes)
        .unwrap()
        .into_iter()
        .find(|(tag, _)| *tag == 0x32)
        .unwrap()
        .1
        .to_vec();
    assert_eq!(cache, 0u32.to_le_bytes());
    let work = rusqlite::Connection::open(out.join("第1話.cmc")).unwrap();
    let story_index: i64 = work
        .query_row("SELECT ComicStoryStoryIndex FROM Project", [], |row| row.get(0))
        .unwrap();
    assert_eq!(story_index, 12);
    for (path, before) in inputs {
        assert_eq!(digest(&path), before, "{} changed", path.display());
    }
    // The output folder may not be an input folder.
    let same = SplitOptions {
        out_dir: sheet_path.parent().unwrap().to_path_buf(),
        ..options
    };
    assert!(split_sheet(&same).is_err());
}

#[test]
fn a_left_bound_name_stays_left_bound_from_a_right_bound_work() {
    use clip_core::write::raster_page::{PageLayer, RasterLayer, RasterWorkWriter, WorkOptions};
    let folder = tempfile::tempdir().unwrap();
    let template_path = template(folder.path());
    // The template work and its page are right-bound (ComicBindPosition 1).
    let cmc_path = build_cmc(&folder.path().join("template").join("name.cmc"), &["page.clip"]);
    let options = |right_binding: Option<bool>, out: &str| WorkOptions {
        template: template_path.clone(),
        out_dir: folder.path().join(out),
        name_pattern: DEFAULT_NAME_PATTERN.into(),
        work: Some(("左綴じ".into(), cmc_path.clone())),
        story_index: None,
        inputs: Vec::new(),
        donor_sources: Vec::new(),
        draft_layers: Vec::new(),
        layer_looks: Vec::new(),
        frame_folders: false,
        right_binding,
    };
    let bind = |right_binding: Option<bool>, out: &str| {
        let mut writer = RasterWorkWriter::new(options(right_binding, out)).unwrap();
        let layer = PageLayer::Raster(RasterLayer {
            name: "ラフ".into(),
            image: RgbaImage::new(400, 560),
        });
        writer.write_page(&[layer], None, false).unwrap();
        let first_left = writer.first_page_left;
        let report = writer.finish().unwrap();
        let work = CmcProject::read(report.work.unwrap()).unwrap();
        let page: (i64, i64) = ClipDocument::read(&report.pages[0])
            .unwrap()
            .database()
            .query_row("SELECT ComicBindPosition, ComicIsLeftPage FROM Canvas", [], |row| {
                Ok((row.get(0)?, row.get(1)?))
            })
            .unwrap();
        (work.binding_position, work.start_page, page, first_left)
    };
    // The template's first page is a left page; left-bound, the book starts on the right.
    assert_eq!(bind(Some(false), "left"), (0, 1, (0, 0), Some(false)));
    assert_eq!(bind(Some(true), "right"), (1, 0, (1, 1), Some(true)));
    // Without a binding, the template's stays.
    let (binding, _, page, first_left) = bind(None, "as-is");
    assert_eq!((binding, page, first_left), (1, (1, 1), Some(true)));
}

#[test]
fn writes_whole_page_raster_layers_into_a_work() {
    use clip_core::write::raster_page::{PageLayer, RasterLayer, RasterWorkWriter, WorkOptions};
    let folder = tempfile::tempdir().unwrap();
    let template_path = template(folder.path());
    let cmc_path = build_cmc(&folder.path().join("template").join("name.cmc"), &["page.clip"]);
    let before = digest(&template_path);
    let out = folder.path().join("work");
    let mut writer = RasterWorkWriter::new(WorkOptions {
        template: template_path.clone(),
        out_dir: out.clone(),
        name_pattern: DEFAULT_NAME_PATTERN.into(),
        work: Some(("第2話".into(), cmc_path.clone())),
        story_index: Some(2),
        inputs: Vec::new(),
        donor_sources: Vec::new(),
        draft_layers: Vec::new(),
        layer_looks: Vec::new(),
        frame_folders: false,
        right_binding: None,
    })
    .unwrap();
    assert_eq!((writer.canvas.width_px, writer.canvas.height_px), (400, 560));
    // Panels drawn at half size are scaled up to the page; balloons stay empty.
    let mut frame = RgbaImage::new(200, 280);
    frame.paste(
        &RgbaImage {
            width: 50,
            height: 40,
            pixels: [0, 0, 0, 255].repeat(2000),
        },
        20,
        30,
    );
    for _ in 0..2 {
        writer
            .write_page(
                &[
                    PageLayer::Raster(RasterLayer {
                        name: "コマ枠".into(),
                        image: frame.clone(),
                    }),
                    PageLayer::Raster(RasterLayer {
                        name: "フキダシ".into(),
                        image: RgbaImage::new(400, 560),
                    }),
                ],
                None,
                false,
            )
            .unwrap();
    }
    let report = writer.finish().unwrap();
    assert_eq!(report.pages.len(), 2);
    assert_eq!(digest(&template_path), before);
    let project = CmcProject::read(report.work.unwrap()).unwrap();
    assert_eq!(project.pages.len(), 2);
    let page = ClipDocument::read(&report.pages[1]).unwrap();
    assert_eq!(canvas_page(&report.pages[1]).0, 1);
    let names: Vec<&str> = page.root.children.iter().map(|layer| layer.name.as_str()).collect();
    assert_eq!(&names[names.len() - 2..], ["コマ枠", "フキダシ"]);
    let frame_layer = page.root.children.iter().find(|layer| layer.name == "コマ枠").unwrap();
    let pixels = page.render_layer_pixels(frame_layer).unwrap().unwrap();
    let (x0, y0, x1, y1) = pixels.alpha_bbox().unwrap();
    // Lanczos leaves a faint fringe a few pixels wide.
    let near = |a: u32, b: u32| a.abs_diff(b) <= 6;
    assert!(
        near(x0, 40) && near(y0, 60) && near(x1, 140) && near(y1, 140),
        "{:?}",
        (x0, y0, x1, y1)
    );
    // Writing into the template's folder would risk the originals.
    let refused = RasterWorkWriter::new(WorkOptions {
        template: template_path.clone(),
        out_dir: folder.path().join("template"),
        name_pattern: DEFAULT_NAME_PATTERN.into(),
        work: None,
        story_index: None,
        inputs: Vec::new(),
        donor_sources: Vec::new(),
        draft_layers: Vec::new(),
        layer_looks: Vec::new(),
        frame_folders: false,
        right_binding: None,
    });
    assert!(refused.is_err());
}

#[test]
fn writes_vector_and_text_layers_copied_from_the_sheet() {
    use clip_core::LayerKind;
    use clip_core::text::NewText;
    use clip_core::vector::NewVectorLine;
    use clip_core::write::raster_page::{BUILT_IN_PARTS, PageLayer, PartDonors, RasterWorkWriter, WorkOptions};
    let folder = tempfile::tempdir().unwrap();
    let template_path = template(folder.path());
    let sheet_path = sheet(folder.path());
    let sheet_before = digest(&sheet_path);
    let options = |donor_sources: Vec<PathBuf>| WorkOptions {
        template: template_path.clone(),
        out_dir: folder.path().join("out"),
        name_pattern: DEFAULT_NAME_PATTERN.into(),
        work: None,
        story_index: None,
        inputs: vec![sheet_path.clone()],
        donor_sources,
        draft_layers: Vec::new(),
        layer_looks: Vec::new(),
        frame_folders: false,
        right_binding: None,
    };
    // The template has no vector or text layer to copy: without the sheet
    // they come from csp-format's built-in parts.
    let bare = RasterWorkWriter::new(options(Vec::new())).unwrap();
    let from = |donor: &Option<PartDonors>| donor.as_ref().map(|donor| donor.path().to_path_buf());
    let built_in = Some(PathBuf::from(BUILT_IN_PARTS));
    assert_eq!(
        (from(&bare.donors.vector), from(&bare.donors.text)),
        (built_in.clone(), built_in)
    );
    drop(bare);
    // A copy of the sheet next to the template is found without being named.
    let beside = template_path.with_file_name("page0002.clip");
    std::fs::copy(&sheet_path, &beside).unwrap();
    let found = RasterWorkWriter::new(options(Vec::new())).unwrap();
    let beside_path = Some(beside.clone());
    assert_eq!(
        (from(&found.donors.vector), from(&found.donors.text)),
        (beside_path.clone(), beside_path)
    );
    drop(found);
    std::fs::remove_file(&beside).unwrap();
    let panel = NewVectorLine {
        points: vec![
            (20.0, 30.0, 1.0),
            (380.0, 30.0, 1.0),
            (380.0, 250.0, 1.0),
            (20.0, 250.0, 1.0),
        ],
        closed: true,
        width_px: 6.0,
    };
    let stroke = NewVectorLine {
        points: vec![(50.0, 300.0, 0.2), (120.0, 340.0, 0.9)],
        closed: false,
        width_px: 3.0,
    };
    let text = NewText {
        text: "こんにちは\nせかい".into(),
        frame: [300, 60, 340, 200],
        font_size_pt: 7.5,
        vertical: true,
        color: None,
        font: None,
        line_spacing: None,
    };
    let layers = [
        PageLayer::Vector {
            name: "コマ枠".into(),
            lines: vec![panel.clone()],
        },
        PageLayer::Vector {
            name: "ラフ線".into(),
            lines: vec![stroke.clone()],
        },
        PageLayer::Text(text.clone()),
    ];
    let mut writer = RasterWorkWriter::new(options(vec![sheet_path.clone()])).unwrap();
    assert!(writer.donors.vector.is_some() && writer.donors.text.is_some());
    let page_path = writer.write_page(&layers, None, false).unwrap();
    writer.finish().unwrap();
    assert_eq!(digest(&sheet_path), sheet_before);

    let page = ClipDocument::read(&page_path).unwrap();
    let find = |name: &str| {
        page.layers()
            .into_iter()
            .find(|layer| layer.name == name)
            .unwrap()
            .clone()
    };
    // Vector lines find their brush styles through Canvas; without it CSP
    // opens the layers empty.
    let manager: i64 = page
        .database()
        .query_row("SELECT BrushStyleManager FROM Canvas", [], |row| row.get(0))
        .unwrap();
    let managers: i64 = page
        .database()
        .query_row(
            "SELECT COUNT(*) FROM BrushStyleManager WHERE MainId = ?1",
            [manager],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!((manager, managers), (8, 1));
    let frame = find("コマ枠");
    assert_eq!(frame.kind, LayerKind::Vector);
    let objects = page.vector_objects(&frame).unwrap();
    assert_eq!(objects.len(), 1);
    // CSP marks a closed polyline (折れ線 with 線を閉じる) with 0x100.
    assert_eq!(objects[0].flags, 0x111);
    assert_eq!(
        objects[0].points,
        vec![(20.0, 30.0), (380.0, 30.0), (380.0, 250.0), (20.0, 250.0)]
    );
    assert_eq!(objects[0].brush_size, 3.0);
    let rough = page.vector_objects(&find("ラフ線")).unwrap();
    assert_eq!(rough[0].flags, 0x11);
    assert_eq!(rough[0].points.len(), 2);

    let said = find("こんにちは");
    assert_eq!(said.kind, LayerKind::Text);
    assert_eq!(page.text_strings(&said), vec!["こんにちは\r\nせかい".to_owned()]);
    // CSP shows garbage for text stored as TEXT instead of a blob.
    let stored: rusqlite::types::Value = page
        .database()
        .query_row(
            "SELECT TextLayerString FROM Layer WHERE MainId = ?1",
            [said.main_id],
            |row| row.get(0),
        )
        .unwrap();
    assert!(matches!(stored, rusqlite::types::Value::Blob(_)));
    let attributes = &page.text_blocks(&said).unwrap()[0];
    assert_eq!(attributes.font_size_pt, Some(7.5));
    assert_eq!(attributes.bbox, Some((300, 60, 340, 200)));
    // The sheet's text, folder and other layers are not copied along.
    assert!(
        page.layers()
            .iter()
            .all(|layer| layer.name != "あ" && layer.name != "テンプレート")
    );
}

#[test]
fn checks_written_pages_and_works() {
    use clip_core::text::NewText;
    use clip_core::vector::NewVectorLine;
    use clip_core::write::raster_page::{PageLayer, RasterLayer, RasterWorkWriter, WorkOptions};
    use clip_core::write::verify::{ExpectedLayer, check_clip, verify_page, verify_work};
    let folder = tempfile::tempdir().unwrap();
    let template_path = template(folder.path());
    let sheet_path = sheet(folder.path());
    let cmc_path = build_cmc(&folder.path().join("template").join("name.cmc"), &["page.clip"]);
    let mut writer = RasterWorkWriter::new(WorkOptions {
        template: template_path.clone(),
        out_dir: folder.path().join("out"),
        name_pattern: DEFAULT_NAME_PATTERN.into(),
        work: Some(("確認".into(), cmc_path)),
        story_index: None,
        inputs: vec![sheet_path.clone()],
        donor_sources: vec![sheet_path.clone()],
        draft_layers: vec!["ラフ".into()],
        layer_looks: Vec::new(),
        frame_folders: false,
        right_binding: None,
    })
    .unwrap();
    let mut rough = RgbaImage::new(200, 280);
    rough.paste(
        &RgbaImage {
            width: 30,
            height: 20,
            pixels: [0, 0, 0, 255].repeat(600),
        },
        100,
        150,
    );
    let white = NewText {
        text: "白抜き".into(),
        frame: [300, 60, 340, 200],
        font_size_pt: 8.0,
        vertical: true,
        color: Some([255, 255, 255]),
        font: None,
        line_spacing: None,
    };
    let layers = vec![
        PageLayer::Raster(RasterLayer {
            name: "ラフ".into(),
            image: rough,
        }),
        PageLayer::Raster(RasterLayer {
            name: "空".into(),
            image: RgbaImage::new(400, 560),
        }),
        PageLayer::Vector {
            name: "コマ枠".into(),
            lines: vec![NewVectorLine {
                points: vec![(20.0, 30.0, 1.0), (380.0, 30.0, 1.0), (380.0, 250.0, 1.0)],
                closed: true,
                width_px: 4.0,
            }],
        },
        PageLayer::Text(white.clone()),
    ];
    let (width, height) = (writer.canvas.width_px, writer.canvas.height_px);
    let expected: Vec<ExpectedLayer> = layers
        .iter()
        .map(|layer| ExpectedLayer::of(layer, width, height))
        .collect();
    assert_eq!(
        expected[0],
        ExpectedLayer::Raster {
            name: "ラフ".into(),
            bbox: Some([200.0, 300.0, 260.0, 340.0])
        }
    );
    let canvas = writer.canvas;
    let page = writer.write_page(&layers, None, false).unwrap();
    let report = writer.finish().unwrap();
    let check = verify_page(&page, &expected, &canvas);
    assert!(check.ok(), "{:?}", check.problems);
    assert_eq!((check.vector_lines, check.texts), (1, 1));
    assert!(check_clip(&page).ok());
    // The rough is a 下描き layer at half opacity, the others as they were.
    let written = ClipDocument::read(&page).unwrap();
    let opacity = |name: &str| {
        written
            .layers()
            .iter()
            .find(|layer| layer.name == name)
            .unwrap()
            .opacity
    };
    assert_eq!((opacity("ラフ"), opacity("空")), (0.5, 1.0));
    let work = report.work.unwrap();
    assert!(verify_work(&work, Some(&report.pages)).ok());

    // What the page was meant to hold, but is not there.
    let mut wrong = expected.clone();
    wrong[0] = ExpectedLayer::Raster {
        name: "ラフ".into(),
        bbox: Some([10.0, 10.0, 60.0, 60.0]),
    };
    wrong[1] = ExpectedLayer::Raster {
        name: "空".into(),
        bbox: Some([0.0, 0.0, 10.0, 10.0]),
    };
    wrong[2] = ExpectedLayer::Vector {
        name: "コマ枠".into(),
        lines: 2,
    };
    wrong[3] = ExpectedLayer::Text {
        text: "白抜き".into(),
        color: Some([0, 0, 0]),
    };
    let problems = verify_page(&page, &wrong, &canvas).problems;
    assert_eq!(problems.len(), 4, "{problems:?}");
    assert!(problems[0].contains("ずれ") && problems[1].contains("空です"));
    assert!(problems[2].contains("1 本") && problems[3].contains("#ffffff"));

    // The faults CSP has shown: vectors without the brush style manager.
    let broken = folder.path().join("broken.clip");
    let editor = ClipFile::open(&page).unwrap();
    editor
        .database()
        .execute("UPDATE Canvas SET BrushStyleManager = NULL", [])
        .unwrap();
    editor.save(&broken).unwrap();
    let problems = check_clip(&broken).problems;
    assert!(
        problems.iter().any(|problem| problem.contains("BrushStyleManager")),
        "{problems:?}"
    );

    // A work whose page went missing.
    std::fs::remove_file(&report.pages[0]).unwrap();
    let problems = verify_work(&work, None).problems;
    assert!(problems[0].contains("ありません"), "{problems:?}");
}

/// The template with a 仕上がり枠 of 30 x 50 mm (300 x 500 px), as spreads need.
fn trimmed_template(folder: &Path) -> PathBuf {
    let path = folder.join("template").join("page-trim.clip");
    let editor = ClipFile::open(template(folder)).unwrap();
    editor
        .database()
        .execute_batch(
            "ALTER TABLE Canvas ADD COLUMN CropFrameUnitKind;
             ALTER TABLE Canvas ADD COLUMN CropFrameWidth;
             ALTER TABLE Canvas ADD COLUMN CropFrameHeight;
             UPDATE Canvas SET CropFrameUnitKind = 2, CropFrameWidth = 30.0, CropFrameHeight = 50.0;",
        )
        .unwrap();
    editor.save(&path).unwrap();
    path
}

/// (text, bbox x0, x1, for the right page) of each story info layer of `kind`.
fn story_texts(path: &Path, kind: i64) -> Vec<(String, i32, i32, bool)> {
    let document = ClipDocument::read(path).unwrap();
    let mut statement = document
        .database()
        .prepare(
            "SELECT TextLayerString, TextLayerAttributes, IFNULL(ComicStoryInfoForRightPage, 0), LayerOffsetX
             FROM Layer WHERE ComicStoryInfoType = ?1 ORDER BY MainId",
        )
        .unwrap();
    statement
        .query_map([kind], |row| {
            let text: Vec<u8> = row.get(0)?;
            let attributes: Vec<u8> = row.get(1)?;
            let right: i64 = row.get(2)?;
            let offset: i64 = row.get(3)?;
            Ok((text, attributes, right != 0, offset))
        })
        .unwrap()
        .map(Result::unwrap)
        .map(|(text, attributes, right, offset)| {
            let items = parse_tlv(&attributes).unwrap();
            let bbox = items
                .iter()
                .find(|(tag, _)| *tag == 0x2A)
                .map(|(_, bbox)| bbox.as_slice());
            let x = |at: usize| {
                bbox.map(|bbox| i32::from_le_bytes(bbox[at..at + 4].try_into().unwrap()) + offset as i32)
                    .unwrap_or(0)
            };
            (String::from_utf8(text).unwrap(), x(0), x(8), right)
        })
        .collect()
}

#[test]
fn writes_spread_pages() {
    use clip_core::write::raster_page::{PageLayer, RasterLayer, RasterWorkWriter, WorkOptions};
    use clip_core::write::spread::{SpreadLayout, make_spread_template};
    use clip_core::write::verify::{ExpectedLayer, verify_page, verify_work};
    let folder = tempfile::tempdir().unwrap();
    let template_path = trimmed_template(folder.path());
    let before = digest(&template_path);

    // The two pages' trims meet at the middle; single-page frame settings.
    let spread_path = folder.path().join("spread.clip");
    let layout = make_spread_template(&template_path, &spread_path).unwrap();
    assert_eq!(digest(&template_path), before);
    assert_eq!(
        layout,
        SpreadLayout {
            width_px: 800,
            height_px: 560,
            gutter_px: 400.0,
            left_dx: 50.0,
            right_dx: 350.0
        }
    );
    let spread = ClipDocument::read(&spread_path).unwrap();
    assert!(spread.canvas.is_double_page);
    assert_eq!((spread.canvas.width_px, spread.canvas.height_px), (800, 560));
    assert_eq!(spread.canvas.crop_size_px, Some((300, 500)));
    let (left, flag): (i64, i64) = spread
        .database()
        .query_row("SELECT ComicIsLeftPage, CropFrameOptionFlag FROM Canvas", [], |row| {
            Ok((row.get(0)?, row.get(1)?))
        })
        .unwrap();
    assert_eq!((left, flag), (0, 17));
    // Every render image is as wide as the spread (padded to blocks) at
    // full size; the smaller zoom levels halve it.
    let mut statement = spread
        .database()
        .prepare(
            "SELECT o.Attribute FROM Mipmap m JOIN MipmapInfo i ON i.MainId = m.BaseMipmapInfo
             JOIN Offscreen o ON o.MainId = i.Offscreen",
        )
        .unwrap();
    let widths: Vec<(u32, u32)> = statement
        .query_map([], |row| row.get::<_, Vec<u8>>(0))
        .unwrap()
        .map(|attribute| {
            let attribute = attribute.unwrap();
            let parameters = clip_core::offscreen::parameters(&attribute).unwrap();
            // BlockSize: one entry per block, at the end of the attribute.
            let count = u32::from_be_bytes(
                attribute[attribute.len() - 4 * (parameters.blocks_x * parameters.blocks_y) as usize - 8..][..4]
                    .try_into()
                    .unwrap(),
            );
            assert_eq!(count, parameters.blocks_x * parameters.blocks_y);
            (parameters.width, parameters.blocks_x)
        })
        .collect();
    assert!(!widths.is_empty());
    assert!(
        widths.iter().all(|(width, _)| [800, 1024].contains(width)),
        "{widths:?}"
    );
    // 作品情報 and ノンブル for each page; the ノンブル at each binding edge.
    let nombres = story_texts(&spread_path, 2);
    assert_eq!(
        nombres
            .iter()
            .map(|(_, x0, x1, right)| (*x0, *x1, *right))
            .collect::<Vec<_>>(),
        vec![(430, 440, false), (359, 369, true)]
    );
    let stories: Vec<bool> = story_texts(&spread_path, 1).into_iter().map(|story| story.3).collect();
    assert_eq!(stories, [false, true]);

    // A work: page 1, the spread of pages 2-3, page 4.
    let cmc_path = build_cmc(&folder.path().join("template").join("name.cmc"), &["page.clip"]);
    let mut writer = RasterWorkWriter::new(WorkOptions {
        template: template_path.clone(),
        out_dir: folder.path().join("out"),
        name_pattern: DEFAULT_NAME_PATTERN.into(),
        work: Some(("見開き".into(), cmc_path)),
        story_index: None,
        inputs: Vec::new(),
        donor_sources: Vec::new(),
        draft_layers: Vec::new(),
        layer_looks: Vec::new(),
        frame_folders: false,
        right_binding: None,
    })
    .unwrap();
    assert_eq!(writer.first_page_left, Some(true));
    let canvas = writer.spread_canvas().unwrap();
    assert_eq!((canvas.width_px, canvas.height_px), (800, 560));
    let mut wide = RgbaImage::new(800, 560);
    wide.paste(
        &RgbaImage {
            width: 40,
            height: 40,
            pixels: [0, 0, 0, 255].repeat(1600),
        },
        600,
        100,
    );
    let page = |image: RgbaImage| {
        vec![PageLayer::Raster(RasterLayer {
            name: "コマ枠".into(),
            image,
        })]
    };
    writer.write_page(&page(RgbaImage::new(400, 560)), None, false).unwrap();
    let layers = page(wide);
    let expected: Vec<ExpectedLayer> = layers.iter().map(|layer| ExpectedLayer::of(layer, 800, 560)).collect();
    let spread_page = writer.write_page(&layers, None, true).unwrap();
    let check = verify_page(&spread_page, &expected, &canvas);
    assert!(check.problems.is_empty(), "{:?}", check.problems);
    let last = writer.write_page(&page(RgbaImage::new(400, 560)), None, false).unwrap();
    let report = writer.finish().unwrap();
    let names: Vec<String> = report
        .pages
        .iter()
        .map(|path| path.file_name().unwrap().to_string_lossy().into_owned())
        .collect();
    assert_eq!(names, ["page0001.clip", "page0002.clip", "page0004.clip"]);
    // Pages 2 (right) and 3 (left) on the spread; page 4 is a right page.
    let numbers: Vec<(String, bool)> = story_texts(&spread_page, 2)
        .into_iter()
        .map(|(text, _, _, right)| (text, right))
        .collect();
    assert_eq!(numbers, [("3".to_owned(), false), ("2".to_owned(), true)]);
    assert_eq!(canvas_page(&spread_page), (1, 0));
    assert_eq!(canvas_page(&last), (3, 0));
    let work = report.work.unwrap();
    let check = verify_work(&work, Some(&report.pages));
    assert!(check.problems.is_empty(), "{:?}", check.problems);
    let project = CmcProject::read(&work).unwrap();
    let spreads: Vec<bool> = project.pages.iter().map(|page| page.page_flag == 1).collect();
    assert_eq!(spreads, [false, true, false]);
    assert_eq!(digest(&template_path), before);
}

#[test]
fn writes_panels_as_a_frame_folder_copied_from_a_finished_page() {
    use clip_core::LayerKind;
    use clip_core::vector::{NewFrame, parse_vector_data};
    use clip_core::write::raster_page::{PageLayer, RasterWorkWriter, WorkOptions};
    use clip_core::write::verify::{ExpectedLayer, verify_page};
    let folder = tempfile::tempdir().unwrap();
    let template_path = template(folder.path());
    // A finished page: one frame folder of two panels with the drawing in it.
    std::fs::create_dir_all(folder.path().join("finished")).unwrap();
    let finished = build_editable_clip(
        &folder.path().join("finished").join("page0011.clip"),
        PAGE,
        vec![
            FixtureLayer::paper(2),
            FixtureLayer::raster(3, "レイヤー 1", vec![(0, (0, 0, 0, 0))]),
            FixtureLayer::frame_folder(
                10,
                "コマ 1",
                vec![
                    rectangle(20.0, 20.0, 380.0, 200.0),
                    rectangle(20.0, 210.0, 380.0, 540.0),
                ],
                vec![FixtureLayer::raster(11, "ペン入れ", vec![(0, (5, 5, 20, 20))])],
            ),
        ],
    );
    let finished_before = digest(&finished);
    let options = |frame_folders: bool| WorkOptions {
        template: template_path.clone(),
        out_dir: folder.path().join("out"),
        name_pattern: DEFAULT_NAME_PATTERN.into(),
        work: None,
        story_index: None,
        inputs: vec![finished.clone()],
        donor_sources: vec![finished.clone()],
        draft_layers: Vec::new(),
        layer_looks: Vec::new(),
        frame_folders,
        right_binding: None,
    };
    // Only looked for when asked (finished pages are big to read).
    assert!(RasterWorkWriter::new(options(false)).unwrap().donors.frame.is_none());
    let mut writer = RasterWorkWriter::new(options(true)).unwrap();
    assert!(writer.donors.frame.is_some());
    // A slanted panel: its corners are not right angles.
    let frames = vec![
        NewFrame {
            points: vec![(30.0, 30.0), (370.0, 30.0), (370.0, 180.0), (30.0, 220.0)],
            width_px: 4.0,
        },
        NewFrame {
            points: vec![(30.0, 230.0), (370.0, 190.0), (370.0, 530.0), (30.0, 530.0)],
            width_px: 4.0,
        },
    ];
    let layers = vec![PageLayer::Frames {
        name: "コマ".into(),
        frames: frames.clone(),
        ink: Some("ペン入れ".into()),
    }];
    let canvas = writer.canvas;
    let expected: Vec<ExpectedLayer> = layers
        .iter()
        .map(|layer| ExpectedLayer::of(layer, canvas.width_px, canvas.height_px))
        .collect();
    let page = writer.write_page(&layers, None, false).unwrap();
    writer.finish().unwrap();
    assert_eq!(digest(&finished), finished_before);
    let check = verify_page(&page, &expected, &canvas);
    assert!(check.ok(), "{:?}", check.problems);

    let written = ClipDocument::read(&page).unwrap();
    let folder_layer = written
        .layers()
        .into_iter()
        .find(|layer| layer.kind == LayerKind::FrameFolder)
        .unwrap()
        .clone();
    assert_eq!(folder_layer.name, "コマ");
    // The donor's drawing is not copied, only the new empty layer to ink on.
    let inside: Vec<&str> = folder_layer.children.iter().map(|child| child.name.as_str()).collect();
    assert_eq!(inside, ["ペン入れ"]);
    let payload = written.vector_payloads(&folder_layer).unwrap()[0].to_vec();
    let objects = parse_vector_data(&payload).unwrap();
    assert_eq!(objects.len(), 2);
    assert_eq!(objects[0].points, frames[0].points);
    assert_eq!(objects[0].flags, 0x1118);
    assert_eq!(objects[0].brush_size, 2.0);
    // Each corner: the miter length and the outward bisector (CSP's layout).
    let corner = |object: usize, index: usize| {
        let mut offset = 8;
        for _ in 0..object {
            offset += 96 + 88 * parse_vector_data(&payload).unwrap()[0].points.len();
        }
        let at = offset + 96 + 88 * index + 64;
        let f = |o: usize| f32::from_be_bytes(payload[at + o..at + o + 4].try_into().unwrap());
        (f(0), f(4), f(8))
    };
    let (miter, nx, ny) = corner(0, 0);
    assert!(
        (miter - 2.0 * 2f32.sqrt()).abs() < 1e-4 && nx < 0.0 && ny < 0.0,
        "{miter} {nx} {ny}"
    );
    let (_, nx, ny) = corner(0, 2);
    assert!(nx > 0.0 && ny > 0.0);
    // Mask and border images are left for CSP to draw from the frames: no
    // pixels stored, and the mask has one plane.
    let row = written.layer_row(folder_layer.main_id).unwrap();
    let base = |mipmap: i64| -> (Vec<u8>, String) {
        written
            .database()
            .query_row(
                "SELECT o.Attribute, o.BlockData FROM Mipmap m JOIN MipmapInfo i ON i.MainId = m.BaseMipmapInfo \
                 JOIN Offscreen o ON o.MainId = i.Offscreen WHERE m.MainId = ?1",
                [mipmap],
                |row| {
                    Ok((
                        row.get(0)?,
                        String::from_utf8_lossy(&row.get::<_, Vec<u8>>(1)?).into_owned(),
                    ))
                },
            )
            .unwrap()
    };
    let (mask, mask_block) = base(row.int("LayerLayerMaskMipmap"));
    let (line, line_block) = base(row.int("ComicFrameLineMipmap"));
    let (mask, line) = (
        clip_core::offscreen::parameters(&mask).unwrap(),
        clip_core::offscreen::parameters(&line).unwrap(),
    );
    assert_eq!((mask.channel_order, mask.pixel_bytes, mask.image_channels), (1, 1, 0));
    assert_eq!((line.channel_order, line.pixel_bytes), (33, 5));
    for block in [mask_block, line_block] {
        assert!(block.starts_with("extrnlid") && written.external_payload(&block).is_none());
    }
}

#[test]
fn writes_a_panel_as_a_folder_with_a_layer_mask() {
    use clip_core::LayerKind;
    use clip_core::vector::NewVectorLine;
    use clip_core::write::raster_page::{PageLayer, RasterLayer, RasterWorkWriter, WorkOptions, page_record};
    use clip_core::write::verify::{ExpectedLayer, verify_page};
    let folder = tempfile::tempdir().unwrap();
    let template_path = template(folder.path());
    let sheet_path = sheet(folder.path());
    let mut writer = RasterWorkWriter::new(WorkOptions {
        template: template_path.clone(),
        out_dir: folder.path().join("out"),
        name_pattern: DEFAULT_NAME_PATTERN.into(),
        work: None,
        story_index: None,
        inputs: vec![sheet_path.clone()],
        donor_sources: vec![sheet_path],
        draft_layers: vec!["ラフ線".into()],
        layer_looks: Vec::new(),
        frame_folders: false,
        right_binding: None,
    })
    .unwrap();
    let canvas = writer.canvas;
    assert_eq!((canvas.width_px, canvas.height_px), (400, 560));
    // The panel, at half the page's size (as the app sends its images).
    let mut mask = RgbaImage::new(200, 280);
    for y in 10..100 {
        for x in 10..150 {
            mask.pixels[(y * 200 + x) * 4 + 3] = 255;
        }
    }
    // A line that runs out of the panel: kept whole, hidden outside it.
    let line = NewVectorLine {
        points: vec![(40.0, 40.0, 1.0), (390.0, 300.0, 1.0)],
        closed: false,
        width_px: 3.0,
    };
    let layers = vec![
        PageLayer::Folder {
            name: "コマ1".into(),
            mask: Some(mask),
            children: vec![
                PageLayer::Vector {
                    name: "ラフ線".into(),
                    lines: vec![line],
                },
                PageLayer::Raster(RasterLayer {
                    name: "ペン入れ".into(),
                    image: RgbaImage::new(400, 560),
                }),
            ],
        },
        PageLayer::Folder {
            name: "コマ2".into(),
            mask: None,
            children: vec![PageLayer::Raster(RasterLayer {
                name: "ペン入れ".into(),
                image: RgbaImage::new(400, 560),
            })],
        },
    ];
    let expected: Vec<ExpectedLayer> = layers
        .iter()
        .map(|layer| ExpectedLayer::of(layer, canvas.width_px, canvas.height_px))
        .collect();
    let page = writer.write_page(&layers, None, false).unwrap();
    writer.finish().unwrap();
    let check = verify_page(&page, &expected, &canvas);
    assert!(check.ok(), "{:?}", check.problems);

    let written = ClipDocument::read(&page).unwrap();
    let top = &written.root.children;
    let (first, second) = (&top[top.len() - 2], &top[top.len() - 1]);
    assert_eq!((first.kind, first.name.as_str()), (LayerKind::Folder, "コマ1"));
    assert!(first.has_mask && !second.has_mask);
    let inside: Vec<(&str, LayerKind)> = first
        .children
        .iter()
        .map(|child| (child.name.as_str(), child.kind))
        .collect();
    assert_eq!(inside, [("ラフ線", LayerKind::Vector), ("ペン入れ", LayerKind::Raster)]);
    // Saved as CSP saves a folder with a mask: type 2, mask in use, no colour settings.
    let row = written.layer_row(first.main_id).unwrap();
    assert_eq!(
        (row.int("LayerType"), row.int("LayerFolder"), row.int("LayerVisibility")),
        (2, 1, 3)
    );
    let plain = written.layer_row(second.main_id).unwrap();
    assert_eq!((plain.int("LayerType"), plain.int("LayerVisibility")), (0, 1));
    // The rough inside the folder is a 下描き layer, as at the top level.
    let rough = written.layer_row(first.children[0].main_id).unwrap();
    assert_eq!(rough.int("LayerOpacity"), 128);
    // The mask is the page's size, one 8-bit plane, opaque inside the panel only.
    let attribute: Vec<u8> = written
        .database()
        .query_row(
            "SELECT o.Attribute FROM Mipmap m JOIN MipmapInfo i ON i.MainId = m.BaseMipmapInfo \
             JOIN Offscreen o ON o.MainId = i.Offscreen WHERE m.MainId = ?1",
            [row.int("LayerLayerMaskMipmap")],
            |row| row.get(0),
        )
        .unwrap();
    let parameters = clip_core::offscreen::parameters(&attribute).unwrap();
    assert_eq!(
        (
            parameters.width,
            parameters.height,
            parameters.channel_order,
            parameters.image_channels,
            parameters.pixel_bytes
        ),
        (400, 560, 1, 0, 1)
    );
    let pixels = written.layer_mask_pixels(first).unwrap().unwrap();
    let alpha = |x: usize, y: usize| pixels.pixels[(y * 400 + x) * 4 + 3];
    assert_eq!((alpha(100, 100), alpha(350, 400), alpha(5, 5)), (255, 0, 0));
    let (x0, y0, x1, y1) = pixels.alpha_bbox().unwrap();
    assert!(
        x0.abs_diff(20) <= 2 && y0.abs_diff(20) <= 2 && x1.abs_diff(300) <= 2 && y1.abs_diff(200) <= 2,
        "{:?}",
        (x0, y0, x1, y1)
    );
    // What went in is recorded under the folder's name.
    let record = page_record(&layers, &[]);
    assert!(record.vectors.contains_key("コマ1/ラフ線"), "{:?}", record.vectors);
}

#[test]
fn writes_rough_layers_hidden_and_fainter_as_set() {
    use clip_core::write::raster_page::{LayerLook, PageLayer, RasterLayer, RasterWorkWriter, WorkOptions};
    let folder = tempfile::tempdir().unwrap();
    let template_path = template(folder.path());
    let raster = |name: &str| {
        let mut image = RgbaImage::new(400, 560);
        image.pixels[3] = 255;
        PageLayer::Raster(RasterLayer {
            name: name.into(),
            image,
        })
    };
    let mut writer = RasterWorkWriter::new(WorkOptions {
        template: template_path,
        out_dir: folder.path().join("out"),
        name_pattern: DEFAULT_NAME_PATTERN.into(),
        work: None,
        story_index: None,
        inputs: Vec::new(),
        donor_sources: Vec::new(),
        draft_layers: vec!["人物".into(), "背景".into(), "指示".into()],
        layer_looks: vec![
            LayerLook {
                name: "人物".into(),
                opacity: 0.5,
                hidden: true,
                whole: false,
            },
            LayerLook {
                name: "効果".into(),
                opacity: 0.25,
                hidden: false,
                whole: false,
            },
            LayerLook {
                name: "指示".into(),
                opacity: 0.75,
                hidden: false,
                whole: true,
            },
        ],
        frame_folders: false,
        right_binding: None,
    })
    .unwrap();
    let page = writer
        .write_page(
            &[raster("人物"), raster("背景"), raster("効果"), raster("指示")],
            None,
            false,
        )
        .unwrap();
    writer.finish().unwrap();
    let written = ClipDocument::read(&page).unwrap();
    let look = |name: &str| {
        let layer = written.root.children.iter().find(|layer| layer.name == name).unwrap();
        let row = written.layer_row(layer.main_id).unwrap();
        (row.int("LayerOpacity"), row.int("LayerVisibility") & 1)
    };
    // 下描き at half, then the layer's own opacity; hidden only where asked.
    assert_eq!(look("人物"), (64, 0));
    assert_eq!(look("背景"), (128, 1));
    assert_eq!(look("効果"), (64, 1));
    // 指示: a 下描き layer at its own opacity, not halved.
    assert_eq!(look("指示"), (192, 1));
}

#[test]
fn brings_changed_dialogue_into_a_page_drawn_on_in_csp() {
    use clip_core::text::NewText;
    use clip_core::vector::NewVectorLine;
    use clip_core::write::manifest::{self, PageRecord, write_manifest};
    use clip_core::write::raster_page::{PageLayer, RasterLayer, RasterWorkWriter, WorkOptions};
    use clip_core::write::update::{DialogueUpdate, adopt_dialogue, read_dialogue, update_dialogue};
    let folder = tempfile::tempdir().unwrap();
    let template_path = template(folder.path());
    let sheet_path = sheet(folder.path());
    let mut writer = RasterWorkWriter::new(WorkOptions {
        template: template_path.clone(),
        out_dir: folder.path().join("out"),
        name_pattern: DEFAULT_NAME_PATTERN.into(),
        work: None,
        story_index: None,
        inputs: vec![sheet_path.clone()],
        donor_sources: vec![sheet_path.clone()],
        draft_layers: vec!["メモ（ネーム）".into()],
        layer_looks: Vec::new(),
        frame_folders: false,
        right_binding: None,
    })
    .unwrap();
    let balloon = |x: f64| PageLayer::Vector {
        name: "フキダシ".into(),
        lines: vec![NewVectorLine {
            points: vec![
                (x, 40.0, 1.0),
                (x + 60.0, 40.0, 1.0),
                (x + 60.0, 200.0, 1.0),
                (x, 200.0, 1.0),
            ],
            closed: true,
            width_px: 2.0,
        }],
    };
    let paper = |x: u32| {
        let mut image = RgbaImage::new(400, 560);
        for y in 40..200 {
            for dx in 0..60 {
                let at = ((y * 400 + x + dx) * 4) as usize;
                image.pixels[at..at + 4].copy_from_slice(&[255, 255, 255, 255]);
            }
        }
        PageLayer::Raster(RasterLayer {
            name: "フキダシの塗り".into(),
            image,
        })
    };
    // The memos: a tag in the corner.
    let memo = |y: u32| {
        let mut image = RgbaImage::new(400, 560);
        for row in y..y + 10 {
            for x in 10..60 {
                let at = ((row * 400 + x) * 4) as usize;
                image.pixels[at..at + 4].copy_from_slice(&[255, 240, 180, 255]);
            }
        }
        PageLayer::Raster(RasterLayer {
            name: "メモ（ネーム）".into(),
            image,
        })
    };
    let notes = |y: u32| match memo(y) {
        PageLayer::Raster(layer) => Some(layer),
        _ => None,
    };
    let said = |text: &str, x: i32| NewText {
        text: text.into(),
        frame: [x, 60, x + 40, 200],
        font_size_pt: 7.5,
        vertical: true,
        color: None,
        font: None,
        line_spacing: None,
    };
    let layers = [
        paper(290),
        balloon(290.0),
        PageLayer::Text(said("こんにちは", 300)),
        PageLayer::Text(said("またね", 200)),
        memo(20),
    ];
    let page_path = writer.write_page(&layers, None, false).unwrap();
    // The update repeats the export: the same file for the same page.
    let report = writer.finish().unwrap();
    let written = report.records[0].clone();
    assert_eq!(written.texts, Some(vec!["こんにちは".to_owned(), "またね".to_owned()]));
    assert_eq!(written.vectors.keys().collect::<Vec<_>>(), ["フキダシ"]);
    assert_eq!(written.rasters.keys().collect::<Vec<_>>(), ["メモ（ネーム）"]);

    // Pen work in CSP: a layer drawn on.
    let mut editor = ClipFile::open(&page_path).unwrap();
    let source = ClipDocument::read(&page_path).unwrap();
    let raster = source
        .layers()
        .into_iter()
        .find(|layer| layer.kind == clip_core::LayerKind::Raster)
        .unwrap()
        .main_id;
    let root = editor.canvas.root_folder;
    let ink = editor.add_layer(root, NewLayer::Raster, "ペン入れ").unwrap();
    let black = csp_format::RgbaImage {
        width: 30,
        height: 30,
        pixels: [0, 0, 0, 255].repeat(900),
    };
    editor.set_layer_pixels(ink, &black, (50, 300)).unwrap();
    // New layers start from a copy of the first raster layer's offscreens: drawn on here too.
    editor.set_layer_pixels(raster, &black, (10, 10)).unwrap();
    editor.save(&page_path).unwrap();
    drop(source);
    let drawn = digest(&page_path);

    let fallback = RasterWorkWriter::new(WorkOptions {
        template: template_path.clone(),
        out_dir: folder.path().join("out"),
        name_pattern: DEFAULT_NAME_PATTERN.into(),
        work: None,
        story_index: None,
        inputs: vec![sheet_path.clone()],
        donor_sources: vec![sheet_path.clone()],
        draft_layers: Vec::new(),
        layer_looks: Vec::new(),
        frame_folders: false,
        right_binding: None,
    })
    .unwrap();
    let backups = folder.path().join("backup");
    // Nothing changed: the page is not touched.
    let same = DialogueUpdate {
        texts: vec![said("こんにちは", 300), said("またね", 200)],
        balloons: vec![paper(290), balloon(290.0)],
        notes: notes(20),
        marks: Vec::new(),
        written: Some(written.clone()),
    };
    let report = update_dialogue(&page_path, &same, &fallback.donors, &backups).unwrap();
    assert_eq!((report.kept, report.backup.clone()), (2, None));
    assert_eq!(digest(&page_path), drawn);
    // Nor without the record of what was written (an older export): compared with the page.
    let unrecorded = DialogueUpdate { written: None, ..same };
    let report = update_dialogue(&page_path, &unrecorded, &fallback.donors, &backups).unwrap();
    assert_eq!((report.kept, report.backup.clone(), report.notes), (2, None, false));
    assert_eq!(digest(&page_path), drawn);

    // 「またね」 became 「さようなら」 and its balloon moved.
    let update = DialogueUpdate {
        texts: vec![said("こんにちは", 300), said("さようなら", 150)],
        balloons: vec![paper(140), balloon(140.0)],
        notes: notes(20),
        marks: Vec::new(),
        written: Some(written.clone()),
    };
    let report = update_dialogue(&page_path, &update, &fallback.donors, &backups).unwrap();
    assert!(report.problems.is_empty(), "{:?}", report.problems);
    assert_eq!(report.kept, 1);
    assert_eq!(report.retired, ["またね"]);
    assert_eq!(report.added, ["さようなら"]);
    assert_eq!(report.replaced, ["フキダシの塗り", "フキダシ"]);
    // The page as it was is kept.
    assert_eq!(digest(report.backup.as_ref().unwrap()), drawn);

    let page = ClipDocument::read(&page_path).unwrap();
    // Each new layer right above the one it replaces; the drawn layer stays on top.
    let names: Vec<(String, bool)> = page
        .root
        .children
        .iter()
        .filter(|layer| layer.kind != clip_core::LayerKind::Paper && layer.kind != clip_core::LayerKind::StoryInfo)
        .map(|layer| (layer.name.clone(), layer.visible))
        .collect();
    let shown = |name: &str| (name.to_owned(), true);
    let hidden = |name: &str| (name.to_owned(), false);
    assert_eq!(
        names,
        [
            shown("レイヤー 1"),
            hidden("（旧）フキダシの塗り"),
            shown("フキダシの塗り"),
            hidden("（旧）フキダシ"),
            shown("フキダシ"),
            shown("こんにちは"),
            hidden("（旧）またね"),
            shown("さようなら"),
            shown("メモ（ネーム）"),
            shown("ペン入れ"),
        ]
    );
    let find = |name: &str| {
        page.layers()
            .into_iter()
            .find(|layer| layer.name == name)
            .unwrap()
            .clone()
    };
    // The pen work is untouched.
    let pixels = page.render_layer_pixels(&find("ペン入れ")).unwrap().unwrap();
    assert_eq!(pixels.alpha_bbox(), Some((50, 300, 80, 330)));
    // The new balloon and its paper are where the name has them now.
    let lines = page.vector_objects(&find("フキダシ")).unwrap();
    assert_eq!(lines[0].points[0], (140.0, 40.0));
    let fill = page.render_layer_pixels(&find("フキダシの塗り")).unwrap().unwrap();
    assert_eq!(fill.alpha_bbox(), Some((140, 40, 200, 200)));
    let new = find("さようなら");
    assert_eq!(page.text_strings(&new), ["さようなら"]);
    // Without that drawing copied into their stored images.
    for layer in [&new, &find("フキダシ")] {
        let pixels = page.render_layer_pixels(layer).unwrap();
        assert_eq!(pixels.and_then(|image| image.alpha_bbox()), None, "{}", layer.name);
    }
    assert_eq!(page.text_blocks(&new).unwrap()[0].bbox, Some((150, 60, 190, 200)));

    // Texts not written by this tool, or changed in CSP since, are left alone.
    let after = digest(&page_path);
    let csp_own = DialogueUpdate {
        texts: vec![said("こんにちは", 300), said("消したセリフ", 100)],
        balloons: vec![paper(140), balloon(140.0)],
        notes: notes(20),
        marks: Vec::new(),
        written: Some(PageRecord {
            texts: Some(vec!["こんにちは".into(), "消したセリフ".into()]),
            ..report.record.clone()
        }),
    };
    let recorded = report.record.clone();
    let report = update_dialogue(&page_path, &csp_own, &fallback.donors, &backups).unwrap();
    assert_eq!((report.kept, report.foreign, report.left_as_in_csp), (1, 1, 1));
    assert!(report.backup.is_none());
    assert_eq!(digest(&page_path), after);
    // The name now says what was typed in CSP: that text is kept as the name's, not added again.
    let taken_back = DialogueUpdate {
        texts: vec![said("こんにちは", 300), said("さようなら", 150)],
        ..csp_own
    };
    let report = update_dialogue(&page_path, &taken_back, &fallback.donors, &backups).unwrap();
    assert_eq!((report.kept, report.foreign, report.added.len()), (2, 0, 0));
    assert!(report.backup.is_none());
    assert_eq!(digest(&page_path), after);

    // A text changed and the balloons not: only the text is swapped.
    let text_only = DialogueUpdate {
        texts: vec![said("こんばんは", 300), said("さようなら", 150)],
        balloons: vec![paper(140), balloon(140.0)],
        notes: notes(20),
        marks: Vec::new(),
        written: Some(recorded.clone()),
    };
    let report = update_dialogue(&page_path, &text_only, &fallback.donors, &backups).unwrap();
    assert!(report.problems.is_empty(), "{:?}", report.problems);
    assert_eq!((report.retired.len(), report.added.len()), (1, 1));
    assert!(report.replaced.is_empty() && report.conflicts.is_empty());

    // The balloons changed in the name and in CSP: the name's go in, CSP's are hidden and named.
    let mut edited = recorded.clone();
    edited.vectors.insert("フキダシ".into(), "1:changed-in-the-name".into());
    let both = DialogueUpdate {
        texts: vec![said("こんばんは", 300), said("さようなら", 150)],
        balloons: vec![paper(100), balloon(100.0)],
        notes: notes(20),
        marks: Vec::new(),
        written: Some(PageRecord {
            texts: Some(vec!["こんばんは".into(), "さようなら".into()]),
            ..edited
        }),
    };
    let report = update_dialogue(&page_path, &both, &fallback.donors, &backups).unwrap();
    assert!(report.problems.is_empty(), "{:?}", report.problems);
    assert_eq!(report.replaced, ["フキダシの塗り", "フキダシ"]);
    assert_eq!(report.conflicts, ["フキダシ"]);

    // Only the memos changed: redrawn in their layer, nothing else touched.
    let recorded = report.record.clone();
    let memos = DialogueUpdate {
        texts: vec![said("こんばんは", 300), said("さようなら", 150)],
        balloons: vec![paper(100), balloon(100.0)],
        notes: notes(500),
        marks: Vec::new(),
        written: Some(recorded),
    };
    let report = update_dialogue(&page_path, &memos, &fallback.donors, &backups).unwrap();
    assert!(report.problems.is_empty(), "{:?}", report.problems);
    assert!(report.notes && report.replaced.is_empty() && report.added.is_empty());
    let page = ClipDocument::read(&page_path).unwrap();
    let layer = page
        .layers()
        .into_iter()
        .find(|layer| layer.name == "メモ（ネーム）")
        .unwrap();
    let pixels = page.render_layer_pixels(layer).unwrap().unwrap();
    assert_eq!(pixels.alpha_bbox(), Some((10, 500, 60, 510)));

    // 指示 drawn since: a new 下描き layer on a page written without them, redrawn when they change.
    let mark = |y: u32| match memo(y) {
        PageLayer::Raster(layer) => RasterLayer {
            name: "指示".into(),
            ..layer
        },
        _ => unreachable!(),
    };
    let mut marked = DialogueUpdate {
        texts: vec![said("こんばんは", 300), said("さようなら", 150)],
        balloons: vec![paper(100), balloon(100.0)],
        notes: notes(500),
        marks: vec![mark(300)],
        written: Some(report.record.clone()),
    };
    let report = update_dialogue(&page_path, &marked, &fallback.donors, &backups).unwrap();
    assert!(report.problems.is_empty(), "{:?}", report.problems);
    assert_eq!(report.marks, ["指示"]);
    assert!(!report.notes && report.replaced.is_empty() && report.added.is_empty());
    let page = ClipDocument::read(&page_path).unwrap();
    let layers = page.layers();
    let layer = layers.iter().find(|layer| layer.name == "指示").unwrap();
    assert_eq!(
        page.render_layer_pixels(layer).unwrap().unwrap().alpha_bbox(),
        Some((10, 300, 60, 310))
    );
    // In its colour: at full opacity, though a 下描き layer.
    assert_eq!(page.layer_row(layer.main_id).unwrap().int("LayerOpacity"), 256);
    // The memos stay where they were.
    let memo_layer = layers.iter().find(|layer| layer.name == "メモ（ネーム）").unwrap();
    assert_eq!(
        page.render_layer_pixels(memo_layer).unwrap().unwrap().alpha_bbox(),
        Some((10, 500, 60, 510))
    );
    // Unchanged: nothing redrawn. Moved: redrawn in the same layer.
    marked.written = Some(report.record.clone());
    let again = update_dialogue(&page_path, &marked, &fallback.donors, &backups).unwrap();
    assert!(again.marks.is_empty() && !again.notes);
    marked.marks = vec![mark(400)];
    marked.written = Some(again.record.clone());
    let moved = update_dialogue(&page_path, &marked, &fallback.donors, &backups).unwrap();
    assert_eq!(moved.marks, ["指示"]);
    let page = ClipDocument::read(&page_path).unwrap();
    let named: Vec<_> = page.layers().into_iter().filter(|layer| layer.name == "指示").collect();
    assert_eq!(named.len(), 1);
    assert_eq!(
        page.render_layer_pixels(named[0]).unwrap().unwrap().alpha_bbox(),
        Some((10, 400, 60, 410))
    );

    // Read back for the name: the texts as CSP has them, with what was written.
    let out = page_path.parent().unwrap();
    let typed = PageRecord {
        texts: Some(vec!["こんばんは".into(), "またね".into()]),
        ..Default::default()
    };
    write_manifest(out, &[(page_path.clone(), typed)]).unwrap();
    let read = read_dialogue(&page_path).unwrap();
    let texts: Vec<&str> = read.texts.iter().map(|text| text.text.as_str()).collect();
    assert_eq!(texts, ["こんばんは", "さようなら"]);
    assert_eq!(read.texts[1].bbox, Some([150, 60, 190, 200]));
    assert_eq!(read.written, Some(vec!["こんばんは".to_owned(), "またね".to_owned()]));
    // Taken back into the name: recorded as this tool's.
    adopt_dialogue(&page_path).unwrap();
    assert_eq!(
        manifest::written(&page_path).and_then(|record| record.texts),
        Some(vec!["こんばんは".to_owned(), "さようなら".to_owned()])
    );
    // What was written before stays, for a name that undoes the take-back (taking it back again keeps it).
    let read = read_dialogue(&page_path).unwrap();
    assert_eq!(
        read.adopted_from,
        Some(vec!["こんばんは".to_owned(), "またね".to_owned()])
    );
    adopt_dialogue(&page_path).unwrap();
    assert_eq!(read_dialogue(&page_path).unwrap().adopted_from, read.adopted_from);
}
