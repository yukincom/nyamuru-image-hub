//! Animation (R17): timelines, tracks, keyframes, cels, the 2D camera and
//! onion skin settings, how a frame is evaluated, and edits.
//!
//! Tables (all optional; CSP adds them when a file first uses animation):
//! `AnimationCutBank` (which timeline is current), `TimeLine` (one row per
//! timeline, linked by `NextTimeLine`), `Track` (one row per animated layer
//! and timeline, linked by `TrackNextIndex` from `TimeLine.FirstTrack`) and
//! `TimeLineLabel`. A track's keys are in two "cmt " documents
//! ([`crate::cmt`]) in external chunks: `TrackActionMixer` (version 0100,
//! single precision) and `TrackActionMixer2` (0110, double precision), with
//! the same content. `TrackValueMap` holds the values at the current frame.
//!
//! Time: a timeline frame `f` (0-based) is at `t = f · 60 / FrameRate`
//! ticks. Each track has one clip mapping timeline ticks to motion ticks,
//! `m = MS + (t − TS) · (ME − MS) / (TE − TS)` (`TimeClip` = TS..TE,
//! `MotionClip` = MS..ME), and its curves are keyed in motion ticks.
//!
//! Measured against CSP's image-sequence export (`docs/validation/V6c-animation.md`):
//! interpolation `Constant` holds a key until the next one, `Linear` moves
//! at a constant speed, `Default` (CSP's smooth interpolation, also used
//! when a curve has no `Interp` list) eases with a cubic Hermite through
//! the slopes (0 in every key seen so far), a keyframed layer is not shown
//! before its clip starts,
//! layer keyframes move `TimeLineOriginalMipmap` by
//! `q = Position + R(rotation) · Scale · (p − Center)` (rotation in degrees,
//! clockwise on screen), and opacity keys are percentages applied as
//! `round(v · 256 / 100) / 256`. See `docs/spec/08-animation.md`.

use std::collections::{HashMap, HashSet};

use rusqlite::types::Value as SqlValue;

use crate::binary::{Reader, Writer};
use crate::clip::ClipFile;
use crate::cmt::{self, Document, Node, Value};
use crate::database::{Row, select_all, table_exists, value_as_text};
use crate::error::{Error, Result, bail};
use crate::model::LayerNode;

/// `LayerType` of light-table reference layers. They are hidden in the
/// layer palette, only shown on the light table, and never rendered.
pub const LAYER_TYPE_LIGHT_TABLE: i64 = 10016;
/// `LayerType` of a 2D camera folder.
pub const LAYER_TYPE_CAMERA: i64 = 512;
/// Timeline ticks per second.
pub const TICKS_PER_SECOND: f64 = 60.0;

/// What a track animates (`Track.TrackKind`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[non_exhaustive]
pub enum TrackKind {
    /// 2000: an animation folder's cel assignment.
    Cels,
    /// 2001: a layer's keyframes (position, scale, rotation, opacity).
    Keyframes,
    /// 2003: the paper.
    Paper,
    /// 2005: a 2D camera folder.
    Camera,
    /// Another `TrackKind` value.
    Other(i64),
}

impl TrackKind {
    /// The kind of a stored `TrackKind` value.
    pub fn from_code(code: i64) -> Self {
        match code {
            2000 => TrackKind::Cels,
            2001 => TrackKind::Keyframes,
            2003 => TrackKind::Paper,
            2005 => TrackKind::Camera,
            other => TrackKind::Other(other),
        }
    }
}

/// How a key moves to the next one (`FCurve/Interp`).
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[non_exhaustive]
pub enum Interp {
    /// `Constant`: hold until the next key.
    Constant,
    /// `Default`: CSP's smooth interpolation (cubic Hermite through the slopes).
    Smooth,
    /// `Linear`: CSP's 等速補間.
    Linear,
    /// Any other name; evaluated as linear and reported.
    Other(String),
}

impl Interp {
    /// The interpolation named `name` in a mixer.
    pub fn from_name(name: &str) -> Self {
        match name {
            "Constant" => Interp::Constant,
            "Default" => Interp::Smooth,
            "Linear" => Interp::Linear,
            other => Interp::Other(other.to_owned()),
        }
    }

    /// The name stored in a mixer.
    pub fn name(&self) -> &str {
        match self {
            Interp::Constant => "Constant",
            Interp::Smooth => "Default",
            Interp::Linear => "Linear",
            Interp::Other(name) => name,
        }
    }
}

/// One key of a curve.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct Key {
    /// Motion ticks.
    pub frame: f64,
    /// The value at the key.
    pub value: f64,
    /// Slope on the left of the key (0 in every file seen).
    pub left_slope: f64,
    /// Slope on the right of the key (0 in every file seen).
    pub right_slope: f64,
    /// How the value moves to the next key.
    pub interp: Interp,
    /// Cel curves: the cel's layer name.
    pub tag: Option<String>,
}

/// One animated value (`FCurve`): `Type` and, for pairs, `Axis` X or Y.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct Curve {
    /// `Type` of the curve (`Position`, `Scale`, `Rotation`, `Opacity`, …).
    pub kind: String,
    /// `Axis` (`X` or `Y`) of a pair's curve.
    pub axis: Option<String>,
    /// The keys, in time order.
    pub keys: Vec<Key>,
}

impl Curve {
    fn from_node(node: &Node) -> Result<Self> {
        let kind = node.attribute("Type").unwrap_or_default().to_owned();
        let axis = node.attribute("Axis").map(str::to_owned);
        let numbers = |name: &str| node.child(name).and_then(|n| n.value.as_numbers());
        let frames = numbers("Frame").ok_or_else(|| Error::format(format!("FCurve {kind} has no Frame")))?;
        let values = numbers("Value").ok_or_else(|| Error::format(format!("FCurve {kind} has no Value")))?;
        if values.len() != frames.len() {
            bail!("FCurve {kind}: {} frames, {} values", frames.len(), values.len());
        }
        let left = numbers("LeftSlope");
        let right = numbers("RightSlope");
        let interp = node.child("Interp").and_then(|n| n.value.as_strings());
        let tags = node.child("Tag").and_then(|n| n.value.as_strings());
        let keys = frames
            .iter()
            .zip(&values)
            .enumerate()
            .map(|(i, (frame, value))| Key {
                frame: *frame,
                value: *value,
                left_slope: left.as_ref().and_then(|v| v.get(i)).copied().unwrap_or(0.0),
                right_slope: right.as_ref().and_then(|v| v.get(i)).copied().unwrap_or(0.0),
                interp: interp.and_then(|v| v.get(i)).map_or(Interp::Smooth, |name| Interp::from_name(name)),
                tag: tags.and_then(|v| v.get(i)).cloned(),
            })
            .collect();
        Ok(Curve { kind, axis, keys })
    }

    /// The value at motion time `m` and the index of the key in effect
    /// (None before the first key). Before the first key the first value
    /// holds, after the last the last.
    pub fn evaluate(&self, m: f64) -> Option<(f64, Option<usize>)> {
        let first = self.keys.first()?;
        if m < first.frame {
            return Some((first.value, None));
        }
        let index = self.keys.iter().rposition(|key| key.frame <= m).unwrap_or(0);
        let key = &self.keys[index];
        let Some(next) = self.keys.get(index + 1) else { return Some((key.value, Some(index))) };
        let span = next.frame - key.frame;
        if span <= 0.0 {
            return Some((key.value, Some(index)));
        }
        let u = (m - key.frame) / span;
        let value = match key.interp {
            Interp::Constant => key.value,
            Interp::Smooth => {
                let (u2, u3) = (u * u, u * u * u);
                let h00 = 2.0 * u3 - 3.0 * u2 + 1.0;
                let h10 = u3 - 2.0 * u2 + u;
                let h01 = -2.0 * u3 + 3.0 * u2;
                let h11 = u3 - u2;
                h00 * key.value + h10 * span * key.right_slope + h01 * next.value + h11 * span * next.left_slope
            }
            Interp::Linear | Interp::Other(_) => key.value + (next.value - key.value) * u,
        };
        Some((value, Some(index)))
    }
}

/// A `Param` node: the value a track shows without keys, and its name.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct Param {
    /// `Name` attribute (the value kind, as the curves' `kind`).
    pub name: String,
    /// `Tag` attribute, if any.
    pub tag: Option<String>,
    /// The value.
    pub value: Value,
}

/// The typed content of a track mixer.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct Clip {
    /// `TimeClip` Start..End in timeline ticks.
    pub time: (f64, f64),
    /// `MotionClip` Start..End in motion ticks.
    pub motion: (f64, f64),
    /// `Param` nodes of `AnimInfo`: values without keys.
    pub params: Vec<Param>,
    /// `FCurve` nodes of `AnimInfo`.
    pub curves: Vec<Curve>,
}

impl Clip {
    /// Reads the clip of a track mixer document.
    pub fn from_document(document: &Document) -> Result<Self> {
        let clip = document.action_clip().ok_or_else(|| Error::format("Track mixer has no ActionNodeClip"))?;
        let number = |path: &[&str]| clip.find(path).and_then(|n| n.value.as_f64()).unwrap_or(0.0);
        let mut params = Vec::new();
        let mut curves = Vec::new();
        for node in clip.child("AnimInfo").map(|n| n.children.as_slice()).unwrap_or_default() {
            match node.name.as_str() {
                "Param" => params.push(Param {
                    name: node.attribute("Name").unwrap_or_default().to_owned(),
                    tag: node.attribute("Tag").map(str::to_owned),
                    value: node.value.clone(),
                }),
                "FCurve" => curves.push(Curve::from_node(node)?),
                _ => {}
            }
        }
        Ok(Clip {
            time: (number(&["TimeClip", "Start"]), number(&["TimeClip", "End"])),
            motion: (number(&["MotionClip", "Start"]), number(&["MotionClip", "End"])),
            params,
            curves,
        })
    }

    /// Motion ticks at timeline ticks `t`.
    pub fn motion_at(&self, t: f64) -> f64 {
        let (ts, te) = self.time;
        let (ms, me) = self.motion;
        if te == ts { ms } else { ms + (t - ts) * (me - ms) / (te - ts) }
    }

    /// Timeline ticks at motion ticks `m` (inverse of [`Clip::motion_at`]).
    pub fn time_at(&self, m: f64) -> f64 {
        let (ts, te) = self.time;
        let (ms, me) = self.motion;
        if me == ms { ts } else { ts + (m - ms) * (te - ts) / (me - ms) }
    }

    /// The curve of this kind and axis.
    pub fn curve(&self, kind: &str, axis: Option<&str>) -> Option<&Curve> {
        self.curves.iter().find(|c| c.kind == kind && c.axis.as_deref() == axis)
    }

    /// The `Param` of this name.
    pub fn param(&self, name: &str) -> Option<&Param> {
        self.params.iter().find(|p| p.name == name)
    }

    /// A value at timeline ticks `t`: the curve if there is one, else the
    /// `Param` (`axis` picks X or Y of a pair).
    pub fn value(&self, kind: &str, axis: Option<&str>, t: f64) -> Option<f64> {
        if let Some((value, _)) = self.curve(kind, axis).and_then(|c| c.evaluate(self.motion_at(t))) {
            return Some(value);
        }
        let value = &self.param(kind)?.value;
        match axis {
            Some("X") => value.as_pair().map(|p| p[0]),
            Some("Y") => value.as_pair().map(|p| p[1]),
            _ => value.as_f64(),
        }
    }

    fn pair(&self, kind: &str, t: f64) -> Option<[f64; 2]> {
        Some([self.value(kind, Some("X"), t)?, self.value(kind, Some("Y"), t)?])
    }
}

/// One entry of `Track.TrackValueMap` (big endian: u32 size, UTF-16 name,
/// UTF-16 tag, u32 type, value).
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct MapEntry {
    /// Entry name.
    pub name: String,
    /// Entry tag.
    pub tag: String,
    /// The value.
    pub value: MapValue,
}

/// Value of a [`MapEntry`], by type code.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub enum MapValue {
    /// Type 0.
    Double(f64),
    /// Type 2.
    Int(i32),
    /// Type 3.
    Pair([f64; 2]),
    /// Another type: its code and raw bytes.
    Raw(u32, Vec<u8>),
}

/// Decode `Track.TrackValueMap`.
pub fn parse_value_map(data: &[u8]) -> Result<Vec<MapEntry>> {
    let mut reader = Reader::new(data);
    let header = reader.be_u32()?;
    if header != 8 {
        bail!("TrackValueMap header {header}");
    }
    let count = reader.be_u32()? as usize;
    let mut entries = Vec::with_capacity(count.min(64));
    for _ in 0..count {
        let start = reader.position();
        let size = reader.be_u32()? as usize;
        let end = start + size;
        let name = utf16(&mut reader)?;
        let tag = utf16(&mut reader)?;
        let kind = reader.be_u32()?;
        let value = match kind {
            0 => MapValue::Double(reader.be_f64()?),
            2 => MapValue::Int(reader.be_i32()?),
            3 => MapValue::Pair([reader.be_f64()?, reader.be_f64()?]),
            other => {
                let rest = end.checked_sub(reader.position()).ok_or_else(|| Error::format("TrackValueMap entry"))?;
                MapValue::Raw(other, reader.bytes(rest)?.to_vec())
            }
        };
        if reader.position() != end {
            bail!("TrackValueMap entry {name:?} is {} bytes, says {size}", reader.position() - start);
        }
        entries.push(MapEntry { name, tag, value });
    }
    Ok(entries)
}

/// Encode `Track.TrackValueMap`.
pub fn value_map_bytes(entries: &[MapEntry]) -> Vec<u8> {
    let mut out = Writer::new();
    out.be_u32(8).be_u32(entries.len() as u32);
    for entry in entries {
        let mut body = Writer::new();
        put_utf16(&mut body, &entry.name);
        put_utf16(&mut body, &entry.tag);
        match &entry.value {
            MapValue::Double(v) => {
                body.be_u32(0).be_f64(*v);
            }
            MapValue::Int(v) => {
                body.be_u32(2).be_i32(*v);
            }
            MapValue::Pair([x, y]) => {
                body.be_u32(3).be_f64(*x).be_f64(*y);
            }
            MapValue::Raw(kind, bytes) => {
                body.be_u32(*kind).bytes(bytes);
            }
        }
        let body = body.into_inner();
        out.be_u32(body.len() as u32 + 4).bytes(&body);
    }
    out.into_inner()
}

fn utf16(reader: &mut Reader) -> Result<String> {
    let units = reader.be_u32()? as usize;
    let bytes = reader.bytes(units.checked_mul(2).ok_or_else(|| Error::format("UTF-16 length"))?)?;
    let units: Vec<u16> = bytes.as_chunks::<2>().0.iter().map(|c| u16::from_be_bytes(*c)).collect();
    Ok(String::from_utf16_lossy(&units))
}

fn put_utf16(out: &mut Writer, text: &str) {
    let units: Vec<u16> = text.encode_utf16().collect();
    out.be_u32(units.len() as u32);
    for unit in units {
        out.be_u16(unit);
    }
}

/// A `Track` row with its mixers.
#[derive(Debug, Clone, serde::Serialize)]
pub struct Track {
    /// `MainId` of the row.
    pub main_id: i64,
    /// `ItemId`: the timeline's `MainId`.
    pub timeline: i64,
    /// What the track animates (`TrackKind`).
    pub kind: TrackKind,
    /// `LayerUuidWithTrack` as 32 lower-case hex digits.
    pub layer_uuid: String,
    /// The layer it animates (by uuid), if found.
    pub layer_id: Option<i64>,
    /// `TrackOptionFlag` as stored.
    pub option_flag: i64,
    /// Labels on the track (`TrackLabelFirstIndex` list).
    pub labels: Vec<Label>,
    /// From `TrackActionMixer2` (or `TrackActionMixer` when that is absent).
    pub clip: Option<Clip>,
    /// The values at the current frame (`TrackValueMap`).
    pub value_map: Vec<MapEntry>,
    /// The decoded mixer documents: `TrackActionMixer` and `TrackActionMixer2` (external chunk id and document).
    #[serde(skip)]
    pub mixers: [Option<(String, Document)>; 2],
}

/// A `TimeLineLabel`: a timeline label (type 0), an in-between mark ○ on a
/// cel track (type 1) or a named track label with a length (type 3).
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct Label {
    /// `MainId` of the row.
    pub main_id: i64,
    /// Label text.
    pub name: String,
    /// 0-based frame.
    pub frame: f64,
    /// Type: 0 timeline label, 1 in-between mark, 3 named track label.
    pub kind: i64,
    /// Length in frames (type 3).
    pub length: Option<f64>,
}

/// A `TimeLine` row.
#[derive(Debug, Clone, serde::Serialize)]
pub struct Timeline {
    /// `MainId` of the row.
    pub main_id: i64,
    /// Name shown in the timeline palette.
    pub name: String,
    /// Frames per second.
    pub frame_rate: f64,
    /// 0-based first frame.
    pub start_frame: f64,
    /// 0-based frame after the last.
    pub end_frame: f64,
    /// 0-based frame shown in CSP.
    pub current_frame: f64,
    /// タイムラインの区切り線 (`GuidelineFrameRate`).
    pub guideline: i64,
    /// シーン number.
    pub scene: i64,
    /// カット number.
    pub cut: i64,
    /// `TimeLineUuid` as 32 hex digits.
    pub uuid: Option<String>,
    /// Timeline labels.
    pub labels: Vec<Label>,
    /// Tracks, in their linked order.
    pub tracks: Vec<Track>,
}

impl Timeline {
    /// Timeline ticks of 0-based frame `frame`.
    pub fn ticks(&self, frame: f64) -> f64 {
        frame * TICKS_PER_SECOND / self.frame_rate.max(1e-9)
    }

    /// The track animating this layer.
    pub fn track_for_layer(&self, layer_id: i64) -> Option<&Track> {
        self.tracks.iter().find(|t| t.layer_id == Some(layer_id))
    }
}

/// オニオンスキン settings (`Canvas.OnionSkin*`).
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct OnionSkin {
    /// Onion skin is on (`OnionSkinStatus`).
    pub enabled: bool,
    /// Previous frames shown.
    pub previous: i64,
    /// Next frames shown.
    pub next: i64,
    /// Fade the frames (`OnionSkinUseOpacity`).
    pub use_opacity: bool,
    /// Percent.
    pub start_opacity: i64,
    /// Opacity step in percent (`OnionSkinStepOpaciy`, misspelled in CSP).
    pub step_opacity: i64,
    /// Tint the frames with the colours below.
    pub use_color: bool,
    /// `OnionSkinHalfColor`.
    pub half_color: bool,
    /// Previous frames' colour.
    pub front_color: [u8; 3],
    /// Next frames' colour.
    pub behind_color: [u8; 3],
}

/// The 基準フレーム (reference frame): the area an image-sequence export
/// shows, in canvas pixels.
#[derive(Debug, Clone, Copy, PartialEq, serde::Serialize)]
pub struct Frame {
    /// Left edge.
    pub x: f64,
    /// Top edge.
    pub y: f64,
    /// Width.
    pub width: f64,
    /// Height.
    pub height: f64,
}

/// All animation data of a file.
#[derive(Debug, Clone, serde::Serialize)]
pub struct Animation {
    /// Timelines in their linked order.
    pub timelines: Vec<Timeline>,
    /// Index (0-based, in [`Animation::timelines`]) of the current timeline.
    pub current: usize,
    /// オニオンスキン settings, when the canvas has them.
    pub onion_skin: Option<OnionSkin>,
    /// The 基準フレーム.
    pub frame: Frame,
}

impl Animation {
    /// None when the file has no timeline.
    pub fn read(file: &ClipFile) -> Result<Option<Self>> {
        let db = file.database();
        if !table_exists(db, "TimeLine")? {
            return Ok(None);
        }
        let timeline_rows: HashMap<i64, Row> =
            select_all(db, "TimeLine")?.into_iter().map(|row| (row.int("MainId"), row)).collect();
        if timeline_rows.is_empty() {
            return Ok(None);
        }
        let track_rows: HashMap<i64, Row> = if table_exists(db, "Track")? {
            select_all(db, "Track")?.into_iter().map(|row| (row.int("MainId"), row)).collect()
        } else {
            HashMap::new()
        };
        let label_rows: HashMap<i64, Row> = if table_exists(db, "TimeLineLabel")? {
            select_all(db, "TimeLineLabel")?.into_iter().map(|row| (row.int("MainId"), row)).collect()
        } else {
            HashMap::new()
        };
        let bank = if table_exists(db, "AnimationCutBank")? {
            select_all(db, "AnimationCutBank")?.into_iter().next()
        } else {
            None
        };
        let mut layer_by_uuid = HashMap::new();
        for layer in &file.layers.layers {
            if let Some(uuid) = &layer.uuid {
                layer_by_uuid.insert(uuid.replace('-', "").to_ascii_lowercase(), layer.main_id);
            }
        }
        let labels = |first: i64| -> Result<Vec<Label>> {
            let mut out = Vec::new();
            let mut next = first;
            while next != 0 {
                if out.len() > label_rows.len() {
                    bail!("TimeLineLabel list loops");
                }
                let row = label_rows.get(&next).ok_or_else(|| Error::format(format!("No TimeLineLabel {next}")))?;
                out.push(Label {
                    main_id: next,
                    name: row.text("LabelName").unwrap_or_default(),
                    frame: row.real("LabelFrame"),
                    kind: row.int("LabelType"),
                    length: row.opt_real("LabelLength"),
                });
                next = row.int("LabelNextIndex");
            }
            Ok(out)
        };
        let first = bank.as_ref().map(|b| b.int("FirstTimeLine")).filter(|id| *id != 0).unwrap_or_else(|| {
            // Without a bank: the timeline no other one points to.
            let pointed: HashSet<i64> = timeline_rows.values().map(|r| r.int("NextTimeLine")).collect();
            timeline_rows.keys().copied().filter(|id| !pointed.contains(id)).min().unwrap_or(0)
        });
        let mut timelines = Vec::new();
        let mut next = first;
        while next != 0 {
            if timelines.len() > timeline_rows.len() {
                bail!("TimeLine list loops");
            }
            let row = timeline_rows.get(&next).ok_or_else(|| Error::format(format!("No TimeLine {next}")))?;
            let mut tracks = Vec::new();
            let mut track_id = row.int("FirstTrack");
            while track_id != 0 {
                if tracks.len() > track_rows.len() {
                    bail!("Track list loops");
                }
                let track = track_rows.get(&track_id).ok_or_else(|| Error::format(format!("No Track {track_id}")))?;
                tracks.push(read_track(file, track, &layer_by_uuid, &labels)?);
                track_id = track.int("TrackNextIndex");
            }
            timelines.push(Timeline {
                main_id: next,
                name: row.text("TimeLineName").unwrap_or_default(),
                frame_rate: row.real("FrameRate"),
                start_frame: row.real("StartFrame"),
                end_frame: row.real("EndFrame"),
                current_frame: row.real("CurrentFrame"),
                guideline: row.int("GuidelineFrameRate"),
                scene: row.int("SceneIndexForName"),
                cut: row.int("CutIndexForName"),
                uuid: row.get("TimeLineUuid").map(uuid_text),
                labels: labels(row.int("LabelFirstIndex"))?,
                tracks,
            });
            next = row.int("NextTimeLine");
        }
        let current = bank.map(|b| b.int("CurrentIndex")).unwrap_or(0).clamp(0, timelines.len() as i64 - 1) as usize;
        Ok(Some(Animation { timelines, current, onion_skin: onion_skin(&file.canvas.row), frame: frame(file) }))
    }

    /// The timeline at [`Animation::current`].
    pub fn current_timeline(&self) -> Option<&Timeline> {
        self.timelines.get(self.current)
    }

    /// Find a timeline by `MainId`.
    pub fn timeline(&self, main_id: i64) -> Option<&Timeline> {
        self.timelines.iter().find(|t| t.main_id == main_id)
    }
}

fn read_track(
    file: &ClipFile,
    row: &Row,
    layer_by_uuid: &HashMap<String, i64>,
    labels: &dyn Fn(i64) -> Result<Vec<Label>>,
) -> Result<Track> {
    let layer_uuid = row.get("LayerUuidWithTrack").map(uuid_text).unwrap_or_default();
    let mut mixers: [Option<(String, Document)>; 2] = [None, None];
    for (slot, column) in ["TrackActionMixer", "TrackActionMixer2"].iter().enumerate() {
        let Some(id) = row.get(column).and_then(value_as_text) else { continue };
        let Some(payload) = file.external(&id) else { continue };
        let document = Document::parse(&cmt::unpack(payload)?)?;
        mixers[slot] = Some((id, document));
    }
    let clip = match mixers[1].as_ref().or(mixers[0].as_ref()) {
        Some((_, document)) => Some(Clip::from_document(document)?),
        None => None,
    };
    let value_map = match row.blob("TrackValueMap") {
        Some(data) if !data.is_empty() => parse_value_map(data)?,
        _ => Vec::new(),
    };
    Ok(Track {
        main_id: row.int("MainId"),
        timeline: row.int("ItemId"),
        kind: TrackKind::from_code(row.int("TrackKind")),
        layer_id: layer_by_uuid.get(&layer_uuid).copied(),
        layer_uuid,
        option_flag: row.int("TrackOptionFlag"),
        labels: labels(row.int("TrackLabelFirstIndex"))?,
        clip,
        value_map,
        mixers,
    })
}

/// A uuid column (16 bytes, or text) as 32 lower-case hex digits.
fn uuid_text(value: &SqlValue) -> String {
    match value {
        SqlValue::Blob(bytes) => bytes.iter().map(|b| format!("{b:02x}")).collect(),
        other => value_as_text(other).unwrap_or_default().replace('-', "").to_ascii_lowercase(),
    }
}

/// CSP stores the onion skin colours as `c · 0x01010101`.
fn channel(row: &Row, column: &str) -> u8 {
    (row.int(column) as u32 & 0xff) as u8
}

fn onion_skin(row: &Row) -> Option<OnionSkin> {
    if !row.has("OnionSkinStatus") {
        return None;
    }
    Some(OnionSkin {
        enabled: row.truthy("OnionSkinStatus"),
        previous: row.int("OnionSkinPrevDisplayCount"),
        next: row.int("OnionSkinNextDisplayCount"),
        use_opacity: row.truthy("OnionSkinUseOpacity"),
        start_opacity: row.int("OnionSkinStartOpacity"),
        step_opacity: row.int("OnionSkinStepOpaciy"),
        use_color: row.truthy("OnionSkinUseColor"),
        half_color: row.truthy("OnionSkinHalfColor"),
        front_color: [
            channel(row, "OnionSkinFrontColorRed"),
            channel(row, "OnionSkinFrontColorGreen"),
            channel(row, "OnionSkinFrontColorBlue"),
        ],
        behind_color: [
            channel(row, "OnionSkinBehindColorRed"),
            channel(row, "OnionSkinBehindColorGreen"),
            channel(row, "OnionSkinBehindColorBlue"),
        ],
    })
}

/// The reference frame: `CropFrameInner*` centred in the crop frame
/// (`CropFrameWidth/Height`, centred on the canvas and moved by
/// `CropFrameCropOffset`), moved by `CropFrameInnerOffset`, all in
/// `CropFrameUnitKind` units. Without a crop frame it is the whole canvas.
fn frame(file: &ClipFile) -> Frame {
    let row = &file.canvas.row;
    let unit = crate::model::Unit::from_code(row.int("CropFrameUnitKind"));
    let px = |column: &str| unit.to_pixels(row.real(column), file.canvas.resolution);
    let (cw, ch) = (file.canvas.width_px as f64, file.canvas.height_px as f64);
    let crop = (px("CropFrameWidth"), px("CropFrameHeight"));
    let inner = (px("CropFrameInnerWidth"), px("CropFrameInnerHeight"));
    if crop.0 <= 0.0 || crop.1 <= 0.0 {
        return Frame { x: 0.0, y: 0.0, width: cw, height: ch };
    }
    let crop_x = (cw - crop.0) / 2.0 + px("CropFrameCropOffsetX");
    let crop_y = (ch - crop.1) / 2.0 + px("CropFrameCropOffsetY");
    let (width, height) = if inner.0 > 0.0 && inner.1 > 0.0 { inner } else { crop };
    Frame {
        x: crop_x + (crop.0 - width) / 2.0 + px("CropFrameInnerOffsetX"),
        y: crop_y + (crop.1 - height) / 2.0 + px("CropFrameInnerOffsetY"),
        width,
        height,
    }
}

/// A 2D affine map `p ↦ (a·x + b·y + c, d·x + e·y + f)`.
#[derive(Debug, Clone, Copy, PartialEq, serde::Serialize)]
pub struct Affine(pub [f64; 6]);

impl Affine {
    /// The identity map.
    pub const IDENTITY: Affine = Affine([1.0, 0.0, 0.0, 0.0, 1.0, 0.0]);

    /// Maps a point.
    pub fn apply(&self, (x, y): (f64, f64)) -> (f64, f64) {
        let [a, b, c, d, e, f] = self.0;
        (a * x + b * y + c, d * x + e * y + f)
    }

    /// The inverse map; None when it is singular.
    pub fn inverse(&self) -> Option<Affine> {
        let [a, b, c, d, e, f] = self.0;
        let det = a * e - b * d;
        if det.abs() < 1e-12 {
            return None;
        }
        let (ia, ib, id, ie) = (e / det, -b / det, -d / det, a / det);
        Some(Affine([ia, ib, -(ia * c + ib * f), id, ie, -(id * c + ie * f)]))
    }

    /// `self ∘ other` (apply `other` first).
    pub fn then_after(&self, other: &Affine) -> Affine {
        let [a, b, c, d, e, f] = self.0;
        let [p, q, r, s, t, u] = other.0;
        Affine([a * p + b * s, a * q + b * t, a * r + b * u + c, d * p + e * s, d * q + e * t, d * r + e * u + f])
    }

    /// `p ↦ position + R(rotation) · diag(scale) · (p − center)`; rotation
    /// in degrees, clockwise on screen (y points down).
    pub fn keyframe(center: [f64; 2], position: [f64; 2], scale: [f64; 2], rotation: f64) -> Affine {
        let (sin, cos) = rotation.to_radians().sin_cos();
        let (a, b, d, e) = (cos * scale[0], -sin * scale[1], sin * scale[0], cos * scale[1]);
        Affine([a, b, position[0] - a * center[0] - b * center[1], d, e, position[1] - d * center[0] - e * center[1]])
    }
}

/// A keyframed layer at one frame.
#[derive(Debug, Clone, Copy, PartialEq, serde::Serialize)]
pub struct LayerTransform {
    /// Canvas position of an original pixel position.
    pub map: Affine,
    /// 0–256, as `LayerOpacity`.
    pub opacity: Option<i64>,
}

/// What a frame changes in the layer tree: which layers are not drawn
/// (cels not shown, light-table layers), keyframed layers' transforms and
/// cameras' maps (frame position → canvas position of the folder's content).
#[derive(Debug, Clone, Default, serde::Serialize)]
pub struct FrameState {
    /// Layers not drawn at this frame.
    pub hidden: HashSet<i64>,
    /// Keyframed layers' transforms, by layer id.
    pub transforms: HashMap<i64, LayerTransform>,
    /// 2D cameras' maps, by camera folder id.
    pub cameras: HashMap<i64, Affine>,
    /// The cel shown by each animation folder (folder id → cel layer id).
    pub cels: HashMap<i64, Option<i64>>,
    /// Interpolations evaluated as linear because they are not known.
    pub unknown_interp: HashSet<String>,
}

/// Opacity percent → `LayerOpacity` (0–256).
fn opacity_256(percent: f64) -> i64 {
    (percent * 256.0 / 100.0).round().clamp(0.0, 256.0) as i64
}

impl Animation {
    /// The state of 0-based frame `frame` of the timeline at `index`.
    pub fn frame_state(&self, file: &ClipFile, index: usize, frame: f64) -> Result<FrameState> {
        let timeline =
            self.timelines.get(index).ok_or_else(|| Error::format(format!("No timeline at index {index}")))?;
        let t = timeline.ticks(frame);
        let mut state = FrameState::default();
        let mut tracks: HashMap<i64, &Track> = HashMap::new();
        for track in &timeline.tracks {
            if let Some(id) = track.layer_id {
                tracks.insert(id, track);
            }
        }
        let mut stack: Vec<&LayerNode> = vec![&file.layers.root];
        while let Some(node) = stack.pop() {
            stack.extend(node.children.iter());
            let layer = &node.layer;
            if layer.layer_type == LAYER_TYPE_LIGHT_TABLE {
                state.hidden.insert(layer.main_id);
                continue;
            }
            let Some(track) = tracks.get(&layer.main_id) else {
                if layer.row.truthy("AnimationFolder") {
                    // A folder without a track in this timeline shows no cel.
                    for child in &node.children {
                        state.hidden.insert(child.layer.main_id);
                    }
                    state.cels.insert(layer.main_id, None);
                }
                continue;
            };
            let Some(clip) = &track.clip else { continue };
            for curve in &clip.curves {
                for key in &curve.keys {
                    if let Interp::Other(name) = &key.interp {
                        state.unknown_interp.insert(name.clone());
                    }
                }
            }
            match track.kind {
                TrackKind::Cels => {
                    let cel = clip
                        .curve("ImageCelName", None)
                        .and_then(|curve| {
                            let (_, index) = curve.evaluate(clip.motion_at(t))?;
                            curve.keys.get(index?)
                        })
                        .and_then(|key| key.tag.clone());
                    let shown = cel.as_ref().and_then(|name| {
                        node.children.iter().rev().find(|c| &c.layer.name == name).map(|c| c.layer.main_id)
                    });
                    for child in &node.children {
                        if Some(child.layer.main_id) != shown {
                            state.hidden.insert(child.layer.main_id);
                        }
                    }
                    state.cels.insert(layer.main_id, shown);
                }
                TrackKind::Keyframes => {
                    if !layer.row.truthy("TimeLineLayerKeyFrameEnabled") {
                        continue;
                    }
                    // Outside its clip the layer is not shown (measured
                    // before the clip; the end is taken as exclusive).
                    if t < clip.time.0 || t >= clip.time.1 {
                        state.hidden.insert(layer.main_id);
                        continue;
                    }
                    let center = clip.pair("ImageCenter", t).unwrap_or([0.0, 0.0]);
                    let position = clip.pair("ImagePosition", t).unwrap_or(center);
                    let scale = clip.pair("ImageAspectScale", t).unwrap_or([100.0, 100.0]);
                    let rotation = clip.value("ImageRotation", None, t).unwrap_or(0.0);
                    state.transforms.insert(
                        layer.main_id,
                        LayerTransform {
                            map: Affine::keyframe(center, position, [scale[0] / 100.0, scale[1] / 100.0], rotation),
                            opacity: clip.value("Opacity", None, t).map(opacity_256),
                        },
                    );
                }
                TrackKind::Camera => {
                    let center =
                        clip.pair("ImageCenter", t).unwrap_or([self.frame.width / 2.0, self.frame.height / 2.0]);
                    let position =
                        clip.pair("ImagePosition", t).unwrap_or([self.frame.x + center[0], self.frame.y + center[1]]);
                    let scale = clip.value("ImageScale", None, t).unwrap_or(100.0) / 100.0;
                    let rotation = clip.value("ImageRotation", None, t).unwrap_or(0.0);
                    // Frame coordinates → canvas, then the reference frame's
                    // own placement undone: canvas → canvas.
                    let camera = Affine::keyframe(center, position, [scale, scale], rotation);
                    let reference = Affine([1.0, 0.0, -self.frame.x, 0.0, 1.0, -self.frame.y]);
                    state.cameras.insert(layer.main_id, camera.then_after(&reference));
                    if let Some(opacity) = clip.value("Opacity", None, t) {
                        state.transforms.insert(
                            layer.main_id,
                            LayerTransform { map: Affine::IDENTITY, opacity: Some(opacity_256(opacity)) },
                        );
                    }
                }
                TrackKind::Paper | TrackKind::Other(_) => {}
            }
        }
        Ok(state)
    }
}

// -- edits ----------------------------------------------------------------

impl ClipFile {
    /// The animation data, None when the file has no timeline.
    pub fn animation(&self) -> Result<Option<Animation>> {
        Animation::read(self)
    }

    fn timeline_row(&self, timeline_id: i64) -> Result<Row> {
        self.row("TimeLine", timeline_id)?.ok_or_else(|| Error::format(format!("No TimeLine {timeline_id}")))
    }

    /// Change a timeline's frame rate. Keys stay on their frames: CSP
    /// stretches each track's `TimeClip` by old / new rate (measured).
    pub fn set_frame_rate(&mut self, timeline_id: i64, frame_rate: f64) -> Result<()> {
        if !(frame_rate > 0.0 && frame_rate <= 240.0) {
            bail!("Frame rate {frame_rate} out of range");
        }
        let old = self.timeline_row(timeline_id)?.real("FrameRate");
        if old <= 0.0 {
            bail!("TimeLine {timeline_id} has no frame rate");
        }
        let factor = old / frame_rate;
        let animation = self.animation()?.ok_or_else(|| Error::format("No animation"))?;
        let timeline = animation.timeline(timeline_id).ok_or_else(|| Error::format("No timeline"))?;
        for track in &timeline.tracks {
            self.edit_mixers(track, |clip| {
                for name in ["Start", "End"] {
                    if let Some(node) = clip.find_mut(&["TimeClip", name])
                        && let Value::Double(v) = &mut node.value
                    {
                        *v *= factor;
                    }
                }
                Ok(())
            })?;
        }
        self.database().execute("UPDATE TimeLine SET FrameRate = ?1 WHERE MainId = ?2", (frame_rate, timeline_id))?;
        Ok(())
    }

    /// Change a timeline's playback range (0-based first frame, frame after
    /// the last), as CSP's 再生フレーム settings store it.
    pub fn set_frame_range(&mut self, timeline_id: i64, start: i64, end: i64) -> Result<()> {
        if start < 0 || end <= start {
            bail!("Frame range {start}..{end} is empty");
        }
        let row = self.timeline_row(timeline_id)?;
        let biggest = row.real("BiggestEndFrame").max(end as f64);
        let current = row.real("CurrentFrame").clamp(start as f64, (end - 1) as f64);
        self.database().execute(
            "UPDATE TimeLine SET StartFrame = ?1, EndFrame = ?2, BiggestEndFrame = ?3, CurrentFrame = ?4 WHERE MainId = ?5",
            (start as f64, end as f64, biggest, current, timeline_id),
        )?;
        Ok(())
    }

    /// Replace the cel keys of an animation folder in a timeline: each
    /// `(0-based frame, cel layer name)` shows that cel from that frame on.
    /// The folder must already have a cel track in the timeline.
    pub fn set_cel_keys(&mut self, timeline_id: i64, folder_id: i64, keys: &[(i64, String)]) -> Result<()> {
        let animation = self.animation()?.ok_or_else(|| Error::format("No animation"))?;
        let timeline = animation.timeline(timeline_id).ok_or_else(|| Error::format("No timeline"))?;
        let track =
            timeline.tracks.iter().find(|t| t.layer_id == Some(folder_id) && t.kind == TrackKind::Cels).ok_or_else(
                || Error::format(format!("Layer {folder_id} has no cel track in timeline {timeline_id}")),
            )?;
        let clip = track.clip.as_ref().ok_or_else(|| Error::format("Cel track has no mixer"))?;
        let folder = self.layers.root.find(folder_id).ok_or_else(|| Error::format("No such folder"))?;
        let cels: Vec<String> = folder.children.iter().map(|c| c.layer.name.clone()).collect();
        let mut sorted = keys.to_vec();
        sorted.sort_by_key(|(frame, _)| *frame);
        sorted.dedup_by_key(|(frame, _)| *frame);
        let mut frames = Vec::new();
        let mut values = Vec::new();
        let mut tags = Vec::new();
        for (frame, name) in &sorted {
            let index = cels
                .iter()
                .position(|c| c == name)
                .ok_or_else(|| Error::format(format!("No cel {name:?} in folder {folder_id}")))?;
            frames.push(clip.motion_at(timeline.ticks(*frame as f64)));
            values.push(index as f64);
            tags.push(name.clone());
        }
        let current = sorted.iter().rev().find(|(frame, _)| *frame as f64 <= timeline.current_frame).or(sorted.first());
        let n = frames.len();
        self.edit_mixers(track, |clip| {
            let double = clip_is_double(clip);
            let numbers = |v: &[f64]| {
                if double {
                    Value::DoubleArray(v.to_vec())
                } else {
                    Value::SingleArray(v.iter().map(|x| *x as f32).collect())
                }
            };
            let anim = clip.child_mut("AnimInfo").ok_or_else(|| Error::format("No AnimInfo"))?;
            let mut curve = Node::new("FCurve", Value::Null);
            curve.attributes.push(("Type".into(), "ImageCelName".into()));
            curve.children = vec![
                Node::new("Frame", numbers(&frames)),
                Node::new("Value", numbers(&values)),
                Node::new("LeftSlope", numbers(&vec![0.0; n])),
                Node::new("RightSlope", numbers(&vec![0.0; n])),
                Node::new("Interp", Value::StringArray(vec!["Constant".into(); n])),
                Node::new("ReviseConstant", Value::ByteArray(vec![1; n])),
                Node::new("Tag", Value::StringArray(tags.clone())),
            ];
            match anim.children.iter_mut().find(|c| c.name == "FCurve" && c.attribute("Type") == Some("ImageCelName")) {
                Some(existing) => *existing = curve,
                None => anim.children.push(curve),
            }
            if let Some((_, name)) = current
                && let Some(param) =
                    anim.children.iter_mut().find(|c| c.name == "Param" && c.attribute("Name") == Some("ImageCelName"))
            {
                param.value = Value::Int32(cels.iter().position(|c| c == name).unwrap_or(0) as i32);
                match param.attributes.iter_mut().find(|(k, _)| k == "Tag") {
                    Some(tag) => tag.1 = name.clone(),
                    None => param.attributes.push(("Tag".into(), name.clone())),
                }
            }
            Ok(())
        })?;
        if let Some((_, name)) = current {
            let entries = vec![MapEntry {
                name: "ImageCelName".into(),
                tag: name.clone(),
                value: MapValue::Int(cels.iter().position(|c| c == name).unwrap_or(0) as i32),
            }];
            self.database().execute(
                "UPDATE Track SET TrackValueMap = ?1 WHERE MainId = ?2",
                (value_map_bytes(&entries), track.main_id),
            )?;
        }
        Ok(())
    }

    /// Edit a track's `ActionNodeClip` in both mixers and store them.
    fn edit_mixers(&mut self, track: &Track, edit: impl Fn(&mut Node) -> Result<()>) -> Result<()> {
        for (slot, column) in ["TrackActionMixer", "TrackActionMixer2"].iter().enumerate() {
            let Some((id, document)) = &track.mixers[slot] else { continue };
            let mut document = document.clone();
            edit(document.action_clip_mut().ok_or_else(|| Error::format("No ActionNodeClip"))?)?;
            let bytes = document.to_bytes()?;
            self.set_external(id, cmt::pack(&bytes)?);
            let size_column = format!("{column}Size");
            self.database().execute(
                &format!("UPDATE Track SET {size_column} = ?1 WHERE MainId = ?2"),
                (bytes.len() as i64, track.main_id),
            )?;
        }
        Ok(())
    }
}

/// Whether a clip stores double precision arrays (mixer 2, version 0110).
fn clip_is_double(clip: &Node) -> bool {
    fn any_double(node: &Node) -> Option<bool> {
        match node.value {
            Value::DoubleArray(_) | Value::Double2(_) | Value::Double2Array(_) => return Some(true),
            Value::SingleArray(_) | Value::Float2(_) | Value::Float2Array(_) => return Some(false),
            _ => {}
        }
        node.children.iter().find_map(any_double)
    }
    any_double(clip).unwrap_or(true)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn curve(keys: &[(f64, f64, &str)]) -> Curve {
        Curve {
            kind: "Opacity".into(),
            axis: None,
            keys: keys
                .iter()
                .map(|(frame, value, interp)| Key {
                    frame: *frame,
                    value: *value,
                    left_slope: 0.0,
                    right_slope: 0.0,
                    interp: Interp::from_name(interp),
                    tag: None,
                })
                .collect(),
        }
    }

    #[test]
    fn constant_holds_and_default_eases() {
        let c = curve(&[(50.0, 322.0, "Constant"), (110.0, 409.0, "Default"), (130.0, 300.0, "Default")]);
        assert_eq!(c.evaluate(0.0), Some((322.0, None)));
        assert_eq!(c.evaluate(109.0).unwrap().0, 322.0);
        assert_eq!(c.evaluate(110.0).unwrap().0, 409.0);
        // Smoothstep: a quarter of the way in is 15.625 % of the change.
        let v = c.evaluate(115.0).unwrap().0;
        assert!((v - (409.0 - 109.0 * 0.15625)).abs() < 1e-9, "{v}");
        assert_eq!(c.evaluate(120.0).unwrap().0, 354.5);
        assert_eq!(c.evaluate(500.0), Some((300.0, Some(2))));
    }

    #[test]
    fn clip_maps_time_to_motion() {
        let clip = Clip { time: (0.0, 180.0), motion: (0.0, 90.0), params: vec![], curves: vec![] };
        assert_eq!(clip.motion_at(20.0), 10.0);
        assert_eq!(clip.time_at(10.0), 20.0);
    }

    #[test]
    fn keyframe_transform_rotates_clockwise_about_the_center() {
        let map = Affine::keyframe([10.0, 10.0], [100.0, 50.0], [2.0, 1.0], 90.0);
        let (x, y) = map.apply((11.0, 10.0));
        // One pixel right of the centre, doubled, turned clockwise: down.
        assert!((x - 100.0).abs() < 1e-9 && (y - 52.0).abs() < 1e-9, "{x} {y}");
        let back = map.inverse().unwrap().apply((x, y));
        assert!((back.0 - 11.0).abs() < 1e-9 && (back.1 - 10.0).abs() < 1e-9);
    }

    #[test]
    fn value_map_round_trips() {
        let entries = vec![
            MapEntry { name: "ImageCelName".into(), tag: "2".into(), value: MapValue::Int(1) },
            MapEntry { name: "ImageCenter".into(), tag: String::new(), value: MapValue::Pair([190.0, 130.0]) },
            MapEntry { name: "Opacity".into(), tag: String::new(), value: MapValue::Double(89.84375) },
        ];
        let bytes = value_map_bytes(&entries);
        // The cel entry as CSP writes it: 46 bytes.
        assert_eq!(&bytes[8..12], &46u32.to_be_bytes());
        assert_eq!(parse_value_map(&bytes).unwrap(), entries);
    }

    /// A cel track mixer: `TimeClip` and `MotionClip` 0..90, keys at the
    /// given motion ticks showing the given cels.
    fn cel_mixer(version: &str, keys: &[(f64, &str, i32)]) -> Document {
        let double = version == "0110";
        let numbers = |v: Vec<f64>| {
            if double { Value::DoubleArray(v) } else { Value::SingleArray(v.iter().map(|x| *x as f32).collect()) }
        };
        let range = |name: &str| {
            let mut node = Node::new(name, Value::Null);
            node.children = vec![
                Node::new("Start", Value::Double(0.0)),
                Node::new("End", Value::Double(90.0)),
                Node::new("Rate", Value::Double(60.0)),
            ];
            node
        };
        let mut curve = Node::new("FCurve", Value::Null);
        curve.attributes.push(("Type".into(), "ImageCelName".into()));
        curve.children = vec![
            Node::new("Frame", numbers(keys.iter().map(|k| k.0).collect())),
            Node::new("Value", numbers(keys.iter().map(|k| k.2 as f64).collect())),
            Node::new("Interp", Value::StringArray(vec!["Constant".into(); keys.len()])),
            Node::new("Tag", Value::StringArray(keys.iter().map(|k| k.1.to_owned()).collect())),
        ];
        let mut param = Node::new("Param", Value::Int32(0));
        param.attributes = vec![("Name".into(), "ImageCelName".into()), ("Tag".into(), keys[0].1.into())];
        let mut anim = Node::new("AnimInfo", Value::Null);
        anim.children = vec![param, curve];
        let mut clip = Node::new("ActionNodeClip", Value::Null);
        clip.attributes.push(("Name".into(), String::new()));
        clip.children = vec![range("TimeClip"), range("MotionClip"), anim];
        let mut general = Node::new("General", Value::Null);
        general.children = vec![clip];
        let mut root = Node::new("celsysdocument", Value::Null);
        root.children = vec![general];
        Document { version: version.into(), root }
    }

    /// A new file with an animation folder holding cels "A" (red) and "B"
    /// (blue), one 24 fps timeline of 6 frames, and a cel track showing A
    /// from frame 0 and B from frame 3 (motion ticks 0 and 7.5).
    fn fixture() -> (ClipFile, i64) {
        use crate::edit::{NewLayer, new_external_id};
        let mut file = ClipFile::create(&crate::NewCanvas { width: 8, height: 8, ..Default::default() }).unwrap();
        let folder = file.add_layer(file.canvas.root_folder, NewLayer::Folder, "anim").unwrap();
        for (name, color) in [("A", [255, 0, 0, 255]), ("B", [0, 0, 255, 255])] {
            let cel = file.add_layer(folder, NewLayer::Raster, name).unwrap();
            let mut image = crate::RgbaImage::new(8, 8);
            image.fill(color);
            file.set_layer_pixels(cel, &image, (0, 0)).unwrap();
        }
        let uuid = file.layers.get(folder).unwrap().uuid.clone().unwrap().replace('-', "");
        let uuid: Vec<u8> = (0..16).map(|i| u8::from_str_radix(&uuid[2 * i..2 * i + 2], 16).unwrap()).collect();
        let ids = [new_external_id(), new_external_id()];
        let keys = [(0.0, "A", 0), (7.5, "B", 1)];
        let mut sizes = Vec::new();
        for (id, version) in ids.iter().zip(["0100", "0110"]) {
            let bytes = cel_mixer(version, &keys).to_bytes().unwrap();
            sizes.push(bytes.len() as i64);
            file.set_external(id, cmt::pack(&bytes).unwrap());
        }
        let db = file.database();
        db.execute_batch(
            "ALTER TABLE Layer ADD COLUMN AnimationFolder INTEGER DEFAULT NULL;
             UPDATE Layer SET AnimationFolder = 1 WHERE MainId = (SELECT MAX(MainId) FROM Layer WHERE LayerFolder = 1);
             UPDATE AnimationCutBank SET FirstTimeLine = 1, CurrentIndex = 0, Enable = 1;
             CREATE TABLE TimeLine(_PW_ID INTEGER PRIMARY KEY AUTOINCREMENT, MainId INTEGER, NextTimeLine INTEGER,
                 FirstTrack INTEGER, TimeLineName TEXT, FrameRate REAL, StartFrame REAL, EndFrame REAL,
                 CurrentFrame REAL, BiggestEndFrame REAL, LabelFirstIndex INTEGER);
             INSERT INTO TimeLine(MainId, NextTimeLine, FirstTrack, TimeLineName, FrameRate, StartFrame, EndFrame,
                 CurrentFrame, BiggestEndFrame, LabelFirstIndex) VALUES (1, 0, 1, 't', 24, 0, 6, 0, 6, 0);
             CREATE TABLE Track(_PW_ID INTEGER PRIMARY KEY AUTOINCREMENT, MainId INTEGER, ItemId INTEGER,
                 TrackNextIndex INTEGER, TrackKind INTEGER, LayerUuidWithTrack BLOB, TrackActionMixer BLOB,
                 TrackActionMixerSize INTEGER, TrackActionMixer2 BLOB, TrackActionMixer2Size INTEGER,
                 TrackValueMap BLOB, TrackLabelFirstIndex INTEGER);",
        )
        .unwrap();
        db.execute(
            "INSERT INTO Track(MainId, ItemId, TrackNextIndex, TrackKind, LayerUuidWithTrack, TrackActionMixer,
                 TrackActionMixerSize, TrackActionMixer2, TrackActionMixer2Size, TrackLabelFirstIndex)
             VALUES (1, 1, 0, 2000, ?1, ?2, ?3, ?4, ?5, 0)",
            (uuid, ids[0].as_bytes(), sizes[0], ids[1].as_bytes(), sizes[1]),
        )
        .unwrap();
        file.reload().unwrap();
        (file, folder)
    }

    fn shown(file: &ClipFile, frame: f64) -> [u8; 4] {
        let animation = Animation::read(file).unwrap().unwrap();
        let state = animation.frame_state(file, 0, frame).unwrap();
        let (image, _) = crate::render::render_frame(file, &state, Default::default()).unwrap();
        image.pixel(4, 4)
    }

    #[test]
    fn cels_switch_by_frame_and_can_be_rekeyed() {
        let (mut file, folder) = fixture();
        let animation = Animation::read(&file).unwrap().unwrap();
        let track = &animation.timelines[0].tracks[0];
        assert_eq!((track.kind, track.layer_id), (TrackKind::Cels, Some(folder)));
        assert_eq!(shown(&file, 0.0), [255, 0, 0, 255]);
        assert_eq!(shown(&file, 2.0), [255, 0, 0, 255]);
        assert_eq!(shown(&file, 3.0), [0, 0, 255, 255]);

        file.set_cel_keys(1, folder, &[(0, "B".into()), (4, "A".into())]).unwrap();
        file.set_frame_rate(1, 12.0).unwrap();
        file.set_frame_range(1, 1, 5).unwrap();
        let file = ClipFile::from_bytes(file.to_bytes().unwrap()).unwrap();
        let animation = Animation::read(&file).unwrap().unwrap();
        let timeline = &animation.timelines[0];
        assert_eq!((timeline.frame_rate, timeline.start_frame, timeline.end_frame), (12.0, 1.0, 5.0));
        let clip = timeline.tracks[0].clip.as_ref().unwrap();
        // 24 → 12 fps stretches the clip; the keys stay on frames 0 and 4.
        assert_eq!(clip.time, (0.0, 180.0));
        let keys: Vec<(f64, Option<&str>)> = clip.curves[0].keys.iter().map(|k| (k.frame, k.tag.as_deref())).collect();
        assert_eq!(keys, [(0.0, Some("B")), (10.0, Some("A"))]);
        // Both mixers carry the edit.
        for (_, document) in timeline.tracks[0].mixers.iter().flatten() {
            assert_eq!(Clip::from_document(document).unwrap().curves[0].keys.len(), 2);
        }
        assert_eq!(timeline.tracks[0].value_map[0].tag, "B");
        assert_eq!(shown(&file, 3.0), [0, 0, 255, 255]);
        assert_eq!(shown(&file, 4.0), [255, 0, 0, 255]);
    }

    /// Writes the Python reader's fixture `python/tests/data/anim.clip`:
    /// `cargo test -p csp-format -- --ignored write_python_fixture`.
    #[test]
    #[ignore]
    fn write_python_fixture() {
        let (mut file, _) = fixture();
        file.update_preview().unwrap();
        file.save(concat!(env!("CARGO_MANIFEST_DIR"), "/../../python/tests/data/anim.clip")).unwrap();
    }

    #[test]
    fn opacity_is_quantized_to_256ths() {
        assert_eq!(opacity_256(89.84375), 230);
        assert_eq!(opacity_256(100.0), 256);
    }
}
