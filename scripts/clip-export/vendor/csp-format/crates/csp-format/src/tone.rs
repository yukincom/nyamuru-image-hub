//! The tone layer effect (トーン, section `EffectTone` of
//! `Layer.LayerEffectInfo`): the layer drawn as a black-and-white
//! halftone screen.
//!
//! The 76-byte section is big endian:
//!
//! ```text
//! +0  u32  on (1) / off (0)
//! +4  f64  resolution the line count refers to (the canvas's in the corpus)
//! +12 u32  dot shape: 1 round, 2 square, 4 lines (others not decoded)
//! +16 u32  density: 0 from the image, 2 fixed (+20)
//! +20 u32  fixed density in percent
//! +24 f64  lines per inch
//! +32 u32  1 (meaning unknown)
//! +40 u32  angle in degrees
//! +44 u32  30, 10, 100 (no visible effect at 100 instead of 30)
//! +52 i32  ×2: 0 in most layers; other values change the dots (not decoded)
//! ```
//!
//! Measured against CSP's exports of two files made for it
//! (`docs/validation/V6-made-files.md`; 98–99.9 % of the pixels agree
//! for the decoded settings):
//!
//! - The screen is a lattice anchored at the canvas origin. Its cell
//!   vectors are the period (resolution / lines) along the angle (y down),
//!   each coordinate rounded to whole pixels: 30 px at 45° gives (21, 21),
//!   at 30° (26, 15). A dot is centred in every cell; the cell corners are
//!   where the holes of dark areas are.
//! - Each pixel is compared, at its top-left corner, with the threshold
//!   of its place in the cell: the share of the cell that is covered
//!   before that place. Round dots grow as circles and turn into round
//!   holes past half (the PostScript "round" spot function); square dots
//!   grow as squares; lines grow across the second cell vector.
//! - The result is two-valued. With density from the image, a pixel is
//!   drawn where its alpha is above the threshold: black where its
//!   darkness × alpha is too, white otherwise. The darkness is
//!   1 − (0.114 R + 0.299 G + 0.587 B): the BT.601 weights, but on the
//!   channels in another order (flat red, green, blue and yellow measured).
//!   With a fixed density, the dots are circles (no holes past half),
//!   black, and drawn wherever the layer has pixels; the rest is
//!   transparent.

use crate::binary::{be_f64_at, be_u32_at};
use crate::image::RgbaImage;

/// Settings of a switched-on tone effect.
#[derive(Debug, Clone, Copy, PartialEq, serde::Serialize)]
pub struct Tone {
    /// Lines per inch.
    pub lines: f64,
    /// The resolution `lines` refers to (dpi).
    pub resolution: f64,
    /// Screen angle in degrees.
    pub angle: f64,
    /// Dot shape: 1 round, 2 square, 4 lines.
    pub shape: u32,
    /// Where the density comes from: 0 the image, 2 `density`.
    pub mode: u32,
    /// The fixed density, 0..1.
    pub density: f64,
    /// Words 13 and 14, not decoded (0 in most layers).
    pub unknown: (u32, u32),
}

/// Dot shapes whose drawing was measured.
const ROUND: u32 = 1;
const SQUARE: u32 = 2;
const LINES: u32 = 4;
/// Density modes.
const FROM_IMAGE: u32 = 0;
const FIXED: u32 = 2;

impl Tone {
    /// The settings when the section switches the tone on.
    pub fn parse(section: &[u8]) -> Option<Tone> {
        if section.len() < 60 || be_u32_at(section, 0) == 0 {
            return None;
        }
        let tone = Tone {
            resolution: be_f64_at(section, 4),
            shape: be_u32_at(section, 12),
            mode: be_u32_at(section, 16),
            density: be_u32_at(section, 20) as f64 / 100.0,
            lines: be_f64_at(section, 24),
            angle: be_u32_at(section, 40) as f64,
            unknown: (be_u32_at(section, 52), be_u32_at(section, 56)),
        };
        (tone.lines > 0.0 && tone.resolution > 0.0 && tone.resolution / tone.lines >= 1.0).then_some(tone)
    }

    /// Whether the drawing of these settings is not known exactly: other
    /// shapes are drawn as round dots, other modes take the density from
    /// the image, and lines matched only at 0° (96 %).
    pub fn is_approximate(&self) -> bool {
        !matches!(self.shape, ROUND | SQUARE) || !matches!(self.mode, FROM_IMAGE | FIXED) || self.unknown != (0, 0)
    }

    /// The cell vectors in pixels.
    fn lattice(&self) -> [(f64, f64); 2] {
        let period = self.resolution / self.lines;
        let (sin, cos) = self.angle.to_radians().sin_cos();
        let a = ((period * cos).round(), (period * sin).round());
        // A cell needs two independent vectors of at least a pixel.
        let a = if a.0 == 0.0 && a.1 == 0.0 { (1.0, 0.0) } else { a };
        [a, (-a.1, a.0)]
    }

    /// Draw `image` (top-left at canvas `origin`, full size) as the tone.
    pub fn draw(&self, image: &RgbaImage, origin: (i64, i64)) -> RgbaImage {
        let [a, b] = self.lattice();
        let det = a.0 * b.1 - a.1 * b.0;
        // Canvas point → cell coordinates (s, r).
        let inverse = [b.1 / det, -b.0 / det, -a.1 / det, a.0 / det];
        let fixed = self.mode == FIXED;
        let shape = match self.shape {
            _ if fixed => Shape::Circle,
            SQUARE => Shape::Square,
            LINES => Shape::Lines,
            _ => Shape::Round,
        };
        let table = Thresholds::new(shape);
        let mut out = RgbaImage::new(image.width, image.height);
        for y in 0..image.height {
            let cy = (origin.1 + y as i64) as f64;
            for x in 0..image.width {
                let p = image.pixel(x, y);
                if p[3] == 0 {
                    continue;
                }
                let cx = (origin.0 + x as i64) as f64;
                let s = inverse[0] * cx + inverse[1] * cy;
                let r = inverse[2] * cx + inverse[3] * cy;
                let t = table.at(s - s.floor(), r - r.floor());
                let pixel = if fixed {
                    (self.density > t).then_some([0, 0, 0, 255])
                } else if p[3] as f64 / 255.0 > t {
                    let alpha = p[3] as f64 / 255.0;
                    let light = (0.114 * p[0] as f64 + 0.299 * p[1] as f64 + 0.587 * p[2] as f64) / 255.0;
                    Some(if (1.0 - light) * alpha > t { [0, 0, 0, 255] } else { [255, 255, 255, 255] })
                } else {
                    None
                };
                if let Some(pixel) = pixel {
                    out.set_pixel(x, y, pixel);
                }
            }
        }
        out
    }
}

#[derive(Clone, Copy)]
enum Shape {
    Round,
    Square,
    Lines,
    Circle,
}

/// Thresholds over a cell sampled on a fine grid: the share of the cell
/// whose spot value is above the value at each place.
struct Thresholds {
    values: Vec<f32>,
}

const GRID: usize = 256;

impl Thresholds {
    fn new(shape: Shape) -> Self {
        let spot = |s: f64, r: f64| -> f64 {
            // u, v in -1..1 with the dot's centre at 0.
            let (u, v) = ((2.0 * s - 1.0).abs(), (2.0 * r - 1.0).abs());
            match shape {
                Shape::Round if u + v <= 1.0 => 1.0 - (u * u + v * v) / 2.0,
                Shape::Round => ((u - 1.0).powi(2) + (v - 1.0).powi(2)) / 2.0,
                Shape::Square => -u.max(v),
                Shape::Lines => -v,
                Shape::Circle => -(u * u + v * v),
            }
        };
        let centre = |i: usize| (i as f64 + 0.5) / GRID as f64;
        let spots: Vec<f64> = (0..GRID * GRID).map(|i| spot(centre(i % GRID), centre(i / GRID))).collect();
        let mut order: Vec<usize> = (0..spots.len()).collect();
        order.sort_by(|&i, &j| spots[j].total_cmp(&spots[i]));
        let mut values = vec![0f32; spots.len()];
        let count = spots.len() as f32;
        // Places with equal spot values share the threshold of the first.
        let mut start = 0;
        while start < order.len() {
            let mut end = start + 1;
            while end < order.len() && spots[order[end]] == spots[order[start]] {
                end += 1;
            }
            for &i in &order[start..end] {
                values[i] = start as f32 / count;
            }
            start = end;
        }
        Thresholds { values }
    }

    /// The threshold at cell coordinates (s, r) in 0..1.
    fn at(&self, s: f64, r: f64) -> f64 {
        let i = ((s * GRID as f64) as usize).min(GRID - 1);
        let j = ((r * GRID as f64) as usize).min(GRID - 1);
        self.values[j * GRID + i] as f64
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn section(lines: f64, angle: u32, shape: u32, mode: u32, density: u32) -> Vec<u8> {
        let mut out = Vec::new();
        out.extend_from_slice(&1u32.to_be_bytes());
        out.extend_from_slice(&600f64.to_be_bytes());
        for word in [shape, mode, density] {
            out.extend_from_slice(&word.to_be_bytes());
        }
        out.extend_from_slice(&lines.to_be_bytes());
        for word in [1, 0, angle, 30, 0, 0, 0, 0, 0, 0, 0] {
            out.extend_from_slice(&u32::to_be_bytes(word));
        }
        out
    }

    fn coverage(image: &RgbaImage) -> f64 {
        let black = image.pixels.as_chunks::<4>().0.iter().filter(|p| p[0] == 0 && p[3] == 255).count();
        black as f64 / (image.width * image.height) as f64
    }

    #[test]
    fn grey_becomes_dots_of_its_darkness() {
        let tone = Tone::parse(&section(20.0, 45, 1, 0, 20)).unwrap();
        assert_eq!(tone.lattice(), [(21.0, 21.0), (-21.0, 21.0)]);
        let mut image = RgbaImage::new(84, 84);
        image.fill([191, 191, 191, 255]);
        let drawn = tone.draw(&image, (0, 0));
        assert!((coverage(&drawn) - 0.25).abs() < 0.02, "{}", coverage(&drawn));
        // A dot is centred in the cell (0, 21) and the corner (0, 0) is white.
        assert_eq!(drawn.pixel(0, 21), [0, 0, 0, 255]);
        assert_eq!(drawn.pixel(0, 0), [255, 255, 255, 255]);
    }

    #[test]
    fn darkness_is_weighted_by_alpha_and_the_rest_is_white_or_transparent() {
        let tone = Tone::parse(&section(60.0, 45, 1, 0, 20)).unwrap();
        let mut image = RgbaImage::new(70, 70);
        // Grey 128 at alpha 0.6: drawn on 60 %, black on about 30 %.
        image.fill([128, 128, 128, 153]);
        let drawn = tone.draw(&image, (0, 0));
        let white = drawn.pixels.as_chunks::<4>().0.iter().filter(|p| **p == [255, 255, 255, 255]).count();
        assert!((coverage(&drawn) - 0.3).abs() < 0.03, "{}", coverage(&drawn));
        assert!((white as f64 / 4900.0 - 0.3).abs() < 0.03);
        // Pure red is dark: its weight is 0.114.
        image.fill([255, 0, 0, 255]);
        assert!((coverage(&tone.draw(&image, (0, 0))) - 0.886).abs() < 0.03);
    }

    #[test]
    fn fixed_density_ignores_the_colour_and_leaves_the_rest_transparent() {
        let tone = Tone::parse(&section(20.0, 0, 1, 2, 30)).unwrap();
        let mut image = RgbaImage::new(60, 60);
        image.fill([255, 255, 255, 40]);
        let drawn = tone.draw(&image, (0, 0));
        assert!((coverage(&drawn) - 0.3).abs() < 0.02);
        assert_eq!(drawn.pixel(0, 0)[3], 0);
        assert_eq!(drawn.pixel(15, 15), [0, 0, 0, 255]);
    }

    #[test]
    fn switched_off_tone_is_none() {
        let mut data = section(20.0, 45, 1, 0, 20);
        data[3] = 0;
        assert!(Tone::parse(&data).is_none());
    }
}
