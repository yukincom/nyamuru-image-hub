//! The built-in template: pages and works made from settings alone.

use std::path::Path;

use clip_core::text::{NewText, parse_tlv};
use clip_core::vector::NewVectorLine;
use clip_core::write::blank::{
    NombrePlace, PageNumber, PageSetup, ShownNombre, StoryFont, StoryLayout, StoryPosition, check_setup,
    write_builtin_template,
};
use clip_core::write::raster_page::{PageLayer, RasterLayer, RasterWorkWriter, WorkOptions};
use clip_core::write::split::DEFAULT_NAME_PATTERN;
use clip_core::write::verify::{ExpectedLayer, check_clip, verify_page, verify_work};
use clip_core::{ClipDocument, CmcProject, RgbaImage};

/// The settings the built-in page was saved with in CSP (A3 canvas, B4
/// 仕上がり, 600 dpi), with another work's story info.
fn commercial() -> PageSetup {
    PageSetup {
        canvas_mm: [297.0, 420.0],
        resolution: 600.0,
        trim_mm: [257.0, 364.0],
        bleed_mm: 5.0,
        basic_mm: [212.0, 300.0],
        basic_offset_mm: [0.0, 0.0],
        right_binding: true,
        first_page_left: true,
        title: "ユメの話".into(),
        story_index: Some(4),
        author: "だれか".into(),
        nombre_start: 1,
        font: None,
        story: StoryLayout::default(),
    }
}

/// An A5 book at 350 dpi, bound on the left, starting on a right page.
fn small_left() -> PageSetup {
    PageSetup {
        canvas_mm: [158.0, 220.0],
        resolution: 350.0,
        trim_mm: [148.0, 210.0],
        bleed_mm: 3.0,
        basic_mm: [120.0, 180.0],
        basic_offset_mm: [2.0, -3.0],
        right_binding: false,
        first_page_left: false,
        title: "Short".into(),
        story_index: None,
        author: String::new(),
        nombre_start: 3,
        font: Some(StoryFont {
            name: "BIZ UDゴシック".into(),
            postscript: "BIZ-UDGothic".into(),
        }),
        story: StoryLayout::default(),
    }
}

/// A story info layer: its text and attributes, its other blocks' texts and
/// attributes, and its offset.
type StoryRow = (Vec<u8>, Vec<u8>, Option<Vec<u8>>, Option<Vec<u8>>, i32, i32);

/// (text, canvas bbox) of each block of the story info layers of `kind`.
fn story_blocks(path: &Path, kind: i64) -> Vec<(String, [i32; 4])> {
    let document = ClipDocument::read(path).unwrap();
    let mut statement = document
        .database()
        .prepare(
            "SELECT TextLayerString, TextLayerAttributes, TextLayerStringArray, TextLayerAttributesArray,
                    LayerOffsetX, LayerOffsetY FROM Layer WHERE ComicStoryInfoType = ?1 ORDER BY MainId",
        )
        .unwrap();
    let rows: Vec<StoryRow> = statement
        .query_map([kind], |row| {
            Ok((
                row.get(0)?,
                row.get(1)?,
                row.get(2)?,
                row.get(3)?,
                row.get(4)?,
                row.get(5)?,
            ))
        })
        .unwrap()
        .map(Result::unwrap)
        .collect();
    let bbox = |attributes: &[u8], dx: i32, dy: i32| {
        let items = parse_tlv(attributes).unwrap();
        let bbox = &items.iter().find(|(tag, _)| *tag == 0x2A).unwrap().1;
        let n = |at: usize| i32::from_le_bytes(bbox[at..at + 4].try_into().unwrap());
        [n(0) + dx, n(4) + dy, n(8) + dx, n(12) + dy]
    };
    let mut blocks = Vec::new();
    for (text, attributes, strings, array, dx, dy) in rows {
        blocks.push((String::from_utf8(text).unwrap(), bbox(&attributes, dx, dy)));
        if let (Some(strings), Some(array)) = (strings, array) {
            let length = u32::from_le_bytes(strings[0..4].try_into().unwrap()) as usize;
            let block = u32::from_le_bytes(array[0..4].try_into().unwrap()) as usize;
            blocks.push((
                String::from_utf8(strings[4..4 + length].to_vec()).unwrap(),
                bbox(&array[4..4 + block], dx, dy),
            ));
        }
    }
    blocks
}

fn canvas_ints(path: &Path, columns: &str) -> Vec<i64> {
    let document = ClipDocument::read(path).unwrap();
    let count = columns.split(',').count();
    document
        .database()
        .query_row(&format!("SELECT {columns} FROM Canvas"), [], |row| {
            (0..count).map(|index| row.get::<_, i64>(index)).collect()
        })
        .unwrap()
}

#[test]
fn keeps_csp_layout_for_the_settings_it_was_saved_with() {
    let folder = tempfile::tempdir().unwrap();
    let built = write_builtin_template(&commercial(), folder.path()).unwrap();
    let page = ClipDocument::read(&built.page).unwrap();
    assert_eq!((page.canvas.width_px, page.canvas.height_px), (7016, 9921));
    assert_eq!(page.canvas.crop_size_px, Some((6071, 8598)));
    assert_eq!(page.canvas.basic_size_px, Some((5008, 7087)));
    assert_eq!(page.canvas.story_name, "ユメの話");
    assert_eq!(page.canvas.story_index, 4);
    // Where CSP put them on this page: the 作品名 below the 仕上がり at its
    // left edge, the 作者名 at its middle, the ノンブル at the gutter.
    let story = story_blocks(&built.page, 1);
    assert_eq!(story[0].0, "ユメの話 4話");
    assert_eq!(story[0].1[..2], [472, 9402]);
    assert_eq!(story[1].0, "だれか");
    assert!(((story[1].1[0] + story[1].1[2]) / 2 - 3507).abs() <= 1, "{story:?}");
    assert_eq!(
        story_blocks(&built.page, 2),
        [("1".to_owned(), [6512, 8454, 6543, 8504])]
    );
    assert_eq!(
        canvas_ints(&built.page, "ComicIsLeftPage, CropFrameOptionFlag, ComicBindPosition"),
        [1, 2, 1]
    );
    assert!(check_clip(&built.page).ok());

    let work = CmcProject::read(&built.work).unwrap();
    assert_eq!(
        (work.story_name.as_str(), work.author_name.as_str()),
        ("ユメの話", "だれか")
    );
    assert_eq!((work.binding_position, work.start_page), (1, 0));
    assert_eq!(work.pages.len(), 1);
}

#[test]
fn makes_pages_of_another_size_and_binding() {
    let folder = tempfile::tempdir().unwrap();
    let setup = small_left();
    let built = write_builtin_template(&setup, folder.path()).unwrap();
    let page = ClipDocument::read(&built.page).unwrap();
    let (width, height) = (page.canvas.width_px, page.canvas.height_px);
    assert_eq!((width, height), (2177, 3031));
    assert_eq!(page.canvas.crop_size_px, Some((2039, 2894)));
    assert_eq!(page.canvas.basic_size_px, Some((1654, 2480)));
    assert_eq!(page.canvas.basic_offset_px, (28, -41));
    assert_eq!(page.canvas.resolution, 350.0);
    // Every canvas-sized offscreen follows the new size at each mipmap level.
    let padded = |size: i64| (size + 255) / 256 * 256;
    let mut statement = page.database().prepare("SELECT Attribute FROM Offscreen").unwrap();
    let sizes: Vec<(u32, u32)> = statement
        .query_map([], |row| row.get::<_, Vec<u8>>(0))
        .unwrap()
        .map(|attribute| {
            let parameters = clip_core::offscreen::parameters(&attribute.unwrap()).unwrap();
            (parameters.width, parameters.height)
        })
        .collect();
    for (w, h) in &sizes {
        let level = |base: i64| (0..8).map(move |level| (base >> level) as u32);
        let fits = level(width).zip(level(height)).any(|size| size == (*w, *h))
            || level(padded(width))
                .zip(level(padded(height)))
                .any(|size| size == (*w, *h))
            || (*w, *h) == (512, 512);
        assert!(fits, "offscreen {w}x{h} is not sized by the {width}x{height} canvas");
    }
    // A right page (left-bound book, page 1 on the right): ノンブル at its left edge.
    assert_eq!(
        canvas_ints(&built.page, "ComicIsLeftPage, CropFrameOptionFlag, ComicBindPosition"),
        [0, 4, 0]
    );
    let trim_x0 = (width - 2039) / 2;
    let nombre = story_blocks(&built.page, 2);
    assert!((nombre[0].1[0] as i64 - trim_x0).abs() <= 1, "{nombre:?} vs {trim_x0}");
    // Level with the bottom of the 基本枠 (moved 3 mm up).
    let basic_bottom = (height - 2480) / 2 - 41 + 2480;
    assert_eq!(nombre[0].1[3] as i64, basic_bottom);
    // The page is the first: its ノンブル is the start number.
    assert_eq!(nombre[0].0, "3");
    let story = story_blocks(&built.page, 1);
    assert_eq!((story[0].0.as_str(), story[1].0.as_str()), ("Short", ""));
    // 作品名 under the 仕上がり and inside the canvas, though CSP's place
    // (just outside the 裁ち落とし) is past its edge.
    let trim_bottom = (height - 2894) / 2 + 2894;
    for (text, [_, y0, _, y1]) in &story {
        assert!(
            *y0 as i64 >= trim_bottom && (*y1 as i64) < height,
            "{text}: {y0}..{y1} vs {trim_bottom}..{height}"
        );
    }
    // The font goes into the texts and the work.
    let fonts: Vec<u8> = page
        .database()
        .query_row(
            "SELECT TextLayerAttributes FROM Layer WHERE ComicStoryInfoType = 2",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert!(fonts.windows(12).any(|window| window == b"BIZ-UDGothic"));
    let work = CmcProject::read(&built.work).unwrap();
    assert_eq!((work.binding_position, work.start_page), (0, 1));
    assert!(check_clip(&built.page).ok());
}

#[test]
fn places_the_story_info_where_csp_does_on_another_page() {
    // CSP EX 5.1.4 made this page: A4 canvas, B5 仕上がり, 裁ち落とし 5 mm,
    // 基本枠 149 × 219 mm, 600 dpi. 作品名 (331, 6685), ノンブル (4599, 6044)-(4630, 6094).
    let folder = tempfile::tempdir().unwrap();
    let setup = PageSetup {
        canvas_mm: [210.0, 297.0],
        trim_mm: [182.0, 257.0],
        basic_mm: [149.0, 219.0],
        ..commercial()
    };
    let built = write_builtin_template(&setup, folder.path()).unwrap();
    let story = story_blocks(&built.page, 1);
    assert_eq!(story[0].1[0], 331);
    assert!((story[0].1[1] - 6685).abs() <= 1, "{story:?}");
    assert_eq!(
        story_blocks(&built.page, 2),
        [("1".to_owned(), [4599, 6044, 4630, 6094])]
    );
}

#[test]
fn keeps_the_story_info_on_a_canvas_of_trim_and_bleed() {
    let folder = tempfile::tempdir().unwrap();
    let setup = PageSetup {
        canvas_mm: [188.0, 263.0],
        trim_mm: [182.0, 257.0],
        bleed_mm: 3.0,
        basic_mm: [150.0, 220.0],
        resolution: 300.0,
        ..commercial()
    };
    let built = write_builtin_template(&setup, folder.path()).unwrap();
    let page = ClipDocument::read(&built.page).unwrap();
    let (width, height) = (page.canvas.width_px, page.canvas.height_px);
    let (trim_w, trim_h) = page.canvas.crop_size_px.unwrap();
    let trim_bottom = (height - trim_h) / 2 + trim_h;
    let story = story_blocks(&built.page, 1);
    assert_eq!(story.len(), 2);
    for (text, [x0, y0, x1, y1]) in &story {
        assert!(*x0 >= 0 && (*x1 as i64) <= width, "{text}: {x0}..{x1}");
        assert!(
            *y0 as i64 >= trim_bottom && (*y1 as i64) < height,
            "{text}: {y0}..{y1} vs {trim_bottom}..{height}"
        );
    }
    // 作品名 at the left of the 仕上がり, 作者名 at its middle.
    assert!((story[0].1[0] as i64 - (width - trim_w) / 2).abs() <= 1, "{story:?}");
    assert!(
        ((story[1].1[0] + story[1].1[2]) as i64 / 2 - width / 2).abs() <= 1,
        "{story:?}"
    );
    assert!(check_clip(&built.page).ok());
}

#[test]
fn writes_a_work_with_editable_layers_from_the_built_template() {
    let folder = tempfile::tempdir().unwrap();
    let setup = PageSetup {
        resolution: 150.0,
        ..commercial()
    };
    let built = write_builtin_template(&setup, &folder.path().join("template")).unwrap();
    let mut writer = RasterWorkWriter::new(WorkOptions {
        template: built.page.clone(),
        out_dir: folder.path().join("out"),
        name_pattern: DEFAULT_NAME_PATTERN.into(),
        work: Some(("確認".into(), built.work.clone())),
        story_index: None,
        inputs: Vec::new(),
        donor_sources: vec![built.parts.clone()],
        draft_layers: Vec::new(),
        layer_looks: Vec::new(),
        frame_folders: false,
        right_binding: None,
    })
    .unwrap();
    assert!(writer.donors.vector.is_some() && writer.donors.text.is_some());
    assert_eq!(writer.first_page_left, Some(true));
    let canvas = writer.canvas;
    assert_eq!((canvas.width_px, canvas.height_px), (1754, 2480));
    let (width, height) = (canvas.width_px, canvas.height_px);
    let mut rough = RgbaImage::new(width, height);
    rough.paste(
        &RgbaImage {
            width: 50,
            height: 40,
            pixels: [0, 0, 0, 255].repeat(2000),
        },
        400,
        500,
    );
    let layers = vec![
        PageLayer::Raster(RasterLayer {
            name: "ラフ".into(),
            image: rough,
        }),
        PageLayer::Vector {
            name: "コマ枠".into(),
            lines: vec![NewVectorLine {
                points: vec![(300.0, 300.0, 1.0), (1400.0, 300.0, 1.0), (1400.0, 900.0, 1.0)],
                closed: true,
                width_px: 3.0,
            }],
        },
        PageLayer::Text(NewText {
            text: "セリフ".into(),
            frame: [800, 400, 840, 560],
            font_size_pt: 9.0,
            vertical: true,
            color: None,
            font: None,
            line_spacing: None,
        }),
    ];
    let expected: Vec<ExpectedLayer> = layers
        .iter()
        .map(|layer| ExpectedLayer::of(layer, width, height))
        .collect();
    let first = writer.write_page(&layers, None, false).unwrap();
    let spread = writer.write_page(&layers[..1], None, true).unwrap();
    let report = writer.finish().unwrap();
    let check = verify_page(&first, &expected, &canvas);
    assert!(check.problems.is_empty(), "{:?}", check.problems);
    assert_eq!((check.vector_lines, check.texts), (1, 1));
    assert!(check_clip(&spread).ok());
    let work = report.work.unwrap();
    let check = verify_work(&work, Some(&report.pages));
    assert!(check.problems.is_empty(), "{:?}", check.problems);
    // Page 2 (right) and 3 (left) as one spread; the ノンブル numbers follow.
    let numbers: Vec<String> = story_blocks(&spread, 2).into_iter().map(|(text, _)| text).collect();
    assert_eq!(numbers.len(), 2);
    assert!(numbers.contains(&"2".to_owned()) && numbers.contains(&"3".to_owned()));
    let project = CmcProject::read(&work).unwrap();
    assert_eq!(project.story_name, "ユメの話");
    assert_eq!(project.pages.len(), 2);
}

/// G1 / G2, made in CSP EX 5.1.4: a 60 × 80 mm 仕上がり (= 基本枠) on a
/// 70 × 90 mm canvas at 600 dpi, with サブタイトル, ページ番号 from 7 and a
/// white ノンブル `p.1-` 3 mm from the 基本枠.
fn shown(place: NombrePlace, position: StoryPosition) -> PageSetup {
    PageSetup {
        canvas_mm: [70.0, 90.0],
        trim_mm: [60.0, 80.0],
        basic_mm: [60.0, 80.0],
        title: "G1".into(),
        story_index: None,
        author: "作者".into(),
        story: StoryLayout {
            subtitle: "サブ".into(),
            title_position: position,
            author_position: position,
            page_number: Some(PageNumber { start: 7, position }),
            nombre: Some(ShownNombre {
                place,
                white: true,
                edge_mm: Some(0.5),
                prefix: "p.".into(),
                suffix: "-".into(),
                offset_mm: [0.0, 3.0],
                size_pt: 9.0,
            }),
        },
        ..commercial()
    }
}

/// (part, text, canvas bbox, font size) of every block of the story info layers of `kind`.
fn story_parts(path: &Path, kind: i64) -> Vec<(i32, String, [i32; 4], i32)> {
    let document = ClipDocument::read(path).unwrap();
    let mut statement = document
        .database()
        .prepare(
            "SELECT TextLayerString, TextLayerAttributes, TextLayerStringArray, TextLayerAttributesArray,
                    LayerOffsetX, LayerOffsetY FROM Layer WHERE ComicStoryInfoType = ?1 ORDER BY MainId",
        )
        .unwrap();
    let rows: Vec<StoryRow> = statement
        .query_map([kind], |row| {
            Ok((
                row.get(0)?,
                row.get(1)?,
                row.get(2)?,
                row.get(3)?,
                row.get(4)?,
                row.get(5)?,
            ))
        })
        .unwrap()
        .map(Result::unwrap)
        .collect();
    let split = |blob: &[u8]| {
        let mut parts = Vec::new();
        let mut at = 0;
        while at < blob.len() {
            let size = u32::from_le_bytes(blob[at..at + 4].try_into().unwrap()) as usize;
            parts.push(blob[at + 4..at + 4 + size].to_vec());
            at += 4 + size;
        }
        parts
    };
    let block = |text: String, attributes: &[u8], dx: i32, dy: i32| {
        let items = parse_tlv(attributes).unwrap();
        let value = |tag: u32| items.iter().find(|(id, _)| *id == tag).unwrap().1.as_slice();
        let n = |bytes: &[u8], at: usize| i32::from_le_bytes(bytes[at..at + 4].try_into().unwrap());
        let bbox = value(0x2a);
        (
            n(value(0x2e), 0),
            text,
            [n(bbox, 0) + dx, n(bbox, 4) + dy, n(bbox, 8) + dx, n(bbox, 12) + dy],
            n(value(0x20), 0),
        )
    };
    let mut blocks = Vec::new();
    for (text, attributes, strings, array, dx, dy) in rows {
        blocks.push(block(String::from_utf8(text).unwrap(), &attributes, dx, dy));
        if let (Some(strings), Some(array)) = (strings, array) {
            for (text, attributes) in split(&strings).into_iter().zip(split(&array)) {
                blocks.push(block(String::from_utf8(text).unwrap(), &attributes, dx, dy));
            }
        }
    }
    blocks
}

fn canvas_texts(path: &Path, columns: &str) -> Vec<String> {
    let document = ClipDocument::read(path).unwrap();
    let count = columns.split(',').count();
    document
        .database()
        .query_row(&format!("SELECT {columns} FROM Canvas"), [], |row| {
            (0..count).map(|index| row.get::<_, String>(index)).collect()
        })
        .unwrap()
}

#[test]
fn lays_out_the_story_info_and_a_shown_nombre_as_csp_does() {
    let close = |a: i32, b: i32| (a - b).abs() <= 1;
    // G1: everything at 左下, the ノンブル 上部内側 (the right of a left page).
    // CSP put the 作品情報 past the bottom of G1's canvas; on a canvas 20 mm
    // taller they are where it had them, from the 仕上がり.
    let folder = tempfile::tempdir().unwrap();
    let setup = PageSetup {
        canvas_mm: [70.0, 110.0],
        ..shown(NombrePlace::TopInner, StoryPosition::Left)
    };
    let built = write_builtin_template(&setup, folder.path()).unwrap();
    let page = ClipDocument::read(&built.page).unwrap();
    assert_eq!((page.canvas.width_px, page.canvas.height_px), (1654, 2598));
    let lower = (2598 - 2126) / 2;
    let story = story_parts(&built.page, 1);
    let texts: Vec<(i32, &str)> = story.iter().map(|(part, text, _, _)| (*part, text.as_str())).collect();
    assert_eq!(texts, [(1, "G1 サブ"), (2, "作者"), (4, "7ページ")]);
    // Rows a line (50 px) high from 6 mm under the 仕上がり: ページ番号, 作品名, 作者名.
    let bbox = |part: i32| story.iter().find(|block| block.0 == part).unwrap().2;
    for (part, y) in [(4, 2150), (1, 2200), (2, 2250)] {
        let [x0, y0, _, y1] = bbox(part);
        assert!(
            x0 == 118 && close(y0, y + lower) && y1 - y0 == 50,
            "{part}: {:?}",
            bbox(part)
        );
    }
    let nombre = story_parts(&built.page, 2);
    assert_eq!(nombre.len(), 1);
    let (part, text, [_, y0, x1, y1], size) = &nombre[0];
    assert_eq!((*part, text.as_str(), *size), (16, "p.1-", 900));
    assert!(
        *x1 == 1535 && close(*y0, -29 + lower) && *y1 == 47 + lower,
        "{nombre:?}"
    );
    assert_eq!(
        canvas_ints(
            &built.page,
            "ComicStoryStoryPosition, ComicStoryAuthorPosition, ComicStoryUsePageNumber, ComicStoryPageNumberStart, \
             ComicStoryPageNumberPosition, ComicStoryUseShownNombre, ComicStoryUseHiddenNombre, ComicStoryNombrePosition, \
             ComicStoryNombreColor, ComicStoryNombreUseEdge"
        ),
        [1, 1, 1, 7, 1, 1, 0, 1, 1, 1]
    );
    assert_eq!(
        canvas_texts(
            &built.page,
            "ComicStorySubTitle, ComicStoryNombrePrefix, ComicStoryNombreSuffix"
        ),
        ["サブ", "p.", "-"]
    );
    // フチ is the layer's effect, as CSP gave G1's: 0.5 mm at 600 dpi, black around white.
    let (attached, info): (i64, Vec<u8>) = page
        .database()
        .query_row(
            "SELECT LayerEffectAttached, LayerEffectInfo FROM Layer WHERE ComicStoryInfoType = 2",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .unwrap();
    assert_eq!((attached, info.as_slice()), (1, csp_format::blank::NOMBRE_EDGE));
    assert!(check_clip(&built.page).ok());
    // On G1's own canvas the three rows go up, inside it, in the same order.
    let folder = tempfile::tempdir().unwrap();
    let built = write_builtin_template(&shown(NombrePlace::TopInner, StoryPosition::Left), folder.path()).unwrap();
    let story = story_parts(&built.page, 1);
    let bbox = |part: i32| story.iter().find(|block| block.0 == part).unwrap().2;
    assert!(
        bbox(4)[3] == bbox(1)[1] && bbox(1)[3] == bbox(2)[1] && bbox(2)[3] < 2126,
        "{story:?}"
    );

    // G2: everything at 右下, the ノンブル 下部外側 (the left of a left page).
    let folder = tempfile::tempdir().unwrap();
    let built = write_builtin_template(&shown(NombrePlace::BottomOuter, StoryPosition::Right), folder.path()).unwrap();
    let story = story_parts(&built.page, 1);
    for (part, _, [_, _, x1, _], _) in &story {
        assert_eq!(*x1, 1535, "{part}: {story:?}");
    }
    let nombre = story_parts(&built.page, 2);
    let [x0, y0, _, y1] = nombre[0].2;
    assert!(x0 == 118 && y0 == 2079 && close(y1, 2155), "{nombre:?}");
}

#[test]
fn numbers_each_page_of_a_work_with_a_shown_nombre() {
    let folder = tempfile::tempdir().unwrap();
    let setup = PageSetup {
        resolution: 150.0,
        ..shown(NombrePlace::Bottom, StoryPosition::Center)
    };
    let built = write_builtin_template(&setup, &folder.path().join("template")).unwrap();
    let mut writer = RasterWorkWriter::new(WorkOptions {
        template: built.page.clone(),
        out_dir: folder.path().join("out"),
        name_pattern: DEFAULT_NAME_PATTERN.into(),
        work: Some(("確認".into(), built.work.clone())),
        story_index: None,
        inputs: Vec::new(),
        donor_sources: vec![built.parts.clone()],
        draft_layers: Vec::new(),
        layer_looks: Vec::new(),
        frame_folders: false,
        right_binding: None,
    })
    .unwrap();
    let blank = RgbaImage::new(writer.canvas.width_px, writer.canvas.height_px);
    let layers = vec![PageLayer::Raster(RasterLayer {
        name: "ラフ".into(),
        image: blank,
    })];
    let first = writer.write_page(&layers, None, false).unwrap();
    let second = writer.write_page(&layers, None, false).unwrap();
    let spread = writer.write_page(&layers, None, true).unwrap();
    let report = writer.finish().unwrap();
    let texts = |path: &Path, kind: i64| -> Vec<String> {
        let mut texts: Vec<String> = story_parts(path, kind)
            .into_iter()
            .filter(|(part, ..)| *part == 4 || *part == 16)
            .map(|(_, text, ..)| text)
            .collect();
        texts.sort();
        texts
    };
    assert_eq!(
        (texts(&first, 1), texts(&first, 2)),
        (vec!["7ページ".to_owned()], vec!["p.1-".to_owned()])
    );
    assert_eq!(
        (texts(&second, 1), texts(&second, 2)),
        (vec!["8ページ".to_owned()], vec!["p.2-".to_owned()])
    );
    assert_eq!(
        (texts(&spread, 1), texts(&spread, 2)),
        (
            vec!["10ページ".to_owned(), "9ページ".to_owned()],
            vec!["p.3-".to_owned(), "p.4-".to_owned()]
        )
    );
    // 下部: in the middle of the 基本枠 on either side.
    let page = ClipDocument::read(&second).unwrap();
    let [x0, _, x1, _] = story_parts(&second, 2)[0].2;
    assert!(
        ((x0 + x1) as i64 / 2 - page.canvas.width_px / 2).abs() <= 1,
        "{x0}..{x1}"
    );
    for path in [&first, &second, &spread] {
        assert!(check_clip(path).ok());
    }
    let check = verify_work(&report.work.unwrap(), Some(&report.pages));
    assert!(check.problems.is_empty(), "{:?}", check.problems);
}

#[test]
fn refuses_settings_csp_cannot_make() {
    let check = |change: &dyn Fn(&mut PageSetup)| {
        let mut setup = commercial();
        change(&mut setup);
        check_setup(&setup).unwrap_err().to_string()
    };
    assert!(check(&|setup| setup.trim_mm = [300.0, 364.0]).contains("仕上がり"));
    assert!(check(&|setup| setup.resolution = 2400.0).contains("解像度"));
    assert!(check(&|setup| setup.basic_offset_mm = [60.0, 0.0]).contains("基本枠"));
    assert!(check(&|setup| setup.title = " ".into()).contains("作品名"));
    assert!(check(&|setup| setup.canvas_mm = [2000.0, 2000.0]).contains("大きすぎ"));
    let mut nombre = shown(NombrePlace::Top, StoryPosition::Left);
    nombre.story.nombre.as_mut().unwrap().size_pt = 200.0;
    assert!(
        check_setup(&nombre)
            .unwrap_err()
            .to_string()
            .contains("ノンブルの大きさ")
    );
    assert!(check_setup(&commercial()).is_ok() && check_setup(&small_left()).is_ok());
}

#[test]
fn a_plain_page_without_parts_gets_editable_layers_from_the_built_in_parts() {
    use clip_core::write::raster_page::BUILT_IN_PARTS;
    let folder = tempfile::tempdir().unwrap();
    let setup = PageSetup {
        resolution: 150.0,
        ..commercial()
    };
    let built = write_builtin_template(&setup, &folder.path().join("template")).unwrap();
    // A page on its own, as a page saved by CSP with only raster layers:
    // no parts.clip beside it and none named.
    let alone = folder.path().join("alone").join("page.clip");
    std::fs::create_dir_all(alone.parent().unwrap()).unwrap();
    std::fs::copy(&built.page, &alone).unwrap();
    let mut writer = RasterWorkWriter::new(WorkOptions {
        template: alone,
        out_dir: folder.path().join("out"),
        name_pattern: DEFAULT_NAME_PATTERN.into(),
        work: None,
        story_index: None,
        inputs: Vec::new(),
        donor_sources: Vec::new(),
        draft_layers: Vec::new(),
        layer_looks: Vec::new(),
        frame_folders: false,
        right_binding: None,
    })
    .unwrap();
    for donor in [&writer.donors.vector, &writer.donors.text] {
        assert_eq!(
            donor.as_ref().map(|donor| donor.path()),
            Some(Path::new(BUILT_IN_PARTS))
        );
    }
    let canvas = writer.canvas;
    let (width, height) = (canvas.width_px, canvas.height_px);
    let layers = vec![
        PageLayer::Vector {
            name: "コマ枠".into(),
            lines: vec![NewVectorLine {
                points: vec![(300.0, 300.0, 1.0), (1400.0, 300.0, 1.0), (1400.0, 900.0, 1.0)],
                closed: true,
                width_px: 3.0,
            }],
        },
        PageLayer::Text(NewText {
            text: "セリフ".into(),
            frame: [800, 400, 840, 560],
            font_size_pt: 9.0,
            vertical: true,
            color: None,
            font: None,
            line_spacing: None,
        }),
    ];
    let expected: Vec<ExpectedLayer> = layers
        .iter()
        .map(|layer| ExpectedLayer::of(layer, width, height))
        .collect();
    let page = writer.write_page(&layers, None, false).unwrap();
    writer.finish().unwrap();
    let check = verify_page(&page, &expected, &canvas);
    assert!(check.problems.is_empty(), "{:?}", check.problems);
    assert_eq!((check.vector_lines, check.texts), (1, 1));
    assert!(check_clip(&page).ok());
}
