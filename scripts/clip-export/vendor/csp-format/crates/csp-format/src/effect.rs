//! Layer effects (`Layer.LayerEffectInfo`): border (フチ), tone, watercolour
//! edge, line extraction and their options, and the border drawing.
//!
//! The blob is big endian: the total size (`u32`), a version (`u32`, 2),
//! then named sections. A name is a `u32` count of UTF-16BE units and the
//! units. `EffectEdge` and `EffectTone`, the oldest two, have fixed sizes;
//! every later section starts with its size (`u32`, counting itself).
//! `LayerEffectAttached` = 1 switches the effects on; the blob keeps the
//! settings of switched-off effects too.
//!
//! The border was measured against CSP's own export of a file made for it
//! (`docs/validation/V6-made-files.md`): within 2/255 for widths 0.5–20,
//! any colour, hard and soft edges, with and without
//! `LayerEffectEdgeNewRender`.

use crate::binary::{Reader, Writer};
use crate::error::{Error, Result, bail};
use crate::image::RgbaImage;

/// Sizes of the sections that have no size field.
const FIXED_SECTIONS: [(&str, usize); 2] = [("EffectEdge", 24), ("EffectTone", 76)];

/// A parsed `LayerEffectInfo` blob; sections in file order.
#[derive(Debug, Clone, PartialEq)]
pub struct LayerEffects {
    /// Format version (2).
    pub version: u32,
    /// (name, bytes) of each section, in stored order; the bytes follow the name.
    pub sections: Vec<(String, Vec<u8>)>,
}

/// The border effect (フチ).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Border {
    /// The border is on.
    pub enabled: bool,
    /// Width in canvas pixels.
    pub width: f64,
    /// Colour as 8-bit RGB.
    pub color: [u8; 3],
}

impl LayerEffects {
    /// Parses a `LayerEffectInfo` blob.
    pub fn parse(data: &[u8]) -> Result<Self> {
        let mut reader = Reader::new(data);
        let total = reader.be_u32()? as usize;
        if total != data.len() {
            bail!("LayerEffectInfo says {total} bytes, has {}", data.len());
        }
        let version = reader.be_u32()?;
        let mut sections = Vec::new();
        while !reader.is_empty() {
            let name = reader.utf16_name()?;
            let size = match FIXED_SECTIONS.iter().find(|(fixed, _)| *fixed == name) {
                Some((_, size)) => *size,
                None => {
                    let size = Reader::at(data, reader.position()).be_u32()? as usize;
                    if size < 4 {
                        bail!("Effect section {name} has size {size}");
                    }
                    size
                }
            };
            let start = reader.position();
            reader.skip(size)?;
            // Newer CSP versions append fields after a section's stated size
            // (EffectLine: 116 stated, 136 stored); they belong to the
            // section, up to the next name.
            while !reader.is_empty() && !is_section_name(data, reader.position()) {
                reader.skip(1)?;
            }
            sections.push((name, data[start..reader.position()].to_vec()));
        }
        Ok(LayerEffects { version, sections })
    }

    /// The blob; unchanged sections give the same bytes.
    pub fn to_bytes(&self) -> Vec<u8> {
        let mut body = Writer::new();
        body.be_u32(self.version);
        for (name, payload) in &self.sections {
            let units: Vec<u16> = name.encode_utf16().collect();
            body.be_u32(units.len() as u32);
            for unit in units {
                body.be_u16(unit);
            }
            body.bytes(payload);
        }
        let mut out = Writer::new();
        out.be_u32(body.len() as u32 + 4).bytes(&body.data);
        out.data
    }

    /// The bytes of a section.
    pub fn section(&self, name: &str) -> Option<&[u8]> {
        self.sections.iter().find(|(n, _)| n == name).map(|(_, payload)| payload.as_slice())
    }

    /// The bytes of a section, mutably.
    pub fn section_mut(&mut self, name: &str) -> Option<&mut Vec<u8>> {
        self.sections.iter_mut().find(|(n, _)| n == name).map(|(_, payload)| payload)
    }

    /// The border settings (`EffectEdge`): on/off (`u32`), width (`f64`),
    /// colour as three `u32` whose top byte is the 8-bit value.
    pub fn border(&self) -> Option<Border> {
        let mut reader = Reader::new(self.section("EffectEdge")?);
        let enabled = reader.be_u32().ok()? != 0;
        let width = reader.be_f64().ok()?;
        let mut color = [0u8; 3];
        for c in &mut color {
            *c = (reader.be_u32().ok()? >> 24) as u8;
        }
        Some(Border { enabled, width, color })
    }

    /// Writes the border settings into `EffectEdge` (keeping its other bytes). Fails when the blob has no such section.
    pub fn set_border(&mut self, border: Border) -> Result<()> {
        let payload = self.section_mut("EffectEdge").ok_or_else(|| Error::format("No EffectEdge section"))?;
        let mut writer = Writer::new();
        writer.be_u32(border.enabled as u32).be_f64(border.width);
        for c in border.color {
            writer.be_u32(u32::from_be_bytes([c; 4]));
        }
        payload.splice(0..writer.len(), writer.data);
        Ok(())
    }

    /// 描画の透明度を反映 (`EffectApplyOpacity`): the border follows the
    /// layer's alpha. Defaults to on when the section is missing.
    pub fn apply_opacity(&self) -> bool {
        self.section("EffectApplyOpacity").and_then(|s| Reader::at(s, 4).be_u32().ok()).is_none_or(|v| v != 0)
    }

    /// Names of the switched-on effects among the ones with an on/off flag.
    pub fn enabled(&self) -> Vec<&str> {
        let mut names = Vec::new();
        if self.border().is_some_and(|border| border.enabled) {
            names.push("EffectEdge");
        }
        let flag = |name: &str, at: usize| self.section(name).and_then(|s| Reader::at(s, at).be_u32().ok());
        for (name, at) in [("EffectTone", 0), ("EffectWaterEdge", 4), ("EffectLine", 4), ("EffectTonePosterize", 4)] {
            if flag(name, at).is_some_and(|v| v != 0) {
                names.push(name);
            }
        }
        names
    }
}

/// Whether a section name ("Effect…") starts at `position`.
fn is_section_name(data: &[u8], position: usize) -> bool {
    let mut reader = Reader::at(data, position);
    let Ok(count) = reader.be_u32() else { return false };
    (6..=64).contains(&count) && reader.bytes(12).is_ok_and(|units| units.chunks(2).map(|u| u[1]).eq(*b"Effect"))
}

/// Draw a border around `image` (straight alpha, 8 bit). The result is
/// larger by the border's reach on every side; the second value is that
/// margin, to move the image's origin by.
///
/// The border's alpha at a pixel is the largest `a(q) · k(|p − q|)` over
/// the layer's pixels q, with `k(d) = clamp(width + 1.5 − d, 0, 1)` (pixel
/// centres; `a` binarised when the border ignores the layer's alpha).
/// The layer is drawn over its border, and the border only fills the
/// alpha up to that value: the result's alpha is `max(a, border)`.
pub fn draw_border(image: &RgbaImage, border: &Border, apply_opacity: bool) -> (RgbaImage, u32) {
    let margin = (border.width + 1.5).ceil().max(0.0) as u32;
    let (w, h) = (image.width + 2 * margin, image.height + 2 * margin);
    let mut alpha = vec![0f32; (w * h) as usize];
    for y in 0..image.height {
        for x in 0..image.width {
            let a = image.pixel(x, y)[3];
            let a = if apply_opacity { a as f32 / 255.0 } else { (a > 0) as u8 as f32 };
            alpha[((y + margin) * w + x + margin) as usize] = a;
        }
    }
    let dilated = dilate(&alpha, w as usize, h as usize, border.width);
    let mut out = RgbaImage::new(w, h);
    let color = border.color.map(|c| c as f32);
    for y in 0..h {
        for x in 0..w {
            let i = (y * w + x) as usize;
            let inside = x >= margin && y >= margin && x < image.width + margin && y < image.height + margin;
            let p = if inside { image.pixel(x - margin, y - margin) } else { [0; 4] };
            let a = p[3] as f32 / 255.0;
            let total = dilated[i].max(a);
            if total <= 0.0 {
                continue;
            }
            let edge = total - a;
            let rgb = [0, 1, 2].map(|c| ((p[c] as f32 * a + color[c] * edge) / total).round().clamp(0.0, 255.0) as u8);
            out.set_pixel(x, y, [rgb[0], rgb[1], rgb[2], (total * 255.0).round() as u8]);
        }
    }
    (out, margin)
}

/// `max_q a(q) · clamp(width + 1.5 − |p − q|, 0, 1)` for every pixel p.
/// Per row offset dy: a running maximum over the chord where the weight is
/// 1 (van Herk / Gil-Werman, constant time per pixel), plus the few
/// pixels at the chord's ends where the weight falls from 1 to 0.
fn dilate(alpha: &[f32], w: usize, h: usize, width: f64) -> Vec<f32> {
    let mut out = vec![0f32; w * h];
    let (full, zero) = (width + 0.5, width + 1.5);
    let reach = zero.ceil() as i64;
    // Rows that have any alpha.
    let used: Vec<bool> = (0..h).map(|y| alpha[y * w..(y + 1) * w].iter().any(|&a| a > 0.0)).collect();
    let mut running = vec![0f32; w];
    for dy in -reach..=reach {
        let dyf = dy as f64;
        let chord = if full > dyf.abs() { Some((full * full - dyf * dyf).sqrt().floor() as usize) } else { None };
        let mut ramp = Vec::new();
        for dx in -reach..=reach {
            let d = (dx as f64).hypot(dyf);
            let k = (zero - d).clamp(0.0, 1.0);
            let in_chord = chord.is_some_and(|c| dx.unsigned_abs() as usize <= c);
            if k > 0.0 && !in_chord {
                ramp.push((dx, k as f32));
            }
        }
        for y in 0..h as i64 {
            let source = y + dy;
            if source < 0 || source >= h as i64 || !used[source as usize] {
                continue;
            }
            let row = &alpha[source as usize * w..(source as usize + 1) * w];
            let target = &mut out[y as usize * w..(y as usize + 1) * w];
            if let Some(half) = chord {
                running_max(row, half, &mut running);
                for (t, r) in target.iter_mut().zip(&running) {
                    *t = t.max(*r);
                }
            }
            for &(dx, k) in &ramp {
                for x in 0..w as i64 {
                    let sx = x + dx;
                    if sx >= 0 && sx < w as i64 {
                        let v = row[sx as usize] * k;
                        if v > target[x as usize] {
                            target[x as usize] = v;
                        }
                    }
                }
            }
        }
    }
    out
}

/// `out[x] = max(row[x − half ..= x + half])` (clipped to the row).
fn running_max(row: &[f32], half: usize, out: &mut [f32]) {
    let n = row.len();
    let size = 2 * half + 1;
    // Prefix maxima within blocks (left to right) and suffix maxima (right to left).
    let mut prefix = vec![0f32; n];
    let mut suffix = vec![0f32; n];
    for i in 0..n {
        prefix[i] = if i % size == 0 { row[i] } else { prefix[i - 1].max(row[i]) };
    }
    for i in (0..n).rev() {
        suffix[i] = if i % size == size - 1 || i == n - 1 { row[i] } else { suffix[i + 1].max(row[i]) };
    }
    for (x, o) in out.iter_mut().enumerate() {
        let lo = x.saturating_sub(half);
        let hi = (x + half).min(n - 1);
        // [lo, hi] spans at most two blocks: suffix of the first, prefix of the second.
        *o = if lo / size == hi / size {
            row[lo..=hi].iter().copied().fold(0.0, f32::max)
        } else {
            suffix[lo].max(prefix[hi])
        };
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample() -> Vec<u8> {
        let mut effects = LayerEffects { version: 2, sections: Vec::new() };
        let mut edge = Writer::new();
        edge.be_u32(1).be_f64(5.0).be_u32(0xffff_ffff).be_u32(0).be_u32(0x8080_8080);
        effects.sections.push(("EffectEdge".into(), edge.data));
        effects.sections.push(("EffectTone".into(), vec![0; 76]));
        effects.sections.push(("EffectApplyOpacity".into(), vec![0, 0, 0, 8, 0, 0, 0, 1]));
        // A section with fields after its stated size (as EffectLine in CSP 3+).
        effects.sections.push(("EffectLine".into(), vec![0, 0, 0, 8, 0, 0, 0, 0, 0, 0, 0, 1]));
        effects.to_bytes()
    }

    #[test]
    fn parses_and_round_trips() {
        let data = sample();
        let effects = LayerEffects::parse(&data).unwrap();
        assert_eq!(effects.to_bytes(), data);
        assert_eq!(effects.border(), Some(Border { enabled: true, width: 5.0, color: [255, 0, 128] }));
        assert!(effects.apply_opacity());
        assert_eq!(effects.enabled(), ["EffectEdge"]);
        let mut changed = effects.clone();
        changed.set_border(Border { enabled: false, width: 2.5, color: [1, 2, 3] }).unwrap();
        assert_eq!(LayerEffects::parse(&changed.to_bytes()).unwrap().border().unwrap().width, 2.5);
        assert!(LayerEffects::parse(&data[..data.len() - 1]).is_err());
    }

    #[test]
    fn border_matches_the_measured_profile() {
        // One opaque pixel; width 3: full up to 3.5 px, half at 4 px, none from 4.5 px.
        let mut image = RgbaImage::new(1, 1);
        image.set_pixel(0, 0, [10, 20, 30, 255]);
        let border = Border { enabled: true, width: 3.0, color: [0, 0, 0] };
        let (out, margin) = draw_border(&image, &border, true);
        assert_eq!(margin, 5);
        let alpha = |dx: u32, dy: u32| out.pixel(margin + dx, margin + dy)[3];
        assert_eq!(out.pixel(margin, margin), [10, 20, 30, 255]);
        assert_eq!(alpha(3, 0), 255);
        assert_eq!(alpha(2, 2), 255); // 2.83
        assert_eq!(alpha(4, 0), 128); // 4.0 → 0.5
        assert_eq!(alpha(3, 3), 66); // 4.24 → 0.26
        assert_eq!(alpha(5, 0), 0);
        assert_eq!(out.pixel(margin + 4, margin), [0, 0, 0, 128]);
    }

    #[test]
    fn running_max_matches_brute_force() {
        let row: Vec<f32> = (0..37).map(|i| ((i * 7919) % 31) as f32).collect();
        for half in 0..8 {
            let mut out = vec![0.0; row.len()];
            running_max(&row, half, &mut out);
            for (x, value) in out.iter().enumerate() {
                let lo = x.saturating_sub(half);
                let hi = (x + half).min(row.len() - 1);
                assert_eq!(*value, row[lo..=hi].iter().copied().fold(0.0, f32::max), "half {half} x {x}");
            }
        }
    }
}
