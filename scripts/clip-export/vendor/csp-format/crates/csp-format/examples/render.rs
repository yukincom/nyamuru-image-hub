//! Composite the layers of a .clip into a PNG, at the size of the preview
//! CSP stored or at a given scale.
//!
//! Usage: `cargo run -p csp-format --example render -- FILE.clip OUT.png [SCALE]`

use csp_format::ClipFile;
use csp_format::render::{RenderOptions, render};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let [path, out, rest @ ..] = args.as_slice() else {
        return Err("usage: render FILE.clip OUT.png [SCALE]".into());
    };
    let file = ClipFile::open(path)?;
    let scale = match rest.first() {
        Some(scale) => scale.parse()?,
        None => file.preview()?.map_or(1.0, |preview| preview.width as f64 / file.canvas.width_px.max(1) as f64),
    };
    let (image, report) = render(&file, RenderOptions { scale, ..RenderOptions::default() })?;
    std::fs::write(out, image.to_png()?)?;
    println!("{} x {} px, {} layers drawn, {} hidden", image.width, image.height, report.drawn, report.hidden);
    Ok(())
}
