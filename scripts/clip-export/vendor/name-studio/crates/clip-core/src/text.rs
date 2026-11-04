//! Attributes of a CSP text layer (`TextLayerAttributes`).
//!
//! A little-endian TLV list (`u32 id, u32 size, bytes`). Observed ids:
//! 0x20 font size × 100 (pt), 0x2a bbox i32[4] (layer-local px),
//! 0x39 font name, 0x3f block size i32[2] (px), 0x40 quad i32[8] (1/100 px).
//! `TextLayerAttributesArray` repeats `u32 size + TLV list` per text block.

use csp_format::text::{Attributes, Record, split_array};

use crate::error::{CspError, Result};
use crate::vector::BBox;

pub const ATTR_FONT_SIZE: u32 = 0x20;
pub const ATTR_BBOX: u32 = 0x2a;
pub const ATTR_FONT_NAME: u32 = 0x39;
pub const ATTR_BLOCK_SIZE: u32 = 0x3f;
pub const ATTR_QUAD: u32 = 0x40;
const FONT_SIZE_UNIT: f64 = 100.0;

/// The decoded subset of one text block's attributes.
#[derive(Debug, Clone, PartialEq)]
pub struct TextAttributes {
    pub bbox: Option<BBox>,
    pub font_size_pt: Option<f64>,
    pub font_name: Option<String>,
}

/// The records of an attribute blob, in order (csp-format reads the list).
fn records(blob: &[u8]) -> Result<Vec<Record>> {
    Ok(Attributes::parse(blob)?.records)
}

/// An attribute blob of these records, in order.
fn blob_of(records: Vec<Record>) -> Vec<u8> {
    Attributes { records }.to_bytes()
}

/// `(id, value)` pairs of an attribute blob, in order.
pub fn parse_tlv(blob: &[u8]) -> Result<Vec<(u32, Vec<u8>)>> {
    Ok(records(blob)?
        .into_iter()
        .map(|record| (record.id, record.data))
        .collect())
}

/// Inverse of [`parse_tlv`].
pub fn build_tlv(items: &[(u32, Vec<u8>)]) -> Vec<u8> {
    blob_of(
        items
            .iter()
            .map(|(id, data)| Record {
                id: *id,
                data: data.clone(),
            })
            .collect(),
    )
}

fn le_u32(value: &[u8], at: usize) -> Option<u32> {
    Some(u32::from_le_bytes(value.get(at..at + 4)?.try_into().ok()?))
}

fn le_i32s<const N: usize>(value: &[u8]) -> Option<[i32; N]> {
    (value.len() == 4 * N)
        .then(|| std::array::from_fn(|i| i32::from_le_bytes(value[4 * i..4 * i + 4].try_into().unwrap())))
}

/// Decode the bbox, font size and font name of one text block.
pub fn parse_text_attributes(blob: &[u8]) -> Result<TextAttributes> {
    let records = records(blob)?;
    // Later duplicates win, like building a dict from the pairs.
    let find = |id: u32| {
        records
            .iter()
            .rev()
            .find(|record| record.id == id)
            .map(|record| record.data.as_slice())
    };
    Ok(TextAttributes {
        bbox: find(ATTR_BBOX)
            .and_then(le_i32s::<4>)
            .map(|[x0, y0, x1, y1]| (x0, y0, x1, y1)),
        font_size_pt: find(ATTR_FONT_SIZE)
            .and_then(le_i32s::<1>)
            .map(|[size]| size as f64 / FONT_SIZE_UNIT),
        font_name: find(ATTR_FONT_NAME).and_then(font_name),
    })
}

fn font_name(value: &[u8]) -> Option<String> {
    let length = u16::from_le_bytes(value.get(2..4)?.try_into().ok()?) as usize;
    value
        .get(4..4 + length)
        .map(|name| String::from_utf8_lossy(name).into_owned())
}

/// Split `TextLayerAttributesArray` into per-block attribute blobs.
pub fn split_attribute_array(blob: &[u8]) -> Result<Vec<&[u8]>> {
    Ok(split_array(blob)?)
}

/// `blob` with its bbox mapped to `p * scale + d` and font size, block size
/// and quad scaled, and no [`ATTR_RENDER_CACHE`]: CSP's rendering of the
/// text stays behind in the source file. Everything else is copied unchanged.
pub fn transform_text_attributes(blob: &[u8], scale: f64, dx: f64, dy: f64) -> Result<Vec<u8>> {
    if scale <= 0.0 {
        return Err(CspError::format("scale must be positive"));
    }
    let mut records = records(blob)?;
    for Record { id, data } in &mut records {
        let (id, value) = (*id, data.as_slice());
        let changed: Option<Vec<u8>> = if id == ATTR_BBOX && value.len() == 16 {
            let [x0, y0, x1, y1] = le_i32s::<4>(value).unwrap();
            Some(i32s(&[
                (x0 as f64 * scale + dx).floor() as i32,
                (y0 as f64 * scale + dy).floor() as i32,
                (x1 as f64 * scale + dx).ceil() as i32,
                (y1 as f64 * scale + dy).ceil() as i32,
            ]))
        } else if id == ATTR_RENDER_CACHE && value.len() == 4 {
            Some(0u32.to_le_bytes().to_vec())
        } else if matches!(id, ATTR_FONT_SIZE | ATTR_BLOCK_SIZE | ATTR_QUAD)
            && !value.is_empty()
            && value.len() % 4 == 0
        {
            Some(
                value
                    .as_chunks::<4>()
                    .0
                    .iter()
                    .flat_map(|bytes| {
                        let number = i32::from_le_bytes(*bytes);
                        ((number as f64 * scale).round_ties_even() as i32).to_le_bytes()
                    })
                    .collect(),
            )
        } else {
            None
        };
        if let Some(changed) = changed {
            *data = changed;
        }
    }
    Ok(blob_of(records))
}

/// Vertical writing bit of `ATTR_DIRECTION` (observed `0x10` for 縦書き).
pub const ATTR_DIRECTION: u32 = 0x21;
/// Character count of the text, `u32` + `u32` 0.
pub const ATTR_LENGTH: u32 = 0x27;
/// Offset of the text from its frame, `i32` × 2 (block width for 縦書き).
pub const ATTR_ORIGIN: u32 = 0x48;
/// Default text colour: per channel a `u16` (8-bit value × 257), written
/// twice. Seen black (all 0) on dialogue and white (all `ff`) on text over
/// black. A font run with [`RUN_HAS_COLOR`] overrides it.
pub const ATTR_COLOR: u32 = 0x22;
/// The text's font as CSP's tool property shows it: the shown name in UTF-8,
/// with no length (in the add-attributes too). A CSP-made dialogue has it
/// beside [`ATTR_FONT_NAME`] and the font run's name.
pub const ATTR_FONT_FAMILY: u32 = 0x1f;
/// `MainId` of the Offscreen holding CSP's rendering of the text (`u32`).
/// A copied layer must not point at the donor's id, which in the new file is
/// missing or belongs to another layer; 0 makes CSP render the text afresh.
pub const ATTR_RENDER_CACHE: u32 = 0x32;
const VERTICAL_BIT: u32 = 0x10;
/// Style-run tags: `u32` run count, then per run `u32` start, `u32` length,
/// a `u32` and the run's data. The `u32` is the data size, except for
/// [`ATTR_FONT_RUNS`]. A plain one-style text has one run each.
const RUN_TAGS: [u32; 8] = [ATTR_FONT_RUNS, 0x1a, 0x0c, 0x0d, 0x1d, 0x41, 0x1e, 0x12];
/// Font runs: the `u32` is a set of flags and the data is 16 bytes, then a
/// `u16` count of UTF-16 units of the font name and the name. Data byte 1
/// holds flags, with byte 1 of the run's data in `TextLayerAddAttributesV01`
/// the same.
const ATTR_FONT_RUNS: u32 = 0x0b;
/// Paragraph runs: data byte 0 is the line spacing mode and an `f64` at
/// bytes 10..18 the spacing. With mode 1 it is a percentage of the font
/// size, the column (or line) pitch: CSP's dialogue has 1 and 125.0, and
/// its vertical text is laid out 1.25 font sizes per column.
const ATTR_PARAGRAPH_RUNS: u32 = 0x0d;
const LINE_SPACING_PERCENT: u8 = 1;
/// Font run flag: the run has its own colour, `u16` R, G, B (8-bit value ×
/// 257) at data bytes 2..8. CSP draws it instead of [`ATTR_COLOR`], so a
/// donor's black dialogue stays black unless the run is recoloured too.
const RUN_HAS_COLOR: u8 = 0x01;
/// Run tags a plain text leaves empty (seen set on parts of a text CSP
/// styled differently); a new text drops them.
const EXTRA_RUN_TAGS: [u32; 10] = [0x0e, 0x0f, 0x10, 0x11, 0x13, 0x14, 0x15, 0x16, 0x1b, 0x1c];

/// One style run: start, length, the `u32` after them and the data.
type Run<'a> = (u32, u32, u32, &'a [u8]);

/// The per-run data of a run tag in `TextLayerAddAttributesV01`: `u32`
/// count, then per run a `u32` size and the data. Kept if `value` is
/// exactly such a list.
fn parse_add_runs(value: &[u8]) -> Option<Vec<&[u8]>> {
    let count = le_u32(value, 0)?;
    let mut runs = Vec::new();
    let mut offset = 4;
    for _ in 0..count {
        let size = le_u32(value, offset)? as usize;
        runs.push(value.get(offset + 4..offset + 4 + size)?);
        offset += 4 + size;
    }
    (offset == value.len()).then_some(runs)
}

/// Set the line spacing of the one paragraph run of `value` (as
/// [`single_run`] or [`single_add_run`] makes it) to `percent`.
fn space_paragraph_run(value: &mut [u8], percent: f64, counted_run: bool) {
    let data = if counted_run { 16 } else { 8 };
    if value.len() < data + 18 {
        return;
    }
    value[data] = LINE_SPACING_PERCENT;
    value[data + 10..data + 18].copy_from_slice(&percent.to_le_bytes());
}

/// The line spacing (percent of the font size) of the first paragraph run
/// of `blob`, when it is given as a percentage.
pub fn line_spacing(blob: &[u8]) -> Result<Option<f64>> {
    for Record { id, data } in records(blob)? {
        if id == ATTR_PARAGRAPH_RUNS
            && let Some(runs) = parse_runs(id, &data)
            && let Some((_, _, _, data)) = runs.first()
            && data.len() >= 18
            && data[0] == LINE_SPACING_PERCENT
        {
            return Ok(Some(f64::from_le_bytes(data[10..18].try_into().unwrap())));
        }
    }
    Ok(None)
}

/// The first run of an add-attributes run list on its own.
fn single_add_run(id: u32, value: &[u8]) -> Result<Vec<u8>> {
    let runs = parse_add_runs(value)
        .ok_or_else(|| CspError::format(format!("Added text attribute 0x{id:x} is not a run list")))?;
    let Some(data) = runs.first() else {
        return Ok(value.to_vec());
    };
    let mut out = Vec::with_capacity(8 + data.len());
    for number in [1, data.len() as u32] {
        out.extend_from_slice(&number.to_le_bytes());
    }
    out.extend_from_slice(data);
    Ok(out)
}

/// Give the one font run of `value` (as [`single_run`] or [`single_add_run`]
/// makes it) its own `color`. The add-attributes run only carries the flag.
fn color_font_run(value: &mut [u8], color: [u8; 3], counted_run: bool) {
    let data = if counted_run { 16 } else { 8 };
    if let Some(flags) = value.get_mut(data + 1) {
        *flags |= RUN_HAS_COLOR;
    }
    if counted_run {
        let channels: Vec<u8> = color.iter().flat_map(|&c| (u16::from(c) * 257).to_le_bytes()).collect();
        if let Some(slot) = value.get_mut(data + 2..data + 8) {
            slot.copy_from_slice(&channels);
        }
    }
}

/// Name the font of the one font run of `value` (as [`single_run`] makes it).
/// CSP draws the text in the run's font when the run names one, whatever
/// [`ATTR_FONT_NAME`] says (a CSP-made dialogue names it in both).
fn name_font_run(value: &mut Vec<u8>, name: &str) {
    const DATA: usize = 16;
    if value.len() < DATA + 18 {
        return;
    }
    let units: Vec<u16> = name.encode_utf16().collect();
    value.truncate(DATA + 16);
    value.extend((units.len() as u16).to_le_bytes());
    value.extend(units.iter().flat_map(|unit| unit.to_le_bytes()));
}

/// The runs of run tag `id`, if `value` is exactly a run list.
fn parse_runs(id: u32, value: &[u8]) -> Option<Vec<Run<'_>>> {
    let count = le_u32(value, 0)?;
    let mut runs = Vec::new();
    let mut offset = 4;
    for _ in 0..count {
        let start = le_u32(value, offset)?;
        let length = le_u32(value, offset + 4)?;
        let field = le_u32(value, offset + 8)?;
        let data_at = offset + 12;
        let size = if id == ATTR_FONT_RUNS {
            let name = value.get(data_at + 16..data_at + 18)?;
            18 + 2 * u16::from_le_bytes([name[0], name[1]]) as usize
        } else {
            field as usize
        };
        runs.push((start, length, field, value.get(data_at..data_at + size)?));
        offset = data_at + size;
    }
    (offset == value.len()).then_some(runs)
}

/// One run over the whole text, styled like the first run of `value`.
fn single_run(id: u32, value: &[u8], length: u32) -> Result<Vec<u8>> {
    let runs =
        parse_runs(id, value).ok_or_else(|| CspError::format(format!("Text attribute 0x{id:x} is not a run list")))?;
    let Some((_, _, field, data)) = runs.first() else {
        return Ok(value.to_vec());
    };
    let mut out = Vec::with_capacity(16 + data.len());
    for number in [1, 0, length, *field] {
        out.extend_from_slice(&number.to_le_bytes());
    }
    out.extend_from_slice(data);
    Ok(out)
}

/// A new text block, in layer-local pixels.
#[derive(Debug, Clone, PartialEq)]
pub struct NewText {
    pub text: String,
    /// Frame `[x0, y0, x1, y1]`; 縦書き starts at its top right.
    pub frame: [i32; 4],
    pub font_size_pt: f64,
    pub vertical: bool,
    /// Text colour (8-bit RGB); `None` keeps the donor's.
    pub color: Option<[u8; 3]>,
    /// Font; `None` keeps the donor's.
    pub font: Option<FontName>,
    /// Line spacing in percent of the font size (CSP's 行間); `None` keeps the donor's.
    pub line_spacing: Option<f64>,
}

/// A font as a text layer names it ([`ATTR_FONT_NAME`]): the name CSP shows
/// (`I-OTFアンチックStd B`) and the PostScript name (`IwaAntStd-Bd`).
#[derive(Debug, Clone, PartialEq)]
pub struct FontName {
    pub name: String,
    pub postscript: String,
}

impl FontName {
    /// `u16` 1, then each name as a `u16` byte count and UTF-8 (as CSP writes it).
    pub fn to_attribute(&self) -> Vec<u8> {
        let mut value = 1u16.to_le_bytes().to_vec();
        for text in [&self.name, &self.postscript] {
            value.extend((text.len() as u16).to_le_bytes());
            value.extend(text.as_bytes());
        }
        value
    }
}

impl NewText {
    /// CSP stores line breaks as CRLF and counts UTF-16 units.
    pub fn stored_text(&self) -> String {
        self.text.replace("\r\n", "\n").replace('\n', "\r\n")
    }

    fn length(&self) -> u32 {
        self.stored_text().encode_utf16().count() as u32
    }
}

fn color_bytes(color: [u8; 3]) -> Vec<u8> {
    color
        .iter()
        .flat_map(|&channel| {
            let wide = (u16::from(channel) * 257).to_le_bytes();
            [wide, wide].concat()
        })
        .collect()
}

fn i32s(values: &[i32]) -> Vec<u8> {
    values.iter().flat_map(|value| value.to_le_bytes()).collect()
}

/// `blob` (the attributes of a CSP-made single-run text) rewritten for `text`:
/// character counts, size, direction and geometry. A text styled in parts
/// becomes one run styled like its first part.
pub fn retarget_text_attributes(blob: &[u8], text: &NewText) -> Result<Vec<u8>> {
    retarget(blob, text, true)
}

/// `TextLayerAddAttributesV01` (`u32` length + attributes per block) for one
/// block: the first entry of `blob`, with size, direction and geometry as in
/// [`retarget_text_attributes`]. Its style runs carry no character counts;
/// they are cut to the first run too, or CSP rewrites them on opening and
/// marks the page changed.
pub fn retarget_add_attributes(blob: &[u8], text: &NewText) -> Result<Vec<u8>> {
    let first = split_attribute_array(blob)?
        .into_iter()
        .next()
        .ok_or_else(|| CspError::format("Empty TextLayerAddAttributesV01"))?;
    let entry = retarget(first, text, false)?;
    let mut result = (entry.len() as u32).to_le_bytes().to_vec();
    result.extend(entry);
    Ok(result)
}

fn retarget(blob: &[u8], text: &NewText, counted_runs: bool) -> Result<Vec<u8>> {
    let length = text.length();
    let [x0, y0, x1, y1] = text.frame;
    let (width, height) = (x1 - x0, y1 - y0);
    let quad = if text.vertical {
        [-width * 100, 0, 0, 0, 0, height * 100, -width * 100, height * 100]
    } else {
        [0, 0, width * 100, 0, width * 100, height * 100, 0, height * 100]
    };
    let mut items = Vec::new();
    for Record { id, data: mut value } in records(blob)? {
        if RUN_TAGS.contains(&id) {
            if !value.is_empty() {
                value = if counted_runs {
                    single_run(id, &value, length)?
                } else {
                    single_add_run(id, &value)?
                };
                if let (ATTR_FONT_RUNS, Some(color)) = (id, text.color) {
                    color_font_run(&mut value, color, counted_runs);
                }
                if let (ATTR_FONT_RUNS, Some(font), true) = (id, &text.font, counted_runs) {
                    name_font_run(&mut value, &font.name);
                }
                if let (ATTR_PARAGRAPH_RUNS, Some(percent)) = (id, text.line_spacing) {
                    space_paragraph_run(&mut value, percent, counted_runs);
                }
            }
        } else if EXTRA_RUN_TAGS.contains(&id) {
            value.clear();
        } else {
            match id {
                ATTR_FONT_SIZE if value.len() == 4 => {
                    value = ((text.font_size_pt * FONT_SIZE_UNIT).round() as i32)
                        .to_le_bytes()
                        .to_vec();
                }
                ATTR_DIRECTION if value.len() == 4 => {
                    let flags = le_u32(&value, 0).unwrap_or(0);
                    let flags = if text.vertical {
                        flags | VERTICAL_BIT
                    } else {
                        flags & !VERTICAL_BIT
                    };
                    value = flags.to_le_bytes().to_vec();
                }
                ATTR_LENGTH if value.len() >= 4 => value[0..4].copy_from_slice(&length.to_le_bytes()),
                ATTR_BBOX if value.len() == 16 => value = i32s(&text.frame),
                ATTR_BLOCK_SIZE if value.len() == 8 => value = i32s(&[width, height]),
                ATTR_QUAD if value.len() == 32 => value = i32s(&quad),
                ATTR_RENDER_CACHE if value.len() == 4 => value = 0u32.to_le_bytes().to_vec(),
                ATTR_ORIGIN if value.len() == 8 => value = i32s(&[if text.vertical { width } else { 0 }, 0]),
                ATTR_COLOR if value.len() == 12 => {
                    if let Some(color) = text.color {
                        value = color_bytes(color);
                    }
                }
                ATTR_FONT_FAMILY if !value.is_empty() => {
                    if let Some(font) = &text.font {
                        value = font.name.as_bytes().to_vec();
                    }
                }
                // The add-attributes list leaves it empty; only a named one is replaced.
                ATTR_FONT_NAME if !value.is_empty() => {
                    if let Some(font) = &text.font {
                        value = font.to_attribute();
                    }
                }
                _ => {}
            }
        }
        items.push(Record { id, data: value });
    }
    Ok(blob_of(items))
}

/// The colour CSP draws a text in (8-bit RGB): its first font run's own
/// colour when the run has one, else [`ATTR_COLOR`]. None when neither is there.
pub fn text_color(blob: &[u8]) -> Result<Option<[u8; 3]>> {
    let narrow = |bytes: &[u8]| -> [u8; 3] {
        let channel = |index: usize| (u16::from_le_bytes([bytes[index * 2], bytes[index * 2 + 1]]) / 257) as u8;
        [channel(0), channel(1), channel(2)]
    };
    let mut default = None;
    for Record { id, data: value } in records(blob)? {
        if id == ATTR_FONT_RUNS
            && let Some(runs) = parse_runs(id, &value)
            && let Some((_, _, _, data)) = runs.first()
            && data.get(1).is_some_and(|flags| flags & RUN_HAS_COLOR != 0)
            && data.len() >= 8
        {
            return Ok(Some(narrow(&data[2..8])));
        }
        if id == ATTR_COLOR && value.len() >= 6 {
            default = Some(narrow(&value));
        }
    }
    Ok(default)
}
