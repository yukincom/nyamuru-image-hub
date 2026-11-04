//! Unit tests on synthetic data. Real CSP files contain artwork and stay out
//! of the repository; `tools/compare_with_python.py` covers them locally.

use clip_core::text::{
    FontName, NewText, build_tlv, line_spacing, parse_text_attributes, parse_tlv, retarget_add_attributes,
    retarget_text_attributes, split_attribute_array, transform_text_attributes,
};
use clip_core::vector::{parse_vector_data, select_vector_objects, transform_vector_data};
use clip_core::{ClipDocument, LayerKind};
use rusqlite::Connection;

fn be32(value: u32) -> [u8; 4] {
    value.to_be_bytes()
}

fn vector_payload(objects: &[(u32, Vec<(f64, f64)>)]) -> Vec<u8> {
    let mut body = Vec::new();
    for (flags, points) in objects {
        let xs = points.iter().map(|p| p.0 as i32);
        let ys = points.iter().map(|p| p.1 as i32);
        let bbox = [
            xs.clone().min().unwrap() - 2,
            ys.clone().min().unwrap() - 2,
            xs.max().unwrap() + 2,
            ys.max().unwrap() + 2,
        ];
        let mut header = Vec::new();
        for value in [92, 76, 88, 88, points.len() as u32, *flags] {
            header.extend(be32(value));
        }
        for value in bbox {
            header.extend(value.to_be_bytes());
        }
        header.resize(92 - 12, 0);
        header.extend(4.0f64.to_be_bytes());
        header.extend(be32(0));
        body.extend(header);
        for (x, y) in points {
            let mut point = Vec::new();
            point.extend(x.to_be_bytes());
            point.extend(y.to_be_bytes());
            for value in [*x as i32 - 2, *y as i32 - 2, *x as i32 + 2, *y as i32 + 2] {
                point.extend(value.to_be_bytes());
            }
            point.resize(88, 0);
            body.extend(point);
        }
    }
    let mut payload = Vec::new();
    payload.extend(be32(0));
    payload.extend(be32(body.len() as u32));
    payload.extend(body);
    payload
}

fn rectangle(x0: f64, y0: f64, x1: f64, y1: f64) -> (u32, Vec<(f64, f64)>) {
    (0x1111, vec![(x0, y0), (x1, y0), (x1, y1), (x0, y1)])
}

fn text_attributes(bbox: [i32; 4], font_size_pt: f64, font: &str) -> Vec<u8> {
    let mut name = Vec::new();
    name.extend(1u16.to_le_bytes());
    name.extend((font.len() as u16).to_le_bytes());
    name.extend(font.as_bytes());
    name.extend(0u16.to_le_bytes());
    build_tlv(&[
        (0x0b, vec![1, 2]),
        (0x20, ((font_size_pt * 100.0) as i32).to_le_bytes().to_vec()),
        (0x2a, bbox.iter().flat_map(|v| v.to_le_bytes()).collect()),
        (0x39, name),
        (
            0x3f,
            [bbox[2] - bbox[0], bbox[3] - bbox[1]]
                .iter()
                .flat_map(|v| v.to_le_bytes())
                .collect(),
        ),
    ])
}

fn utf16(name: &str) -> Vec<u8> {
    let mut data = be32(name.encode_utf16().count() as u32).to_vec();
    for unit in name.encode_utf16() {
        data.extend(unit.to_be_bytes());
    }
    data
}

/// A colour offscreen's attribute as CSP writes it: a header with the
/// lengths of the Parameter, InitColor and BlockSize sections, then those.
fn csp_attribute(width: u32, height: u32) -> Vec<u8> {
    let (blocks_x, blocks_y) = (width.div_ceil(256), height.div_ceil(256));
    let section = |name: &str, values: &[u32]| {
        let mut data = utf16(name);
        for &value in values {
            data.extend(be32(value));
        }
        data
    };
    let parameter = section(
        "Parameter",
        &[
            width, height, blocks_x, blocks_y, 0x21, 1, 4, 5, 65536, 4, 1024, 1, 256, 65536, 256, 256, 8, 8, 0, 0,
        ],
    );
    let init = section("InitColor", &[0x14, 0, 0, 0, 0, 4]);
    let mut sizes = vec![12, blocks_x * blocks_y, 4];
    sizes.extend(std::iter::repeat_n(0x68, (blocks_x * blocks_y) as usize));
    let blocks = section("BlockSize", &sizes);
    let mut data = Vec::new();
    for length in [16, parameter.len(), init.len(), blocks.len()] {
        data.extend(be32(length as u32));
    }
    data.extend(parameter);
    data.extend(init);
    data.extend(blocks);
    data
}

/// A 600x300 colour offscreen (3x2 blocks) with block `index` alpha 255
/// inside `filled` (block pixels), BGRX red.
fn block_payload(index: usize, filled: (usize, usize, usize, usize)) -> Vec<u8> {
    let mut raw = vec![0u8; 256 * 256 * 5];
    for y in filled.1..filled.3 {
        for x in filled.0..filled.2 {
            raw[y * 256 + x] = 255;
            let color = 65536 + (y * 256 + x) * 4;
            raw[color + 2] = 200;
        }
    }
    let mut blocks = vec![None; 6];
    blocks[index] = Some(raw);
    csp_format::offscreen::BlockData::from_raw_blocks(&blocks, 256 * 256 * 5)
        .unwrap()
        .to_bytes()
}

fn container(database: &Connection, externals: &[(&str, Vec<u8>)]) -> Vec<u8> {
    let image = database.serialize("main").unwrap().to_vec();
    let mut chunks = Vec::new();
    let mut chunk = |tag: &[u8; 8], body: &[u8]| {
        chunks.extend(tag);
        chunks.extend((body.len() as u64).to_be_bytes());
        chunks.extend(body);
    };
    chunk(b"CHNKHead", &[0; 40]);
    for (id, payload) in externals {
        let mut body = 40u64.to_be_bytes().to_vec();
        body.extend(id.as_bytes());
        body.extend(payload);
        chunk(b"CHNKExta", &body);
    }
    chunk(b"CHNKSQLi", &image);
    chunk(b"CHNKFoot", &[]);
    let mut file = b"CSFCHUNK".to_vec();
    file.extend(((24 + chunks.len()) as u64).to_be_bytes());
    file.extend(24u64.to_be_bytes());
    file.extend(chunks);
    file
}

const RASTER_ID: &str = "extrnlid00000000000000000000000000000001";
const VECTOR_ID: &str = "extrnlid00000000000000000000000000000002";

fn sample_clip(folder: &std::path::Path) -> std::path::PathBuf {
    let database = Connection::open_in_memory().unwrap();
    database
        .execute_batch(
            "CREATE TABLE Canvas(MainId, CanvasUnit, CanvasWidth, CanvasHeight, CanvasResolution, CanvasRootFolder,
                 CanvasDoublePage, CropFrameUnitKind, CropFrameWidth, CropFrameHeight);
             CREATE TABLE Layer(MainId, LayerName, LayerType, LayerFolder, LayerVisibility, LayerOpacity,
                 LayerComposite, LayerOffsetX, LayerOffsetY, LayerClip, LayerLock, LayerNextIndex,
                 LayerFirstChildIndex, LayerRenderMipmap, LayerLayerMaskMipmap, TextLayerString,
                 ComicFrameLineMipmap, TextLayerAttributes, TextLayerAttributesArray);
             CREATE TABLE Mipmap(MainId, BaseMipmapInfo);
             CREATE TABLE MipmapInfo(MainId, Offscreen);
             CREATE TABLE Offscreen(MainId, Attribute, BlockData);
             CREATE TABLE VectorObjectList(MainId, LayerId, VectorData);
             CREATE TABLE CanvasPreview(MainId, ImageData);
             CREATE TABLE Project(MainId, ProjectInternalVersion, ProjectName, ProjectCanvas);
             INSERT INTO Project VALUES(1, '1.1.0', '', 1);
             INSERT INTO Canvas VALUES(1, 2, 594.0, 420.0, 600.0, 1, 1, 2, 182.0, 257.0);
             INSERT INTO Layer VALUES(1, '', 256, 1, 1, 256, 0, 0, 0, 0, 0, 0, 2, 0, 0, NULL, NULL, NULL, NULL);
             INSERT INTO Layer VALUES(2, '用紙', 1584, 0, 1, 256, 0, 0, 0, 0, 0, 3, 0, 0, 0, NULL, NULL, NULL, NULL);
             INSERT INTO Layer VALUES(3, 'ラフ', 1, 0, 1, 128, 0, 0, 0, 0, 0, 4, 0, 1, 0, NULL, NULL, NULL, NULL);
             INSERT INTO Layer VALUES(4, 'コマ', 0, 1, 0, 256, 0, 0, 0, 0, 0, 0, 5, 0, 0, NULL, 9, NULL, NULL);
             INSERT INTO Layer VALUES(5, '枠', 0, 0, 1, 256, 0, 10, -5, 0, 0, 6, 0, 0, 0, NULL, NULL, NULL, NULL);
             INSERT INTO Layer VALUES(6, 'セリフ', 0, 0, 1, 256, 0, 7, 3, 0, 0, 0, 0, 0, 0, 'こんにちは', NULL, NULL, NULL);
             INSERT INTO Mipmap VALUES(1, 1);
             INSERT INTO MipmapInfo VALUES(1, 1);
             INSERT INTO CanvasPreview VALUES(1, x'89504e47');",
        )
        .unwrap();
    // execute_batch cannot bind parameters, so the blobs are set afterwards.
    database
        .execute(
            "UPDATE Layer SET TextLayerAttributes = ?1, TextLayerAttributesArray = ?2 WHERE MainId = 6",
            rusqlite::params![text_attributes([40, 50, 60, 150], 8.0, "Font"), {
                let block = text_attributes([70, 80, 90, 180], 9.0, "源ノ角ゴシック");
                let mut array = (block.len() as u32).to_le_bytes().to_vec();
                array.extend(block);
                array
            }],
        )
        .unwrap();
    database
        .execute(
            "INSERT INTO Offscreen VALUES(1, ?1, ?2)",
            rusqlite::params![csp_attribute(600, 300), RASTER_ID.as_bytes()],
        )
        .unwrap();
    database
        .execute(
            "INSERT INTO VectorObjectList VALUES(1, 5, ?1)",
            rusqlite::params![VECTOR_ID.as_bytes()],
        )
        .unwrap();
    let vectors = vector_payload(&[
        rectangle(20.0, 30.0, 120.0, 230.0),
        (0x11, vec![(1.0, 2.0), (3.0, 4.0)]),
    ]);
    let blocks = block_payload(1, (10, 20, 30, 40));
    let path = folder.join("sheet.clip");
    std::fs::write(
        &path,
        container(&database, &[(RASTER_ID, blocks), (VECTOR_ID, vectors)]),
    )
    .unwrap();
    path
}

#[test]
fn reads_canvas_tree_pixels_vectors_and_text() {
    let folder = tempfile::tempdir().unwrap();
    let document = ClipDocument::read(sample_clip(folder.path())).unwrap();

    assert_eq!((document.canvas.width_px, document.canvas.height_px), (14031, 9921));
    assert!(document.canvas.is_double_page);
    assert_eq!(document.canvas.crop_size_px, Some((4299, 6071)));
    assert_eq!(document.canvas.single_page_width_px(), 7016);
    assert!(document.preview_png.is_some());

    let names: Vec<_> = document
        .layers()
        .iter()
        .map(|layer| (layer.name.as_str(), layer.kind))
        .collect();
    assert_eq!(
        names,
        [
            ("用紙", LayerKind::Paper),
            ("ラフ", LayerKind::Raster),
            ("コマ", LayerKind::FrameFolder),
            ("枠", LayerKind::Vector),
            ("セリフ", LayerKind::Text),
        ]
    );
    let raster = document.find_layer(3).unwrap();
    assert_eq!(raster.opacity, 0.5);
    assert!(!document.find_layer(4).unwrap().visible);

    let image = document.render_layer_pixels(raster).unwrap().unwrap();
    assert_eq!((image.width, image.height), (600, 300));
    assert_eq!(image.alpha_bbox(), Some((266, 20, 286, 40)));
    let pixel = ((25 * 600 + 270) * 4) as usize;
    assert_eq!(&image.pixels[pixel..pixel + 4], &[200, 0, 0, 255]);
    assert_eq!(document.occupied_pixel_boxes(raster).unwrap(), [(256, 0, 512, 256)]);
    let region = document.layer_pixels_in_box(raster, (260, 10, 300, 50)).unwrap();
    assert_eq!(region.alpha_bbox(), Some((6, 10, 26, 30)));

    let vectors = document.vector_objects(document.find_layer(5).unwrap()).unwrap();
    assert_eq!(vectors.len(), 2);
    assert!(vectors[0].closed() && !vectors[1].closed());
    assert_eq!(vectors[0].bbox, (18, 28, 122, 232));
    assert_eq!(vectors[0].brush_size, 4.0);

    let blocks = document.text_blocks(document.find_layer(6).unwrap()).unwrap();
    assert_eq!(blocks.len(), 2);
    assert_eq!(blocks[0].bbox, Some((40, 50, 60, 150)));
    assert_eq!(blocks[1].font_size_pt, Some(9.0));
    assert_eq!(blocks[1].font_name.as_deref(), Some("源ノ角ゴシック"));
}

#[test]
fn rejects_broken_files() {
    let folder = tempfile::tempdir().unwrap();
    let broken = |name: &str, bytes: Vec<u8>| {
        let path = folder.path().join(name);
        std::fs::write(&path, bytes).unwrap();
        ClipDocument::read(&path).is_err()
    };
    assert!(broken("not.clip", b"not a clip".to_vec()));
    let mut wrong_size = b"CSFCHUNK".to_vec();
    wrong_size.extend(999u64.to_be_bytes());
    wrong_size.extend(24u64.to_be_bytes());
    assert!(broken("size.clip", wrong_size));
    let database = Connection::open_in_memory().unwrap();
    database.execute_batch("CREATE TABLE T(A);").unwrap();
    let mut file = container(&database, &[]);
    let length = file.len();
    file.truncate(length - 1);
    file[8..16].copy_from_slice(&((length - 1) as u64).to_be_bytes());
    assert!(broken("cut.clip", file));
}

#[test]
fn transforms_and_selects_vector_objects() {
    let payload = vector_payload(&[rectangle(20.0, 30.0, 120.0, 230.0), rectangle(0.0, 0.0, 10.0, 10.0)]);
    assert_eq!(transform_vector_data(&payload, 1.0, 0.0, 0.0).unwrap(), payload);
    let moved = parse_vector_data(&transform_vector_data(&payload, 2.0, 5.0, -5.0).unwrap()).unwrap();
    assert_eq!(moved[0].points[0], (45.0, 55.0));
    assert_eq!(moved[0].bbox, (41, 51, 249, 459));
    assert_eq!(moved[0].brush_size, 8.0);
    let selected = parse_vector_data(&select_vector_objects(&payload, &[1]).unwrap()).unwrap();
    assert_eq!(selected.len(), 1);
    assert_eq!(selected[0].points[2], (10.0, 10.0));
    assert!(parse_vector_data(&payload[..payload.len() - 1]).is_err());
}

#[test]
fn round_trips_and_scales_text_attributes() {
    let blob = text_attributes([40, 50, 60, 150], 8.0, "Font");
    let items: Vec<(u32, Vec<u8>)> = parse_tlv(&blob)
        .unwrap()
        .into_iter()
        .map(|(id, value)| (id, value.to_vec()))
        .collect();
    assert_eq!(build_tlv(&items), blob);
    let scaled = parse_text_attributes(&transform_text_attributes(&blob, 2.5, 1.0, 2.0).unwrap()).unwrap();
    assert_eq!(scaled.bbox, Some((101, 127, 151, 377)));
    assert_eq!(scaled.font_size_pt, Some(20.0));
    assert_eq!(scaled.font_name.as_deref(), Some("Font"));
    // CSP's rendering of the text (Offscreen 3760) is not copied with it.
    let cached = build_tlv(&[(0x32, 3760u32.to_le_bytes().to_vec())]);
    let moved = transform_text_attributes(&cached, 2.5, 1.0, 2.0).unwrap();
    assert_eq!(parse_tlv(&moved).unwrap(), vec![(0x32, 0u32.to_le_bytes().to_vec())]);
    assert!(split_attribute_array(&[5, 0, 0, 0, 1]).is_err());
    assert!(parse_tlv(&blob[..blob.len() - 1]).is_err());
}

/// A style run: start, length, a `u32` and the data.
fn run(start: u32, length: u32, field: u32, data: &[u8]) -> Vec<u8> {
    let mut out: Vec<u8> = [start, length, field].iter().flat_map(|n| n.to_le_bytes()).collect();
    out.extend_from_slice(data);
    out
}

#[test]
fn new_text_takes_one_run_from_a_text_styled_in_parts() {
    // Font runs carry 16 bytes and a UTF-16 font name; other runs say their size.
    let mut font_name = vec![0u8; 16];
    font_name.extend_from_slice(&2u16.to_le_bytes());
    font_name.extend("明朝".encode_utf16().flat_map(|unit| unit.to_le_bytes()));
    let plain = [vec![0u8; 16], vec![0, 0]].concat();
    let runs = |parts: Vec<Vec<u8>>| [(parts.len() as u32).to_le_bytes().to_vec(), parts.concat()].concat();
    let blob = build_tlv(&[
        (
            0x0b,
            runs(vec![run(0, 45, 0x32, &font_name), run(47, 166, 0x1a, &plain)]),
        ),
        (0x1a, runs(vec![run(0, 45, 2, &[1, 0]), run(47, 166, 2, &[0, 0])])),
        (0x10, runs(vec![run(0, 45, 2, &[0, 0])])),
        (0x20, 400i32.to_le_bytes().to_vec()),
        (0x22, vec![0; 12]),
    ]);
    let mut text = NewText {
        text: "やあ".into(),
        frame: [0, 0, 100, 300],
        font_size_pt: 9.0,
        vertical: true,
        color: None,
        font: None,
        line_spacing: None,
    };
    let retargeted = retarget_text_attributes(&blob, &text).unwrap();
    let items = parse_tlv(&retargeted).unwrap();
    let value = |id: u32| items.iter().find(|(tag, _)| *tag == id).unwrap().1.to_vec();
    assert_eq!(value(0x0b), runs(vec![run(0, 2, 0x32, &font_name)]));
    assert_eq!(value(0x1a), runs(vec![run(0, 2, 2, &[1, 0])]));
    assert!(value(0x10).is_empty());
    assert_eq!(value(0x20), 900i32.to_le_bytes());
    assert_eq!(value(0x22), vec![0; 12]);
    text.color = Some([255, 255, 255]);
    let white = retarget_text_attributes(&blob, &text).unwrap();
    let white = parse_tlv(&white).unwrap();
    let value = |id: u32| white.iter().find(|(tag, _)| *tag == id).unwrap().1.to_vec();
    assert_eq!(value(0x22), vec![0xff; 12]);
    // The font run's own colour wins over 0x22 in CSP, so it is white too.
    let mut white_font = font_name.clone();
    white_font[1] = 1;
    white_font[2..8].fill(0xff);
    assert_eq!(value(0x0b), runs(vec![run(0, 2, 0x32, &white_font)]));
    // A run list that does not add up is refused rather than guessed at.
    let broken = build_tlv(&[(0x1a, runs(vec![run(0, 45, 9, &[1, 0])]))]);
    assert!(retarget_text_attributes(&broken, &text).is_err());
}

#[test]
fn new_text_writes_the_line_spacing_into_its_paragraph_run() {
    // As in CSP's dialogue: mode 1 (percent), an f64 CSP keeps, 125 %.
    let paragraph = |mode: u8, percent: f64| {
        [
            vec![mode, 0],
            4.0f64.to_le_bytes().to_vec(),
            percent.to_le_bytes().to_vec(),
        ]
        .concat()
    };
    let run = |start: u32, length: u32, data: &[u8]| {
        [
            start.to_le_bytes(),
            length.to_le_bytes(),
            (data.len() as u32).to_le_bytes(),
        ]
        .concat()
        .into_iter()
        .chain(data.iter().copied())
        .collect::<Vec<u8>>()
    };
    let runs = |parts: Vec<Vec<u8>>| [(parts.len() as u32).to_le_bytes().to_vec(), parts.concat()].concat();
    let blob = build_tlv(&[
        (
            0x0d,
            runs(vec![run(0, 9, &paragraph(1, 125.0)), run(9, 3, &paragraph(0, 100.0))]),
        ),
        (0x20, 400i32.to_le_bytes().to_vec()),
    ]);
    assert_eq!(line_spacing(&blob).unwrap(), Some(125.0));
    let mut text = NewText {
        text: "やあ\nどうも".into(),
        frame: [0, 0, 100, 300],
        font_size_pt: 9.0,
        vertical: true,
        color: None,
        font: None,
        line_spacing: None,
    };
    // Kept as the donor has it, as one run over the new text.
    let kept = retarget_text_attributes(&blob, &text).unwrap();
    assert_eq!(line_spacing(&kept).unwrap(), Some(125.0));
    text.line_spacing = Some(115.0);
    let spaced = retarget_text_attributes(&blob, &text).unwrap();
    assert_eq!(line_spacing(&spaced).unwrap(), Some(115.0));
    let items = parse_tlv(&spaced).unwrap();
    let value = items.iter().find(|(tag, _)| *tag == 0x0d).unwrap().1.to_vec();
    assert_eq!(value, runs(vec![run(0, 7, &paragraph(1, 115.0))]));
    // A paragraph run spaced some other way takes the percentage.
    let fixed = build_tlv(&[(0x0d, runs(vec![run(0, 9, &paragraph(0, 100.0))]))]);
    assert_eq!(line_spacing(&fixed).unwrap(), None);
    assert_eq!(
        line_spacing(&retarget_text_attributes(&fixed, &text).unwrap()).unwrap(),
        Some(115.0)
    );
}

#[test]
fn new_text_names_its_font_as_csp_does() {
    // As in a CSP-made page: the font run names no font; 0x39 holds the shown and PostScript names.
    let donor_font = FontName {
        name: "I-OTFアンチックStd B".into(),
        postscript: "IwaAntStd-Bd".into(),
    };
    let blob = build_tlv(&[(0x20, 400i32.to_le_bytes().to_vec()), (0x39, donor_font.to_attribute())]);
    assert_eq!(
        hex(&donor_font.to_attribute()),
        "01001900492d4f5446e382a2e383b3e38381e38383e382af53746420420c00497761416e745374642d4264"
    );
    let mut text = NewText {
        text: "やあ".into(),
        frame: [0, 0, 100, 300],
        font_size_pt: 9.0,
        vertical: true,
        color: None,
        font: None,
        line_spacing: None,
    };
    let kept = retarget_text_attributes(&blob, &text).unwrap();
    assert_eq!(
        parse_text_attributes(&kept).unwrap().font_name.as_deref(),
        Some("I-OTFアンチックStd B")
    );
    text.font = Some(FontName {
        name: "游明朝 Demibold".into(),
        postscript: "YuMin-Demibold".into(),
    });
    let named = retarget_text_attributes(&blob, &text).unwrap();
    assert_eq!(
        parse_text_attributes(&named).unwrap().font_name.as_deref(),
        Some("游明朝 Demibold")
    );
    let items = parse_tlv(&named).unwrap();
    let value = &items.iter().find(|(tag, _)| *tag == 0x39).unwrap().1;
    assert!(value.ends_with(b"YuMin-Demibold"));

    // CSP's own dialogue (the builtin pages' donor) names the font in its run
    // too, and CSP draws that one: the run is renamed, its flags kept.
    let named_run = |name: &str| {
        let mut data = vec![0u8, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0x59, 0x40];
        data.extend((name.encode_utf16().count() as u16).to_le_bytes());
        data.extend(name.encode_utf16().flat_map(|unit| unit.to_le_bytes()));
        data
    };
    let runs = |data: &[u8]| [1u32.to_le_bytes().to_vec(), run(0, 6, 0x32, data)].concat();
    let blob = build_tlv(&[
        (0x0b, runs(&named_run("游明朝 Demibold"))),
        (0x1f, "游明朝 Demibold".as_bytes().to_vec()),
        (0x39, donor_font.to_attribute()),
    ]);
    text.font = Some(FontName {
        name: "メイリオ".into(),
        postscript: "Meiryo".into(),
    });
    let meiryo = retarget_text_attributes(&blob, &text).unwrap();
    let items = parse_tlv(&meiryo).unwrap();
    let value = &items.iter().find(|(tag, _)| *tag == 0x0b).unwrap().1;
    assert_eq!(
        *value,
        [1u32.to_le_bytes().to_vec(), run(0, 2, 0x32, &named_run("メイリオ"))].concat()
    );
    assert_eq!(
        parse_text_attributes(&meiryo).unwrap().font_name.as_deref(),
        Some("メイリオ")
    );
    // And the name the tool property shows (0x1f, plain UTF-8).
    let value = &items.iter().find(|(tag, _)| *tag == 0x1f).unwrap().1;
    assert_eq!(value, "メイリオ".as_bytes());
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

#[test]
fn new_text_takes_one_run_in_the_added_attributes_too() {
    // There runs carry only their size and data; CSP keeps one per run and
    // rewrites a list longer than the text's runs when it opens the page.
    let runs = |parts: &[&[u8]]| {
        let mut out = (parts.len() as u32).to_le_bytes().to_vec();
        for part in parts {
            out.extend((part.len() as u32).to_le_bytes());
            out.extend_from_slice(part);
        }
        out
    };
    let entry = build_tlv(&[
        (0x0b, runs(&[&[0, 3, 1], &[0, 0, 1], &[0, 2, 1]])),
        (0x1a, runs(&[&[1, 0, 0, 0], &[1, 0, 0, 0]])),
        (0x14, runs(&[&[1, 0, 0, 0]])),
        (0x20, 400i32.to_le_bytes().to_vec()),
        (0x32, 3760u32.to_le_bytes().to_vec()),
    ]);
    let blob = [(entry.len() as u32).to_le_bytes().to_vec(), entry].concat();
    let mut text = NewText {
        text: "やあ".into(),
        frame: [0, 0, 300, 100],
        font_size_pt: 9.0,
        vertical: false,
        color: None,
        font: None,
        line_spacing: None,
    };
    let retargeted = retarget_add_attributes(&blob, &text).unwrap();
    let items = parse_tlv(&retargeted[4..]).unwrap();
    let value = |id: u32| items.iter().find(|(tag, _)| *tag == id).unwrap().1.to_vec();
    assert_eq!(value(0x0b), runs(&[&[0, 3, 1]]));
    assert_eq!(value(0x1a), runs(&[&[1, 0, 0, 0]]));
    assert!(value(0x14).is_empty());
    assert_eq!(value(0x20), 900i32.to_le_bytes());
    // The donor's rendering of its own text is not carried over.
    assert_eq!(value(0x32), 0u32.to_le_bytes());
    // A recoloured text flags its font run as coloured here as well.
    let plain = build_tlv(&[(0x0b, runs(&[&[0, 2, 1]]))]);
    let plain = [(plain.len() as u32).to_le_bytes().to_vec(), plain].concat();
    text.color = Some([255, 255, 255]);
    let white = retarget_add_attributes(&plain, &text).unwrap();
    assert_eq!(parse_tlv(&white[4..]).unwrap(), vec![(0x0b, runs(&[&[0, 3, 1]]))]);
}

#[test]
fn shrinks_raster_layers_without_full_decode() {
    let folder = tempfile::tempdir().unwrap();
    let document = ClipDocument::read(sample_clip(folder.path())).unwrap();
    let raster = document.find_layer(3).unwrap();
    let small = document.render_layer_scaled(raster, 4).unwrap().unwrap();
    assert_eq!((small.width, small.height), (150, 75));
    // Block 1 fills x 266..286, y 20..40 → x 66.5..71.5, y 5..10 at 1/4.
    assert_eq!(small.alpha_bbox(), Some((66, 5, 72, 10)));
    let pixel = ((7 * 150 + 68) * 4) as usize;
    assert_eq!(&small.pixels[pixel..pixel + 4], &[200, 0, 0, 255]);
    let edge = ((7 * 150 + 66) * 4) as usize;
    assert_eq!(
        small.pixels[edge + 3],
        128,
        "half-covered pixel keeps half alpha (rounded)"
    );
    assert_eq!(
        small.pixels[edge], 200,
        "colour is not darkened by transparent neighbours"
    );
    assert!(small.to_png().unwrap().starts_with(b"\x89PNG"));
}

#[test]
fn detects_spread_cells_in_reading_order() {
    use clip_core::layout::{ReadingOrder, Rect, SpreadSide, detect_page_cells};
    let outer = [
        Rect::new(20.0, 20.0, 280.0, 140.0),
        Rect::new(320.0, 20.0, 580.0, 140.0),
    ];
    let inner = [
        Rect::new(30.0, 30.0, 140.0, 130.0),
        Rect::new(160.0, 30.0, 270.0, 130.0),
        Rect::new(330.0, 30.0, 440.0, 130.0),
        Rect::new(460.0, 30.0, 570.0, 130.0),
    ];
    let rects: Vec<Rect> = outer.iter().chain(&inner).copied().collect();
    let cells = detect_page_cells(&rects, 600.0, false, ReadingOrder::RightToLeft);
    let summary: Vec<_> = cells
        .iter()
        .map(|cell| (cell.index, cell.rect.x0, cell.spread_side))
        .collect();
    assert_eq!(
        summary,
        [
            (1, 450.0, Some(SpreadSide::Right)),
            (2, 320.0, Some(SpreadSide::Left)),
            (3, 150.0, Some(SpreadSide::Right)),
            (4, 20.0, Some(SpreadSide::Left)),
        ]
    );
    assert_eq!(cells[0].frame, Some(inner[3]));
}
