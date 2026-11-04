//! List the sub tools of an exported sub tool (`.sut`) or of CSP's tool
//! database (`EditImageTool.todb`), with the materials they use.
//!
//! Usage: `cargo run -p csp-assets --example subtools -- FILE`

use csp_assets::subtool::SubToolDb;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let path = std::env::args().nth(1).ok_or("usage: subtools FILE")?;
    let db = SubToolDb::open(&path)?;
    for entry in db.sub_tools() {
        let node = &db.nodes[entry.node];
        println!("{}/{} ({:?})", entry.path.join("/"), node.name, node.kind());
        for (column, material) in db.material_refs(node.variant_id) {
            println!("  {column}: {}", material.name.as_deref().unwrap_or(&material.path));
        }
    }
    Ok(())
}
