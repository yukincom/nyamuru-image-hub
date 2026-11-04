//! Image helpers for writing pages: resampling, pasting and PNG decoding.
//!
//! Resampling follows Pillow's `Image.resize` (the Python reference): a
//! separable filter on premultiplied colour, with the filter widened by the
//! scale when shrinking. Results are close to Pillow's, not byte-identical.

use rayon::prelude::*;

use crate::offscreen::RgbaImage;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Filter {
    /// Average of the covered pixels (CSP-like mipmap levels).
    Box,
    /// Lanczos with a = 3 (Pillow's `LANCZOS`), for enlarging sheet crops.
    Lanczos3,
}

impl Filter {
    fn support(self) -> f64 {
        match self {
            Filter::Box => 0.5,
            Filter::Lanczos3 => 3.0,
        }
    }

    fn weight(self, x: f64) -> f64 {
        match self {
            Filter::Box => {
                if (-0.5..0.5).contains(&x) {
                    1.0
                } else {
                    0.0
                }
            }
            Filter::Lanczos3 => {
                if x.abs() < 3.0 {
                    sinc(x) * sinc(x / 3.0)
                } else {
                    0.0
                }
            }
        }
    }
}

fn sinc(x: f64) -> f64 {
    if x == 0.0 {
        1.0
    } else {
        let x = x * std::f64::consts::PI;
        x.sin() / x
    }
}

/// For each output position: first input index and normalised weights.
fn coefficients(input: usize, output: usize, filter: Filter) -> Vec<(usize, Vec<f32>)> {
    let scale = input as f64 / output as f64;
    let filter_scale = scale.max(1.0);
    let support = filter.support() * filter_scale;
    (0..output)
        .map(|index| {
            let center = (index as f64 + 0.5) * scale;
            let start = ((center - support + 0.5).floor().max(0.0)) as usize;
            let end = ((center + support + 0.5).floor() as usize).min(input).max(start + 1);
            let mut weights: Vec<f64> = (start..end)
                .map(|x| filter.weight((x as f64 - center + 0.5) / filter_scale))
                .collect();
            let total: f64 = weights.iter().sum();
            if total != 0.0 {
                weights.iter_mut().for_each(|weight| *weight /= total);
            }
            (start, weights.into_iter().map(|weight| weight as f32).collect())
        })
        .collect()
}

fn premultiply(pixels: &[u8]) -> Vec<u8> {
    let mut result = pixels.to_vec();
    result.par_chunks_mut(4).for_each(|pixel| {
        let alpha = pixel[3] as u32;
        for channel in &mut pixel[..3] {
            let value = *channel as u32 * alpha + 128;
            *channel = ((value + (value >> 8)) >> 8) as u8;
        }
    });
    result
}

fn unpremultiply(pixels: &mut [u8]) {
    pixels.par_chunks_mut(4).for_each(|pixel| {
        let alpha = pixel[3] as u32;
        if alpha == 0 {
            pixel[..3].fill(0);
        } else if alpha < 255 {
            for channel in &mut pixel[..3] {
                *channel = ((*channel as u32 * 255 + alpha / 2) / alpha).min(255) as u8;
            }
        }
    });
}

fn clamp(value: f32) -> u8 {
    value.round().clamp(0.0, 255.0) as u8
}

/// Resize `image` to `width` x `height`.
pub fn resize(image: &RgbaImage, width: u32, height: u32, filter: Filter) -> RgbaImage {
    let (width, height) = (width.max(1), height.max(1));
    if (image.width, image.height) == (width, height) {
        return image.clone();
    }
    let (in_w, in_h) = (image.width as usize, image.height as usize);
    let (out_w, out_h) = (width as usize, height as usize);
    let source = premultiply(&image.pixels);
    // Horizontal pass into an 8-bit buffer (like Pillow), then vertical.
    let horizontal = coefficients(in_w, out_w, filter);
    let mut middle = vec![0u8; out_w * in_h * 4];
    middle.par_chunks_mut(out_w * 4).enumerate().for_each(|(y, row)| {
        let line = &source[y * in_w * 4..(y + 1) * in_w * 4];
        for (x, (start, weights)) in horizontal.iter().enumerate() {
            let mut sum = [0f32; 4];
            for (offset, weight) in weights.iter().enumerate() {
                let pixel = &line[(start + offset) * 4..(start + offset) * 4 + 4];
                for channel in 0..4 {
                    sum[channel] += pixel[channel] as f32 * weight;
                }
            }
            for channel in 0..4 {
                row[x * 4 + channel] = clamp(sum[channel]);
            }
        }
    });
    let vertical = coefficients(in_h, out_h, filter);
    let mut pixels = vec![0u8; out_w * out_h * 4];
    pixels.par_chunks_mut(out_w * 4).enumerate().for_each(|(y, row)| {
        let (start, weights) = &vertical[y];
        let mut sums = vec![0f32; out_w * 4];
        for (offset, weight) in weights.iter().enumerate() {
            let line = &middle[(start + offset) * out_w * 4..(start + offset + 1) * out_w * 4];
            for (sum, value) in sums.iter_mut().zip(line) {
                *sum += *value as f32 * weight;
            }
        }
        for (target, sum) in row.iter_mut().zip(sums) {
            *target = clamp(sum);
        }
    });
    unpremultiply(&mut pixels);
    RgbaImage { width, height, pixels }
}

/// The part of `image` inside (x0, y0, x1, y1), transparent where it leaves the image.
pub fn crop(image: &RgbaImage, box_: (i64, i64, i64, i64)) -> RgbaImage {
    let (x0, y0, x1, y1) = box_;
    let mut result = RgbaImage::new((x1 - x0).max(1) as u32, (y1 - y0).max(1) as u32);
    result.paste(image, -x0, -y0);
    result
}

/// No pixel of `image` has any alpha.
pub fn is_transparent(image: &RgbaImage) -> bool {
    image.pixels.iter().skip(3).step_by(4).all(|alpha| *alpha == 0)
}

pub use csp_format::image::decode_png;

/// Pillow's RGB → L conversion (ITU-R 601-2 luma, fixed point).
pub fn luma(r: u8, g: u8, b: u8) -> u8 {
    ((r as u32 * 19595 + g as u32 * 38470 + b as u32 * 7471 + 0x8000) >> 16) as u8
}
