//! Nyamuru's data adapter. The vendored CSP encoders retain their upstream bodies.
use std::{collections::HashSet, io::{Read, Write}, path::Path};
use base64::{Engine, engine::general_purpose::STANDARD};
use clip_core::{ClipDocument, text::{FontName, NewText, retarget_add_attributes, retarget_text_attributes}, vector::NewVectorLine,
    write::{layers::set_layer_mask, raster_page::{PartDonors, prepare_for, add_text_layer, add_vector_layer}}};
use csp_format::{ClipFile, GrayImage, RgbaImage, blank::{PageSetup, StoryLayout, blank_page, blank_parts},
    copy::CopyLayer, database::{Row, select}, edit::NewLayer, render::BlendMode, vector::VectorData};
use rusqlite::types::Value;
use serde::Deserialize;
use serde_json::json;

type Result<T> = std::result::Result<T, Box<dyn std::error::Error>>;
const MAX_PIXELS: u64 = 100_000_000;
const MAX_INPUT: u64 = 96 * 1024 * 1024;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Page {
    profile: String, width: u32, height: u32, dpi: f64, title: String,
    page: u32,
    #[serde(default)] trim_mm: Option<[f64; 2]>,
    #[serde(default)] bleed_mm: Option<f64>,
    #[serde(default)] basic_mm: Option<[f64; 2]>,
    #[serde(default)] right_binding: Option<bool>,
    layers: Vec<Layer>, preview: Option<String>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Layer {
    id: String, name: String, visible: bool, locked: bool, opacity: f64,
    blend: Blend, mask: Option<Mask>,
    #[serde(default)] pass_through: bool,
    #[serde(flatten)] content: Content,
}
#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "lowercase")]
enum Blend { Normal, Multiply }
#[derive(Deserialize)]
struct Mask { png: String, x: i64, y: i64 }
#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
enum Content {
    Folder { children: Vec<Layer> },
    #[serde(rename = "frame_folder")]
    FrameFolder { frames: Vec<Frame>, children: Vec<Layer> },
    Raster { png: String, x: i64, y: i64 },
    Text {
        text: String, frame: [i32; 4],
        #[serde(rename = "fontSizePt")] font_size_pt: f64,
        vertical: bool, color: [u8; 3], font: Option<Font>,
        #[serde(rename = "lineSpacing")] line_spacing: Option<f64>,
        #[serde(rename = "fontWeight", default)] font_weight: u32,
        #[serde(default)] italic: bool,
        #[serde(rename = "textAlign", default)] text_align: Option<String>,
        #[serde(default)] balloons: Vec<Balloon>,
    },
    Vector { lines: Vec<Line> },
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Font { name: String, postscript: String, synthetic_bold: Option<bool>, synthetic_italic: Option<bool> }
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Line { points: Vec<(f64, f64, f64)>, closed: bool, width_px: f64, color: [u8; 3] }
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Frame { points: Vec<(f64, f64)>, width_px: f64 }
fn default_true() -> bool { true }
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Balloon {
    points: Vec<(f64, f64)>,
    #[serde(default)] is_tail: bool,
    #[serde(default = "default_true")] spline: bool,
    width_px: f64,
    color: [u8; 3],
    #[serde(default)] fill: Option<[u8; 3]>,
}

fn png(value: &str) -> Result<RgbaImage> {
    let encoded = value.strip_prefix("data:image/png;base64,").ok_or("PNGデータが必要です")?;
    let data = STANDARD.decode(encoded)?;
    if data.len() < 24 || &data[..8] != b"\x89PNG\r\n\x1a\n" || &data[12..16] != b"IHDR" { return Err("PNGの形式が不正です".into()); }
    let width = u32::from_be_bytes(data[16..20].try_into()?);
    let height = u32::from_be_bytes(data[20..24].try_into()?);
    if width == 0 || height == 0 || width > 30_000 || height > 30_000 || u64::from(width)*u64::from(height)>MAX_PIXELS { return Err("画像サイズが上限を超えています".into()); }
    Ok(RgbaImage::from_png(&data)?)
}

fn validate_layers(layers: &[Layer], depth: usize, ids: &mut HashSet<String>) -> Result<()> {
    if depth > 64 { return Err("フォルダーの階層が深すぎます".into()); }
    for layer in layers {
        if layer.id.is_empty() || !ids.insert(layer.id.clone()) || ids.len()>10_000 { return Err("レイヤーIDまたは件数が不正です".into()); }
        if layer.name.len()>4096 || !layer.opacity.is_finite() || !(0.0..=1.0).contains(&layer.opacity) { return Err("レイヤー名または透明度が不正です".into()); }
        match &layer.content {
            Content::Folder { children } => validate_layers(children, depth+1, ids)?,
            Content::FrameFolder { frames, children } => {
                if frames.is_empty() || frames.len()>1000 || frames.iter().any(|frame| frame.points.len()<3 || frame.points.len()>100_000
                    || !frame.width_px.is_finite() || !(0.0..=30_000.0).contains(&frame.width_px)
                    || frame.points.iter().any(|&(x,y)| !x.is_finite() || !y.is_finite() || x.abs()>1_000_000.0 || y.abs()>1_000_000.0)) {
                    return Err("コマ枠の頂点または太さが不正です".into());
                }
                validate_layers(children, depth+1, ids)?;
            },
            Content::Text {text, frame, font_size_pt, line_spacing, balloons, ..} => {
                if text.len()>1_000_000 || frame[2]<=frame[0] || frame[3]<=frame[1] || frame.iter().any(|v| v.unsigned_abs()>1_000_000)
                    || !font_size_pt.is_finite() || !(0.1..=2000.0).contains(font_size_pt)
                    || line_spacing.is_some_and(|v| !v.is_finite() || !(1.0..=2000.0).contains(&v)) { return Err("文字の位置・サイズが不正です".into()); }
                if balloons.len()>1000 || balloons.iter().any(|b| b.points.len()<3 || b.points.len()>100_000
                    || !b.width_px.is_finite() || !(0.0..=30_000.0).contains(&b.width_px)
                    || b.points.iter().any(|&(x,y)| !x.is_finite() || !y.is_finite() || x.abs()>1_000_000.0 || y.abs()>1_000_000.0)) {
                    return Err("フキダシの座標または太さが不正です".into());
                }
            },
            Content::Vector { lines } => {
                if lines.len()>100_000 || lines.iter().any(|line| line.points.len()<2 || line.points.len()>1_000_000 || !line.width_px.is_finite() || !(0.0..=30_000.0).contains(&line.width_px)
                    || line.points.iter().any(|&(x,y,p)| !x.is_finite() || !y.is_finite() || x.abs()>1_000_000.0 || y.abs()>1_000_000.0 || !p.is_finite() || !(0.0..=1.0).contains(&p))) { return Err("ベクター線の座標が不正です".into()); }
            },
            Content::Raster { x, y, .. } => if x.unsigned_abs()>1_000_000 || y.unsigned_abs()>1_000_000 { return Err("画像の位置が不正です".into()); },
        }
    }
    Ok(())
}

// The public vector object exposes its documented RGB header. The upstream line
// builder makes black lines; colour is a layer-adapter concern, not an encoder fork.
fn vector_colors(file: &mut ClipFile, id: i64, lines: &[Line]) -> Result<()> {
    for row in select(file.database(), "SELECT VectorData FROM VectorObjectList WHERE LayerId = ?1", [id])? {
        let external = row.text("VectorData").ok_or("ベクターデータの参照がありません")?;
        let bytes = file.external(&external).ok_or("ベクターデータがありません")?;
        let mut data = VectorData::parse(bytes)?;
        if data.objects.len()!=lines.len() { return Err("ベクター線の件数が一致しません".into()); }
        for (object, line) in data.objects.iter_mut().zip(lines) {
            for (channel, value) in line.color.iter().enumerate() {
                object.header[40+channel*4..44+channel*4].copy_from_slice(&(u32::from(*value)*0x01010101).to_be_bytes());
            }
        }
        file.set_external(&external, data.to_bytes());
    }
    Ok(())
}

// Plain blocks inherit their point size from the block, not the donor's
// character-level size override. Main and additional runs have different layouts.
// 0x2c is the donor's pixel/point conversion (dpi/72*1000): keeping 8333 from
// its 600dpi canvas made 24pt render at 200px on a 150dpi target in real CSP.
const fn hex_bytes<const N: usize>(text: &str) -> [u8; N] {
    const fn digit(d: u8) -> u8 {
        match d { b'0'..=b'9' => d - b'0', b'a'..=b'f' => d - b'a' + 10, _ => panic!("hex") }
    }
    let b = text.as_bytes();
    let mut out = [0u8; N];
    let mut i = 0;
    while i < N { out[i] = (digit(b[2 * i]) << 4) | digit(b[2 * i + 1]); i += 1; }
    out
}

const BALLOON_HEADER: [u8; 96] = hex_bytes(concat!(
    "000000600000004800000058000000580000001c00000188000000bb0000015900000315000004a7",
    "000000000000000000000000ffffffffffffffffffffffff3ff0000000000000",
    "0000013000000001000000013ffb8f1e3c78f1e40f1fa7c1",
));
const TAIL_HEADER: [u8; 96] = hex_bytes(concat!(
    "0000006000000048000000580000005800000003000011180000024000000428000002d90000049e",
    "000000000000000000000000ffffffffffffffffffffffff3ff0000000000000",
    "00000111000000000000000000000000000000000f1fbea7",
));
const BALLOON_POINT: [u8; 88] = hex_bytes(concat!(
    "407e7b5dd6e04c054075b179cd8127b3000001e5000001590000022c0000016800000000",
    "3f8000003f80000000000000000000003f8000003f8000003f800000000000000000000000000000",
    "000000000f1fa7c100000000",
));

fn balloon_bbox(points: &[(f64, f64)], radius: f64) -> [i32; 4] {
    let mut x0 = f64::INFINITY; let mut y0 = f64::INFINITY;
    let mut x1 = f64::NEG_INFINITY; let mut y1 = f64::NEG_INFINITY;
    for &(x, y) in points { x0 = x0.min(x); y0 = y0.min(y); x1 = x1.max(x); y1 = y1.max(y); }
    [(x0 - radius).floor() as i32, (y0 - radius).floor() as i32, (x1 + radius).ceil() as i32, (y1 + radius).ceil() as i32]
}

fn build_balloon_vector_data(balloons: &[Balloon], brush_style: u32) -> (VectorData, [i32; 4]) {
    use csp_format::vector::VectorObject;
    let mut objects = Vec::with_capacity(balloons.len());
    let first_radius = (balloons[0].width_px / 2.0).max(0.5);
    let first_box = balloon_bbox(&balloons[0].points, first_radius);
    for balloon in balloons {
        let radius = if balloon.is_tail && !balloon.spline { 0.0 } else { (balloon.width_px / 2.0).max(0.5) };
        let bbox = balloon_bbox(&balloon.points, radius);
        let mut header = if balloon.is_tail && !balloon.spline { TAIL_HEADER.to_vec() } else { BALLOON_HEADER.to_vec() };
        header[16..20].copy_from_slice(&(balloon.points.len() as u32).to_be_bytes());
        let flags: u32 = if balloon.is_tail && !balloon.spline { 0x1118 } else if balloon.spline { 0x2188 } else { 0x3118 };
        header[20..24].copy_from_slice(&flags.to_be_bytes());
        for (i, v) in bbox.iter().enumerate() { header[24 + 4 * i..28 + 4 * i].copy_from_slice(&v.to_be_bytes()); }
        let fill = balloon.fill.unwrap_or([255, 255, 255]);
        for (c, v) in balloon.color.iter().enumerate() { header[40 + c * 4..44 + c * 4].copy_from_slice(&(u32::from(*v) * 0x01010101).to_be_bytes()); }
        for (c, v) in fill.iter().enumerate() { header[52 + c * 4..56 + c * 4].copy_from_slice(&(u32::from(*v) * 0x01010101).to_be_bytes()); }
        let kind: u32 = if balloon.is_tail && !balloon.spline { 0x111 } else if balloon.is_tail { 0x11 } else { 0x130 };
        header[72..76].copy_from_slice(&kind.to_be_bytes());
        if !(balloon.is_tail && !balloon.spline) {
            header[76..80].copy_from_slice(&brush_style.to_be_bytes());
            header[80..84].copy_from_slice(&brush_style.to_be_bytes());
            header[84..92].copy_from_slice(&radius.to_be_bytes());
        }
        let n = balloon.points.len();
        let points = (0..n).map(|i| {
            let (x, y) = balloon.points[i];
            let (nx, ny) = balloon.points[(i + 1) % n];
            let seg = [
                (x.min(nx) - radius).floor() as i32, (y.min(ny) - radius).floor() as i32,
                (x.max(nx) + radius).ceil() as i32, (y.max(ny) + radius).ceil() as i32,
            ];
            let mut pt = BALLOON_POINT.to_vec();
            pt[0..8].copy_from_slice(&x.to_be_bytes());
            pt[8..16].copy_from_slice(&y.to_be_bytes());
            for (j, v) in seg.iter().enumerate() { pt[16 + 4 * j..20 + 4 * j].copy_from_slice(&v.to_be_bytes()); }
            pt[32..36].copy_from_slice(&0u32.to_be_bytes());
            pt
        }).collect();
        objects.push(VectorObject { header, point_size: 88, points });
    }
    (VectorData { lead: 0, objects, trailing: Vec::new() }, first_box)
}

fn text_style(file: &mut ClipFile, id: i64, bold: bool, italic: bool, align: Option<&str>, balloon_index: Option<u32>) -> Result<()> {
    use csp_format::text::{Attributes, split_array, join_array};
    let style=u32::from(bold) | (u32::from(italic)<<1);
    let pixels_per_point=(file.canvas.resolution/72.0*1000.0).round() as u32;
    let alignment=match align {Some("right")=>1u32,Some("center")=>2u32,_=>0u32};
    let patch=|bytes: &[u8], counted: bool| -> Result<Vec<u8>> {
        let mut attr=Attributes::parse(bytes)?;
        let flags=attr.get(0x21).filter(|b|b.len()==4).map(|b|u32::from_le_bytes(b.try_into().unwrap())).unwrap_or(0);
        attr.set(0x21,((flags & !3) | style).to_le_bytes().to_vec());
        attr.set(0x23,alignment.to_le_bytes().to_vec());
        attr.set(0x2c,pixels_per_point.to_le_bytes().to_vec());
        if let Some(bidx) = balloon_index {
            attr.set(0x2d, bidx.to_le_bytes().to_vec());
        }
        let offset=if counted {16}else{8};
        for record in &mut attr.records {
            if record.id==0x0b && record.data.len()>=offset+2 {
                record.data[offset]=(record.data[offset]&!3) | style as u8;
                record.data[offset+1]&=!2;
                if counted && record.data.len()>=offset+16 {record.data[offset+8..offset+16].copy_from_slice(&0f64.to_le_bytes());}
            }
            if record.id==0x0c && record.data.len()>=offset+2 {record.data[offset..offset+2].copy_from_slice(&(alignment as u16).to_le_bytes());}
        }
        Ok(attr.to_bytes())
    };
    let row=select(file.database(),"SELECT TextLayerAttributes, TextLayerAddAttributesV01 FROM Layer WHERE MainId = ?1",[id])?.remove(0);
    if let Some(blob)=row.blob("TextLayerAttributes") {file.set_layer_value(id,"TextLayerAttributes",Value::Blob(patch(blob,true)?))?;}
    if let Some(blob)=row.blob("TextLayerAddAttributesV01") {
        let parts=split_array(blob)?.into_iter().map(|part|patch(part,false)).collect::<Result<Vec<_>>>()?;
        file.set_layer_value(id,"TextLayerAddAttributesV01",Value::Blob(join_array(&parts)))?;
    }
    Ok(())
}

const EXTRA_DONOR_BYTES: &[u8] = include_bytes!("../BalloonFrameDonor.clip");

fn default_brush_style(file: &ClipFile) -> u32 {
    select(file.database(), "SELECT MainId FROM BrushStyle ORDER BY MainId LIMIT 1", [])
        .ok()
        .and_then(|rows| rows.first().map(|r| r.int("MainId") as u32))
        .unwrap_or(1)
}

fn rasterize_frames_mask(width: u32, height: u32, frames: &[Frame]) -> GrayImage {
    let w = width as usize;
    let h = height as usize;
    let mut pixels = vec![0u8; w * h];
    let mut intersections = Vec::new();
    for frame in frames {
        if frame.points.len() < 3 { continue; }
        for y in 0..h {
            let sy = y as f64 + 0.5;
            intersections.clear();
            let n = frame.points.len();
            for i in 0..n {
                let (x0, y0) = frame.points[i];
                let (x1, y1) = frame.points[(i + 1) % n];
                if (y0 <= sy && y1 > sy) || (y1 <= sy && y0 > sy) {
                    let t = (sy - y0) / (y1 - y0);
                    intersections.push(x0 + t * (x1 - x0));
                }
            }
            intersections.sort_by(|a, b| a.total_cmp(b));
            for pair in intersections.chunks_exact(2) {
                let start = (pair[0] - 0.5).ceil().max(0.0) as usize;
                let end = ((pair[1] - 0.5).floor() + 1.0).min(w as f64) as usize;
                if start < end {
                    pixels[y * w + start..y * w + end].fill(255);
                }
            }
        }
    }
    GrayImage { width, height, pixels }
}

fn add(file: &mut ClipFile, parent: i64, layers: &[Layer], donor: &PartDonors, extra_donor: &ClipFile) -> Result<()> {
    for layer in layers {
        let id = match &layer.content {
            Content::Folder { children } => {
                let id = file.add_layer(parent, NewLayer::Folder, &layer.name)?;
                add(file, id, children, donor, extra_donor)?;
                id
            },
            Content::FrameFolder { frames, children } => {
                let id = file.add_layer(parent, NewLayer::Folder, &layer.name)?;
                let border_lines: Vec<NewVectorLine> = frames.iter().map(|f| NewVectorLine {
                    points: f.points.iter().map(|&(x, y)| (x, y, 1.0)).collect(),
                    closed: true,
                    width_px: f.width_px,
                }).collect();
                let color_lines: Vec<Line> = frames.iter().map(|f| Line {
                    points: f.points.iter().map(|&(x, y)| (x, y, 1.0)).collect(),
                    closed: true,
                    width_px: f.width_px,
                    color: [17, 17, 17],
                }).collect();
                let border_id = add_vector_layer(file, donor, "コマ枠", &border_lines, id)?;
                vector_colors(file, border_id, &color_lines)?;
                let inner_id = file.add_layer(id, NewLayer::Folder, "コマ中身")?;
                add(file, inner_id, children, donor, extra_donor)?;
                let mask_gray = rasterize_frames_mask(file.canvas.width_px, file.canvas.height_px, frames);
                let mut mask_rgba = vec![0u8; mask_gray.pixels.len() * 4];
                for (i, &a) in mask_gray.pixels.iter().enumerate() {
                    mask_rgba[i * 4 + 3] = a;
                }
                set_layer_mask(file, inner_id, &clip_core::RgbaImage {
                    width: mask_gray.width,
                    height: mask_gray.height,
                    pixels: mask_rgba,
                })?;
                id
            },
            Content::Raster { png: image, x, y } => {
                let image = png(image)?;
                let id = file.add_layer(parent, NewLayer::Raster, &layer.name)?;
                file.set_layer_pixels(id, &image, (*x,*y))?;
                id
            },
            Content::Text { text, frame, font_size_pt, vertical, color, font, line_spacing, font_weight, italic, text_align, balloons } => {
                let id = if !balloons.is_empty() {
                    let brush_id = default_brush_style(file);
                    let (vdata, bbox) = build_balloon_vector_data(balloons, brush_id);
                    let cx = (bbox[0] + bbox[2]).div_euclid(2);
                    let cy = (bbox[1] + bbox[3]).div_euclid(2);
                    let text_frame = [frame[0] - cx, frame[1] - cy, frame[2] - cx, frame[3] - cy];
                    let new_text = NewText { text:text.clone(), frame:text_frame, font_size_pt:*font_size_pt, vertical:*vertical,
                        color:Some(*color), font:font.as_ref().map(|f| FontName{name:f.name.clone(),postscript:f.postscript.clone()}), line_spacing:*line_spacing };
                    let payload = vdata.to_bytes();
                    let payload_hook = |table: &str, column: &str, existing: Vec<u8>| -> csp_format::Result<Vec<u8>> {
                        Ok(if table == "VectorObjectList" && column == "VectorData" { payload.clone() } else { existing })
                    };
                    let layer_name = layer.name.clone();
                    let mut edit = |row: &mut Row| -> csp_format::Result<()> {
                        row.set("LayerName", Value::Text(layer_name.clone()));
                        row.set("TextLayerString", Value::Blob(new_text.stored_text().into_bytes()));
                        if let Some(blob) = row.blob("TextLayerAttributes") {
                            let updated = retarget_text_attributes(blob, &new_text).map_err(|e| csp_format::Error::format(e.to_string()))?;
                            row.set("TextLayerAttributes", Value::Blob(updated));
                        }
                        if let Some(blob) = row.blob("TextLayerAddAttributesV01") {
                            let updated = retarget_add_attributes(blob, &new_text).map_err(|e| csp_format::Error::format(e.to_string()))?;
                            row.set("TextLayerAddAttributesV01", Value::Blob(updated));
                        }
                        row.set("TextLayerStringArray", Value::Null);
                        row.set("TextLayerAttributesArray", Value::Null);
                        Ok(())
                    };
                    file.copy_layer_from(extra_donor, 14, CopyLayer {
                        payload_hook: Some(&payload_hook),
                        row_hook: Some(&mut edit),
                        parent: Some(parent),
                    })?
                } else {
                    let new_text = NewText { text:text.clone(), frame:*frame, font_size_pt:*font_size_pt, vertical:*vertical,
                        color:Some(*color), font:font.as_ref().map(|f| FontName{name:f.name.clone(),postscript:f.postscript.clone()}), line_spacing:*line_spacing };
                    let id = add_text_layer(file, donor, &new_text, parent)?;
                    file.set_layer_name(id, &layer.name)?;
                    id
                };
                text_style(file,id,font.as_ref().and_then(|f|f.synthetic_bold).unwrap_or(*font_weight>=600),
                    font.as_ref().and_then(|f|f.synthetic_italic).unwrap_or(*italic),text_align.as_deref(), (!balloons.is_empty()).then_some(1))?;
                id
            },
            Content::Vector { lines } => {
                let native = lines.iter().map(|line| NewVectorLine{points:line.points.clone(),closed:line.closed,width_px:line.width_px}).collect::<Vec<_>>();
                let id = add_vector_layer(file, donor, &layer.name, &native, parent)?;
                vector_colors(file, id, lines)?;
                id
            },
        };
        if !matches!(layer.content, Content::FrameFolder { .. }) {
            if let Some(mask) = &layer.mask {
                let image = png(&mask.png)?;
                let mut full = RgbaImage::new(file.canvas.width_px, file.canvas.height_px);
                full.paste(&image,mask.x,mask.y);
                set_layer_mask(file,id,&clip_core::RgbaImage{width:full.width,height:full.height,pixels:full.pixels})?;
            }
        }
        file.set_layer_opacity(id,layer.opacity)?;
        file.set_layer_visible(id,layer.visible)?;
        file.set_layer_blend(id,if layer.pass_through && matches!(layer.content,Content::Folder{..}) {BlendMode::PassThrough} else {match layer.blend {Blend::Normal=>BlendMode::Normal,Blend::Multiply=>BlendMode::Multiply}})?;
        file.set_layer_value(id,"LayerLock",Value::Integer(i64::from(layer.locked)))?;
    }
    Ok(())
}

fn encode(page: &Page) -> Result<Vec<u8>> {
    if page.profile!="nyamuru-clip-v1" || page.width==0 || page.height==0 || page.width>30_000 || page.height>30_000
        || u64::from(page.width)*u64::from(page.height)>MAX_PIXELS || !page.dpi.is_finite() || !(72.0..=1200.0).contains(&page.dpi)
        || page.title.len()>4096 || page.page==0 { return Err("CLIP書き出しの用紙設定が不正です".into()); }
    validate_layers(&page.layers,0,&mut HashSet::new())?;
    let mm=[f64::from(page.width)*25.4/page.dpi,f64::from(page.height)*25.4/page.dpi];
    let raw_trim=page.trim_mm.unwrap_or(mm);
    let trim_mm=[raw_trim[0].min(mm[0]),raw_trim[1].min(mm[1])];
    let bleed_mm=page.bleed_mm.unwrap_or(0.0).max(0.0);
    let raw_basic=page.basic_mm.unwrap_or(trim_mm);
    let basic_mm=[raw_basic[0].min(trim_mm[0]),raw_basic[1].min(trim_mm[1])];
    let setup=PageSetup {canvas_mm:mm,resolution:page.dpi,trim_mm,bleed_mm,basic_mm,basic_offset_mm:[0.0;2],
        right_binding:page.right_binding.unwrap_or(true),first_page_left:true,title:page.title.clone(),story_index:None,author:String::new(),nombre_start:1,font:None,story:StoryLayout::default()};
    let mut file=blank_page(&setup)?;
    let root=file.canvas.root_folder;
    // The app supplies every authored layer. Keep only a separate white paper,
    // which CSP can hide to reveal the actual alpha in each layer.
    for id in file.layer_children(root)? { file.remove_layer(id)?; }
    file.add_layer(root,NewLayer::Paper([255;3]),"用紙")?;
    let donor=PartDonors::find(ClipDocument::from_file(blank_parts()?,Path::new("(built-in parts)"))?)?;
    prepare_for(&mut file,&donor)?;
    let extra_donor=ClipFile::from_bytes(EXTRA_DONOR_BYTES.to_vec())?;
    file.prepare_copy_from(&extra_donor)?;
    add(&mut file,root,&page.layers,&donor,&extra_donor)?;
    if let Some(preview)=&page.preview {
        let image=png(preview)?;
        let image=if image.width.max(image.height)>2048 {
            let factor=2048.0/f64::from(image.width.max(image.height));
            image.resize_area((f64::from(image.width)*factor).round().max(1.0) as u32,(f64::from(image.height)*factor).round().max(1.0) as u32)
        }else{image};
        file.database().execute("UPDATE CanvasPreview SET ImageData = ?1, ImageWidth = ?2, ImageHeight = ?3",(image.to_png()?,image.width,image.height))?;
    } else { file.update_preview()?; }
    Ok(file.to_bytes()?)
}

fn inspect(data: Vec<u8>) -> Result<serde_json::Value> {
    let file=ClipFile::from_bytes(data)?;
    let layers=file.layers.flatten().into_iter().map(|(layer,depth)| {
        let texts=csp_format::text::read_blocks(&layer.row).unwrap_or_default().into_iter().map(|block| {
            json!({"text":block.text,"fontSizePt":block.attributes.font_size(),"frame":block.attributes.bbox(),"font":block.attributes.font()})
        }).collect::<Vec<_>>();
        json!({"id":layer.main_id,"depth":depth,"name":layer.name,"kind":layer.kind.name(),"opacity":layer.opacity,"visible":layer.visible,"locked":layer.locked,"blend":layer.blend,"mask":layer.mask_enabled,"texts":texts})
    }).collect::<Vec<_>>();
    Ok(json!({"width":file.canvas.width_px,"height":file.canvas.height_px,"dpi":file.canvas.resolution,"layers":layers}))
}

fn run() -> Result<()> {
    let mut bytes=Vec::new();std::io::stdin().take(MAX_INPUT+1).read_to_end(&mut bytes)?;
    if bytes.len() as u64>MAX_INPUT {return Err("入力サイズが上限を超えています".into());}
    if std::env::args().nth(1).as_deref()==Some("--inspect") {
        serde_json::to_writer(std::io::stdout(),&inspect(bytes)?)?;
    } else {
        let page:Page=serde_json::from_slice(&bytes)?;
        std::io::stdout().write_all(&encode(&page)?)?;
    }
    Ok(())
}
fn main(){if let Err(error)=run(){eprintln!("{error}");std::process::exit(1);}}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture() -> Page {
        let mut image=RgbaImage::new(2,2);
        image.pixels=vec![255,0,0,128,0,0,0,0,0,255,0,255,0,0,255,64];
        let png=format!("data:image/png;base64,{}",STANDARD.encode(image.to_png().unwrap()));
        serde_json::from_value(json!({"profile":"nyamuru-clip-v1","width":128,"height":160,"dpi":300,"title":"確認","page":1,
            "layers":[{"kind":"folder","id":"group","name":"作画","visible":true,"locked":false,"opacity":1.0,"blend":"normal","passThrough":true,
                "children":[{"kind":"raster","id":"image","name":"透過画像","visible":false,"locked":true,"opacity":0.5,"blend":"multiply","png":png,"x":10,"y":20},
                    {"kind":"text","id":"text","name":"セリフ","visible":true,"locked":false,"opacity":1.0,"blend":"normal","text":"こんにちは\n新しい文字です😀","frame":[30,20,100,140],"fontSizePt":15,"vertical":true,"color":[17,17,17],"lineSpacing":105,"font":{"name":"ヒラギノ角ゴシック W3","postscript":"HiraginoSans-W3"}},
                    {"kind":"vector","id":"line","name":"編集線","visible":true,"locked":false,"opacity":1.0,"blend":"normal","lines":[{"points":[[1,2,1],[20,30,0.5]],"closed":false,"widthPx":3,"color":[50,100,200]}]}]}]})).unwrap()
    }
    // 見込み: 同梱writerで符号化すれば文字と線を画像化せず構造を保持できる。
    // 合格: 実CLIP再読込で本文・座標・文字種・階層/順序・線色・透過画素が一致。CSP画面は別確認。
    #[test]
    fn clip_roundtrip_keeps_editable_content_and_alpha() {
        let page=fixture();let bytes=encode(&page).unwrap();let file=ClipFile::from_bytes(bytes.clone()).unwrap();
        assert_eq!((file.canvas.width_px,file.canvas.height_px,file.canvas.resolution),(128,160,300.0));
        let group=file.layers.flatten().into_iter().find(|(l,_)|l.name=="作画").unwrap().0;
        assert_eq!(group.blend,30);
        let ids=file.layer_children(group.main_id).unwrap();
        assert_eq!(ids.iter().map(|id|file.layers.get(*id).unwrap().name.as_str()).collect::<Vec<_>>(),["透過画像","セリフ","編集線"]);
        let raster=file.layers.get(ids[0]).unwrap();assert!(!raster.visible);assert!(raster.locked);assert_eq!(raster.opacity,128);assert_eq!(raster.blend,2);
        let pixels=file.layer_pixels_in_box(raster,(10,20,12,22)).unwrap();assert_eq!(pixels.pixels,[255,0,0,128,0,0,0,0,0,255,0,255,0,0,255,64]);
        let text=file.layers.get(ids[1]).unwrap();let blocks=csp_format::text::read_blocks(&text.row).unwrap();assert_eq!(blocks.len(),1);
        assert_eq!(blocks[0].text,"こんにちは\r\n新しい文字です😀");assert_eq!(blocks[0].attributes.font_size(),Some(15.0));assert_eq!(blocks[0].attributes.bbox(),Some([30,20,100,140]));
        let layer=file.layers.get(ids[2]).unwrap();
        let reference=select(file.database(),"SELECT VectorData FROM VectorObjectList WHERE LayerId = ?1",[layer.main_id]).unwrap()[0].text("VectorData").unwrap();
        let data=VectorData::parse(file.external(&reference).unwrap()).unwrap();assert_eq!(data.objects.len(),1);assert_eq!(data.objects[0].main_color(),[50,100,200]);assert_eq!(data.objects[0].coordinates(),[(1.0,2.0),(20.0,30.0)]);
        let report=csp_format::verify::check_clip(bytes,csp_format::verify::CheckOptions::default());
        assert!(report.ok(),"{}",serde_json::to_string_pretty(&report).unwrap());
    }
    // 見込み: マスクは画素へ焼かず別面に保持し、透明度0の層も残る。
    // 合格: 実CLIP再読込でmask alphaと層opacity=0が一致。CSPでの手操作は別確認。
    #[test]
    fn mask_and_zero_opacity_survive() {
        let mut page=fixture();let mut image=RgbaImage::new(2,2);image.pixels=vec![255,255,255,0,255,255,255,128,255,255,255,255,255,255,255,64];
        page.layers[0].mask=Some(Mask{png:format!("data:image/png;base64,{}",STANDARD.encode(image.to_png().unwrap())),x:10,y:20});page.layers[0].opacity=0.0;
        let file=ClipFile::from_bytes(encode(&page).unwrap()).unwrap();
        let group=file.layers.flatten().into_iter().find(|(l,_)|l.name=="作画").unwrap().0;
        assert_eq!(group.opacity,0);assert!(group.mask_enabled);
        let (mask,origin)=file.layer_mask(group).unwrap().unwrap();
        let x=(10-origin.0) as usize;let y=(20-origin.1) as usize;let width=mask.width as usize;
        assert_eq!([mask.pixels[y*width+x],mask.pixels[y*width+x+1],mask.pixels[(y+1)*width+x],mask.pixels[(y+1)*width+x+1]],[0,128,255,64]);
    }
    // 見込み: donorの600dpi・書体・書式に引きずられず出力指定を採用する。
    // 合格: main/add属性にページdpi換算、指定font、太字/斜体/揃えが残る。
    // 範囲: 実ファイル読戻し。150dpiの24ptが約50pxになることは実CSPでも確認。
    #[test]
    fn text_uses_target_dpi_font_and_style() {
        use csp_format::text::{Attributes,split_array};
        for (dpi,expected) in [(150.0,2083u32),(300.0,4167),(600.0,8333)] {
            let mut page=fixture();page.dpi=dpi;
            if let Content::Folder{children}=&mut page.layers[0].content {
                if let Content::Text{font_weight,italic,text_align,..}=&mut children[1].content {*font_weight=700;*italic=true;*text_align=Some("center".into());}
            }
            let file=ClipFile::from_bytes(encode(&page).unwrap()).unwrap();
            let text=file.layers.flatten().into_iter().find(|(l,_)|l.name=="セリフ").unwrap().0;
            let main=Attributes::parse(text.row.blob("TextLayerAttributes").unwrap()).unwrap();
            let add=Attributes::parse(split_array(text.row.blob("TextLayerAddAttributesV01").unwrap()).unwrap()[0]).unwrap();
            for attr in [&main,&add] {assert_eq!(attr.get(0x2c),Some(expected.to_le_bytes().as_slice()));assert_eq!(attr.get(0x21).unwrap()[0]&3,3);assert_eq!(attr.get(0x23).unwrap()[0],2);}
            assert_eq!(main.font().unwrap().postscript_name,"HiraginoSans-W3");
            assert_eq!(main.get(0x0b).unwrap()[17]&2,0);
            assert_eq!(f64::from_le_bytes(main.get(0x0b).unwrap()[24..32].try_into().unwrap()),0.0);
        }
    }
    // 見込み: 実太字・斜体faceを選んだときは擬似書式を重ねない。
    // 合格: 指定faceを保持し、main/addの擬似style bitが0。範囲: 実バイナリ属性。
    #[test]
    fn real_font_faces_do_not_receive_synthetic_style() {
        use csp_format::text::{Attributes,split_array};
        let mut page=fixture();
        if let Content::Folder{children}=&mut page.layers[0].content {
            if let Content::Text{font,font_weight,italic,..}=&mut children[1].content {
                *font_weight=700;*italic=true;
                *font=Some(Font{name:"Test Bold Italic".into(),postscript:"Test-BoldItalic".into(),synthetic_bold:Some(false),synthetic_italic:Some(false)});
            }
        }
        let file=ClipFile::from_bytes(encode(&page).unwrap()).unwrap();
        let text=file.layers.flatten().into_iter().find(|(l,_)|l.name=="セリフ").unwrap().0;
        let main=Attributes::parse(text.row.blob("TextLayerAttributes").unwrap()).unwrap();
        let add=Attributes::parse(split_array(text.row.blob("TextLayerAddAttributesV01").unwrap()).unwrap()[0]).unwrap();
        for attr in [&main,&add] {assert_eq!(attr.get(0x21).unwrap()[0]&3,0);}
        assert_eq!(main.font().unwrap().postscript_name,"Test-BoldItalic");
    }
    #[test]
    fn balloon_text_layer_passes_verify() {
        let mut page=fixture();
        page.layers=vec![serde_json::from_value(json!({
            "kind":"text","id":"b1","name":"本文 1","visible":true,"locked":false,"opacity":1.0,"blend":"normal",
            "text":"テスト","frame":[30,30,90,110],"fontSizePt":14,"vertical":true,"color":[17,17,17],
            "balloons":[
                {"points":[[60.0,10.0],[110.0,70.0],[60.0,130.0],[10.0,70.0]],"isTail":false,"spline":true,"widthPx":3.0,"color":[17,17,17],"fill":[255,255,255]},
                {"points":[[50.0,125.0],[60.0,155.0],[70.0,125.0]],"isTail":true,"spline":false,"widthPx":3.0,"color":[17,17,17],"fill":[255,255,255]}
            ]
        })).unwrap()];
        let bytes=encode(&page).unwrap();
        let file=ClipFile::from_bytes(bytes.clone()).unwrap();
        let layer=file.layers.flatten().into_iter().find(|(l,_)|l.name=="本文 1").unwrap().0;
        let vectors=csp_format::stroke::layer_vectors(&file,layer).unwrap();
        assert_eq!(vectors.len(),1);
        assert_eq!(vectors[0].objects.len(),2);
        assert_eq!(vectors[0].objects[0].points.len(),4);
        assert_eq!(vectors[0].objects[1].points.len(),3);
        let blocks=csp_format::text::read_blocks(&layer.row).unwrap();
        assert_eq!(blocks[0].attributes.balloon(),Some(1));
        let report=csp_format::verify::check_clip(bytes,csp_format::verify::CheckOptions::default());
        assert!(report.ok(),"{}",serde_json::to_string_pretty(&report).unwrap());
    }
    #[test]
    fn frame_folder_keeps_connected_border_and_children() {
        let mut page=fixture();
        page.layers=vec![serde_json::from_value(json!({
            "kind":"frame_folder","id":"panel-0","name":"コマ 1","visible":true,"locked":false,"opacity":1.0,"blend":"normal",
            "frames":[{"points":[[10.0,10.0],[118.0,10.0],[118.0,150.0],[10.0,150.0]],"widthPx":4.0}],
            "children":[
                {"kind":"vector","id":"line","name":"フキダシの枠","visible":true,"locked":false,"opacity":1.0,"blend":"normal",
                    "lines":[{"points":[[20.0,20.0,1.0],[80.0,20.0,1.0],[80.0,60.0,1.0],[20.0,60.0,1.0]],"closed":true,"widthPx":2.0,"color":[17,17,17]}]}
            ]
        })).unwrap()];
        let bytes=encode(&page).unwrap();
        let file=ClipFile::from_bytes(bytes.clone()).unwrap();
        let frame=file.layers.flatten().into_iter().find(|(l,_)|l.name=="コマ 1").unwrap().0;
        let children=file.layer_children(frame.main_id).unwrap();
        assert_eq!(children.len(),2);
        let border=file.layers.get(children[0]).unwrap();
        assert_eq!(border.name,"コマ枠");
        let reference=select(file.database(),"SELECT VectorData FROM VectorObjectList WHERE LayerId = ?1",[border.main_id]).unwrap()[0].text("VectorData").unwrap();
        let data=VectorData::parse(file.external(&reference).unwrap()).unwrap();
        assert_eq!(data.objects.len(),1);
        assert_eq!(data.objects[0].coordinates(),[(10.0,10.0),(118.0,10.0),(118.0,150.0),(10.0,150.0)]);
        let inner=file.layers.get(children[1]).unwrap();
        assert_eq!(inner.name,"コマ中身");
        assert!(inner.mask_enabled);
        let inner_children=file.layer_children(inner.main_id).unwrap();
        assert_eq!(inner_children.len(),1);
        assert_eq!(file.layers.get(inner_children[0]).unwrap().name,"フキダシの枠");
        let mm = inner.row.int("LayerLayerMaskMipmap");
        let base_off = file.mipmap(mm).unwrap().unwrap().levels[0].offscreen;
        let orow = file.row("Offscreen", base_off).unwrap().unwrap();
        let ext = orow.text("BlockData").unwrap();
        let off = csp_format::offscreen::Offscreen::parse(orow.blob("Attribute").unwrap(), Some(file.external(&ext).unwrap())).unwrap();
        let alpha = off.to_alpha().unwrap();
        let c255 = alpha.pixels.iter().filter(|&&p| p == 255).count();
        let c0 = alpha.pixels.iter().filter(|&&p| p == 0).count();
        assert!(c255 > 0 && c0 > 0, "expected non-empty mask, got c255={c255}, c0={c0}");
        let report=csp_format::verify::check_clip(bytes,csp_format::verify::CheckOptions::default());
        assert!(report.ok(),"{}",serde_json::to_string_pretty(&report).unwrap());
    }
    // 見込み: 無効な寸法・ID重複・壊れた画像は完成ファイルとして返さない。
    // 合格: encoderがErrを返す。外部サービスやUIは通さない。
    #[test]
    fn invalid_input_is_rejected_before_output() {
        let mut page=fixture();page.width=30_001;assert!(encode(&page).is_err());
        let mut page=fixture();if let Content::Folder{children}= &mut page.layers[0].content {children[0].id="group".into();}assert!(encode(&page).is_err());
        assert!(png("data:image/png;base64,aGVsbG8=").is_err());
    }
}
