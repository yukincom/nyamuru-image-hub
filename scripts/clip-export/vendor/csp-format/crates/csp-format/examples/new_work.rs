//! Make a new work: a .cmc and its page files, which CLIP STUDIO PAINT
//! opens. Existing files are not replaced.
//!
//! Usage: `cargo run -p csp-format --example new_work -- OUT_DIR NAME`

use std::path::Path;

use csp_format::NewWork;
use csp_format::work::Binding;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let [dir, name] = args.as_slice() else { return Err("usage: new_work OUT_DIR NAME".into()) };
    let work = NewWork { pages: 8, spreads: true, binding: Binding::Right, title: name.clone(), ..NewWork::default() };
    let cmc = work.write(Path::new(dir), name)?;
    println!("{}", cmc.display());
    Ok(())
}
