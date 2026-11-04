//! Writes a plain synthetic page (.clip) to use as a template where no CSP
//! file can be shipped, e.g. the app's end-to-end export check in CI:
//!
//! ```text
//! cargo run -p clip-core --features fixtures --example fixture_page -- <page.clip>
//! ```
//!
//! It is not for CSP: its database holds only the tables and columns the tests
//! read, and CSP crashes on pages exported with it as the template. For a check
//! in CSP, export with a page CSP saved (or `--builtin`) instead.

use clip_core::fixtures::{FixtureCanvas, FixtureLayer, build_editable_clip};

fn main() {
    let path = std::env::args().nth(1).expect("usage: fixture_page <page.clip>");
    // B5 at 150 dpi: small, but a whole page.
    let page = FixtureCanvas {
        width_mm: 182.0,
        height_mm: 257.0,
        resolution: 150.0,
        double_page: false,
    };
    let layers = vec![
        FixtureLayer::paper(2),
        FixtureLayer::raster(3, "レイヤー 1", vec![(0, (0, 0, 0, 0))]),
    ];
    let path = std::path::Path::new(&path);
    if let Some(folder) = path.parent() {
        std::fs::create_dir_all(folder).expect("create the folder");
    }
    build_editable_clip(path, page, layers);
}
