# csp-assets

Read and write CLIP STUDIO PAINT's files other than canvases:

- sub tools (`.sut`) and CSP's tool database (`EditImageTool.todb`),
  including brush tips and papers stored in them;
- auto actions (`.las`, `.laf`), colour sets (`.cls`), gradient sets
  (`.sgs`), shortcut and modifier key settings;
- material folders (`catalog.xml`, `info.xml`, the install map), and the
  envelope of encrypted material data, which is kept as bytes and never
  decrypted.

Parsing then writing an unchanged file gives the same bytes. Canvases
(`.clip`, `.cmc`) are in [`csp-format`](https://crates.io/crates/csp-format).
The requirements, specification and validation records are in the
repository: [docs/assets/](https://github.com/nanikasheila/csp-format/blob/main/docs/assets/requirements.md).

Not made or endorsed by CELSYS. CLIP STUDIO PAINT is a trademark of CELSYS, Inc.

```rust
use csp_assets::subtool::SubToolDb;

let db = SubToolDb::open("G-pen.sut")?;
for entry in db.sub_tools() {
    let node = &db.nodes[entry.node];
    println!("{}/{} ({:?})", entry.path.join("/"), node.name, node.kind());
}
```

## License

MIT (see `LICENSE`)
