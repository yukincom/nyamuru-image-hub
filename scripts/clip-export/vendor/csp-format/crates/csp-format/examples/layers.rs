//! Print the layer tree of a .clip and write each layer's stored pixels as
//! PNG.
//!
//! Usage: `cargo run -p csp-format --example layers -- FILE.clip [OUT_DIR]`

use csp_format::ClipFile;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut args = std::env::args().skip(1);
    let path = args.next().ok_or("usage: layers FILE.clip [OUT_DIR]")?;
    let out = args.next();
    let file = ClipFile::open(&path)?;
    println!("{} x {} px, {} dpi", file.canvas.width_px, file.canvas.height_px, file.canvas.resolution);
    for (layer, depth) in file.layers.flatten() {
        let shown = if layer.visible { "" } else { " (hidden)" };
        println!("{}{} [{}]{shown}", "  ".repeat(depth), layer.name, layer.kind.name());
        let Some(dir) = &out else { continue };
        if let Some((image, (x, y))) = file.layer_pixels(layer)? {
            std::fs::create_dir_all(dir)?;
            let name = format!("{dir}/{}_{x}_{y}.png", layer.main_id);
            std::fs::write(&name, image.to_png()?)?;
        }
    }
    Ok(())
}
