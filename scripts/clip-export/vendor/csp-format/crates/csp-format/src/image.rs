//! Plain in-memory images and PNG input / output.

use crate::error::{Error, Result};

/// RGBA, 8 bits per channel, straight (not premultiplied) alpha.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RgbaImage {
    /// Width in pixels.
    pub width: u32,
    /// Height in pixels.
    pub height: u32,
    /// `width * height * 4` bytes, rows top to bottom, R G B A.
    pub pixels: Vec<u8>,
}

impl RgbaImage {
    /// A transparent image.
    pub fn new(width: u32, height: u32) -> Self {
        RgbaImage { width, height, pixels: vec![0; width as usize * height as usize * 4] }
    }

    /// Sets every pixel to `pixel` (RGBA).
    pub fn fill(&mut self, pixel: [u8; 4]) {
        for chunk in self.pixels.as_chunks_mut::<4>().0.iter_mut() {
            chunk.copy_from_slice(&pixel);
        }
    }

    /// The RGBA pixel at (x, y). Panics outside the image.
    pub fn pixel(&self, x: u32, y: u32) -> [u8; 4] {
        let at = (y as usize * self.width as usize + x as usize) * 4;
        self.pixels[at..at + 4].try_into().expect("4 bytes")
    }

    /// Sets the RGBA pixel at (x, y). Panics outside the image.
    pub fn set_pixel(&mut self, x: u32, y: u32, pixel: [u8; 4]) {
        let at = (y as usize * self.width as usize + x as usize) * 4;
        self.pixels[at..at + 4].copy_from_slice(&pixel);
    }

    /// The bytes of row `y`.
    pub fn row_mut(&mut self, y: u32) -> &mut [u8] {
        let stride = self.width as usize * 4;
        &mut self.pixels[y as usize * stride..(y as usize + 1) * stride]
    }

    /// Bounding box (x0, y0, x1, y1, exclusive ends) of the pixels with alpha.
    pub fn alpha_bbox(&self) -> Option<(u32, u32, u32, u32)> {
        let (mut x0, mut y0, mut x1, mut y1) = (u32::MAX, u32::MAX, 0, 0);
        for y in 0..self.height {
            for x in 0..self.width {
                if self.pixel(x, y)[3] != 0 {
                    x0 = x0.min(x);
                    y0 = y0.min(y);
                    x1 = x1.max(x + 1);
                    y1 = y1.max(y + 1);
                }
            }
        }
        (x0 != u32::MAX).then_some((x0, y0, x1, y1))
    }

    /// Shrink to `width`×`height` with an area (box) filter on premultiplied colour.
    pub fn resize_area(&self, width: u32, height: u32) -> RgbaImage {
        let mut result = RgbaImage::new(width.max(1), height.max(1));
        if self.width == 0 || self.height == 0 {
            return result;
        }
        let sx = self.width as f64 / result.width as f64;
        let sy = self.height as f64 / result.height as f64;
        for ty in 0..result.height {
            let y0 = ty as f64 * sy;
            let y1 = y0 + sy;
            for tx in 0..result.width {
                let x0 = tx as f64 * sx;
                let x1 = x0 + sx;
                let mut sum = [0f64; 4];
                let mut area = 0f64;
                let mut y = y0.floor() as u32;
                while (y as f64) < y1 && y < self.height {
                    let wy = (y1.min(y as f64 + 1.0) - y0.max(y as f64)).max(0.0);
                    let mut x = x0.floor() as u32;
                    while (x as f64) < x1 && x < self.width {
                        let wx = (x1.min(x as f64 + 1.0) - x0.max(x as f64)).max(0.0);
                        let weight = wx * wy;
                        let pixel = self.pixel(x, y);
                        let alpha = pixel[3] as f64 / 255.0;
                        sum[0] += pixel[0] as f64 * alpha * weight;
                        sum[1] += pixel[1] as f64 * alpha * weight;
                        sum[2] += pixel[2] as f64 * alpha * weight;
                        sum[3] += alpha * weight;
                        area += weight;
                        x += 1;
                    }
                    y += 1;
                }
                if area > 0.0 && sum[3] > 0.0 {
                    let alpha = sum[3] / area;
                    result.set_pixel(
                        tx,
                        ty,
                        [
                            (sum[0] / sum[3]).round().clamp(0.0, 255.0) as u8,
                            (sum[1] / sum[3]).round().clamp(0.0, 255.0) as u8,
                            (sum[2] / sum[3]).round().clamp(0.0, 255.0) as u8,
                            (alpha * 255.0).round().clamp(0.0, 255.0) as u8,
                        ],
                    );
                }
            }
        }
        result
    }

    /// Halve with a 2×2 box on premultiplied colour (width and height rounded down).
    pub fn halve(&self) -> RgbaImage {
        let image = self;
        let (w, h) = ((image.width / 2).max(1), (image.height / 2).max(1));
        let mut out = RgbaImage::new(w, h);
        for y in 0..h {
            for x in 0..w {
                let mut sum = [0u32; 4];
                for (dx, dy) in [(0, 0), (1, 0), (0, 1), (1, 1)] {
                    let p = image.pixel((2 * x + dx).min(image.width - 1), (2 * y + dy).min(image.height - 1));
                    let a = p[3] as u32;
                    sum[0] += p[0] as u32 * a;
                    sum[1] += p[1] as u32 * a;
                    sum[2] += p[2] as u32 * a;
                    sum[3] += a;
                }
                // All colour sums are 0 when the alpha sum is, so `max(1)` only avoids 0 / 0.
                let total = sum[3].max(1);
                let pixel = [
                    ((sum[0] + total / 2) / total) as u8,
                    ((sum[1] + total / 2) / total) as u8,
                    ((sum[2] + total / 2) / total) as u8,
                    ((sum[3] + 2) / 4) as u8,
                ];
                out.set_pixel(x, y, pixel);
            }
        }
        out
    }

    /// Copy `other` onto self with its top-left at (x, y), replacing pixels
    /// (no blending); parts outside are dropped.
    pub fn paste(&mut self, other: &RgbaImage, x: i64, y: i64) {
        for sy in 0..other.height as i64 {
            let ty = y + sy;
            if ty < 0 || ty >= self.height as i64 {
                continue;
            }
            for sx in 0..other.width as i64 {
                let tx = x + sx;
                if tx < 0 || tx >= self.width as i64 {
                    continue;
                }
                self.set_pixel(tx as u32, ty as u32, other.pixel(sx as u32, sy as u32));
            }
        }
    }

    /// Draw `other` over self (normal blending, straight alpha) with its
    /// top-left at (x, y); parts outside are dropped.
    pub fn draw_over(&mut self, other: &RgbaImage, x: i64, y: i64) {
        for sy in 0..other.height as i64 {
            let ty = y + sy;
            if ty < 0 || ty >= self.height as i64 {
                continue;
            }
            for sx in 0..other.width as i64 {
                let tx = x + sx;
                if tx < 0 || tx >= self.width as i64 {
                    continue;
                }
                let s = other.pixel(sx as u32, sy as u32);
                if s[3] == 0 {
                    continue;
                }
                let d = self.pixel(tx as u32, ty as u32);
                let (sa, da) = (s[3] as f32 / 255.0, d[3] as f32 / 255.0);
                let a = sa + da * (1.0 - sa);
                let mix = |c: usize| (s[c] as f32 * sa + d[c] as f32 * da * (1.0 - sa)) / a;
                let out = [mix(0), mix(1), mix(2), a * 255.0].map(|v| v.round().clamp(0.0, 255.0) as u8);
                self.set_pixel(tx as u32, ty as u32, out);
            }
        }
    }

    /// Encodes as an 8-bit RGBA PNG.
    pub fn to_png(&self) -> Result<Vec<u8>> {
        encode_png(self.width, self.height, png::ColorType::Rgba, &self.pixels)
    }

    /// Decodes a PNG (any colour type; converted to RGBA).
    pub fn from_png(data: &[u8]) -> Result<Self> {
        decode_png(data)
    }
}

/// One 8-bit channel (masks).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GrayImage {
    /// Width in pixels.
    pub width: u32,
    /// Height in pixels.
    pub height: u32,
    /// `width * height` bytes, rows top to bottom.
    pub pixels: Vec<u8>,
}

impl GrayImage {
    /// A black (all 0) image.
    pub fn new(width: u32, height: u32) -> Self {
        GrayImage { width, height, pixels: vec![0; width as usize * height as usize] }
    }

    /// Encodes as an 8-bit grayscale PNG.
    pub fn to_png(&self) -> Result<Vec<u8>> {
        encode_png(self.width, self.height, png::ColorType::Grayscale, &self.pixels)
    }
}

/// ITU-R BT.601 luma, as used for gray layers.
pub fn luma(r: u8, g: u8, b: u8) -> u8 {
    ((r as u32 * 299 + g as u32 * 587 + b as u32 * 114 + 500) / 1000) as u8
}

fn encode_png(width: u32, height: u32, color: png::ColorType, pixels: &[u8]) -> Result<Vec<u8>> {
    let mut output = Vec::new();
    let mut encoder = png::Encoder::new(&mut output, width, height);
    encoder.set_color(color);
    encoder.set_depth(png::BitDepth::Eight);
    encoder.set_compression(png::Compression::Fast);
    let mut writer = encoder.write_header().map_err(|error| Error::format(error.to_string()))?;
    writer.write_image_data(pixels).map_err(|error| Error::format(error.to_string()))?;
    writer.finish().map_err(|error| Error::format(error.to_string()))?;
    Ok(output)
}

/// Decode any 8-bit PNG (gray, gray+alpha, RGB, RGBA, palette) to RGBA.
pub fn decode_png(data: &[u8]) -> Result<RgbaImage> {
    let mut decoder = png::Decoder::new(std::io::Cursor::new(data));
    decoder.set_transformations(png::Transformations::EXPAND | png::Transformations::STRIP_16);
    let mut reader = decoder.read_info().map_err(|error| Error::format(format!("PNG: {error}")))?;
    let size = reader.output_buffer_size().ok_or_else(|| Error::format("PNG too large"))?;
    let mut buffer = vec![0; size];
    let info = reader.next_frame(&mut buffer).map_err(|error| Error::format(format!("PNG: {error}")))?;
    let (width, height) = (info.width, info.height);
    let pixels = &buffer[..info.buffer_size()];
    let mut image = RgbaImage::new(width, height);
    let count = width as usize * height as usize;
    match info.color_type {
        png::ColorType::Rgba => image.pixels.copy_from_slice(&pixels[..count * 4]),
        png::ColorType::Rgb => {
            for (target, source) in image.pixels.as_chunks_mut::<4>().0.iter_mut().zip(pixels.as_chunks::<3>().0.iter())
            {
                target.copy_from_slice(&[source[0], source[1], source[2], 255]);
            }
        }
        png::ColorType::GrayscaleAlpha => {
            for (target, source) in image.pixels.as_chunks_mut::<4>().0.iter_mut().zip(pixels.as_chunks::<2>().0.iter())
            {
                target.copy_from_slice(&[source[0], source[0], source[0], source[1]]);
            }
        }
        png::ColorType::Grayscale => {
            for (target, source) in image.pixels.as_chunks_mut::<4>().0.iter_mut().zip(pixels.iter()) {
                target.copy_from_slice(&[*source, *source, *source, 255]);
            }
        }
        png::ColorType::Indexed => return Err(Error::format("PNG palette was not expanded")),
    }
    Ok(image)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn png_round_trip() {
        let mut image = RgbaImage::new(3, 2);
        image.set_pixel(2, 1, [1, 2, 3, 4]);
        let decoded = decode_png(&image.to_png().unwrap()).unwrap();
        assert_eq!(decoded, image);
    }

    #[test]
    fn area_resize_averages() {
        let mut image = RgbaImage::new(2, 2);
        image.fill([100, 100, 100, 255]);
        image.set_pixel(0, 0, [200, 200, 200, 255]);
        let small = image.resize_area(1, 1);
        assert_eq!(small.pixel(0, 0), [125, 125, 125, 255]);
    }
}
