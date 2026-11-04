//! Compositing the stored layer pixels into a canvas image (R10).
//!
//! The layers are drawn bottom to top (the first child of a folder is its
//! bottom layer) with visibility, opacity, blending mode, clipping, layer
//! masks and folders. Vector, gradient and correction layers, which CSP
//! draws when it opens a file, are drawn from their settings; text and 3D
//! layers without stored pixels are skipped and counted in the report.
//!
//! Rendering uses the mipmap level nearest above the wanted scale, so a
//! render at the size of `CanvasPreview` decodes only that level. Colours
//! are blended as premultiplied `f32` in the stored (sRGB) values. The
//! mapping of `LayerComposite` values to modes is in [`BlendMode`]; its
//! confidence is recorded in `docs/spec/`.
//!
//! Animated files are drawn at a frame ([`render_frame`], R17): only the
//! cel an animation folder shows at that frame, keyframed layers moved by
//! their transform and cameras applied to their folders. [`render`] draws
//! the current frame as CSP's canvas shows it, without the camera (a
//! keyframed layer's `LayerRenderMipmap` is not stored: CSP rebuilds it
//! from `TimeLineOriginalMipmap`). Light-table reference layers are never
//! drawn.

use std::collections::BTreeMap;

use crate::animation::{Affine, Animation, FrameState, LAYER_TYPE_LIGHT_TABLE};
use crate::clip::ClipFile;
use crate::correction::Correction;
use crate::effect::{Border, LayerEffects, draw_border};
use crate::error::Result;
use crate::gradient::Gradient;
use crate::image::{GrayImage, RgbaImage, luma};
use crate::material::Placement;
use crate::model::{Layer, LayerKind, LayerNode};
use crate::offscreen::Offscreen;
use crate::stroke::{
    draw_balloons, draw_balloons_at_canvas_size, draw_layer, draw_layer_at_canvas_size, frame_mask, layer_vectors,
};
use crate::text::read_blocks;
use crate::tone::Tone;

/// Blending modes, numbered as in `LayerComposite`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[non_exhaustive]
pub enum BlendMode {
    /// 通常 (0).
    Normal,
    /// 比較(暗) (1).
    Darken,
    /// 乗算 (2).
    Multiply,
    /// 焼き込みカラー (3).
    ColorBurn,
    /// 焼き込み(リニア) (4).
    LinearBurn,
    /// 減算 (5).
    Subtract,
    /// カラー比較(暗) (6).
    DarkerColor,
    /// 比較(明) (7).
    Lighten,
    /// スクリーン (8).
    Screen,
    /// 覆い焼きカラー (9).
    ColorDodge,
    /// 覆い焼き(発光) (10).
    GlowDodge,
    /// 加算 (11).
    Add,
    /// 加算(発光) (12).
    AddGlow,
    /// カラー比較(明) (13).
    LighterColor,
    /// オーバーレイ (14).
    Overlay,
    /// ソフトライト (15).
    SoftLight,
    /// ハードライト (16).
    HardLight,
    /// 差の絶対値 (21).
    Difference,
    /// 除外 (22).
    Exclusion,
    /// ビビッドライト (17).
    VividLight,
    /// リニアライト (18).
    LinearLight,
    /// ピンライト (19).
    PinLight,
    /// ハードミックス (20).
    HardMix,
    /// 色相 (23).
    Hue,
    /// 彩度 (24).
    Saturation,
    /// カラー (25).
    Color,
    /// 輝度 (26).
    Brightness,
    /// 除算 (36).
    Divide,
    /// Folders only: the children blend with what is below the folder.
    PassThrough,
}

impl BlendMode {
    /// The mode of a `LayerComposite` value (None for unknown values).
    ///
    /// Confirmed with a file made in CSP EX that has one layer per mode
    /// (`docs/validation/V6-made-files.md`). The numbers do not follow the
    /// order of CSP's mode list: darker / lighter colour, difference,
    /// exclusion and divide were added later.
    pub fn from_code(code: i64) -> Option<Self> {
        use BlendMode::*;
        Some(match code {
            0 => Normal,
            1 => Darken,
            2 => Multiply,
            3 => ColorBurn,
            4 => LinearBurn,
            5 => Subtract,
            6 => DarkerColor,
            7 => Lighten,
            8 => Screen,
            9 => ColorDodge,
            10 => GlowDodge,
            11 => Add,
            12 => AddGlow,
            13 => LighterColor,
            14 => Overlay,
            15 => SoftLight,
            16 => HardLight,
            17 => VividLight,
            18 => LinearLight,
            19 => PinLight,
            20 => HardMix,
            21 => Difference,
            22 => Exclusion,
            23 => Hue,
            24 => Saturation,
            25 => Color,
            26 => Brightness,
            30 => PassThrough,
            36 => Divide,
            _ => return None,
        })
    }

    /// The `LayerComposite` value of the mode.
    pub fn code(self) -> i64 {
        (0..=36).find(|code| Self::from_code(*code) == Some(self)).unwrap_or(0)
    }

    /// 覆い焼き(発光) and 加算(発光).
    fn is_glow(self) -> bool {
        matches!(self, BlendMode::GlowDodge | BlendMode::AddGlow)
    }

    /// Separable blend of one channel (backdrop `b`, source `s`, both 0..1).
    fn channel(self, b: f32, s: f32) -> f32 {
        use BlendMode::*;
        let burn = |b: f32, s: f32| {
            if b >= 1.0 {
                1.0
            } else if s <= 0.0 {
                0.0
            } else {
                1.0 - ((1.0 - b) / s).min(1.0)
            }
        };
        let dodge = |b: f32, s: f32| {
            if b <= 0.0 {
                0.0
            } else if s >= 1.0 {
                1.0
            } else {
                (b / (1.0 - s)).min(1.0)
            }
        };
        let hard = |b: f32, s: f32| if s <= 0.5 { b * 2.0 * s } else { b + (2.0 * s - 1.0) - b * (2.0 * s - 1.0) };
        let vivid = |b: f32, s: f32| if s <= 0.5 { burn(b, 2.0 * s) } else { dodge(b, 2.0 * s - 1.0) };
        match self {
            Normal | PassThrough => s,
            Darken => b.min(s),
            Multiply => b * s,
            ColorBurn => burn(b, s),
            LinearBurn => (b + s - 1.0).max(0.0),
            Subtract => (b - s).max(0.0),
            Lighten => b.max(s),
            Screen => b + s - b * s,
            ColorDodge | GlowDodge => dodge(b, s),
            Add | AddGlow => (b + s).min(1.0),
            Overlay => hard(s, b),
            SoftLight => {
                if s <= 0.5 {
                    b - (1.0 - 2.0 * s) * b * (1.0 - b)
                } else {
                    let d = if b <= 0.25 { ((16.0 * b - 12.0) * b + 4.0) * b } else { b.sqrt() };
                    b + (2.0 * s - 1.0) * (d - b)
                }
            }
            HardLight => hard(b, s),
            Difference => (b - s).abs(),
            Exclusion => b + s - 2.0 * b * s,
            VividLight => vivid(b, s),
            LinearLight => (b + 2.0 * s - 1.0).clamp(0.0, 1.0),
            PinLight => {
                if s <= 0.5 {
                    b.min(2.0 * s)
                } else {
                    b.max(2.0 * s - 1.0)
                }
            }
            HardMix => {
                // In 8-bit units: b + s > 255, and at exactly 255 only when
                // s < 128 (measured in CSP, docs/validation/V6-made-files.md).
                let (b8, s8) = ((b * 255.0).round(), (s * 255.0).round());
                if b8 + s8 > 255.0 || (b8 + s8 == 255.0 && s8 < 128.0) { 1.0 } else { 0.0 }
            }
            Divide => {
                if s <= 0.0 {
                    if b > 0.0 { 1.0 } else { 0.0 }
                } else {
                    (b / s).min(1.0)
                }
            }
            DarkerColor | LighterColor | Hue | Saturation | Color | Brightness => s,
        }
    }

    /// Blend a colour (non-premultiplied RGB).
    fn blend(self, b: [f32; 3], s: [f32; 3]) -> [f32; 3] {
        use BlendMode::*;
        match self {
            DarkerColor => {
                if lum8(s) <= lum8(b) {
                    s
                } else {
                    b
                }
            }
            LighterColor => {
                if lum8(s) >= lum8(b) {
                    s
                } else {
                    b
                }
            }
            Hue => set_lum(set_sat(s, sat(b)), lum(b)),
            Saturation => set_lum(set_sat(b, sat(s)), lum(b)),
            Color => set_lum(s, lum(b)),
            Brightness => set_lum(b, lum(s)),
            _ => [self.channel(b[0], s[0]), self.channel(b[1], s[1]), self.channel(b[2], s[2])],
        }
    }
}

/// The luminance darker / lighter colour compare: 0.3 R + 0.59 G + 0.11 B
/// rounded to 8 bits, ties going to the source (exact on CSP's output).
fn lum8(c: [f32; 3]) -> f32 {
    (lum(c) * 255.0).round()
}

fn lum(c: [f32; 3]) -> f32 {
    0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2]
}

fn clip_color(c: [f32; 3]) -> [f32; 3] {
    let l = lum(c);
    let n = c[0].min(c[1]).min(c[2]);
    let x = c[0].max(c[1]).max(c[2]);
    let mut out = c;
    for v in &mut out {
        if n < 0.0 {
            *v = l + (*v - l) * l / (l - n);
        }
        if x > 1.0 {
            *v = l + (*v - l) * (1.0 - l) / (x - l);
        }
    }
    out
}

fn set_lum(c: [f32; 3], l: f32) -> [f32; 3] {
    let d = l - lum(c);
    clip_color([c[0] + d, c[1] + d, c[2] + d])
}

fn sat(c: [f32; 3]) -> f32 {
    c[0].max(c[1]).max(c[2]) - c[0].min(c[1]).min(c[2])
}

fn set_sat(c: [f32; 3], s: f32) -> [f32; 3] {
    let max = c[0].max(c[1]).max(c[2]);
    let min = c[0].min(c[1]).min(c[2]);
    if max <= min {
        return [0.0; 3];
    }
    c.map(|v| (v - min) * s / (max - min))
}

/// A premultiplied RGBA float image.
#[derive(Debug, Clone)]
struct Buffer {
    width: usize,
    height: usize,
    data: Vec<[f32; 4]>,
}

impl Buffer {
    fn new(width: usize, height: usize) -> Self {
        Buffer { width, height, data: vec![[0.0; 4]; width * height] }
    }

    fn to_image(&self) -> RgbaImage {
        let mut image = RgbaImage::new(self.width as u32, self.height as u32);
        for (i, p) in self.data.iter().enumerate() {
            let a = p[3].clamp(0.0, 1.0);
            let un = |v: f32| if a > 0.0 { (v / a * 255.0).round().clamp(0.0, 255.0) as u8 } else { 0 };
            image.pixels[i * 4..i * 4 + 4].copy_from_slice(&[un(p[0]), un(p[1]), un(p[2]), (a * 255.0).round() as u8]);
        }
        image
    }

    /// Composite `source` (premultiplied) onto self with a mode; `coverage`
    /// scales the source alpha per pixel (opacity × mask × clipping base).
    fn composite(&mut self, source: &Buffer, mode: BlendMode, coverage: impl Fn(usize) -> f32) {
        self.composite_with(source, mode, coverage, false);
    }

    /// Like [`Buffer::composite`], but keep self's alpha: the source shows
    /// only where self has pixels (clipping onto a base layer).
    fn composite_atop(&mut self, source: &Buffer, mode: BlendMode, coverage: impl Fn(usize) -> f32) {
        self.composite_with(source, mode, coverage, true);
    }

    fn composite_with(&mut self, source: &Buffer, mode: BlendMode, coverage: impl Fn(usize) -> f32, atop: bool) {
        for i in 0..self.data.len() {
            let s = source.data[i];
            let k = coverage(i);
            if k <= 0.0 || s[3] <= 0.0 {
                continue;
            }
            let sa = s[3] * k;
            let b = self.data[i];
            let ba = b[3];
            let sc = [s[0] / s[3], s[1] / s[3], s[2] / s[3]];
            let bc = if ba > 0.0 { [b[0] / ba, b[1] / ba, b[2] / ba] } else { [0.0; 3] };
            let oa = if atop { ba } else { sa + ba * (1.0 - sa) };
            // Source where the backdrop is empty (not when clipping).
            let alone = if atop { 0.0 } else { sa * (1.0 - ba) };
            let mut out = [0.0; 4];
            if mode.is_glow() {
                // Glow modes blend the backdrop with the source colour times
                // its alpha and are not then mixed by alpha (measured in CSP).
                let mixed = mode.blend(bc, sc.map(|v| v * sa));
                for c in 0..3 {
                    out[c] = alone * sc[c] + ba * mixed[c];
                }
            } else {
                let mixed = mode.blend(bc, sc);
                for c in 0..3 {
                    // W3C compositing: source over, with the blended colour where both exist.
                    out[c] = alone * sc[c] + sa * ba * mixed[c] + (1.0 - sa) * b[c];
                }
            }
            out[3] = oa;
            self.data[i] = out;
        }
    }
}

/// Options for [`render`].
#[derive(Debug, Clone, Copy)]
pub struct RenderOptions {
    /// Output scale (1.0 = canvas size).
    pub scale: f64,
    /// Output size; by default the canvas size × `scale` rounded down.
    /// CSP's half-size levels round down at each step, so a quarter-size
    /// image can be a pixel larger than `size × 0.25` rounded down.
    pub size: Option<(u32, u32)>,
}

impl Default for RenderOptions {
    fn default() -> Self {
        RenderOptions { scale: 1.0, size: None }
    }
}

/// What the renderer did, by layer count.
#[derive(Debug, Clone, Default, serde::Serialize)]
pub struct RenderReport {
    /// Width of the image in pixels.
    pub width: u32,
    /// Height of the image in pixels.
    pub height: u32,
    /// Layers drawn.
    pub drawn: usize,
    /// Layers skipped because they or a folder above them are hidden.
    pub hidden: usize,
    /// Layers drawn without pixels of their own (no stored pixels), by kind.
    pub without_pixels: BTreeMap<String, usize>,
    /// `LayerComposite` values not in [`BlendMode`] (drawn as normal).
    pub unknown_blend: BTreeMap<i64, usize>,
    /// Modes used, by `LayerComposite` value.
    pub blend_modes: BTreeMap<i64, usize>,
    /// Layers clipped to the layer below.
    pub clipped: usize,
    /// Layers drawn through a mask.
    pub masked: usize,
    /// Layer effects drawn, by section name (`EffectEdge`, …).
    pub effects: BTreeMap<String, usize>,
    /// Switched-on effects not drawn yet (tone, watercolour edge, line extraction).
    pub effects_skipped: BTreeMap<String, usize>,
    /// Vector layers drawn from their vector data (see [`crate::stroke`]).
    pub vector_layers: usize,
    /// Text layers drawn from CSP's rendered text blocks.
    pub text_layers: usize,
    /// Image material layers drawn from their original image (see [`crate::material`]).
    pub material_layers: usize,
    /// Gradient layers drawn from `GradationFillInfo` (see [`crate::gradient`]),
    /// and how many of them only approximately (the 知覚的 mix).
    pub gradient_layers: usize,
    /// Gradient layers drawn only approximately (see `gradient_layers`).
    pub gradients_approximate: usize,
    /// Tones with settings whose drawing was not measured.
    pub tones_approximate: usize,
    /// Correction layers applied (see [`crate::correction`]), and how many
    /// of them only approximately.
    pub correction_layers: usize,
    /// Correction layers applied only approximately (see `correction_layers`).
    pub corrections_approximate: usize,
}

struct Renderer<'a> {
    file: &'a ClipFile,
    scale: f64,
    width: usize,
    height: usize,
    report: RenderReport,
    frame: &'a FrameState,
    /// Inside a 2D camera folder: output canvas position → the canvas
    /// position shown there. Pixel layers are then sampled once through
    /// the camera (and their keyframe transform).
    camera: Option<Affine>,
}

/// Render the canvas. The image has the canvas size × `options.scale`.
/// An animated file is drawn at its current frame (see the module notes).
pub fn render(file: &ClipFile, options: RenderOptions) -> Result<(RgbaImage, RenderReport)> {
    let mut state = match Animation::read(file) {
        Ok(Some(animation)) => {
            let frame = animation.current_timeline().map_or(0.0, |t| t.current_frame);
            animation.frame_state(file, animation.current, frame).unwrap_or_default()
        }
        _ => FrameState::default(),
    };
    state.cameras.clear();
    render_frame(file, &state, options)
}

/// Render the canvas as a frame's state changes it (see
/// [`Animation::frame_state`]). Crop to [`Animation::frame`] for what an
/// image-sequence export shows.
pub fn render_frame(file: &ClipFile, frame: &FrameState, options: RenderOptions) -> Result<(RgbaImage, RenderReport)> {
    let scale = options.scale.clamp(1e-3, 1.0);
    let (width, height) = match options.size {
        Some((width, height)) => (width.max(1) as usize, height.max(1) as usize),
        None => (
            ((file.canvas.width_px as f64 * scale).floor() as usize).max(1),
            ((file.canvas.height_px as f64 * scale).floor() as usize).max(1),
        ),
    };
    let mut renderer = Renderer { file, scale, width, height, report: RenderReport::default(), frame, camera: None };
    let mut canvas = Buffer::new(width, height);
    renderer.children(&file.layers.root, &mut canvas)?;
    let mut report = renderer.report;
    report.width = width as u32;
    report.height = height as u32;
    Ok((canvas.to_image(), report))
}

/// Render at the size of the stored `CanvasPreview`.
pub fn render_like_preview(file: &ClipFile) -> Result<Option<(RgbaImage, RenderReport, RgbaImage)>> {
    let Some(preview) = file.preview()? else { return Ok(None) };
    let scale = preview.width as f64 / file.canvas.width_px.max(1) as f64;
    let (mut image, report) = render(file, RenderOptions { scale, size: Some((preview.width, preview.height)) })?;
    if (image.width, image.height) != (preview.width, preview.height) {
        image = resample(&image, preview.width, preview.height);
    }
    Ok(Some((image, report, preview)))
}

fn resample(image: &RgbaImage, width: u32, height: u32) -> RgbaImage {
    if image.width >= width && image.height >= height {
        return image.resize_area(width, height);
    }
    // Nearest neighbour for the (one pixel) enlargements rounding causes.
    let mut out = RgbaImage::new(width, height);
    for y in 0..height {
        for x in 0..width {
            let sx = (x as u64 * image.width as u64 / width as u64) as u32;
            let sy = (y as u64 * image.height as u64 / height as u64) as u32;
            out.set_pixel(x, y, image.pixel(sx.min(image.width - 1), sy.min(image.height - 1)));
        }
    }
    out
}

impl Renderer<'_> {
    /// Draw the children of `node` (bottom first) onto `target`.
    ///
    /// A layer and the clipping layers above it form a group, as in CSP:
    /// the clipping layers are drawn onto the base layer alone (keeping its
    /// alpha), and the group is then drawn with the base layer's mode,
    /// opacity and mask (measured in CSP, `docs/validation/V6-made-files.md`).
    /// A pass-through folder or a correction layer as the base has no image
    /// of its own; its clipping layers are drawn onto the backdrop, masked
    /// by the base's alpha.
    fn children(&mut self, node: &LayerNode, target: &mut Buffer) -> Result<()> {
        let mut group: Option<Group> = None;
        for child in &node.children {
            let layer = &child.layer;
            if !layer.clipping
                && let Some(done) = group.take()
            {
                done.flush(target);
            }
            if !layer.visible
                || layer.layer_type == LAYER_TYPE_LIGHT_TABLE
                || self.frame.hidden.contains(&layer.main_id)
            {
                self.report.hidden += 1;
                if !layer.clipping {
                    group = Some(Group::Empty);
                }
                continue;
            }
            let backdrop = match (&group, layer.clipping) {
                (Some(Group::Isolated { buffer, .. }), true) => buffer,
                _ => &*target,
            };
            let Some(content) = self.content(child, backdrop)? else {
                if !layer.clipping {
                    group = Some(Group::Empty);
                }
                continue;
            };
            let opacity = match self.frame.transforms.get(&layer.main_id).and_then(|t| t.opacity) {
                Some(opacity) => opacity as f64 / 256.0,
                None => layer.opacity_fraction(),
            };
            let mut coverage = vec![opacity as f32; self.width * self.height];
            if layer.mask_enabled
                && !content.masked
                && let Some(mask) = self.mask(layer)?
            {
                self.report.masked += 1;
                for (c, m) in coverage.iter_mut().zip(mask) {
                    *c *= m;
                }
            }
            self.report.drawn += 1;
            if !layer.clipping {
                group = Some(match content.mode {
                    Some(mode) => Group::Isolated { buffer: content.buffer, mode, coverage },
                    None => {
                        let alpha = content.buffer.data.iter().zip(&coverage).map(|(p, c)| p[3] * c).collect();
                        mix(target, &content.buffer, &coverage);
                        Group::Backdrop { alpha }
                    }
                });
                // A frame folder's frame lines are drawn over its masked
                // content (layers clipped to the folder are not supported).
                if layer.kind == LayerKind::FrameFolder
                    && let Some(lines) = self.frame_lines(layer)?
                {
                    if let Some(done) = group.take() {
                        done.flush(target);
                    }
                    target.composite(&lines, BlendMode::Normal, |_| opacity as f32);
                    group = Some(Group::Empty);
                }
                continue;
            }
            self.report.clipped += 1;
            match &mut group {
                Some(Group::Isolated { buffer, .. }) => match content.mode {
                    Some(mode) => buffer.composite_atop(&content.buffer, mode, |i| coverage[i]),
                    None => mix(buffer, &content.buffer, &coverage),
                },
                Some(Group::Backdrop { alpha }) => {
                    for (c, a) in coverage.iter_mut().zip(alpha.iter()) {
                        *c *= a;
                    }
                    match content.mode {
                        Some(mode) => target.composite(&content.buffer, mode, |i| coverage[i]),
                        None => mix(target, &content.buffer, &coverage),
                    }
                }
                // No base (or a hidden or empty one): nothing shows.
                Some(Group::Empty) | None => self.report.drawn -= 1,
            }
        }
        if let Some(done) = group {
            done.flush(target);
        }
        Ok(())
    }

    /// The layer's own image: pixels, a folder's composite, or None.
    /// `mode` None means pass-through (the buffer already includes the backdrop).
    fn content(&mut self, node: &LayerNode, backdrop: &Buffer) -> Result<Option<Content>> {
        let layer = &node.layer;
        *self.report.blend_modes.entry(layer.blend).or_default() += 1;
        let mode = BlendMode::from_code(layer.blend).unwrap_or_else(|| {
            *self.report.unknown_blend.entry(layer.blend).or_default() += 1;
            BlendMode::Normal
        });
        if layer.kind.is_folder() {
            if let Some(camera) = self.frame.cameras.get(&layer.main_id).copied()
                && self.camera.is_none()
            {
                // A camera shows its folder's content through its frame.
                // Each layer is sampled through the camera on its own, as
                // CSP does (warping the composite blurs keyframed layers
                // twice); with layer masks inside, the composite is warped.
                let mode = if mode == BlendMode::PassThrough { BlendMode::Normal } else { mode };
                let mut masks = false;
                node.walk(0, &mut |n, _| masks |= n.layer.mask_enabled && n.layer.has_mask());
                let mut buffer = Buffer::new(self.width, self.height);
                if masks {
                    self.children(node, &mut buffer)?;
                    buffer = self.warp_buffer(&buffer, &camera);
                } else {
                    self.camera = Some(camera);
                    let result = self.children(node, &mut buffer);
                    self.camera = None;
                    result?;
                }
                return Ok(Some(Content { buffer, mode: Some(mode), masked: false }));
            }
            // Pass-through (30) folders blend their children with what is
            // below; any other mode makes the folder an isolated group.
            if mode == BlendMode::PassThrough {
                let mut buffer = backdrop.clone();
                self.children(node, &mut buffer)?;
                return Ok(Some(Content { buffer, mode: None, masked: false }));
            }
            let mut buffer = Buffer::new(self.width, self.height);
            self.children(node, &mut buffer)?;
            return Ok(Some(Content { buffer, mode: Some(mode), masked: false }));
        }
        if layer.kind == LayerKind::Paper {
            // The paper's stored pixels are not its look (older files store
            // opaque black); CSP draws the paper colour, white when unset.
            let color =
                layer.color("DrawColorMain").filter(|_| layer.row.truthy("DrawColorEnable")).unwrap_or([255; 3]);
            let pixel = [color[0] as f32 / 255.0, color[1] as f32 / 255.0, color[2] as f32 / 255.0, 1.0];
            let mut buffer = Buffer::new(self.width, self.height);
            buffer.data.fill(pixel);
            return Ok(Some(Content { buffer, mode: Some(mode), masked: false }));
        }
        if layer.kind == LayerKind::Correction
            && let Some(correction) = layer.row.blob("FilterLayerInfo").and_then(|data| Correction::parse(data).ok())
        {
            // The corrected backdrop, mixed in by opacity and mask like a
            // pass-through folder.
            self.report.correction_layers += 1;
            self.report.corrections_approximate += usize::from(correction.is_approximate());
            let filter = correction.filter();
            let mut buffer = backdrop.clone();
            for pixel in &mut buffer.data {
                let a = pixel[3];
                if a <= 0.0 {
                    continue;
                }
                let out = filter.apply([0, 1, 2].map(|c| pixel[c] / a * 255.0));
                for c in 0..3 {
                    pixel[c] = out[c] / 255.0 * a;
                }
            }
            return Ok(Some(Content { buffer, mode: None, masked: false }));
        }
        // Gradient layers are drawn from their settings, as CSP does when it
        // opens a file; the pixels some files store are a cache.
        if layer.kind == LayerKind::Gradient
            && let Some(mut gradient) = layer.row.blob("GradationFillInfo").and_then(|data| Gradient::parse(data).ok())
        {
            // Its points are relative to the layer's offset (a moved layer),
            // as vector points are.
            let (dx, dy) = (layer.offset.0 as f64, layer.offset.1 as f64);
            gradient.start = (gradient.start.0 + dx, gradient.start.1 + dy);
            gradient.end = (gradient.end.0 + dx, gradient.end.1 + dy);
            self.report.gradient_layers += 1;
            self.report.gradients_approximate += usize::from(gradient.is_approximate());
            let opaque = gradient.fill && gradient.ramp.stops.first().is_some_and(|stop| stop.color[3] >= 1.0)
                || gradient.ramp.stops.iter().all(|stop| stop.color[3] >= 1.0);
            let canvas_pixels = self.file.canvas.width_px as u64 * self.file.canvas.height_px as u64;
            let effects = self.effects(layer);
            // A border shows only where the layer has holes. Effects need the
            // full-size image (see `pixels`), which very large canvases
            // cannot afford: those are drawn without them.
            let shown = effects.tone.is_some() || effects.border.is_some() && (layer.mask_enabled || !opaque);
            if shown && canvas_pixels <= EFFECT_PIXELS_MAX {
                let image = gradient.draw(self.file.canvas.width_px, self.file.canvas.height_px, 1.0);
                let (buffer, masked) = self.with_effects(layer, image, (0, 0), &effects)?;
                return Ok(Some(Content { buffer, mode: Some(mode), masked }));
            }
            let image = gradient.draw(self.width as u32, self.height as u32, self.scale);
            return Ok(Some(Content {
                buffer: self.place(image, (0, 0), self.scale),
                mode: Some(mode),
                masked: false,
            }));
        }
        if let Some(camera) = self.camera {
            let transform = self.frame.transforms.get(&layer.main_id).map(|t| t.map);
            let plain = layer.kind == LayerKind::Raster && !self.effects(layer).any() && layer_colors(layer).is_none();
            if transform.is_some() || plain {
                let map = transform.unwrap_or(Affine::IDENTITY);
                if let Some(buffer) = self.keyframed(layer, &map, Some(&camera))? {
                    return Ok(Some(Content { buffer, mode: Some(mode), masked: false }));
                }
            }
            // Other layers are drawn as usual and then seen through the camera.
            self.camera = None;
            let content = self.content(node, backdrop);
            self.camera = Some(camera);
            return Ok(content?.map(|c| Content { buffer: self.warp_buffer(&c.buffer, &camera), ..c }));
        }
        if let Some(transform) = self.frame.transforms.get(&layer.main_id)
            && let Some(buffer) = self.keyframed(layer, &transform.map, None)?
        {
            return Ok(Some(Content { buffer, mode: Some(mode), masked: false }));
        }
        let effects = self.effects(layer);
        if let Some((buffer, masked)) = self.pixels(layer, &effects)? {
            return Ok(Some(Content { buffer, mode: Some(mode), masked }));
        }
        // Layers drawn from other data than pixels. With effects they are
        // drawn at full size (see `pixels`), unless the canvas is too large.
        let canvas = (self.file.canvas.width_px, self.file.canvas.height_px);
        let full = effects.any() && canvas.0 as u64 * canvas.1 as u64 <= EFFECT_PIXELS_MAX;
        if layer.kind == LayerKind::Text {
            let text = self.text(layer, full)?;
            if text.is_some() {
                self.report.text_layers += 1;
            }
            match text {
                Some(TextImage::Full(image)) => {
                    let (buffer, masked) = self.with_effects(layer, image, (0, 0), &effects)?;
                    return Ok(Some(Content { buffer, mode: Some(mode), masked }));
                }
                Some(TextImage::Placed(buffer)) => {
                    return Ok(Some(Content { buffer, mode: Some(mode), masked: false }));
                }
                None => {}
            }
        }
        // CSP draws an image material into the layer at the canvas's size and
        // makes the smaller views by halving that, so drawing it straight at
        // the preview's size samples it differently (3.7–14 dB worse on the
        // corpus files checked, V3).
        if layer.kind == LayerKind::ImageMaterial
            && !full
            && let Some((image, origin)) = self.material_at_canvas_size(layer)?
        {
            self.report.material_layers += 1;
            return Ok(Some(Content { buffer: self.place(image, origin, 1.0), mode: Some(mode), masked: false }));
        }
        // Vector layers likewise: CSP draws the lines at canvas size, so
        // drawing them at the preview's size makes thin lines too faint
        // and thick ones too sharp (V3 section 6).
        if layer.kind == LayerKind::Vector
            && !full
            && self.scale < 1.0
            && let Some((image, origin)) = draw_layer_at_canvas_size(self.file, layer)?
        {
            self.report.vector_layers += 1;
            return Ok(Some(Content { buffer: self.place(image, origin, 1.0), mode: Some(mode), masked: false }));
        }
        let drawn = if layer.kind == LayerKind::ImageMaterial {
            self.material(layer, full)?.inspect(|_| self.report.material_layers += 1)
        } else if layer.kind == LayerKind::Vector {
            let (w, h, scale) =
                if full { (canvas.0, canvas.1, 1.0) } else { (self.width as u32, self.height as u32, self.scale) };
            draw_layer(self.file, layer, w, h, scale)?.inspect(|_| self.report.vector_layers += 1)
        } else {
            None
        };
        if let Some(image) = drawn {
            let (buffer, masked) = if full {
                self.with_effects(layer, image, (0, 0), &effects)?
            } else {
                (self.place(image, (0, 0), self.scale), false)
            };
            return Ok(Some(Content { buffer, mode: Some(mode), masked }));
        }
        *self.report.without_pixels.entry(layer.kind.name().to_owned()).or_default() += 1;
        Ok(None)
    }

    /// A text layer from the images CSP rendered its text blocks into
    /// (attribute record 50, see [`crate::text`]): each is the size of the
    /// block's bounding box and placed at its top-left (layer pixels). The
    /// text itself is not laid out here. With `full`, the blocks are drawn
    /// on a canvas-sized image for the effects; otherwise each is placed in
    /// an output buffer.
    fn text(&self, layer: &Layer, full: bool) -> Result<Option<TextImage>> {
        let mut result: Option<TextImage> = None;
        // The balloons under the text, drawn from the layer's vector objects.
        let objects: Vec<_> = layer_vectors(self.file, layer)?.into_iter().flat_map(|data| data.objects).collect();
        // Blocks name their balloon by its number among the objects that
        // are not tails.
        let balloons: Vec<_> = objects.iter().filter(|object| !object.is_balloon_tail()).collect();
        if !objects.is_empty() && !full && self.scale < 1.0 {
            if let Some((image, origin)) = draw_balloons_at_canvas_size(self.file, layer)? {
                result = Some(TextImage::Placed(self.place(image, origin, 1.0)));
            }
        } else if !objects.is_empty() {
            let (w, h, scale) = if full {
                (self.file.canvas.width_px, self.file.canvas.height_px, 1.0)
            } else {
                (self.width as u32, self.height as u32, self.scale)
            };
            if let Some(image) = draw_balloons(self.file, layer, w, h, scale)? {
                result = Some(if full {
                    TextImage::Full(image)
                } else {
                    TextImage::Placed(self.place(image, (0, 0), self.scale))
                });
            }
        }
        let mut seen = Vec::new();
        for block in read_blocks(&layer.row)? {
            let (Some(id), Some(bbox)) = (block.attributes.render_offscreen(), block.attributes.bbox()) else {
                continue;
            };
            if id == 0 || seen.contains(&id) {
                continue;
            }
            seen.push(id);
            let Some(offscreen) = self.file.offscreen(id as i64)? else { continue };
            if offscreen.data.is_none() {
                continue;
            }
            // A block in a balloon is placed from the centre of the balloon's
            // bbox (V3 section 5).
            let anchor = match block.attributes.balloon() {
                Some(index) => match balloons.get(index as usize - 1) {
                    Some(object) => {
                        let b = object.bbox();
                        ((b[0] as i64 + b[2] as i64).div_euclid(2), (b[1] as i64 + b[3] as i64).div_euclid(2))
                    }
                    None => continue,
                },
                None => (0, 0),
            };
            let origin = (layer.offset.0 + anchor.0 + bbox[0] as i64, layer.offset.1 + anchor.1 + bbox[1] as i64);
            let image = offscreen.to_rgba()?;
            match &mut result {
                None if full => {
                    let mut canvas = RgbaImage::new(self.file.canvas.width_px, self.file.canvas.height_px);
                    canvas.draw_over(&image, origin.0, origin.1);
                    result = Some(TextImage::Full(canvas));
                }
                None => result = Some(TextImage::Placed(self.place(image, origin, 1.0))),
                Some(TextImage::Full(canvas)) => canvas.draw_over(&image, origin.0, origin.1),
                Some(TextImage::Placed(buffer)) => {
                    buffer.composite(&self.place(image, origin, 1.0), BlendMode::Normal, |_| 1.0)
                }
            }
        }
        Ok(result)
    }

    /// A frame folder's frame lines, drawn from its frames like a vector
    /// layer when CSP has not stored them (`ComicFrameLineMipmap`).
    fn frame_lines(&self, layer: &Layer) -> Result<Option<Buffer>> {
        let stored = layer.row.int("ComicFrameLineMipmap");
        if stored != 0 && self.level(stored, self.scale)?.is_some_and(|(offscreen, _)| offscreen.data.is_some()) {
            return Ok(None);
        }
        if self.scale < 1.0 {
            return Ok(
                draw_layer_at_canvas_size(self.file, layer)?.map(|(image, origin)| self.place(image, origin, 1.0))
            );
        }
        let image = draw_layer(self.file, layer, self.width as u32, self.height as u32, self.scale)?;
        Ok(image.map(|image| self.place(image, (0, 0), self.scale)))
    }

    /// An image material drawn from its original image and placement, at
    /// the output size, or the canvas's when `full` (see [`crate::material`]).
    fn material(&self, layer: &Layer, full: bool) -> Result<Option<RgbaImage>> {
        let original = layer.row.int("ResizableOriginalMipmap");
        let Some(placement) = layer.row.blob("ResizableImageInfo").and_then(|data| Placement::parse(data).ok()) else {
            return Ok(None);
        };
        if original == 0 {
            return Ok(None);
        }
        let (width, height, scale) = if full {
            (self.file.canvas.width_px, self.file.canvas.height_px, 1.0)
        } else {
            (self.width as u32, self.height as u32, self.scale)
        };
        let wanted = (scale * placement.magnification()).min(1.0);
        let Some((offscreen, level_scale)) = self.level(original, wanted)? else { return Ok(None) };
        if offscreen.data.is_none() {
            return Ok(None);
        }
        let offset = (layer.offset.0 as f64, layer.offset.1 as f64);
        let image = offscreen.to_rgba()?;
        Ok(placement.draw(&image, level_scale, offset, width, height, scale))
    }

    /// An image material drawn at the canvas's size, only over the part it
    /// covers (a whole canvas-sized buffer per material does not fit in
    /// memory for large sheets). The part starts on a 256-pixel boundary so
    /// that halving it keeps the grid of the canvas-sized image.
    fn material_at_canvas_size(&self, layer: &Layer) -> Result<Option<(RgbaImage, (i64, i64))>> {
        let original = layer.row.int("ResizableOriginalMipmap");
        let Some(placement) = layer.row.blob("ResizableImageInfo").and_then(|data| Placement::parse(data).ok()) else {
            return Ok(None);
        };
        if original == 0 {
            return Ok(None);
        }
        let (width, height) = (self.file.canvas.width_px as i64, self.file.canvas.height_px as i64);
        let offset = (layer.offset.0 as f64, layer.offset.1 as f64);
        let (x0, y0, x1, y1) = placement.bounds(offset, 1.0);
        let (x0, y0) = ((x0.clamp(0, width) / 256) * 256, (y0.clamp(0, height) / 256) * 256);
        let (x1, y1) = (x1.clamp(0, width), y1.clamp(0, height));
        if x1 <= x0 || y1 <= y0 {
            return Ok(None);
        }
        let wanted = placement.magnification().min(1.0);
        let Some((offscreen, level_scale)) = self.level(original, wanted)? else { return Ok(None) };
        if offscreen.data.is_none() {
            return Ok(None);
        }
        let region = (x0 as u32, y0 as u32, (x1 - x0) as u32, (y1 - y0) as u32);
        let image = offscreen.to_rgba()?;
        Ok(placement.draw_region(&image, level_scale, offset, region, 1.0).map(|image| (image, (x0, y0))))
    }

    /// The mipmap level to read for the output scale: the smallest stored
    /// level at or above it. CSP often stores only some levels (hidden
    /// layers only the full size), so levels without data are passed over;
    /// when none has data the full-size level is returned (its init colour
    /// still applies). Returns the offscreen and the level's scale.
    fn level(&self, mipmap: i64, scale: f64) -> Result<Option<(Offscreen, f64)>> {
        let Some(mipmap) = self.file.mipmap(mipmap)? else { return Ok(None) };
        let mut levels: Vec<_> = mipmap.levels.iter().filter(|level| level.scale / 100.0 + 1e-9 >= scale).collect();
        levels.sort_by(|a, b| a.scale.total_cmp(&b.scale));
        for level in levels {
            if let Some(offscreen) = self.file.offscreen(level.offscreen)?
                && offscreen.data.is_some()
            {
                return Ok(Some((offscreen, level.scale / 100.0)));
            }
        }
        let Some(first) = mipmap.levels.first() else { return Ok(None) };
        Ok(self.file.offscreen(first.offscreen)?.map(|offscreen| (offscreen, first.scale / 100.0)))
    }

    /// A keyframed layer: its untransformed pixels (`TimeLineOriginalMipmap`,
    /// placed at the layer's pixel origin) moved by `map` (original canvas
    /// position → canvas position), sampled bilinearly, and through a
    /// camera (output position → canvas position) when given.
    fn keyframed(&self, layer: &Layer, map: &Affine, camera: Option<&Affine>) -> Result<Option<Buffer>> {
        let original = layer.row.int("TimeLineOriginalMipmap");
        let keyframed = layer.row.truthy("TimeLineLayerKeyFrameEnabled") && original != 0;
        let mipmap = if keyframed { original } else { layer.render_mipmap };
        let Some(offscreen) = self.file.mipmap_base(mipmap)? else { return Ok(None) };
        if offscreen.data.is_none() {
            return Ok(None);
        }
        let Some(mut inverse) = map.inverse() else { return Ok(Some(Buffer::new(self.width, self.height))) };
        if let Some(camera) = camera {
            inverse = inverse.then_after(camera);
        }
        let image = offscreen.to_rgba()?;
        let origin = layer.pixel_origin();
        let (w, h) = (image.width as usize, image.height as usize);
        let fetch = |x: usize, y: usize| {
            let p = image.pixel(x as u32, y as u32);
            let a = p[3] as f32 / 255.0;
            [p[0] as f32 / 255.0 * a, p[1] as f32 / 255.0 * a, p[2] as f32 / 255.0 * a, a]
        };
        let mut buffer = Buffer::new(self.width, self.height);
        for y in 0..self.height {
            for x in 0..self.width {
                let canvas = ((x as f64 + 0.5) / self.scale, (y as f64 + 0.5) / self.scale);
                let (sx, sy) = inverse.apply(canvas);
                let (sx, sy) = (sx - origin.0 as f64 - 0.5, sy - origin.1 as f64 - 0.5);
                buffer.data[y * self.width + x] = bilinear(w, h, &fetch, sx, sy);
            }
        }
        Ok(Some(buffer))
    }

    /// `buffer` seen through a camera: each output position shows the
    /// buffer at `map(position)` (canvas coordinates), sampled bilinearly.
    fn warp_buffer(&self, buffer: &Buffer, map: &Affine) -> Buffer {
        let fetch = |x: usize, y: usize| buffer.data[y * buffer.width + x];
        let mut out = Buffer::new(self.width, self.height);
        for y in 0..self.height {
            for x in 0..self.width {
                let canvas = ((x as f64 + 0.5) / self.scale, (y as f64 + 0.5) / self.scale);
                let (sx, sy) = map.apply(canvas);
                out.data[y * self.width + x] =
                    bilinear(buffer.width, buffer.height, &fetch, sx * self.scale - 0.5, sy * self.scale - 0.5);
            }
        }
        out
    }

    /// Place an image read at `level_scale` with its top-left at canvas
    /// `origin` into an output-sized buffer.
    fn place(&self, image: RgbaImage, origin: (i64, i64), level_scale: f64) -> Buffer {
        let factor = self.scale / level_scale;
        let halvings = exact_halvings(factor);
        // Output sizes are rounded down from the canvas size, so the scale
        // asked for is a little under the level's (826 / 1653 for a half-size
        // preview); within the tolerance of `exact_halvings` the level is
        // used as it is rather than resampled by a fraction of a pixel.
        let image = if (factor - 1.0).abs() < 0.005 {
            image
        } else if halvings > 0 {
            // CSP's mipmap levels: each halves the one above with a 2×2 box
            // (sizes rounded down). Following the same steps keeps the
            // pixel grid of the stored lower levels.
            let mut image = image;
            for _ in 0..halvings {
                image = image.halve();
            }
            image
        } else {
            let w = ((image.width as f64 * factor).round() as u32).max(1);
            let h = ((image.height as f64 * factor).round() as u32).max(1);
            image.resize_area(w, h)
        };
        let ox = (origin.0 as f64 * self.scale).round() as i64;
        let oy = (origin.1 as f64 * self.scale).round() as i64;
        let mut buffer = Buffer::new(self.width, self.height);
        for y in 0..image.height as i64 {
            let ty = oy + y;
            if ty < 0 || ty >= self.height as i64 {
                continue;
            }
            for x in 0..image.width as i64 {
                let tx = ox + x;
                if tx < 0 || tx >= self.width as i64 {
                    continue;
                }
                let p = image.pixel(x as u32, y as u32);
                let a = p[3] as f32 / 255.0;
                buffer.data[ty as usize * self.width + tx as usize] =
                    [p[0] as f32 / 255.0 * a, p[1] as f32 / 255.0 * a, p[2] as f32 / 255.0 * a, a];
            }
        }
        buffer
    }

    /// The layer's stored pixels placed in an output buffer, and whether
    /// the mask was applied to them already.
    fn pixels(&mut self, layer: &Layer, effects: &Effects) -> Result<Option<(Buffer, bool)>> {
        if layer.render_mipmap == 0 {
            return Ok(None);
        }
        // Borders and tones are drawn at full size (their widths and screens
        // are in canvas pixels), then scaled with the layer.
        let scale = if effects.any() { 1.0 } else { self.scale };
        let Some((offscreen, level_scale)) = self.level(layer.render_mipmap, scale)? else { return Ok(None) };
        if offscreen.data.is_none() {
            return Ok(None);
        }
        if effects.any() {
            return Ok(Some(self.with_effects(layer, offscreen.to_rgba()?, layer.pixel_origin(), effects)?));
        }
        // Halve block by block when the wanted scale is a power of two
        // below the level (large canvases read for a preview).
        let halvings = exact_halvings(self.scale / level_scale);
        let (mut image, level_scale) = if halvings > 0 {
            (offscreen.to_rgba_halved(halvings)?, level_scale / 2f64.powi(halvings as i32))
        } else {
            (offscreen.to_rgba()?, level_scale)
        };
        if let Some(colors) = layer_colors(layer) {
            recolor(&mut image, colors);
        }
        Ok(Some((self.place(image, layer.pixel_origin(), level_scale), false)))
    }

    /// Draw the effects of a full-size layer image whose top-left is at
    /// canvas `origin`: the tone, then the border. For a border the mask is
    /// applied first, so the border follows the masked shape (CSP draws
    /// the border of a masked fill layer around the mask's hole), and the
    /// result is not masked again.
    fn with_effects(
        &self,
        layer: &Layer,
        mut image: RgbaImage,
        origin: (i64, i64),
        effects: &Effects,
    ) -> Result<(Buffer, bool)> {
        if let Some(tone) = &effects.tone {
            image = tone.draw(&image, origin);
        }
        if let Some(colors) = layer_colors(layer) {
            recolor(&mut image, colors);
        }
        let Some((border, apply_opacity)) = &effects.border else {
            return Ok((self.place(image, origin, 1.0), false));
        };
        let masked = layer.mask_enabled && self.fold_mask(layer, &mut image, origin)?;
        let (bordered, margin) = draw_border(&image, border, *apply_opacity);
        let origin = (origin.0 - margin as i64, origin.1 - margin as i64);
        Ok((self.place(bordered, origin, 1.0), masked))
    }

    /// Multiply the alpha of a full-size image at canvas `origin` by the
    /// layer's mask. Returns false when the layer has no mask.
    fn fold_mask(&self, layer: &Layer, image: &mut RgbaImage, origin: (i64, i64)) -> Result<bool> {
        if layer.mask_mipmap == 0 {
            return Ok(false);
        }
        let Some((offscreen, _)) = self.level(layer.mask_mipmap, 1.0)? else { return Ok(false) };
        let outside = offscreen.attribute.init_color().map(|init| (init.alpha & 0xff) as u8).unwrap_or(0);
        let mask = offscreen.to_alpha()?;
        let (mx, my) = layer.mask_origin();
        for y in 0..image.height {
            for x in 0..image.width {
                let (cx, cy) = (origin.0 + x as i64 - mx, origin.1 + y as i64 - my);
                let m = if cx >= 0 && cy >= 0 && (cx as u32) < mask.width && (cy as u32) < mask.height {
                    mask.pixels[cy as usize * mask.width as usize + cx as usize]
                } else {
                    outside
                };
                let i = (y * image.width + x) as usize * 4 + 3;
                image.pixels[i] = ((image.pixels[i] as u32 * m as u32 + 127) / 255) as u8;
            }
        }
        Ok(true)
    }

    /// The layer's switched-on effects that are drawn (border and tone);
    /// the others are counted in the report.
    fn effects(&mut self, layer: &Layer) -> Effects {
        let mut drawn = Effects::default();
        if !layer.row.truthy("LayerEffectAttached") {
            return drawn;
        }
        let Some(effects) = layer.row.blob("LayerEffectInfo").and_then(|blob| LayerEffects::parse(blob).ok()) else {
            return drawn;
        };
        drawn.tone = effects.section("EffectTone").and_then(Tone::parse);
        drawn.border = effects
            .border()
            .filter(|border| border.enabled && border.width > 0.0)
            .map(|border| (border, effects.apply_opacity()));
        for name in effects.enabled() {
            let shown = match name {
                "EffectEdge" => drawn.border.is_some(),
                "EffectTone" => drawn.tone.is_some(),
                _ => false,
            };
            let counts = if shown { &mut self.report.effects } else { &mut self.report.effects_skipped };
            *counts.entry(name.to_owned()).or_default() += 1;
        }
        if drawn.tone.is_some_and(|tone| tone.is_approximate()) {
            self.report.tones_approximate += 1;
        }
        drawn
    }

    /// The mask as coverage 0..1 per output pixel (outside the mask image:
    /// the mask's init value, usually hidden).
    fn mask(&self, layer: &Layer) -> Result<Option<Vec<f32>>> {
        if layer.mask_mipmap == 0 {
            return Ok(None);
        }
        let Some((offscreen, level_scale)) = self.level(layer.mask_mipmap, self.scale)? else { return Ok(None) };
        // CSP does not store a frame folder's mask: it is drawn from the frames.
        if layer.kind == LayerKind::FrameFolder
            && offscreen.data.is_none()
            && let Some(mask) = frame_mask(self.file, layer, self.width as u32, self.height as u32, self.scale)?
        {
            return Ok(Some(mask));
        }
        let outside = offscreen.attribute.init_color().map(|init| (init.alpha & 0xff) as f32 / 255.0).unwrap_or(0.0);
        let halvings = exact_halvings(self.scale / level_scale);
        let (image, level_scale) = if halvings > 0 {
            (offscreen.to_mask_rgba_halved(halvings)?, level_scale / 2f64.powi(halvings as i32))
        } else {
            (gray_to_rgba(&offscreen.to_alpha()?), level_scale)
        };
        // Inside the placed image alpha is 1 (fractional on resampled edges).
        let placed = self.place(image, layer.mask_origin(), level_scale);
        Ok(Some(placed.data.iter().map(|p| p[0] + outside * (1.0 - p[3])).collect()))
    }
}

/// The layer colour (レイヤーカラー, `DrawColorEnable`): the main and sub
/// colours (white when the sub colour is unset). Not for the paper, whose
/// colour is drawn from the same columns.
fn layer_colors(layer: &Layer) -> Option<([u8; 3], [u8; 3])> {
    if layer.kind == LayerKind::Paper || !layer.row.truthy("DrawColorEnable") {
        return None;
    }
    Some((layer.color("DrawColorMain")?, layer.color("DrawColorSub").unwrap_or([255; 3])))
}

/// Show dark parts in the main colour and light parts in the sub colour,
/// mixed by luminance (black is all main, white all sub); alpha is kept.
fn recolor(image: &mut RgbaImage, (main, sub): ([u8; 3], [u8; 3])) {
    for p in image.pixels.as_chunks_mut::<4>().0 {
        if p[3] == 0 {
            continue;
        }
        let light = luma(p[0], p[1], p[2]) as u32;
        for c in 0..3 {
            p[c] = ((main[c] as u32 * (255 - light) + sub[c] as u32 * light + 127) / 255) as u8;
        }
    }
}

/// A text layer's blocks: on a canvas-sized image, or placed in an output
/// buffer.
enum TextImage {
    Full(RgbaImage),
    Placed(Buffer),
}

/// The effects a layer is drawn with.
#[derive(Default)]
struct Effects {
    /// The border and whether it follows the layer's alpha.
    border: Option<(Border, bool)>,
    tone: Option<Tone>,
}

impl Effects {
    fn any(&self) -> bool {
        self.border.is_some() || self.tone.is_some()
    }
}

/// The largest canvas (pixels) on which a gradient layer's effects are
/// drawn (they need several full-size buffers).
const EFFECT_PIXELS_MAX: u64 = 40_000_000;

/// `n` when `factor` is 1/2ⁿ (n ≥ 1), else 0.
fn exact_halvings(factor: f64) -> u32 {
    let halvings = (1.0 / factor).log2().round();
    if halvings >= 1.0 && ((1.0 / factor) / 2f64.powf(halvings) - 1.0).abs() < 0.005 { halvings as u32 } else { 0 }
}

struct Content {
    buffer: Buffer,
    mode: Option<BlendMode>,
    /// The layer mask is already in the buffer (a border was drawn around
    /// the masked image).
    masked: bool,
}

/// A base layer and the clipping layers drawn onto it so far.
enum Group {
    /// The base's own image, drawn with its mode and coverage at the end.
    Isolated { buffer: Buffer, mode: BlendMode, coverage: Vec<f32> },
    /// The base was mixed into the backdrop (pass-through or correction);
    /// clipping layers are masked by its alpha.
    Backdrop { alpha: Vec<f32> },
    /// The base is hidden or has no image.
    Empty,
}

impl Group {
    fn flush(self, target: &mut Buffer) {
        if let Group::Isolated { buffer, mode, coverage } = self {
            target.composite(&buffer, mode, |i| coverage[i]);
        }
    }
}

/// Mix `source` (which already includes the backdrop, as a pass-through
/// folder or a correction layer does) into `target` by `coverage`.
fn mix(target: &mut Buffer, source: &Buffer, coverage: &[f32]) {
    for (i, pixel) in target.data.iter_mut().enumerate() {
        let k = coverage[i];
        let s = source.data[i];
        for c in 0..4 {
            pixel[c] += (s[c] - pixel[c]) * k;
        }
    }
}

/// Bilinear sample of premultiplied pixels at pixel-centre coordinates
/// (`x` = 0 is the centre of the first column); transparent outside.
fn bilinear(width: usize, height: usize, fetch: &impl Fn(usize, usize) -> [f32; 4], x: f64, y: f64) -> [f32; 4] {
    if !(x > -1.0 && y > -1.0 && x < width as f64 && y < height as f64) {
        return [0.0; 4];
    }
    let (x0, y0) = (x.floor(), y.floor());
    let (fx, fy) = ((x - x0) as f32, (y - y0) as f32);
    let (x0, y0) = (x0 as i64, y0 as i64);
    let mut out = [0.0f32; 4];
    for (dy, wy) in [(0, 1.0 - fy), (1, fy)] {
        for (dx, wx) in [(0, 1.0 - fx), (1, fx)] {
            let (sx, sy) = (x0 + dx, y0 + dy);
            let w = wx * wy;
            if w <= 0.0 || sx < 0 || sy < 0 || sx >= width as i64 || sy >= height as i64 {
                continue;
            }
            let p = fetch(sx as usize, sy as usize);
            for c in 0..4 {
                out[c] += p[c] * w;
            }
        }
    }
    out
}

fn gray_to_rgba(gray: &GrayImage) -> RgbaImage {
    let mut image = RgbaImage::new(gray.width, gray.height);
    for (i, v) in gray.pixels.iter().enumerate() {
        image.pixels[i * 4..i * 4 + 4].copy_from_slice(&[*v, *v, *v, 255]);
    }
    image
}

/// PSNR in dB of the RGB channels after compositing both images on white.
pub fn psnr(a: &RgbaImage, b: &RgbaImage) -> f64 {
    if (a.width, a.height) != (b.width, b.height) {
        return 0.0;
    }
    let flatten = |p: &[u8]| {
        let alpha = p[3] as f64 / 255.0;
        [0, 1, 2].map(|c| p[c] as f64 * alpha + 255.0 * (1.0 - alpha))
    };
    let mut sum = 0.0;
    for (pa, pb) in a.pixels.as_chunks::<4>().0.iter().zip(b.pixels.as_chunks::<4>().0.iter()) {
        let (x, y) = (flatten(pa), flatten(pb));
        for c in 0..3 {
            sum += (x[c] - y[c]).powi(2);
        }
    }
    let mse = sum / (a.pixels.len() / 4 * 3).max(1) as f64;
    if mse <= 1e-12 { 99.0 } else { 10.0 * (255.0f64 * 255.0 / mse).log10() }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn blend_modes_match_their_definitions() {
        assert_eq!(BlendMode::Multiply.channel(0.5, 0.5), 0.25);
        assert_eq!(BlendMode::Screen.channel(0.5, 0.5), 0.75);
        assert_eq!(BlendMode::Add.channel(0.7, 0.7), 1.0);
        assert_eq!(BlendMode::Overlay.channel(0.25, 1.0), 0.5);
        assert_eq!(BlendMode::Brightness.blend([1.0, 0.0, 0.0], [0.5, 0.5, 0.5]), set_lum([1.0, 0.0, 0.0], 0.5));
        assert_eq!(BlendMode::from_code(2), Some(BlendMode::Multiply));
        assert_eq!(BlendMode::from_code(99), None);
        assert_eq!(BlendMode::from_code(36), Some(BlendMode::Divide));
        assert_eq!(BlendMode::Divide.code(), 36);
    }

    #[test]
    fn normal_over_opaque_backdrop() {
        let mut backdrop = Buffer::new(1, 1);
        backdrop.data[0] = [1.0, 1.0, 1.0, 1.0];
        let mut source = Buffer::new(1, 1);
        source.data[0] = [0.0, 0.0, 0.5, 0.5];
        backdrop.composite(&source, BlendMode::Normal, |_| 1.0);
        assert_eq!(backdrop.data[0], [0.5, 0.5, 1.0, 1.0]);
        let mut backdrop = Buffer::new(1, 1);
        backdrop.data[0] = [0.5, 0.5, 0.5, 1.0];
        source.data[0] = [0.5, 0.5, 0.5, 1.0];
        backdrop.composite(&source, BlendMode::Multiply, |_| 1.0);
        assert_eq!(backdrop.data[0], [0.25, 0.25, 0.25, 1.0]);
    }

    #[test]
    fn psnr_of_equal_images_is_high() {
        let mut a = RgbaImage::new(2, 2);
        a.fill([10, 20, 30, 255]);
        assert_eq!(psnr(&a, &a), 99.0);
        let mut b = a.clone();
        b.set_pixel(0, 0, [11, 20, 30, 255]);
        assert!(psnr(&a, &b) > 50.0);
    }

    /// A clipping layer is drawn onto its base layer alone, and the group
    /// then with the base's mode and opacity (measured in CSP: a screen
    /// layer clipped to a half-transparent multiply layer at 50%).
    #[test]
    fn clipping_layers_group_with_their_base() {
        let canvas = crate::NewCanvas { width: 4, height: 4, paper: Some([200, 200, 200]), ..Default::default() };
        let mut file = ClipFile::create(&canvas).unwrap();
        let mut base = RgbaImage::new(4, 4);
        base.fill([56, 199, 199, 140]);
        let base_id = file.add_raster_layer("base", &base, (0, 0)).unwrap();
        file.set_layer_blend(base_id, BlendMode::Multiply).unwrap();
        file.set_layer_opacity(base_id, 0.5).unwrap();
        let mut top = RgbaImage::new(4, 4);
        top.fill([151, 202, 160, 255]);
        let top_id = file.add_raster_layer("top", &top, (0, 0)).unwrap();
        file.set_layer_blend(top_id, BlendMode::Screen).unwrap();
        file.set_layer_clipping(top_id, true).unwrap();
        let (image, report) = render(&file, RenderOptions::default()).unwrap();
        assert_eq!(report.clipped, 1);
        // Expected: group colour = screen(base, top) (the top is opaque), alpha
        // = the base's; then multiplied onto the paper at 0.5 × 140/255.
        let (b, t, paper): ([f64; 3], [f64; 3], f64) = ([56.0, 199.0, 199.0], [151.0, 202.0, 160.0], 200.0);
        let a = 0.5 * 140.0 / 255.0;
        let expected: Vec<u8> = (0..3)
            .map(|c| {
                let group = 255.0 - (255.0 - b[c]) * (255.0 - t[c]) / 255.0;
                (paper * (1.0 - a) + paper * group / 255.0 * a).round() as u8
            })
            .collect();
        let got = image.pixel(1, 1);
        for c in 0..3 {
            assert!(got[c].abs_diff(expected[c]) <= 1, "{got:?} vs {expected:?}");
        }
    }
}
