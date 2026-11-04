//! Correction layers (色調補正レイヤー): `Layer.FilterLayerInfo` holds
//! `u32 type, u32 size` and the settings; CSP stores no pixels and applies
//! the correction to the image below the layer when it draws.
//!
//! Big endian. Types and payloads:
//!
//! ```text
//! 1 brightness/contrast   i32 brightness, contrast (-100..100)
//! 2 levels                32 slots × u16 [input black, gamma point, input
//!                         white, output black, output white] (0..0xffff);
//!                         slot 0 is the master, 1..3 red, green, blue
//! 3 tone curve            32 slots × (u16 count, 32 × (u16 x, u16 y))
//! 4 hue/saturation/value  i32 hue (degrees), saturation, value (-100..100)
//! 5 colour balance        i32 preserve luminosity, then shadows, midtones
//!                         and highlights as i32 R, G, B (-100..100)
//! 6 invert                (nothing)
//! 7 posterize             i32 levels
//! 8 threshold             i32 threshold
//! 9 gradient map          a GradationData (see crate::gradient)
//! ```
//!
//! The rules were measured against CSP exports of generated test files
//! (`docs/validation/V6b-generated-layers.md`). Colour balance without
//! "preserve luminosity" is an empirical fit (within 3 levels at every
//! tested setting); with it, it is exact per channel (within 1).
//! [`Correction::is_approximate`] says when a setting falls outside what
//! was measured closely.

use crate::curve::Spline;
use crate::error::{Error, Result};
use crate::gradient::{Mixing, Ramp};

/// The settings of a correction layer, by type.
#[derive(Debug, Clone, PartialEq)]
#[non_exhaustive]
pub enum Correction {
    /// 明るさ・コントラスト (type 1).
    BrightnessContrast {
        /// -100..100.
        brightness: i32,
        /// -100..100.
        contrast: i32,
    },
    /// レベル補正 (type 2). Per slot: input black, gamma point, input
    /// white, output black, output white (0..1).
    Levels(Vec<[f64; 5]>),
    /// トーンカーブ (type 3). Per slot: control points (0..1).
    ToneCurve(Vec<Vec<(f64, f64)>>),
    /// 色相・彩度・明度 (type 4).
    HueSaturationValue {
        /// Degrees.
        hue: i32,
        /// -100..100.
        saturation: i32,
        /// -100..100.
        value: i32,
    },
    /// カラーバランス (type 5).
    ColorBalance {
        /// 輝度を保持.
        preserve_luminosity: bool,
        /// R, G, B shift of the shadows (-100..100).
        shadows: [i32; 3],
        /// R, G, B shift of the midtones (-100..100).
        midtones: [i32; 3],
        /// R, G, B shift of the highlights (-100..100).
        highlights: [i32; 3],
    },
    /// 階調の反転 (type 6).
    Invert,
    /// ポスタリゼーション (type 7): the number of levels.
    Posterize(i32),
    /// 2値化 (type 8): the threshold.
    Threshold(i32),
    /// グラデーションマップ (type 9).
    GradientMap(Ramp),
}

fn int(data: &[u8], index: usize) -> Result<i32> {
    data.get(4 * index..4 * index + 4)
        .map(|b| i32::from_be_bytes(b.try_into().expect("4")))
        .ok_or_else(|| Error::format("FilterLayerInfo is cut short"))
}

fn short(data: &[u8], offset: usize) -> Result<f64> {
    data.get(offset..offset + 2)
        .map(|b| u16::from_be_bytes([b[0], b[1]]) as f64 / 65535.0)
        .ok_or_else(|| Error::format("FilterLayerInfo is cut short"))
}

impl Correction {
    /// Parse a `FilterLayerInfo` blob.
    pub fn parse(data: &[u8]) -> Result<Self> {
        let kind = int(data, 0)?;
        let payload = data.get(8..).unwrap_or_default();
        Ok(match kind {
            1 => Correction::BrightnessContrast { brightness: int(payload, 0)?, contrast: int(payload, 1)? },
            2 => Correction::Levels(
                (0..4)
                    .map(|slot| -> Result<[f64; 5]> {
                        let at = slot * 10;
                        Ok([
                            short(payload, at)?,
                            short(payload, at + 2)?,
                            short(payload, at + 4)?,
                            short(payload, at + 6)?,
                            short(payload, at + 8)?,
                        ])
                    })
                    .collect::<Result<_>>()?,
            ),
            3 => Correction::ToneCurve(
                (0..4)
                    .map(|slot| -> Result<Vec<(f64, f64)>> {
                        let at = slot * 130;
                        let count = (short(payload, at)? * 65535.0).round() as usize;
                        (0..count.min(32))
                            .map(|i| Ok((short(payload, at + 2 + 4 * i)?, short(payload, at + 4 + 4 * i)?)))
                            .collect()
                    })
                    .collect::<Result<_>>()?,
            ),
            4 => Correction::HueSaturationValue {
                hue: int(payload, 0)?,
                saturation: int(payload, 1)?,
                value: int(payload, 2)?,
            },
            5 => {
                let v = |i| int(payload, i);
                Correction::ColorBalance {
                    preserve_luminosity: v(0)? != 0,
                    shadows: [v(1)?, v(2)?, v(3)?],
                    midtones: [v(4)?, v(5)?, v(6)?],
                    highlights: [v(7)?, v(8)?, v(9)?],
                }
            }
            6 => Correction::Invert,
            7 => Correction::Posterize(int(payload, 0)?),
            8 => Correction::Threshold(int(payload, 0)?),
            9 => Correction::GradientMap(Ramp::parse(payload)?),
            other => return Err(Error::format(format!("FilterLayerInfo type {other}"))),
        })
    }

    /// True when the result is an approximation: a gradient map in the
    /// 知覚的 mode.
    pub fn is_approximate(&self) -> bool {
        match self {
            Correction::GradientMap(ramp) => ramp.mixing == Mixing::Perceptual,
            _ => false,
        }
    }

    /// Prepare for applying to many pixels.
    pub fn filter(&self) -> Filter<'_> {
        let tables = match self {
            Correction::BrightnessContrast { brightness, contrast } => {
                Some([brightness_contrast(*brightness, *contrast); 3])
            }
            Correction::Levels(slots) => {
                let table = |slot: usize| slots.get(slot).map(|s| levels(*s)).unwrap_or_else(identity);
                Some(compose(table(0), [table(1), table(2), table(3)]))
            }
            Correction::ToneCurve(slots) => {
                let table = |slot: usize| match slots.get(slot) {
                    Some(points) if !points.is_empty() => Spline::new(points).table(),
                    _ => identity(),
                };
                Some(compose(table(0), [table(1), table(2), table(3)]))
            }
            Correction::ColorBalance { preserve_luminosity: false, shadows, midtones, highlights } => {
                Some(std::array::from_fn(|c| balance(shadows[c], midtones[c], highlights[c])))
            }
            Correction::ColorBalance { preserve_luminosity: true, shadows, midtones, highlights } => {
                Some(std::array::from_fn(|c| balance_preserving(c, *shadows, *midtones, *highlights)))
            }
            Correction::Invert => Some([std::array::from_fn(|v| 255.0 - v as f32); 3]),
            Correction::Posterize(levels) => {
                let n = (*levels).max(2) as f32;
                Some([std::array::from_fn(|v| ((v as f32 * n / 256.0).floor() * 255.0 / (n - 1.0)).floor()); 3])
            }
            _ => None,
        };
        Filter { correction: self, tables }
    }
}

/// A [`Correction`] ready to apply: per-channel tables where the
/// correction is one, otherwise the per-pixel rule.
pub struct Filter<'a> {
    correction: &'a Correction,
    tables: Option<[[f32; 256]; 3]>,
}

impl Filter<'_> {
    /// The corrected colour of a straight sRGB colour (0..255 per channel).
    pub fn apply(&self, rgb: [f32; 3]) -> [f32; 3] {
        if let Some(tables) = &self.tables {
            return std::array::from_fn(|c| lookup(&tables[c], rgb[c]));
        }
        let out = match self.correction {
            Correction::HueSaturationValue { hue, saturation, value } => {
                let rgb = rgb.map(|v| v as f64);
                let rgb = value_op(rgb, *value as f64 / 100.0);
                let rgb = hue_op(rgb, *hue as f64);
                saturation_op(rgb, *saturation as f64 / 100.0).map(|v| v as f32)
            }
            Correction::Threshold(t) => {
                let [r, g, b] = rgb.map(|v| v.round().clamp(0.0, 255.0) as i32);
                let y = (306 * r + 601 * g + 117 * b) >> 10;
                [if y >= *t { 255.0 } else { 0.0 }; 3]
            }
            Correction::GradientMap(ramp) => {
                let y = 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2];
                let c = ramp.color((y / 255.0) as f64);
                let a = c[3] as f32;
                std::array::from_fn(|i| c[i] as f32 * 255.0 * a + rgb[i] * (1.0 - a))
            }
            _ => rgb,
        };
        out.map(|v| v.clamp(0.0, 255.0))
    }
}

fn identity() -> [f32; 256] {
    std::array::from_fn(|v| v as f32)
}

fn lookup(table: &[f32; 256], v: f32) -> f32 {
    let v = v.clamp(0.0, 255.0);
    let i = (v.floor() as usize).min(254);
    let f = v - i as f32;
    table[i] + (table[i + 1] - table[i]) * f
}

/// Each channel's own table, then the master's.
fn compose(master: [f32; 256], channels: [[f32; 256]; 3]) -> [[f32; 256]; 3] {
    channels.map(|table| table.map(|v| lookup(&master, v)))
}

/// Measured: contrast scales around 127.5; brightness is added before a
/// contrast increase and after a decrease; contrast 100 is a threshold.
fn brightness_contrast(brightness: i32, contrast: i32) -> [f32; 256] {
    let (b, c) = (brightness as f64, contrast as f64);
    std::array::from_fn(|v| {
        let v = v as f64;
        let out = if c >= 100.0 {
            if v + b > 127.5 { 255.0 } else { 0.0 }
        } else if c > 0.0 {
            (v + b - 127.5) / (1.0 - c / 100.0) + 127.5
        } else {
            (v - 127.5) * (1.0 + c / 100.0) + 127.5 + b
        };
        out.clamp(0.0, 255.0) as f32
    })
}

/// Levels: out = ob + (ow - ob) · t^g with t the input between black and
/// white and g putting the gamma point at one half.
fn levels([black, gamma_point, white, out_black, out_white]: [f64; 5]) -> [f32; 256] {
    let range = (white - black).max(1e-6);
    let middle = ((gamma_point - black) / range).clamp(1e-6, 1.0 - 1e-6);
    let g = 0.5f64.ln() / middle.ln();
    std::array::from_fn(|v| {
        let t = ((v as f64 / 255.0 - black) / range).clamp(0.0, 1.0);
        ((out_black + (out_white - out_black) * t.powf(g)) * 255.0).clamp(0.0, 255.0) as f32
    })
}

/// Colour balance of one channel, as levels: shadows below zero raise the
/// input black, highlights above zero lower the input white, and every
/// setting bends the gamma. The coefficients are fitted to CSP exports at
/// ±30, ±50 and ±100 (`docs/validation/V6b-generated-layers.md`).
fn balance(shadows: i32, midtones: i32, highlights: i32) -> [f32; 256] {
    let (s, m, h) = (shadows as f64, midtones as f64, highlights as f64);
    let (mut log_gamma, mut black, mut white) = (0.0, 0.0, 255.0);
    if s > 0.0 {
        log_gamma -= 0.002_25 * s;
    } else if s < 0.0 {
        log_gamma += 0.0034 * -s + 3.4e-6 * s * s;
        black = -s * (0.99 - 0.000_32 * -s);
    }
    if m > 0.0 {
        log_gamma -= 0.0055 * m;
    } else if m < 0.0 {
        log_gamma += 0.004_66 * -m + 1.88e-5 * m * m;
    }
    if h > 0.0 {
        log_gamma -= 0.003_31 * h;
        white = 255.0 - 0.9575 * h;
    } else if h < 0.0 {
        log_gamma += 0.0024 * -h;
    }
    let gamma = log_gamma.exp();
    std::array::from_fn(|v| {
        let t = ((v as f64 - black) / (white - black)).clamp(0.0, 1.0);
        (255.0 * t.powf(gamma)) as f32
    })
}

/// Colour balance with "preserve luminosity", for channel `c`: still one
/// table per channel, but a shift toward a colour moves the other
/// channels the opposite way. Shadows raise a channel's black point by
/// its own negative amount plus the other channels' positive amounts;
/// highlights lower its white point by its own positive amount plus the
/// others' negative amounts; midtones set a gamma from the channel's
/// amount less the mean of all three.
fn balance_preserving(c: usize, shadows: [i32; 3], midtones: [i32; 3], highlights: [i32; 3]) -> [f32; 256] {
    let others = |values: [i32; 3], own: fn(i32) -> i32, other: fn(i32) -> i32| -> f64 {
        (0..3).map(|i| if i == c { own(values[i]) } else { other(values[i]) }).sum::<i32>() as f64
    };
    let black = others(shadows, |v| (-v).max(0), |v| v.max(0)).min(254.0);
    let white = (255.0 - others(highlights, |v| v.max(0), |v| (-v).max(0))).max(black + 1.0);
    let mean = midtones.iter().sum::<i32>() as f64 / 3.0;
    let gamma = (-0.0064 * (midtones[c] as f64 - mean)).exp();
    std::array::from_fn(|v| {
        let t = ((v as f64 - black) / (white - black)).clamp(0.0, 1.0);
        (255.0 * t.powf(gamma)) as f32
    })
}

fn max3(c: [f64; 3]) -> f64 {
    c[0].max(c[1]).max(c[2])
}

fn min3(c: [f64; 3]) -> f64 {
    c[0].min(c[1]).min(c[2])
}

/// 明度: below zero every channel scales down; above zero the HSV value
/// moves toward 255 and the HSV saturation shrinks by the same amount.
fn value_op(c: [f64; 3], t: f64) -> [f64; 3] {
    if t <= 0.0 {
        return c.map(|v| v * (1.0 + t));
    }
    let max = max3(c);
    let new_max = max + (255.0 - max) * t;
    c.map(|v| {
        let below = if max > 0.0 { (max - v) / max } else { 0.0 };
        new_max - below * (1.0 - t) * new_max
    })
}

/// 色相: rotation of the HSL hue, keeping HSL saturation and lightness.
fn hue_op(c: [f64; 3], degrees: f64) -> [f64; 3] {
    if degrees == 0.0 {
        return c;
    }
    let (max, min) = (max3(c), min3(c));
    let chroma = max - min;
    if chroma <= 0.0 {
        return c;
    }
    let [r, g, b] = c;
    let sector = if max == r {
        ((g - b) / chroma).rem_euclid(6.0)
    } else if max == g {
        (b - r) / chroma + 2.0
    } else {
        (r - g) / chroma + 4.0
    };
    let h = (sector + degrees / 60.0).rem_euclid(6.0);
    let x = chroma * (1.0 - (h % 2.0 - 1.0).abs());
    let (r, g, b) = match h as u32 {
        0 => (chroma, x, 0.0),
        1 => (x, chroma, 0.0),
        2 => (0.0, chroma, x),
        3 => (0.0, x, chroma),
        4 => (x, 0.0, chroma),
        _ => (chroma, 0.0, x),
    };
    [r + min, g + min, b + min]
}

/// 彩度. Below zero: HSV saturation × (1 + t), then all channels × (1 +
/// t·s/2). Above zero: HSV saturation s + (1 - s)·u and value × (1 + u)
/// with u = t·(1 - s), u limited so the value stays within 255; greys
/// stay grey.
fn saturation_op(c: [f64; 3], t: f64) -> [f64; 3] {
    let (max, min) = (max3(c), min3(c));
    let chroma = max - min;
    if t == 0.0 || chroma <= 0.0 || max <= 0.0 {
        return c;
    }
    let s = chroma / max;
    if t < 0.0 {
        let scale = 1.0 + t * s / 2.0;
        return c.map(|v| (max - (max - v) * (1.0 + t)) * scale);
    }
    let room = if s < 1.0 { (255.0 / max - 1.0) / (1.0 - s) } else { f64::INFINITY };
    let u = t.min(room) * (1.0 - s);
    let (new_max, new_s) = (max * (1.0 + u), s + u);
    let new_min = new_max * (1.0 - new_s);
    c.map(|v| new_min + (v - min) / chroma * (new_max - new_min))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn blob(kind: i32, ints: &[i32]) -> Vec<u8> {
        let mut data = kind.to_be_bytes().to_vec();
        data.extend(((ints.len() * 4) as u32).to_be_bytes());
        for v in ints {
            data.extend(v.to_be_bytes());
        }
        data
    }

    fn apply(kind: i32, ints: &[i32], rgb: [f32; 3]) -> [f32; 3] {
        let correction = Correction::parse(&blob(kind, ints)).unwrap();
        correction.filter().apply(rgb).map(|v| v.round())
    }

    /// Within one level of CSP (its own rounding differs from ours).
    fn near(kind: i32, ints: &[i32], rgb: [f32; 3], csp: [f32; 3]) {
        let ours = apply(kind, ints, rgb);
        assert!(ours.iter().zip(csp).all(|(a, b)| (a - b).abs() <= 1.0), "{ours:?} vs CSP {csp:?}");
    }

    // Expected values are CSP exports of the generated test files.

    #[test]
    fn invert_posterize_threshold() {
        assert_eq!(apply(6, &[], [0.0, 100.0, 255.0]), [255.0, 155.0, 0.0]);
        assert_eq!(apply(7, &[4], [63.0, 64.0, 255.0]), [0.0, 85.0, 255.0]);
        assert_eq!(apply(8, &[128], [128.0, 128.0, 128.0]), [255.0; 3]);
    }

    #[test]
    fn brightness_contrast_rule() {
        // bc4 (-20, 40): grey 127 → 93.
        near(1, &[-20, 40], [127.0; 3], [93.0; 3]);
        // contrast 100 is a threshold at 127.5 - brightness.
        assert_eq!(apply(1, &[-18, 100], [145.0, 146.0, 0.0]), [0.0, 255.0, 0.0]);
    }

    #[test]
    fn hue_saturation_value_rules() {
        // Value -30 scales; +30 on (55, 6, 6) gives (114, 42, 42).
        assert_eq!(apply(4, &[0, 0, -30], [100.0, 50.0, 0.0]), [70.0, 35.0, 0.0]);
        near(4, &[0, 0, 30], [55.0, 6.0, 6.0], [114.0, 42.0, 42.0]);
        // Saturation -50 on (55, 6, 6) gives (43, 23, 23); +50 on (128, 96, 64) gives (160, 100, 40).
        near(4, &[0, -50, 0], [55.0, 6.0, 6.0], [43.0, 23.0, 23.0]);
        near(4, &[0, 50, 0], [128.0, 96.0, 64.0], [160.0, 100.0, 40.0]);
        // Saturation stops where the value reaches 255.
        assert_eq!(apply(4, &[0, 100, 0], [250.0, 233.0, 217.0])[2], 216.0);
        // Hue +120 turns red green.
        assert_eq!(apply(4, &[120, 0, 0], [200.0, 0.0, 0.0]), [0.0, 200.0, 0.0]);
        assert_eq!(apply(4, &[0, 100, 0], [90.0; 3]), [90.0; 3]);
    }

    #[test]
    fn colour_balance_fit() {
        // Red shadows -100: input black near 96; midtones +100: 128 → 172.
        let shadows = apply(5, &[0, -100, 0, 0, 0, 0, 0, 0, 0, 0], [96.0, 96.0, 96.0]);
        assert_eq!(shadows, [0.0, 96.0, 96.0]);
        near(5, &[0, 0, 0, 0, 100, 0, 0, 0, 0, 0], [128.0; 3], [172.0, 128.0, 128.0]);
    }

    #[test]
    fn colour_balance_preserving_luminosity() {
        // CSP at 128: red midtones +50, red shadows -50, red highlights +50,
        // red shadows +50 (the other channels' black point moves).
        near(5, &[1, 0, 0, 0, 50, 0, 0, 0, 0, 0], [128.0; 3], [146.0, 118.0, 118.0]);
        near(5, &[1, -50, 0, 0, 0, 0, 0, 0, 0, 0], [128.0; 3], [97.0, 128.0, 128.0]);
        near(5, &[1, 0, 0, 0, 0, 0, 0, 50, 0, 0], [128.0; 3], [159.0, 128.0, 128.0]);
        near(5, &[1, 50, 0, 0, 0, 0, 0, 0, 0, 0], [128.0; 3], [128.0, 97.0, 97.0]);
    }

    #[test]
    fn tone_curve_channel_then_master() {
        let mut payload = Vec::new();
        let slots: [&[(u16, u16)]; 2] =
            [&[(0, 0), (0x8000, 0x4000), (0xffff, 0xffff)], &[(0, 0x4000), (0xffff, 0xffff)]];
        for slot in 0..32 {
            let points: &[(u16, u16)] = slots.get(slot).copied().unwrap_or(&[(0, 0), (0xffff, 0xffff)]);
            payload.extend((points.len() as u16).to_be_bytes());
            for i in 0..32 {
                let (x, y) = points.get(i).copied().unwrap_or((0, 0));
                payload.extend(x.to_be_bytes());
                payload.extend(y.to_be_bytes());
            }
        }
        let mut data = 3i32.to_be_bytes().to_vec();
        data.extend((payload.len() as u32).to_be_bytes());
        data.extend(payload);
        let correction = Correction::parse(&data).unwrap();
        let out = correction.filter().apply([0.0, 128.0, 255.0]);
        // Red: 0 → 64 by its own curve, then the master y = (x + x²)/2 → 40.
        assert!((out[0] - 40.0).abs() < 1.0, "{out:?}");
        assert!((out[1] - 96.0).abs() < 1.0 && out[2] > 254.0, "{out:?}");
    }
}
