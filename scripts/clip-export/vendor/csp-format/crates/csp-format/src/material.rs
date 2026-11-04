//! Image material layers (画像素材レイヤー, R10): CSP keeps the original
//! image (`Layer.ResizableOriginalMipmap`) and its placement
//! (`Layer.ResizableImageInfo`), and draws the transformed image when it
//! opens the file; the render mipmap is often not stored.
//!
//! `ResizableImageInfo` (big endian, 184 bytes in the corpus):
//!
//! ```text
//! +0   u32 120, 16, 4, 0, 1, 3, 2, 2 (meaning unknown)
//! +32  u32 original width, height (pixels)
//! +40  f64 scale x, scale y
//! +56  f64 0 (rotation, unconfirmed)
//! +64  f64 centre x, y (layer pixels)
//! +80  f64 pivot x, y in the original (half its size)
//! +96  u32 3, 1, 0, 1, 0, 1 (meaning unknown)
//! +120 f64 × 8: where the original's corners go, (0, 0), (w, 0), (0, h),
//!      (w, h), in layer pixels (add `LayerOffsetX/Y` for the canvas)
//! ```
//!
//! The corners define the transform, so scaling, rotation, flips and free
//! (perspective) transforms are all drawn the same way: each output pixel
//! is mapped back into the original with the homography of the four
//! corners and sampled bilinearly (the edge is hard: outside the image
//! is transparent).

use crate::binary::{be_f64_at, be_u32_at};
use crate::error::{Result, bail};
use crate::image::RgbaImage;

/// The placement of an image material.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct Placement {
    /// Width of the original image in pixels.
    pub width: u32,
    /// Height of the original image in pixels.
    pub height: u32,
    /// Scale (x, y) as stored; the corners are what is drawn.
    pub scale: (f64, f64),
    /// Centre in layer pixels.
    pub center: (f64, f64),
    /// Where (0, 0), (w, 0), (0, h) and (w, h) of the original go.
    pub corners: [(f64, f64); 4],
}

const CORNERS_AT: usize = 120;

impl Placement {
    /// Parses `ResizableImageInfo`.
    pub fn parse(data: &[u8]) -> Result<Self> {
        if data.len() < CORNERS_AT + 64 {
            bail!("ResizableImageInfo of {} bytes, expected at least 184", data.len());
        }
        let f = |at: usize| be_f64_at(data, at);
        let corners = [0, 1, 2, 3].map(|i| (f(CORNERS_AT + 16 * i), f(CORNERS_AT + 16 * i + 8)));
        let placement = Placement {
            width: be_u32_at(data, 32),
            height: be_u32_at(data, 36),
            scale: (f(40), f(48)),
            center: (f(64), f(72)),
            corners,
        };
        if placement.width == 0
            || placement.height == 0
            || corners.iter().any(|(x, y)| !x.is_finite() || !y.is_finite())
        {
            bail!("ResizableImageInfo without a usable size or corners");
        }
        Ok(placement)
    }

    /// The homography mapping canvas points back into the original image
    /// (after moving the corners by `offset`), or None when the corners are
    /// degenerate.
    fn inverse(&self, offset: (f64, f64)) -> Option<[f64; 9]> {
        let (w, h) = (self.width as f64, self.height as f64);
        let source = [(0.0, 0.0), (w, 0.0), (0.0, h), (w, h)];
        let target = self.corners.map(|(x, y)| (x + offset.0, y + offset.1));
        homography(target, source)
    }

    /// Draw `original` (the original image read at `level_scale` of its
    /// full size) placed on a `width` × `height` output at `scale` of the
    /// canvas, with the corners moved by the layer's `offset`.
    pub fn draw(
        &self,
        original: &RgbaImage,
        level_scale: f64,
        offset: (f64, f64),
        width: u32,
        height: u32,
        scale: f64,
    ) -> Option<RgbaImage> {
        self.draw_region(original, level_scale, offset, (0, 0, width, height), scale)
    }

    /// The output pixels the placed image can cover, `(x0, y0, x1, y1)`, at
    /// `scale` of the canvas (not clipped to any output).
    pub fn bounds(&self, offset: (f64, f64), scale: f64) -> (i64, i64, i64, i64) {
        let xs = self.corners.map(|c| (c.0 + offset.0) * scale);
        let ys = self.corners.map(|c| (c.1 + offset.1) * scale);
        let min = |v: [f64; 4]| v.iter().copied().fold(f64::INFINITY, f64::min).floor() as i64;
        let max = |v: [f64; 4]| v.iter().copied().fold(f64::NEG_INFINITY, f64::max).ceil() as i64;
        (min(xs), min(ys), max(xs), max(ys))
    }

    /// [`Placement::draw`] for the part `(left, top, width, height)` of the
    /// output only: the result is `width` × `height` with its top-left at
    /// output pixel (`left`, `top`).
    pub fn draw_region(
        &self,
        original: &RgbaImage,
        level_scale: f64,
        offset: (f64, f64),
        region: (u32, u32, u32, u32),
        scale: f64,
    ) -> Option<RgbaImage> {
        let (left, top, width, height) = region;
        let m = self.inverse(offset)?;
        let premultiplied: Vec<[f32; 4]> = original
            .pixels
            .as_chunks::<4>()
            .0
            .iter()
            .map(|p| {
                let a = p[3] as f32 / 255.0;
                [p[0] as f32 * a, p[1] as f32 * a, p[2] as f32 * a, p[3] as f32]
            })
            .collect();
        let (ow, oh) = (original.width as i64, original.height as i64);
        // Inside the image, samples near its edge repeat the edge pixels.
        let texel = |x: i64, y: i64| premultiplied[(y.clamp(0, oh - 1) * ow + x.clamp(0, ow - 1)) as usize];
        // Only the outputs inside the corners' bounding box can be covered.
        let (bx0, by0, bx1, by1) = self.bounds(offset, scale);
        let clip = |value: i64, start: u32, size: u32| (value - start as i64).clamp(0, size as i64) as u32;
        let (x0, x1) = (clip(bx0, left, width), clip(bx1, left, width));
        let (y0, y1) = (clip(by0, top, height), clip(by1, top, height));
        let mut out = RgbaImage::new(width, height);
        for y in y0..y1 {
            for x in x0..x1 {
                let cx = ((x + left) as f64 + 0.5) / scale;
                let cy = ((y + top) as f64 + 0.5) / scale;
                let d = m[6] * cx + m[7] * cy + m[8];
                if d.abs() < 1e-12 {
                    continue;
                }
                // Original pixel coordinates, then the level's.
                let sx = (m[0] * cx + m[1] * cy + m[2]) / d * level_scale - 0.5;
                let sy = (m[3] * cx + m[4] * cy + m[5]) / d * level_scale - 0.5;
                if sx < -0.5 || sy < -0.5 || sx >= ow as f64 - 0.5 || sy >= oh as f64 - 0.5 {
                    continue;
                }
                let (fx, fy) = (sx.floor(), sy.floor());
                let (tx, ty) = ((sx - fx) as f32, (sy - fy) as f32);
                let (ix, iy) = (fx as i64, fy as i64);
                let (a, b, c, e) = (texel(ix, iy), texel(ix + 1, iy), texel(ix, iy + 1), texel(ix + 1, iy + 1));
                let mut p = [0f32; 4];
                for k in 0..4 {
                    let top = a[k] + (b[k] - a[k]) * tx;
                    let bottom = c[k] + (e[k] - c[k]) * tx;
                    p[k] = top + (bottom - top) * ty;
                }
                if p[3] <= 0.0 {
                    continue;
                }
                let alpha = p[3] / 255.0;
                let at = (y as usize * width as usize + x as usize) * 4;
                let straight = [p[0] / alpha, p[1] / alpha, p[2] / alpha, p[3]];
                for (target, value) in out.pixels[at..at + 4].iter_mut().zip(straight) {
                    *target = value.round().clamp(0.0, 255.0) as u8;
                }
            }
        }
        Some(out)
    }

    /// How much the original is scaled on the canvas (the larger side).
    pub fn magnification(&self) -> f64 {
        let length = |a: (f64, f64), b: (f64, f64)| ((a.0 - b.0).powi(2) + (a.1 - b.1).powi(2)).sqrt();
        let x = length(self.corners[0], self.corners[1]) / self.width as f64;
        let y = length(self.corners[0], self.corners[2]) / self.height as f64;
        x.max(y)
    }
}

/// The 3 × 3 homography (row major, last entry 1) taking each `from` point
/// to the matching `to` point.
fn homography(from: [(f64, f64); 4], to: [(f64, f64); 4]) -> Option<[f64; 9]> {
    let mut a = [[0f64; 9]; 8];
    for (i, ((x, y), (u, v))) in from.iter().zip(to.iter()).enumerate() {
        a[2 * i] = [*x, *y, 1.0, 0.0, 0.0, 0.0, -u * x, -u * y, *u];
        a[2 * i + 1] = [0.0, 0.0, 0.0, *x, *y, 1.0, -v * x, -v * y, *v];
    }
    // Gaussian elimination with partial pivoting.
    for col in 0..8 {
        let pivot = (col..8).max_by(|&r, &s| a[r][col].abs().total_cmp(&a[s][col].abs()))?;
        if a[pivot][col].abs() < 1e-12 {
            return None;
        }
        a.swap(col, pivot);
        let pivot_row = a[col];
        for (index, row) in a.iter_mut().enumerate() {
            if index != col {
                let factor = row[col] / pivot_row[col];
                for (value, pivot_value) in row.iter_mut().zip(pivot_row).skip(col) {
                    *value -= factor * pivot_value;
                }
            }
        }
    }
    let mut h = [0f64; 9];
    for (i, (value, row)) in h.iter_mut().zip(&a).enumerate() {
        *value = row[8] / row[i];
    }
    h[8] = 1.0;
    Some(h)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn blob(width: u32, height: u32, corners: [(f64, f64); 4]) -> Vec<u8> {
        let mut data = vec![0u8; 184];
        data[32..36].copy_from_slice(&width.to_be_bytes());
        data[36..40].copy_from_slice(&height.to_be_bytes());
        for (i, (x, y)) in corners.iter().enumerate() {
            data[120 + 16 * i..128 + 16 * i].copy_from_slice(&x.to_be_bytes());
            data[128 + 16 * i..136 + 16 * i].copy_from_slice(&y.to_be_bytes());
        }
        data
    }

    #[test]
    fn scaled_and_moved_image_lands_on_its_corners() {
        let mut original = RgbaImage::new(4, 2);
        original.fill([200, 10, 20, 255]);
        // Twice the size, top-left at (10, 6) in layer pixels, layer moved by (2, 1).
        let placement = Placement::parse(&blob(4, 2, [(10.0, 6.0), (18.0, 6.0), (10.0, 10.0), (18.0, 10.0)])).unwrap();
        assert!((placement.magnification() - 2.0).abs() < 1e-9);
        let image = placement.draw(&original, 1.0, (2.0, 1.0), 32, 16, 1.0).unwrap();
        assert_eq!(image.pixel(13, 9), [200, 10, 20, 255]);
        assert_eq!(image.pixel(11, 6)[3], 0);
        assert_eq!(image.pixel(20, 9)[3], 0);
        assert_eq!(image.pixel(19, 10), [200, 10, 20, 255]);
    }

    #[test]
    fn flipped_corners_mirror_the_image() {
        let mut original = RgbaImage::new(2, 1);
        original.set_pixel(0, 0, [255, 0, 0, 255]);
        original.set_pixel(1, 0, [0, 0, 255, 255]);
        let placement = Placement::parse(&blob(2, 1, [(20.0, 0.0), (0.0, 0.0), (20.0, 10.0), (0.0, 10.0)])).unwrap();
        let image = placement.draw(&original, 1.0, (0.0, 0.0), 20, 10, 1.0).unwrap();
        assert_eq!(image.pixel(2, 5), [0, 0, 255, 255]);
        assert_eq!(image.pixel(17, 5), [255, 0, 0, 255]);
    }

    #[test]
    fn a_region_is_the_same_part_of_the_whole() {
        let mut original = RgbaImage::new(3, 3);
        for (i, pixel) in original.pixels.chunks_mut(4).enumerate() {
            pixel.copy_from_slice(&[i as u8 * 20, 100, 200 - i as u8 * 10, 255]);
        }
        let placement = Placement::parse(&blob(3, 3, [(3.5, 2.0), (15.0, 4.0), (2.0, 13.0), (14.0, 16.5)])).unwrap();
        let whole = placement.draw(&original, 1.0, (1.0, 1.0), 24, 20, 1.0).unwrap();
        let part = placement.draw_region(&original, 1.0, (1.0, 1.0), (5, 4, 8, 9), 1.0).unwrap();
        for y in 0..9 {
            for x in 0..8 {
                assert_eq!(part.pixel(x, y), whole.pixel(x + 5, y + 4));
            }
        }
        assert_eq!(placement.bounds((1.0, 1.0), 1.0), (3, 3, 16, 18));
    }
}
