//! The texts of a page's story info layers (`Layer.ComicStoryInfoType`):
//! (作品情報) holds 作品名・話数・サブタイトル in its first block, 作者名 and
//! ページ番号 in the blocks of its attributes array; (ノンブル) holds the
//! ノンブル. CSP marks each block with the part it is (record 0x2e) and
//! draws them afresh from these blocks, so a part's text, style run length
//! and block width are written together. Moved from name-studio's clip-core
//! (`write/story.rs`, `write/page.rs`).

use rusqlite::types::Value;
use rusqlite::{Connection, OptionalExtension};

use crate::database::{has_column, quote};
use crate::error::{Error, Result};
use crate::text::{Attributes, Record, ids, join_array, split_array};

/// `Layer.ComicStoryInfoType` of the 作品情報 and (ノンブル) layers.
pub const STORY_INFO: i64 = 1;
/// `Layer.ComicStoryInfoType` of the (ノンブル) layer.
pub const NOMBRE_INFO: i64 = 2;
/// Layer column of a spread's story info layers: 1 for the right page's.
pub const FOR_RIGHT_PAGE: &str = "ComicStoryInfoForRightPage";
/// `CropFrameOptionFlag` bits CSP sets for a single left / right page (a spread has 17).
pub const LEFT_PAGE_FLAG: i64 = 2;
/// See [`LEFT_PAGE_FLAG`].
pub const RIGHT_PAGE_FLAG: i64 = 4;

/// Record 0x2e: which part of the story info a block is.
pub const ATTR_STORY_PART: u32 = 0x2e;
/// Record 0x0b: the style runs (a count, then per run its start and length).
const ATTR_RUNS: u32 = ids::RUN_FONT_SIZE;
/// Record 0x48: offset of the text from its frame (i32 × 2).
pub const ATTR_ORIGIN: u32 = 0x48;
/// Record 0x22: default text colour (per channel a u16, written twice).
pub const ATTR_COLOR: u32 = 0x22;
/// Record 0x1f: the font name CSP shows, in UTF-8.
pub const ATTR_FONT_LABEL: u32 = 0x1f;

const TEXT_BLOBS: [&str; 1] = ["TextLayerAttributes"];
const TEXT_ARRAYS: [&str; 2] = ["TextLayerAttributesArray", "TextLayerAddAttributesV01"];

/// A part of the story info texts.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StoryPart {
    /// 作品名・話数・サブタイトル.
    Title,
    /// 作者名.
    Author,
    /// ページ番号 (`7ページ`).
    PageNumber,
    /// ノンブル (visible or hidden).
    Nombre,
}

impl StoryPart {
    /// The record 0x2e value CSP gives the part (the hidden ノンブル is 32).
    pub fn code(self) -> i64 {
        match self {
            StoryPart::Title => 1,
            StoryPart::Author => 2,
            StoryPart::PageNumber => 4,
            StoryPart::Nombre => 16,
        }
    }

    /// The part a block is marked as (record 0x2e), if marked.
    pub fn of(attributes: &Attributes) -> Option<StoryPart> {
        match attributes.get(ATTR_STORY_PART).map(i32s).as_deref() {
            Some([1]) => Some(StoryPart::Title),
            Some([2]) => Some(StoryPart::Author),
            Some([4]) => Some(StoryPart::PageNumber),
            Some([16] | [32]) => Some(StoryPart::Nombre),
            _ => None,
        }
    }

    /// The part of a block without a 0x2e mark, by where it is.
    fn by_place(info: i64, column: &str, block: Option<usize>) -> StoryPart {
        if info != STORY_INFO {
            return StoryPart::Nombre;
        }
        match (column, block) {
            ("TextLayerAttributesArray", Some(0)) | ("TextLayerAddAttributesV01", Some(1)) => StoryPart::Author,
            ("TextLayerAttributesArray", Some(_)) | ("TextLayerAddAttributesV01", Some(_)) => StoryPart::PageNumber,
            _ => StoryPart::Title,
        }
    }
}

/// Which edge of a text block stays where it is when its text changes.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Align {
    /// The left / top edge.
    Start,
    /// The centre.
    Middle,
    /// The right / bottom edge.
    End,
}

impl Align {
    /// Of CSP's 作品情報 positions: 1 左下, 2 下, 3 右下.
    pub fn of_position(position: i64) -> Align {
        match position {
            2 => Align::Middle,
            3 => Align::End,
            _ => Align::Start,
        }
    }
}

/// Little-endian `i32`s of a record value.
pub fn i32s(value: &[u8]) -> Vec<i64> {
    value.as_chunks::<4>().0.iter().map(|bytes| i32::from_le_bytes(*bytes) as i64).collect()
}

/// `values` as little-endian `i32`s.
pub fn i32_bytes(values: &[i64]) -> Vec<u8> {
    values.iter().flat_map(|value| (*value as i32).to_le_bytes()).collect()
}

/// Rounds half to even, as CSP does for text positions.
pub fn round_half_even(value: f64) -> i64 {
    value.round_ties_even() as i64
}

/// `attributes` with every record changed by `change`.
pub fn map_records(attributes: Attributes, change: impl Fn(u32, Vec<u8>) -> Vec<u8>) -> Attributes {
    Attributes {
        records: attributes
            .records
            .into_iter()
            .map(|Record { id, data }| Record { id, data: change(id, data) })
            .collect(),
    }
}

/// A Canvas column, None when the canvas has no such column.
pub fn canvas_value(db: &Connection, column: &str) -> Result<Option<Value>> {
    if !has_column(db, "Canvas", column)? {
        return Ok(None);
    }
    Ok(db.query_row(&format!("SELECT {} FROM Canvas", quote(column)), [], |row| row.get(0)).optional()?)
}

fn canvas_int(db: &Connection, column: &str) -> Result<Option<i64>> {
    Ok(match canvas_value(db, column)? {
        Some(Value::Integer(number)) => Some(number),
        Some(Value::Real(number)) => Some(number as i64),
        _ => None,
    })
}

fn canvas_text(db: &Connection, column: &str) -> Result<String> {
    Ok(match canvas_value(db, column)? {
        Some(Value::Text(text)) => text,
        Some(Value::Blob(bytes)) => String::from_utf8_lossy(&bytes).into_owned(),
        _ => String::new(),
    })
}

/// `Canvas.CanvasResolution` (dpi).
pub fn resolution(db: &Connection) -> Result<f64> {
    match canvas_value(db, "CanvasResolution")? {
        Some(Value::Real(number)) => Ok(number),
        Some(Value::Integer(number)) => Ok(number as f64),
        _ => Err(Error::format("Canvas has no resolution")),
    }
}

/// `Canvas.CanvasDoublePage` is set.
pub fn is_spread(db: &Connection) -> Result<bool> {
    Ok(matches!(canvas_value(db, "CanvasDoublePage")?, Some(Value::Integer(flag)) if flag != 0))
}

/// Canvas width in px, as CSP computes it from its unit.
pub fn canvas_width_px(db: &Connection) -> Result<i64> {
    let row = crate::database::select(db, "SELECT CanvasWidth, CanvasResolution, CanvasUnit FROM Canvas", [])?;
    let row = row.first().ok_or_else(|| Error::format("No Canvas row"))?;
    let unit = crate::model::Unit::from_code(row.int("CanvasUnit"));
    Ok(round_half_even(unit.to_pixels(row.real("CanvasWidth"), row.real("CanvasResolution"))))
}

fn layer_blob(db: &Connection, layer_id: i64, column: &str) -> Result<Option<Vec<u8>>> {
    let value: Value =
        db.query_row(&format!("SELECT {} FROM Layer WHERE MainId = ?1", quote(column)), [layer_id], |row| row.get(0))?;
    Ok(match value {
        Value::Blob(blob) => Some(blob),
        _ => None,
    })
}

fn set_layer_column(db: &Connection, layer_id: i64, column: &str, value: impl rusqlite::ToSql) -> Result<()> {
    db.execute(&format!("UPDATE Layer SET {} = ?1 WHERE MainId = ?2", quote(column)), (value, layer_id))?;
    Ok(())
}

fn layer_offset_x(db: &Connection, layer_id: i64) -> Result<i64> {
    let offset: Option<i64> =
        db.query_row("SELECT LayerOffsetX FROM Layer WHERE MainId = ?1", [layer_id], |row| row.get(0))?;
    Ok(offset.unwrap_or(0))
}

/// Story info layers of one kind as (id, for the right page of a spread).
pub fn story_layers(db: &Connection, info: i64) -> Result<Vec<(i64, bool)>> {
    if !has_column(db, "Layer", "ComicStoryInfoType")? {
        return Ok(Vec::new());
    }
    let side = if has_column(db, "Layer", FOR_RIGHT_PAGE)? {
        format!("IFNULL({}, 0)", quote(FOR_RIGHT_PAGE))
    } else {
        "0".to_owned()
    };
    let mut statement =
        db.prepare(&format!("SELECT MainId, {side} FROM Layer WHERE ComicStoryInfoType = ?1 ORDER BY MainId"))?;
    let ids = statement
        .query_map([info], |row| Ok((row.get(0)?, row.get::<_, i64>(1)? != 0)))?
        .collect::<std::result::Result<_, _>>()?;
    Ok(ids)
}

/// The (ノンブル) layer of a single page. A spread has a second one for its
/// right page.
fn nombre_layer(db: &Connection) -> Result<Option<i64>> {
    let ids = story_layers(db, NOMBRE_INFO)?;
    Ok(if ids.len() == 1 { Some(ids[0].0) } else { None })
}

/// Apply `edit` to the attributes of each block of one story info layer,
/// with the part the block is and whether its style runs count characters.
pub fn edit_story_blocks(
    db: &Connection,
    layer_id: i64,
    info: i64,
    edit: &dyn Fn(StoryPart, bool, Attributes) -> Result<Attributes>,
) -> Result<()> {
    for column in TEXT_BLOBS.iter().chain(TEXT_ARRAYS.iter()) {
        if !has_column(db, "Layer", column)? {
            continue;
        }
        let Some(blob) = layer_blob(db, layer_id, column)? else { continue };
        // The add-attributes runs carry no character counts.
        let counted = *column != "TextLayerAddAttributesV01";
        let one = |bytes: &[u8], block: Option<usize>| -> Result<Vec<u8>> {
            let attributes = Attributes::parse(bytes)?;
            let part = StoryPart::of(&attributes).unwrap_or_else(|| StoryPart::by_place(info, column, block));
            Ok(edit(part, counted, attributes)?.to_bytes())
        };
        let value = if TEXT_BLOBS.contains(column) {
            one(&blob, None)?
        } else {
            let blocks = split_array(&blob)?
                .into_iter()
                .enumerate()
                .map(|(index, block)| one(block, Some(index)))
                .collect::<Result<Vec<_>>>()?;
            join_array(&blocks)
        };
        set_layer_column(db, layer_id, column, value)?;
    }
    Ok(())
}

/// Apply `edit` to the attributes of every non-empty attribute blob of one
/// text layer.
pub fn edit_text_blocks(db: &Connection, layer_id: i64, edit: &dyn Fn(Attributes) -> Attributes) -> Result<()> {
    let one = |blob: &[u8]| -> Result<Vec<u8>> { Ok(edit(Attributes::parse(blob)?).to_bytes()) };
    for column in TEXT_BLOBS.iter().chain(TEXT_ARRAYS.iter()) {
        if !has_column(db, "Layer", column)? {
            continue;
        }
        let Some(blob) = layer_blob(db, layer_id, column)? else { continue };
        if blob.is_empty() {
            continue;
        }
        let value = if TEXT_BLOBS.contains(column) {
            one(&blob)?
        } else {
            join_array(&split_array(&blob)?.into_iter().map(one).collect::<Result<Vec<_>>>()?)
        };
        set_layer_column(db, layer_id, column, value)?;
    }
    Ok(())
}

/// Make CSP draw a story info / ノンブル text anew instead of the image the
/// file caches for it (record 0x32 → Offscreen), which shows the old text.
pub fn drop_render_cache(db: &Connection, layer_id: i64) -> Result<()> {
    edit_text_blocks(db, layer_id, &|attributes| {
        map_records(
            attributes,
            |id, data| if id == ids::RENDER_OFFSCREEN && data.len() == 4 { vec![0; 4] } else { data },
        )
    })
}

/// Font size in px of a story text (record 0x20 is pt × 100 at the canvas resolution).
pub fn em_px(attributes: &Attributes, resolution: f64) -> f64 {
    let points = attributes
        .get(ids::FONT_SIZE)
        .filter(|value| value.len() == 4)
        .map(|value| i32::from_le_bytes(value.try_into().unwrap()) as f64 / 100.0)
        .unwrap_or(6.0);
    points * resolution / 72.0
}

/// The width of a story text's block: a full-width character is one em, the
/// space, digits and other ASCII narrower. CSP does not lay the block out
/// again when it opens the page, and breaks a text wider than its block
/// (a shown ノンブル `- 1 -` lost its last ` -`), so the narrow characters are
/// given as much as the widest fonts take.
pub fn text_width(text: &str, em: f64) -> i64 {
    let ems: f64 = text
        .chars()
        .map(|character| match character {
            ' ' | '.' | ',' | '-' | ':' => 0.5,
            character if character.is_ascii() => 0.62,
            _ => 1.0,
        })
        .sum();
    round_half_even(ems * em).max(1)
}

/// `attributes` with its one style run `units` UTF-16 units long (counted runs only).
pub fn set_run_length(attributes: Attributes, units: usize, counted: bool) -> Attributes {
    map_records(attributes, |id, mut data| {
        if id == ATTR_RUNS && counted && data.len() >= 12 && data[0..4] == 1u32.to_le_bytes() {
            data[8..12].copy_from_slice(&(units as u32).to_le_bytes());
        }
        data
    })
}

/// A block made `width` px wide: its bbox (keeping the edge or middle
/// `align` says), block size and quad.
pub fn resize_block(attributes: Attributes, width: i64, align: Align) -> Attributes {
    map_records(attributes, |id, data| match id {
        ids::BBOX if data.len() == 16 => {
            let [x0, y0, x1, y1] = i32s(&data)[..] else { unreachable!() };
            let x0 = match align {
                Align::Start => x0,
                Align::Middle => (x0 + x1 - width).div_euclid(2),
                Align::End => x1 - width,
            };
            i32_bytes(&[x0, y0, x0 + width, y1])
        }
        ids::BLOCK_SIZE if data.len() == 8 => i32_bytes(&[width, i32s(&data)[1]]),
        ids::QUAD if data.len() == 32 => {
            let mut quad = i32s(&data);
            for index in [2, 4] {
                quad[index] = quad[0] + width * 100;
            }
            i32_bytes(&quad)
        }
        _ => data,
    })
}

/// Write `text` into one part's block(s): its style run and width.
pub fn write_part(db: &Connection, layer_id: i64, info: i64, part: StoryPart, text: &str, align: Align) -> Result<()> {
    let resolution = resolution(db)?;
    let units = text.encode_utf16().count();
    edit_story_blocks(db, layer_id, info, &|found, counted, attributes| {
        if found != part {
            return Ok(attributes);
        }
        let width = text_width(text, em_px(&attributes, resolution));
        Ok(resize_block(set_run_length(attributes, units, counted), width, align))
    })
}

/// The strings of a layer's `TextLayerStringArray`.
pub fn string_array(db: &Connection, layer_id: i64) -> Result<Option<Vec<String>>> {
    if !has_column(db, "Layer", "TextLayerStringArray")? {
        return Ok(None);
    }
    let Some(blob) = layer_blob(db, layer_id, "TextLayerStringArray")? else { return Ok(None) };
    Ok(Some(split_array(&blob)?.into_iter().map(|bytes| String::from_utf8_lossy(bytes).into_owned()).collect()))
}

/// Replaces a layer's `TextLayerStringArray` (the texts of its blocks after the first).
pub fn set_string_array(db: &Connection, layer_id: i64, strings: &[String]) -> Result<()> {
    set_layer_column(db, layer_id, "TextLayerStringArray", join_array(strings))
}

/// The parts of the blocks of a layer's attributes array, in order.
pub fn array_parts(db: &Connection, layer_id: i64) -> Result<Vec<StoryPart>> {
    if !has_column(db, "Layer", "TextLayerAttributesArray")? {
        return Ok(Vec::new());
    }
    let Some(blob) = layer_blob(db, layer_id, "TextLayerAttributesArray")? else { return Ok(Vec::new()) };
    split_array(&blob)?
        .into_iter()
        .enumerate()
        .map(|(index, block)| {
            let attributes = Attributes::parse(block)?;
            Ok(StoryPart::of(&attributes)
                .unwrap_or_else(|| StoryPart::by_place(STORY_INFO, "TextLayerAttributesArray", Some(index))))
        })
        .collect()
}

/// The ページ番号 text of the 作品情報.
pub fn page_number_text(number: i64) -> String {
    format!("{number}ページ")
}

/// Write the page's own ページ番号 into its 作品情報, when the work shows one:
/// `ComicStoryPageNumberStart + ComicPageIndex` (and the next one for the
/// other page of a spread). `first_right`: the spread's first page is its
/// right one.
pub fn update_page_number(db: &Connection, first_right: bool) -> Result<()> {
    if canvas_int(db, "ComicStoryUsePageNumber")? != Some(1) {
        return Ok(());
    }
    let first =
        canvas_int(db, "ComicStoryPageNumberStart")?.unwrap_or(1) + canvas_int(db, "ComicPageIndex")?.unwrap_or(0);
    let align = Align::of_position(canvas_int(db, "ComicStoryPageNumberPosition")?.unwrap_or(3));
    let spread = is_spread(db)?;
    for (layer_id, right) in story_layers(db, STORY_INFO)? {
        let number = if spread && right != first_right { first + 1 } else { first };
        let text = page_number_text(number);
        let Some(mut strings) = string_array(db, layer_id)? else { continue };
        let Some(index) = array_parts(db, layer_id)?.iter().position(|part| *part == StoryPart::PageNumber) else {
            continue;
        };
        if strings.get(index).is_none_or(|old| *old == text) {
            continue;
        }
        strings[index] = text.clone();
        set_string_array(db, layer_id, &strings)?;
        write_part(db, layer_id, STORY_INFO, StoryPart::PageNumber, &text, align)?;
        drop_render_cache(db, layer_id)?;
    }
    Ok(())
}

/// How the work shows its ノンブル: the text around the number, and whether
/// it stays centred (上部 / 下部) as the number changes.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NombreStyle {
    /// Text before the number.
    pub prefix: String,
    /// Text after the number.
    pub suffix: String,
    /// The ノンブル stays centred when the number changes.
    pub centred: bool,
}

/// The ノンブル style of the page's work (none for the hidden ノンブル).
pub fn nombre_style(db: &Connection) -> Result<Option<NombreStyle>> {
    if canvas_int(db, "ComicStoryUseShownNombre")? != Some(1) {
        return Ok(None);
    }
    let position = canvas_int(db, "ComicStoryNombrePosition")?.unwrap_or(5);
    Ok(Some(NombreStyle {
        prefix: canvas_text(db, "ComicStoryNombrePrefix")?,
        suffix: canvas_text(db, "ComicStoryNombreSuffix")?,
        centred: matches!(position, 2 | 5),
    }))
}

/// Change the x of every block's bbox with `change(x0, x1)`.
pub fn map_bbox_x(attributes: Attributes, change: &dyn Fn(i64, i64) -> (i64, i64)) -> Attributes {
    map_records(attributes, |id, data| {
        if id != ids::BBOX || data.len() != 16 {
            return data;
        }
        let [x0, y0, x1, y1] = i32s(&data)[..] else { unreachable!() };
        let (x0, x1) = change(x0, x1);
        i32_bytes(&[x0, y0, x1, y1])
    })
}

/// Move the (ノンブル) of a single page to the other side.
///
/// The hidden ノンブル sits at the binding edge, which is on the other side
/// for left and right pages. CSP moves it when it opens a page whose side
/// differs from where the file had it, and then marks the page as
/// modified. The text block's bbox is mirrored across the canvas width.
pub fn mirror_nombre(db: &Connection) -> Result<()> {
    let Some(layer_id) = nombre_layer(db)? else { return Ok(()) };
    let width = canvas_width_px(db)?;
    let offset = layer_offset_x(db, layer_id)?;
    let mirror = |x0: i64, x1: i64| (width - (x1 + offset) - offset, width - (x0 + offset) - offset);
    edit_text_blocks(db, layer_id, &|attributes| map_bbox_x(attributes, &mirror))
}

/// `TextLayerAttributes` with its one style run `delta` characters longer.
pub fn move_run_length(blob: &[u8], delta: i64) -> Result<Vec<u8>> {
    if delta == 0 {
        return Ok(blob.to_vec());
    }
    Ok(map_records(Attributes::parse(blob)?, |id, mut data| {
        if id == ATTR_RUNS && data.len() >= 12 && u32::from_le_bytes(data[0..4].try_into().unwrap()) == 1 {
            let length = u32::from_le_bytes(data[8..12].try_into().unwrap()) as i64;
            data[8..12].copy_from_slice(&((length + delta).max(0) as u32).to_le_bytes());
        }
        data
    })
    .to_bytes())
}

/// Write the page's own number into the (ノンブル) text.
///
/// CSP writes `ComicStoryNombreStart + ComicPageIndex` there (a shown
/// ノンブル with the work's prefix and suffix around it). The text and its
/// style run change, and the block widens or narrows by its width per
/// character, keeping the edge nearer to the page border (the binding edge),
/// or its middle for a centred shown ノンブル. `first_right`: the spread's
/// first page is its right one.
pub fn update_nombre(db: &Connection, first_right: bool) -> Result<()> {
    if !has_column(db, "Canvas", "ComicPageIndex")? || !has_column(db, "Canvas", "ComicStoryNombreStart")? {
        return Ok(());
    }
    let first = canvas_int(db, "ComicStoryNombreStart")?.unwrap_or(1) + canvas_int(db, "ComicPageIndex")?.unwrap_or(0);
    let style = nombre_style(db)?;
    let text = |number: i64| match &style {
        Some(style) => format!("{}{number}{}", style.prefix, style.suffix),
        None => number.to_string(),
    };
    let centred = style.as_ref().is_some_and(|style| style.centred);
    if is_spread(db)? {
        for (layer_id, right) in story_layers(db, NOMBRE_INFO)? {
            let number = if right == first_right { first } else { first + 1 };
            set_nombre(db, layer_id, &text(number), centred)?;
        }
        return Ok(());
    }
    let Some(layer_id) = nombre_layer(db)? else { return Ok(()) };
    set_nombre(db, layer_id, &text(first), centred)
}

/// Write `number` into one (ノンブル) layer.
fn set_nombre(db: &Connection, layer_id: i64, number: &str, centred: bool) -> Result<()> {
    let (string, attributes): (Value, Value) =
        db.query_row("SELECT TextLayerString, TextLayerAttributes FROM Layer WHERE MainId = ?1", [layer_id], |row| {
            Ok((row.get(0)?, row.get(1)?))
        })?;
    let old = match string {
        Value::Blob(bytes) => String::from_utf8_lossy(&bytes).into_owned(),
        Value::Text(text) => text,
        _ => String::new(),
    };
    if old.is_empty() || old == number {
        return Ok(());
    }
    let (old_length, new_length) = (old.chars().count() as i64, number.chars().count() as i64);
    let width = canvas_width_px(db)?;
    let offset = layer_offset_x(db, layer_id)?;
    let resize = |attributes: Attributes| -> Attributes {
        let Some(block) = attributes.get(ids::BLOCK_SIZE).filter(|value| value.len() == 8).map(i32s) else {
            return attributes;
        };
        let (block_width, height) = (block[0], block[1]);
        let new_width = round_half_even(block_width as f64 * new_length as f64 / old_length as f64).max(1);
        let grow = new_width - block_width;
        let keep_border_edge = |x0: i64, x1: i64| {
            if centred {
                let x0 = (x0 + x1 - new_width).div_euclid(2);
                (x0, x0 + new_width)
            } else if x0 + offset < width - (x1 + offset) {
                (x0, x1 + grow)
            } else {
                (x0 - grow, x1)
            }
        };
        map_records(map_bbox_x(attributes, &keep_border_edge), |id, mut data| {
            if id == ids::BLOCK_SIZE {
                data = i32_bytes(&[new_width, height]);
            } else if id == ids::QUAD && data.len() == 32 {
                // The right-hand x of the quad, in 1/100 px.
                for position in [2, 4] {
                    let at = position * 4;
                    let x = i32::from_le_bytes(data[at..at + 4].try_into().unwrap()) as i64 + grow * 100;
                    data[at..at + 4].copy_from_slice(&(x as i32).to_le_bytes());
                }
            }
            data
        })
    };
    set_layer_column(db, layer_id, "TextLayerString", number.as_bytes())?;
    if let Value::Blob(attributes) = attributes {
        set_layer_column(db, layer_id, "TextLayerAttributes", move_run_length(&attributes, new_length - old_length)?)?;
    }
    edit_text_blocks(db, layer_id, &resize)?;
    drop_render_cache(db, layer_id)
}

impl crate::ClipFile {
    /// Make this page page `index` (from 0) of a work: `ComicPageIndex`, and
    /// for a single page its side (`ComicIsLeftPage`, the 仕上がり's side
    /// flag, the ノンブル mirrored to the other edge when the side changes).
    /// The side alternates with the index: `zero_left` (page 0 is a left
    /// page) gives the parity, else the page's own index and side do. A
    /// 見開き page keeps its sides. Returns whether the page is a left page
    /// (None: a spread, or a canvas without these columns).
    pub fn set_comic_page(&mut self, index: i64, zero_left: Option<bool>) -> Result<Option<bool>> {
        let db = self.database();
        if !has_column(db, "Canvas", "ComicPageIndex")? {
            return Ok(None);
        }
        if is_spread(db)? {
            db.execute("UPDATE Canvas SET ComicPageIndex = ?1", [index])?;
            self.reload()?;
            return Ok(None);
        }
        if !has_column(db, "Canvas", "ComicIsLeftPage")? {
            return Ok(None);
        }
        let (own_index, own_left): (Option<i64>, Option<i64>) =
            db.query_row("SELECT ComicPageIndex, ComicIsLeftPage FROM Canvas", [], |row| {
                Ok((row.get(0)?, row.get(1)?))
            })?;
        let left = match zero_left {
            Some(zero_left) => zero_left == (index.rem_euclid(2) == 0),
            None => (own_left.unwrap_or(0) != 0) == (index - own_index.unwrap_or(0)).rem_euclid(2).eq(&0),
        };
        db.execute("UPDATE Canvas SET ComicPageIndex = ?1, ComicIsLeftPage = ?2", (index, left as i64))?;
        if let Some(Value::Integer(flag)) = canvas_value(db, "CropFrameOptionFlag")?
            && flag & (LEFT_PAGE_FLAG | RIGHT_PAGE_FLAG) != 0
        {
            let side = if left { LEFT_PAGE_FLAG } else { RIGHT_PAGE_FLAG };
            db.execute(
                "UPDATE Canvas SET CropFrameOptionFlag = ?1",
                [(flag & !(LEFT_PAGE_FLAG | RIGHT_PAGE_FLAG)) | side],
            )?;
        }
        if (own_left.unwrap_or(0) != 0) != left {
            mirror_nombre(db)?;
        }
        self.reload()?;
        Ok(Some(left))
    }

    /// Write the page's own ページ番号 and ノンブル into its story info texts
    /// ([`update_page_number`], [`update_nombre`]), after its
    /// `ComicPageIndex` or the work's story settings changed.
    pub fn update_story_numbers(&mut self, first_right: bool) -> Result<()> {
        update_page_number(self.database(), first_right)?;
        update_nombre(self.database(), first_right)?;
        self.reload()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn gives_a_text_room_enough_not_to_break() {
        // ＭＳ ゴシック: ASCII is half an em; `- 1 -` at 9 pt (75 px at 600 dpi).
        assert!(text_width("- 1 -", 75.0) >= 188);
        // Full-width characters are an em each.
        assert_eq!(text_width("作品名", 50.0), 150);
    }

    #[test]
    fn resizes_a_block_keeping_the_edge_asked_for() {
        let mut attributes = Attributes::default();
        attributes.set_bbox([100, 10, 200, 60]);
        attributes.set(ids::BLOCK_SIZE, i32_bytes(&[100, 50]));
        let resized = resize_block(attributes.clone(), 40, Align::End);
        assert_eq!(resized.bbox(), Some([160, 10, 200, 60]));
        assert_eq!(resized.block_size(), Some([40, 50]));
        assert_eq!(resize_block(attributes, 40, Align::Middle).bbox(), Some([130, 10, 170, 60]));
    }
}
