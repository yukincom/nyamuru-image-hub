//! Gradient layers (`Layer.GradationFillInfo`, R10): CSP saves no pixels
//! for them and draws the gradient when it opens the file.
//!
//! Big endian, the same section layout as `LayerEffectInfo`: `u32 total,
//! u32 2`, then sections of `u32 n, UTF-16BE name (n units), payload`:
//!
//! ```text
//! GradationData
//!   u32 size (bytes after this field)
//!   u32 header size (16 or 24, counted from here)  u32 stop size (28)
//!   u32 stop count  u32 16  [i32 mixing, i32 luminance correction when
//!   the header is 24 bytes; 16-byte headers mix normally]
//!   stop × count:
//!     u32 R, G, B, A (16-bit value repeated in both halves)
//!     u32 flags (1 main colour, 2 sub colour, 0x10 curved to the next stop)
//!     u32 position (0..=0x8000)   u32 points in the curve (flag 0x10)
//!   curve × (stops with flag 0x10): f64 x, y pairs (0..1)
//! GradationSetting
//!   u32 ?  u32 shape (0 linear, 1 circular)  u32 ?
//!   f64 ellipse width, height, rotation (degrees; circular shapes)
//!   f64 start x, y, end x, y (canvas pixels)
//! GradationSettingAdd0001
//!   u32 0x14  u32 fill (1: a fill layer, drawn in the first stop's colour)
//!   u32 R, G, B  u32 1
//! ```
//!
//! Between two stops the mix follows a curve (`curve.rs`): the
//! stop's own control points when it has flag 0x10, otherwise CSP's
//! default S curve through (0, 0), (0.25, 0.1), (0.75, 0.9), (1, 1).
//! Colours mix in straight (not premultiplied) sRGB for the normal mode,
//! in Oklab for 知覚的 (Photoshop互換) and in linear light for リニア
//! (Photoshop互換); alpha mixes linearly. A fully transparent stop takes
//! the colour of the stop it mixes with, so only the alpha fades. 知覚的
//! is CSP's own pigment-like mix, approximated (see [`Mixing::Perceptual`]).
//! Outside the start and end the end colours continue. A circular
//! gradient is a circle around the start whose radius is half the
//! ellipse width (CSP ignores the height and rotation it saves). Measured
//! in `docs/validation/V6b-generated-layers.md`.

use crate::curve::Spline;
use crate::error::{Error, Result};
use crate::image::RgbaImage;

/// One colour stop.
#[derive(Debug, Clone, PartialEq)]
pub struct Stop {
    /// Straight RGBA, 0..1.
    pub color: [f64; 4],
    /// 1 main colour, 2 sub colour, 0x10 curved to the next stop (`curve` holds the curve).
    pub flags: u32,
    /// 0..1 along the gradient.
    pub position: f64,
    /// Control points (x, y) shaping the change to the next stop.
    pub curve: Vec<(f64, f64)>,
}

/// How colours mix between stops (`GradationData` mixing word).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum Mixing {
    /// 通常: straight sRGB values.
    Normal,
    /// 知覚的: a pigment-like mix where the darker colour weighs more
    /// (black to white is about a fifth of the way at mid with no
    /// luminance correction, a third with 3). Approximated as Oklab with
    /// that weighting: grey ramps within a few levels, colour pairs off by
    /// up to a few tens, because CSP also darkens some pairs in between.
    Perceptual,
    /// 知覚的 (Photoshop互換): Oklab.
    Oklab,
    /// リニア (Photoshop互換): linear light.
    Linear,
}

/// The stops of a gradient (also the colours of a gradient map).
#[derive(Debug, Clone, PartialEq)]
pub struct Ramp {
    /// The stops, by position.
    pub stops: Vec<Stop>,
    /// How colours mix between stops.
    pub mixing: Mixing,
    /// Luminance correction (0 none … 3 high); only used by 知覚的.
    pub correction: i32,
    curves: Vec<Spline>,
}

/// CSP's curve between stops that store none.
const DEFAULT_CURVE: [(f64, f64); 4] = [(0.0, 0.0), (0.25, 0.1), (0.75, 0.9), (1.0, 1.0)];

/// Gradient shape.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum Shape {
    /// 直線.
    Linear,
    /// 円 (an ellipse).
    Circular,
}

/// A gradient or fill layer (`Layer.GradationFillInfo`).
#[derive(Debug, Clone, PartialEq)]
pub struct Gradient {
    /// The colours.
    pub ramp: Ramp,
    /// A fill layer (べた塗り): the first stop's colour everywhere.
    pub fill: bool,
    /// Linear or circular.
    pub shape: Shape,
    /// Ellipse width and height (pixels) and rotation (degrees).
    pub ellipse: [f64; 3],
    /// Start point in layer pixels.
    pub start: (f64, f64),
    /// End point in layer pixels.
    pub end: (f64, f64),
}

fn word(data: &[u8], offset: usize) -> Result<u32> {
    data.get(offset..offset + 4)
        .map(|b| u32::from_be_bytes(b.try_into().expect("4")))
        .ok_or_else(|| Error::format("GradationFillInfo is cut short"))
}

fn real(data: &[u8], offset: usize) -> Result<f64> {
    data.get(offset..offset + 8)
        .map(|b| f64::from_be_bytes(b.try_into().expect("8")))
        .ok_or_else(|| Error::format("GradationFillInfo is cut short"))
}

/// The sections (name, payload) of a GradationFillInfo blob. Payload
/// sizes differ by section and version, so a section runs to the next
/// name (`u32 n` and n UTF-16 units spelling `Gradation…`).
fn sections(data: &[u8]) -> Vec<(String, &[u8])> {
    let total = word(data, 0).map(|t| t as usize).unwrap_or(0).min(data.len());
    let name_at = |at: usize| -> Option<(String, usize)> {
        let n = word(data, at).ok()? as usize;
        let units: Vec<u16> = data
            .get(at + 4..at + 4 + 2 * n)?
            .as_chunks::<2>()
            .0
            .iter()
            .map(|u| u16::from_be_bytes([u[0], u[1]]))
            .collect();
        let name = String::from_utf16(&units).ok()?;
        (n >= 3 && name.starts_with("Gradation") && name.chars().all(|c| c.is_ascii_alphanumeric()))
            .then_some((name, at + 4 + 2 * n))
    };
    let mut names = Vec::new();
    let mut at = 8;
    while at + 4 <= total {
        match name_at(at) {
            Some((name, end)) => {
                names.push((at, name, end));
                at = end;
            }
            None => at += 2,
        }
    }
    names
        .iter()
        .enumerate()
        .map(|(i, (_, name, start))| {
            let end = names.get(i + 1).map(|next| next.0).unwrap_or(total);
            (name.clone(), &data[*start..end])
        })
        .collect()
}

impl Ramp {
    /// Parse a `GradationData` payload (starting at its size word).
    pub fn parse(stops_data: &[u8]) -> Result<Self> {
        let header = word(stops_data, 4)? as usize;
        let stop_size = word(stops_data, 8)? as usize;
        let count = word(stops_data, 12)? as usize;
        if stop_size < 28 || count == 0 || count > 256 {
            return Err(Error::format(format!("GradationData: {count} stops of {stop_size} bytes")));
        }
        let (mixing, correction) = if header >= 24 {
            let mixing = match word(stops_data, 20)? {
                1 => Mixing::Perceptual,
                2 => Mixing::Oklab,
                3 => Mixing::Linear,
                _ => Mixing::Normal,
            };
            (mixing, word(stops_data, 24)? as i32)
        } else {
            (Mixing::Normal, 0)
        };
        let mut stops = Vec::with_capacity(count);
        let mut curve_offset = 4 + header + count * stop_size;
        for index in 0..count {
            let at = 4 + header + index * stop_size;
            let channel = |i: usize| -> Result<f64> { Ok((word(stops_data, at + 4 * i)? >> 16) as f64 / 65535.0) };
            let color = [channel(0)?, channel(1)?, channel(2)?, channel(3)?];
            let flags = word(stops_data, at + 16)?;
            let position = word(stops_data, at + 20)? as f64 / 32768.0;
            let mut curve = Vec::new();
            if flags & 0x10 != 0 {
                let points = (word(stops_data, at + 24)? as usize).min(64);
                for p in 0..points {
                    curve
                        .push((real(stops_data, curve_offset + 16 * p)?, real(stops_data, curve_offset + 16 * p + 8)?));
                }
                curve_offset += 16 * points;
            }
            stops.push(Stop { color, flags, position: position.clamp(0.0, 1.0), curve });
        }
        stops.sort_by(|a, b| a.position.total_cmp(&b.position));
        let curves = stops
            .iter()
            .map(|stop| if stop.flags & 0x10 != 0 { Spline::new(&stop.curve) } else { Spline::new(&DEFAULT_CURVE) })
            .collect();
        Ok(Ramp { stops, mixing, correction, curves })
    }

    /// Straight RGBA (0..1) at position `t`.
    pub fn color(&self, t: f64) -> [f64; 4] {
        let first = &self.stops[0];
        if t <= first.position {
            return first.color;
        }
        for (index, pair) in self.stops.windows(2).enumerate() {
            let (a, b) = (&pair[0], &pair[1]);
            if t <= b.position {
                let span = b.position - a.position;
                let k = if span > 0.0 { (t - a.position) / span } else { 1.0 };
                let k = self.curves[index].at(k.clamp(0.0, 1.0));
                let (mut from, mut to) = (a.color, b.color);
                if from[3] <= 0.0 {
                    from[..3].copy_from_slice(&to[..3]);
                } else if to[3] <= 0.0 {
                    to[..3].copy_from_slice(&from[..3]);
                }
                return mix(self.mixing, from, to, k, self.correction);
            }
        }
        self.stops.last().map(|s| s.color).unwrap_or([0.0; 4])
    }
}

fn mix(mixing: Mixing, a: [f64; 4], b: [f64; 4], k: f64, correction: i32) -> [f64; 4] {
    let rgb = |c: [f64; 4]| [c[0], c[1], c[2]];
    let alpha = a[3] + (b[3] - a[3]) * k;
    let k = if mixing == Mixing::Perceptual {
        perceptual_weight(oklab(rgb(a))[0], oklab(rgb(b))[0], k, correction)
    } else {
        k
    };
    let lerp = |x: f64, y: f64| x + (y - x) * k;
    let [r, g, bl] = match mixing {
        Mixing::Normal => [lerp(a[0], b[0]), lerp(a[1], b[1]), lerp(a[2], b[2])],
        Mixing::Linear => {
            let (x, y) = (rgb(a).map(to_linear), rgb(b).map(to_linear));
            std::array::from_fn::<f64, 3, _>(|c| from_linear(lerp(x[c], y[c])))
        }
        Mixing::Oklab | Mixing::Perceptual => {
            let (x, y) = (oklab(rgb(a)), oklab(rgb(b)));
            from_oklab(std::array::from_fn(|c| lerp(x[c], y[c])))
        }
    };
    [r.clamp(0.0, 1.0), g.clamp(0.0, 1.0), bl.clamp(0.0, 1.0), alpha]
}

/// The share of the second colour in a 知覚的 mix at `k`: each colour
/// weighs by its darkness, the lighter one `r` times the darker per unit
/// of Oklab lightness between them, with `r` growing with the luminance
/// correction (fitted to CSP's black-to-white ramps, corrections 0 to 3).
fn perceptual_weight(lightness_a: f64, lightness_b: f64, k: f64, correction: i32) -> f64 {
    let r = (0.195 + 0.104 * correction as f64).clamp(0.05, 1.0).powf(lightness_b - lightness_a);
    let denominator = (1.0 - k) + k * r;
    if denominator <= 0.0 { k } else { k * r / denominator }
}

fn to_linear(c: f64) -> f64 {
    if c <= 0.04045 { c / 12.92 } else { ((c + 0.055) / 1.055).powf(2.4) }
}

fn from_linear(c: f64) -> f64 {
    if c <= 0.003_130_8 { 12.92 * c } else { 1.055 * c.max(0.0).powf(1.0 / 2.4) - 0.055 }
}

fn oklab(c: [f64; 3]) -> [f64; 3] {
    let [r, g, b] = c.map(to_linear);
    let l = (0.412_221_470_8 * r + 0.536_332_536_3 * g + 0.051_445_992_9 * b).cbrt();
    let m = (0.211_903_498_2 * r + 0.680_699_545_1 * g + 0.107_396_956_6 * b).cbrt();
    let s = (0.088_302_461_9 * r + 0.281_718_837_6 * g + 0.629_978_700_5 * b).cbrt();
    [
        0.210_454_255_3 * l + 0.793_617_785_0 * m - 0.004_072_046_8 * s,
        1.977_998_495_1 * l - 2.428_592_205_0 * m + 0.450_593_709_9 * s,
        0.025_904_037_1 * l + 0.782_771_766_2 * m - 0.808_675_766_0 * s,
    ]
}

fn from_oklab(c: [f64; 3]) -> [f64; 3] {
    let l = (c[0] + 0.396_337_777_4 * c[1] + 0.215_803_757_3 * c[2]).powi(3);
    let m = (c[0] - 0.105_561_345_8 * c[1] - 0.063_854_172_8 * c[2]).powi(3);
    let s = (c[0] - 0.089_484_177_5 * c[1] - 1.291_485_548_0 * c[2]).powi(3);
    [
        4.076_741_662_1 * l - 3.307_711_591_3 * m + 0.230_969_929_2 * s,
        -1.268_438_004_6 * l + 2.609_757_401_1 * m - 0.341_319_396_5 * s,
        -0.004_196_086_3 * l - 0.703_418_614_7 * m + 1.707_614_701_0 * s,
    ]
    .map(from_linear)
}

impl Gradient {
    /// Parses `GradationFillInfo`.
    pub fn parse(data: &[u8]) -> Result<Self> {
        let sections = sections(data);
        let find = |name: &str| {
            sections
                .iter()
                .find(|(n, _)| n == name)
                .map(|(_, payload)| *payload)
                .ok_or_else(|| Error::format(format!("GradationFillInfo has no {name}")))
        };
        let ramp = Ramp::parse(find("GradationData")?)?;
        let setting = find("GradationSetting")?;
        let shape = if word(setting, 4)? == 1 { Shape::Circular } else { Shape::Linear };
        let r = |i: usize| real(setting, 12 + 8 * i);
        let fill = find("GradationSettingAdd0001").ok().and_then(|add| word(add, 4).ok()) == Some(1);
        Ok(Gradient { ramp, fill, shape, ellipse: [r(0)?, r(1)?, r(2)?], start: (r(3)?, r(4)?), end: (r(5)?, r(6)?) })
    }

    /// Position (0..1, clamped) of the canvas point `(x, y)`.
    pub fn position(&self, x: f64, y: f64) -> f64 {
        let t = match self.shape {
            Shape::Linear => {
                let (dx, dy) = (self.end.0 - self.start.0, self.end.1 - self.start.1);
                let length2 = dx * dx + dy * dy;
                if length2 <= 0.0 { 0.0 } else { ((x - self.start.0) * dx + (y - self.start.1) * dy) / length2 }
            }
            Shape::Circular => {
                let radius = self.ellipse[0] / 2.0;
                if radius <= 0.0 { 0.0 } else { (x - self.start.0).hypot(y - self.start.1) / radius }
            }
        };
        t.clamp(0.0, 1.0)
    }

    /// True when CSP's look is only approximated (the 知覚的 mix).
    pub fn is_approximate(&self) -> bool {
        !self.fill && self.ramp.mixing == Mixing::Perceptual && self.ramp.stops.len() > 1
    }

    /// Straight RGBA (0..1) at position `t`.
    pub fn color(&self, t: f64) -> [f64; 4] {
        if self.fill { self.ramp.stops[0].color } else { self.ramp.color(t) }
    }

    /// The gradient at `scale` into a `width × height` image (pixel centres).
    pub fn draw(&self, width: u32, height: u32, scale: f64) -> RgbaImage {
        let mut image = RgbaImage::new(width, height);
        for y in 0..height {
            for x in 0..width {
                let t = self.position((x as f64 + 0.5) / scale, (y as f64 + 0.5) / scale);
                let c = self.color(t).map(|v| (v * 255.0).round().clamp(0.0, 255.0) as u8);
                image.set_pixel(x, y, c);
            }
        }
        image
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn name(text: &str) -> Vec<u8> {
        let mut out = (text.len() as u32).to_be_bytes().to_vec();
        for unit in text.encode_utf16() {
            out.extend(unit.to_be_bytes());
        }
        out
    }

    /// A two-stop linear gradient from opaque black (x = 0) to transparent
    /// white (x = 100), shaped like the files CSP writes.
    fn sample() -> Vec<u8> {
        let words = |values: &[u32]| values.iter().flat_map(|w| w.to_be_bytes()).collect::<Vec<u8>>();
        let mut data = words(&[0, 2]);
        data.extend(name("GradationData"));
        data.extend(words(&[72, 16, 28, 2, 16]));
        data.extend(words(&[0, 0, 0, 0xffff_ffff, 0, 0, 0]));
        data.extend(words(&[0xffff_ffff, 0xffff_ffff, 0xffff_ffff, 0, 0, 0x8000, 0]));
        data.extend(name("GradationSetting"));
        data.extend(words(&[0, 0, 1]));
        for value in [100.0f64, 100.0, 0.0, 0.0, 0.0, 100.0, 0.0] {
            data.extend(value.to_be_bytes());
        }
        data.extend(name("GradationSettingAdd0001"));
        data.extend(words(&[0x14, 0, 0, 0, 0, 1]));
        let total = data.len() as u32;
        data[..4].copy_from_slice(&total.to_be_bytes());
        data
    }

    #[test]
    fn parses_and_interpolates() {
        let gradient = Gradient::parse(&sample()).unwrap();
        assert_eq!(gradient.shape, Shape::Linear);
        assert_eq!(gradient.ramp.stops.len(), 2);
        assert_eq!(gradient.ramp.mixing, Mixing::Normal);
        assert!(!gradient.fill);
        assert_eq!(gradient.end, (100.0, 0.0));
        assert_eq!(gradient.position(50.0, 7.0), 0.5);
        assert_eq!(gradient.position(-5.0, 0.0), 0.0);
        // The transparent end keeps the black: only the alpha fades.
        let mid = gradient.color(0.5);
        assert!(mid[0].abs() < 1e-9 && (mid[3] - 0.5).abs() < 1e-3, "{mid:?}");
        // The default S curve: a quarter of the way is 17.8 % of the change.
        let quarter = gradient.color(0.25);
        assert!((quarter[3] - (1.0 - 0.178)).abs() < 0.005, "{quarter:?}");
    }

    #[test]
    fn mixing_spaces_keep_the_ends() {
        let (red, blue) = ([1.0, 0.0, 0.0, 1.0], [0.0, 0.0, 1.0, 1.0]);
        for mixing in [Mixing::Normal, Mixing::Linear, Mixing::Oklab] {
            let end = mix(mixing, red, blue, 1.0, 3);
            assert!((end[2] - 1.0).abs() < 1e-6 && end[0].abs() < 1e-6, "{mixing:?} {end:?}");
        }
        // Linear light: the middle of red and blue is 0.5 linear = 188/255.
        let middle = mix(Mixing::Linear, red, blue, 0.5, 3);
        assert!((middle[0] * 255.0 - 187.5).abs() < 1.0, "{middle:?}");
    }

    #[test]
    fn perceptual_grey_ramps_follow_csp() {
        // CSP, black to white at the middle: 13 with no correction, 55
        // with correction 3; white to black mirrors it.
        let (black, white) = ([0.0, 0.0, 0.0, 1.0], [1.0, 1.0, 1.0, 1.0]);
        for (correction, expected) in [(0, 13.0), (3, 55.0)] {
            let grey = mix(Mixing::Perceptual, black, white, 0.5, correction)[0] * 255.0;
            assert!((grey - expected).abs() < 4.0, "{correction}: {grey}");
            let back = mix(Mixing::Perceptual, white, black, 0.5, correction)[0] * 255.0;
            assert!((back - expected).abs() < 4.0, "{correction}: {back}");
        }
    }
}
