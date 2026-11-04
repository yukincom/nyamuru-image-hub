//! Material folders (素材): what CSP keeps under
//! `CLIPStudioCommon/Material/<2 digits>/<2 digits>/<catalog uuid>/` and
//! inside `.sut` files (`MaterialFile.FileData`).
//!
//! Plain files, read by this module:
//!
//! - `catalog.xml`: `<archive><version/><catalog uuid=…>` with `<type>`
//!   (`material` / `catalog`), `<name>`, nested `<groups><group>` and
//!   `<items><item uuid=…>` (`<type>`: `image`, `brush`, `pose`,
//!   `anglepreset`, …), each item pointing at its files with
//!   `<thumbnail|data|icedata><fileref idref=…>`, and `<files><file id=…
//!   encrypt=… mime=…><path>` naming them.
//! - `info.xml` and `icedata/layerData.xml`: `<infolist><info uuid=…>
//!   <datalist key=…><data>…` (tags, the material palette folder, tiling,
//!   tone settings, colours …).
//! - `thumbnail/*.png`, `description/description.tar`.
//! - `files.xml` / `cloud.xml`: cloud sync state (hashes, dates).
//! - `catalog*.cac`: a binary cache of `catalog.xml` (u16 length + UTF-8
//!   strings, see [`cac_strings`]).
//!
//! Encrypted (kept opaque, `docs/assets/requirements.md` C5): the item
//! data (`data/*.layer`, `.tool`, `.pose` …) and `catalog.zip` /
//! `info.zip`, all in the [`crate::c2f`] envelope.

use std::path::{Path, PathBuf};

use quick_xml::Reader;
use quick_xml::events::Event;
use serde::Serialize;

use crate::error::{Error, Result};

/// A small XML element tree.
#[derive(Debug, Clone, Default, PartialEq, Serialize)]
pub struct Element {
    /// Tag name.
    pub name: String,
    /// Attributes (name, value), in document order.
    pub attributes: Vec<(String, String)>,
    /// Text content (empty when it is only whitespace between children).
    pub text: String,
    /// Child elements, in document order.
    pub children: Vec<Element>,
}

impl Element {
    /// Parses a document and returns its root element.
    pub fn parse(xml: &[u8]) -> Result<Element> {
        let mut reader = Reader::from_reader(xml);
        let mut stack: Vec<Element> = vec![Element::default()];
        let mut buffer = Vec::new();
        let bad = |e: quick_xml::Error| Error::format(format!("XML: {e}"));
        loop {
            match reader.read_event_into(&mut buffer).map_err(bad)? {
                Event::Start(start) => stack.push(element_of(&start)?),
                Event::Empty(start) => {
                    let element = element_of(&start)?;
                    stack.last_mut().unwrap().children.push(element);
                }
                Event::End(_) => {
                    let mut element = stack.pop().ok_or_else(|| Error::format("XML: unbalanced"))?;
                    // Indentation between child elements is not text.
                    if element.text.trim().is_empty() {
                        element.text.clear();
                    }
                    stack.last_mut().ok_or_else(|| Error::format("XML: unbalanced"))?.children.push(element);
                }
                Event::Text(text) => {
                    let text = text.decode().map_err(|e| Error::format(format!("XML: {e}")))?;
                    let text = quick_xml::escape::unescape(&text).map_err(|e| Error::format(format!("XML: {e}")))?;
                    stack.last_mut().unwrap().text.push_str(&text);
                }
                Event::CData(data) => stack.last_mut().unwrap().text.push_str(&String::from_utf8_lossy(&data)),
                Event::GeneralRef(reference) => {
                    let name = String::from_utf8_lossy(&reference);
                    let text = match name.as_ref() {
                        "lt" => "<".to_owned(),
                        "gt" => ">".to_owned(),
                        "amp" => "&".to_owned(),
                        "quot" => "\"".to_owned(),
                        "apos" => "'".to_owned(),
                        other => reference
                            .resolve_char_ref()
                            .ok()
                            .flatten()
                            .map(String::from)
                            .unwrap_or_else(|| format!("&{other};")),
                    };
                    stack.last_mut().unwrap().text.push_str(&text);
                }
                Event::Eof => break,
                _ => {}
            }
            buffer.clear();
        }
        let mut document = stack.pop().ok_or_else(|| Error::format("XML: empty"))?;
        if !stack.is_empty() {
            return Err(Error::format("XML: unclosed element"));
        }
        document.children.pop().ok_or_else(|| Error::format("XML: no root element"))
    }

    /// The value of an attribute.
    pub fn attribute(&self, name: &str) -> Option<&str> {
        self.attributes.iter().find(|(k, _)| k == name).map(|(_, v)| v.as_str())
    }

    /// The first child with this tag name.
    pub fn child(&self, name: &str) -> Option<&Element> {
        self.children.iter().find(|c| c.name == name)
    }

    /// The children with this tag name.
    pub fn children_named<'a>(&'a self, name: &'a str) -> impl Iterator<Item = &'a Element> + 'a {
        self.children.iter().filter(move |c| c.name == name)
    }

    /// The text of the first child with this tag name.
    pub fn child_text(&self, name: &str) -> Option<&str> {
        self.child(name).map(|c| c.text.as_str())
    }

    /// The `idref` of `<name><fileref idref=…/></name>`.
    fn fileref(&self, name: &str) -> Option<String> {
        self.child(name)?.child("fileref")?.attribute("idref").map(str::to_owned)
    }
}

fn element_of(start: &quick_xml::events::BytesStart) -> Result<Element> {
    let name = String::from_utf8_lossy(start.name().as_ref()).into_owned();
    let mut attributes = Vec::new();
    for attribute in start.attributes() {
        let attribute = attribute.map_err(|e| Error::format(format!("XML attribute: {e}")))?;
        let key = String::from_utf8_lossy(attribute.key.as_ref()).into_owned();
        let value = attribute
            .normalized_value(quick_xml::XmlVersion::default())
            .map_err(|e| Error::format(format!("XML attribute: {e}")))?
            .into_owned();
        attributes.push((key, value));
    }
    Ok(Element { name, attributes, ..Element::default() })
}

/// A file listed in `catalog.xml`.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct CatalogFile {
    /// `id` attribute, referred to by `<fileref idref=…>`.
    pub id: String,
    /// `<path>`, relative to the material folder.
    pub path: String,
    /// `mime` attribute.
    pub mime: String,
    /// `encrypt="true"`: the file is in the [`crate::c2f`] envelope.
    pub encrypted: bool,
}

/// One material of a catalogue.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct CatalogItem {
    /// `uuid` attribute.
    pub uuid: String,
    /// `image`, `brush`, `pose`, `anglepreset`, `facepreset…`, …
    pub kind: String,
    /// `ver` attribute of `<type>`.
    pub kind_version: String,
    /// `<name>`.
    pub name: String,
    /// `<created_date>`, as stored.
    pub created: String,
    /// `<modified_date>`, as stored.
    pub modified: String,
    /// Names of the groups it is in.
    pub groups: Vec<String>,
    /// File id of the thumbnail.
    pub thumbnail: Option<String>,
    /// File id of the data.
    pub data: Option<String>,
    /// File id of the icedata.
    pub icedata: Option<String>,
}

/// A parsed `catalog.xml`.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Catalog {
    /// `<version>` of the archive.
    pub version: String,
    /// `uuid` attribute of `<catalog>`.
    pub uuid: String,
    /// `material` (one item) or `catalog` (a downloaded set).
    pub kind: String,
    /// `<name>`.
    pub name: String,
    /// The program and version that made it (`paint 1.9.3`).
    pub tool: String,
    /// `<content_id>` (materials from CLIP STUDIO ASSETS).
    pub content_id: Option<String>,
    /// Every item, through all groups.
    pub items: Vec<CatalogItem>,
    /// The files the items refer to.
    pub files: Vec<CatalogFile>,
}

impl Catalog {
    /// Parses `catalog.xml`.
    pub fn parse(xml: &[u8]) -> Result<Catalog> {
        let archive = Element::parse(xml)?;
        if archive.name != "archive" {
            return Err(Error::format(format!("catalog.xml: root is <{}>", archive.name)));
        }
        let catalog = archive.child("catalog").ok_or_else(|| Error::format("catalog.xml: no <catalog>"))?;
        let mut items = Vec::new();
        if let Some(groups) = catalog.child("groups") {
            collect_items(groups, &mut Vec::new(), &mut items);
        }
        let files = archive
            .child("files")
            .map(|files| {
                files
                    .children_named("file")
                    .map(|f| CatalogFile {
                        id: f.attribute("id").unwrap_or("").into(),
                        path: f.child_text("path").unwrap_or("").into(),
                        mime: f.attribute("mime").unwrap_or("").into(),
                        encrypted: f.attribute("encrypt") == Some("true"),
                    })
                    .collect()
            })
            .unwrap_or_default();
        let tool = catalog
            .child("tool")
            .map(|t| format!("{} {}", t.attribute("name").unwrap_or(""), t.attribute("version").unwrap_or("")))
            .unwrap_or_default();
        Ok(Catalog {
            version: archive.child_text("version").unwrap_or("").into(),
            uuid: catalog.attribute("uuid").unwrap_or("").into(),
            kind: catalog.child_text("type").unwrap_or("").into(),
            name: catalog.child_text("name").unwrap_or("").into(),
            tool,
            content_id: catalog.child_text("content_id").map(str::to_owned),
            items,
            files,
        })
    }

    /// The file with this id.
    pub fn file(&self, id: &str) -> Option<&CatalogFile> {
        self.files.iter().find(|f| f.id == id)
    }
}

fn collect_items(groups: &Element, path: &mut Vec<String>, out: &mut Vec<CatalogItem>) {
    for group in groups.children_named("group") {
        let name = group.child_text("name").unwrap_or("").to_owned();
        path.push(name);
        if let Some(items) = group.child("items") {
            for item in items.children_named("item") {
                let kind = item.child("type");
                out.push(CatalogItem {
                    uuid: item.attribute("uuid").unwrap_or("").into(),
                    kind: kind.map(|k| k.text.clone()).unwrap_or_default(),
                    kind_version: kind.and_then(|k| k.attribute("ver")).unwrap_or("").into(),
                    name: item.child_text("name").unwrap_or("").into(),
                    created: item.child_text("created_date").unwrap_or("").into(),
                    modified: item.child_text("modified_date").unwrap_or("").into(),
                    groups: path.iter().filter(|p| !p.is_empty()).cloned().collect(),
                    thumbnail: item.fileref("thumbnail"),
                    data: item.fileref("data"),
                    icedata: item.fileref("icedata"),
                });
            }
        }
        collect_items(group, path, out);
        path.pop();
    }
}

/// `info.xml` / `layerData.xml`: per item uuid, keyed lists of values.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct InfoList {
    /// `<version>`.
    pub version: String,
    /// The `<info>` elements.
    pub infos: Vec<Info>,
}

/// One `<info>`: the values of one item.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Info {
    /// `uuid` attribute: the item.
    pub uuid: String,
    /// (`key`, values) of each `<datalist>`.
    pub data: Vec<(String, Vec<String>)>,
}

impl Info {
    /// The values of a key.
    pub fn get(&self, key: &str) -> Option<&[String]> {
        self.data.iter().find(|(k, _)| k == key).map(|(_, v)| v.as_slice())
    }
}

impl InfoList {
    /// Parses `info.xml` or `layerData.xml`.
    pub fn parse(xml: &[u8]) -> Result<InfoList> {
        let root = Element::parse(xml)?;
        if root.name != "infolist" {
            return Err(Error::format(format!("info list: root is <{}>", root.name)));
        }
        let infos = root
            .children_named("info")
            .map(|info| Info {
                uuid: info.attribute("uuid").unwrap_or("").into(),
                data: info
                    .children_named("datalist")
                    .map(|d| {
                        (
                            d.attribute("key").unwrap_or("").to_owned(),
                            d.children_named("data").map(|x| x.text.clone()).collect(),
                        )
                    })
                    .collect(),
            })
            .collect();
        Ok(InfoList { version: root.child_text("version").unwrap_or("").into(), infos })
    }
}

/// A material folder read from disk (or from a `.sut`'s tar).
#[derive(Debug, Clone, Serialize)]
pub struct MaterialFolder {
    /// `catalog.xml` (empty when the folder has only the encrypted catalogue).
    pub catalog: Catalog,
    /// `icedata/*.xml` and `info.xml` of the folder and of nested item folders.
    pub info: Vec<InfoList>,
    /// For each listed data file: the envelope summary (or the error).
    pub data_files: Vec<(String, std::result::Result<crate::c2f::Summary, String>)>,
    /// Paths of the thumbnails.
    pub thumbnails: Vec<String>,
}

/// Files of a folder, by relative path with `/`.
pub trait FileSource {
    /// The bytes of a file.
    fn read(&self, path: &str) -> Option<Vec<u8>>;
    /// Paths of all files.
    fn list(&self) -> Vec<String>;
    /// Modification time (seconds since 1970), when known.
    fn mtime(&self, _path: &str) -> Option<u64> {
        None
    }
}

/// Files of a folder on disk.
pub struct DirSource(pub PathBuf);

impl FileSource for DirSource {
    fn read(&self, path: &str) -> Option<Vec<u8>> {
        std::fs::read(self.0.join(path)).ok()
    }

    fn mtime(&self, path: &str) -> Option<u64> {
        let modified = std::fs::metadata(self.0.join(path)).ok()?.modified().ok()?;
        modified.duration_since(std::time::UNIX_EPOCH).ok().map(|d| d.as_secs())
    }

    fn list(&self) -> Vec<String> {
        let mut out = Vec::new();
        let mut stack = vec![self.0.clone()];
        while let Some(dir) = stack.pop() {
            let Ok(entries) = std::fs::read_dir(&dir) else { continue };
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_dir() {
                    stack.push(path);
                } else if let Ok(relative) = path.strip_prefix(&self.0) {
                    out.push(relative.to_string_lossy().replace('\\', "/"));
                }
            }
        }
        out.sort();
        out
    }
}

/// Files of a tar (a `.sut`'s `MaterialFile.FileData`).
pub struct TarSource(pub Vec<crate::tar::Entry>);

impl FileSource for TarSource {
    fn read(&self, path: &str) -> Option<Vec<u8>> {
        self.0.iter().find(|e| e.name == path).map(|e| e.data.clone())
    }

    fn list(&self) -> Vec<String> {
        self.0.iter().map(|e| e.name.clone()).collect()
    }
}

impl MaterialFolder {
    /// Reads a material folder on disk.
    pub fn open(dir: impl AsRef<Path>) -> Result<MaterialFolder> {
        MaterialFolder::read(&DirSource(dir.as_ref().to_path_buf()))
    }

    /// A folder as stored in a `.sut` (`catalog.xml` may be missing there:
    /// only the encrypted `catalog.zip` is kept).
    pub fn read(source: &dyn FileSource) -> Result<MaterialFolder> {
        let files = source.list();
        let catalog = match source.read("catalog.xml") {
            Some(xml) => Catalog::parse(&xml)?,
            None => Catalog {
                version: String::new(),
                uuid: String::new(),
                kind: String::new(),
                name: String::new(),
                tool: String::new(),
                content_id: None,
                items: Vec::new(),
                files: Vec::new(),
            },
        };
        let mut info = Vec::new();
        for path in files.iter().filter(|p| p.ends_with(".xml") && (p.ends_with("info.xml") || p.contains("icedata/")))
        {
            if let Some(xml) = source.read(path) {
                info.push(InfoList::parse(&xml)?);
            }
        }
        let mut data_files = Vec::new();
        for path in files.iter().filter(|p| p.contains("data/") && !p.contains("icedata/") || p.ends_with(".zip")) {
            if let Some(bytes) = source.read(path) {
                data_files.push((path.clone(), crate::c2f::summarize(&bytes).map_err(|e| e.to_string())));
            }
        }
        let thumbnails = files.iter().filter(|p| p.ends_with(".png")).cloned().collect();
        Ok(MaterialFolder { catalog, info, data_files, thumbnails })
    }
}

/// The files CSP packs into a `.sut` for one material, in its order:
/// `catalog.zip`, `info.zip`, `data/*`, `thumbnail/thumbnail.png`,
/// `icedata/layerData.xml` (the plain `catalog.xml` and the cloud and
/// cache files stay behind).
pub fn sut_entries(source: &dyn FileSource) -> Vec<crate::tar::Entry> {
    let files = source.list();
    let mut names: Vec<String> = vec!["catalog.zip".into(), "info.zip".into()];
    names.extend(files.iter().filter(|f| f.starts_with("data/") && !f[5..].contains('/')).cloned());
    names.push("thumbnail/thumbnail.png".into());
    names.push("icedata/layerData.xml".into());
    names.into_iter().filter_map(|name| source.read(&name).map(|data| crate::tar::Entry { name, data })).collect()
}

/// [`sut_entries`] as the tar CSP stores, every entry stamped with the
/// time of the material's data file (as CSP does).
pub fn sut_tar(source: &dyn FileSource) -> Result<Option<Vec<u8>>> {
    let entries = sut_entries(source);
    let Some(data) = entries.iter().find(|e| e.name.starts_with("data/")) else { return Ok(None) };
    crate::tar::write_at(&entries, source.mtime(&data.name).unwrap_or(0)).map(Some)
}

/// Index of material folders by their uuid directory name, for finding
/// what a sub tool's [`crate::subtool::blob::MaterialRef`] points at.
pub fn index_by_uuid(roots: &[PathBuf]) -> std::collections::HashMap<String, PathBuf> {
    let mut index = std::collections::HashMap::new();
    for root in roots {
        let mut stack = vec![(root.clone(), 0)];
        while let Some((dir, depth)) = stack.pop() {
            let Ok(entries) = std::fs::read_dir(&dir) else { continue };
            for entry in entries.flatten() {
                let path = entry.path();
                if !path.is_dir() {
                    continue;
                }
                let name = entry.file_name().to_string_lossy().into_owned();
                if name.len() >= 30 && name.matches('-').count() >= 3 {
                    index.entry(name).or_insert_with(|| path.clone());
                }
                if depth < 5 {
                    stack.push((path, depth + 1));
                }
            }
        }
    }
    index
}

/// The folder holding a referenced material's `data/` file: the path
/// components between the last uuid and `data`.
pub fn resolve_ref(index: &std::collections::HashMap<String, PathBuf>, path: &str) -> Option<PathBuf> {
    let parts: Vec<&str> = path.trim_end_matches('\0').split(':').collect();
    let data_at = parts.iter().rposition(|p| *p == "data")?;
    let uuid_at = parts[..data_at].iter().rposition(|p| index.contains_key(*p))?;
    let mut dir = index[parts[uuid_at]].clone();
    for part in &parts[uuid_at + 1..data_at] {
        dir.push(part);
    }
    dir.is_dir().then_some(dir)
}

/// Material folders under CSP's material root (folders with a
/// `catalog.xml`), sorted.
pub fn scan(root: impl AsRef<Path>) -> Vec<PathBuf> {
    let mut found = Vec::new();
    let mut stack = vec![(root.as_ref().to_path_buf(), 0)];
    while let Some((dir, depth)) = stack.pop() {
        if dir.join("catalog.xml").is_file() {
            found.push(dir.clone());
            continue;
        }
        if depth >= 4 {
            continue;
        }
        if let Ok(entries) = std::fs::read_dir(&dir) {
            for entry in entries.flatten() {
                if entry.path().is_dir() {
                    stack.push((entry.path(), depth + 1));
                }
            }
        }
    }
    found.sort();
    found
}

/// `Material/InstallPathToCatalogId.dat` (CSP's install folder): which
/// installed material replaces a material path of older versions
/// (`.:15_brush_pattern:04_plant:twig01.layer` →
/// `.:Paint001:<uuid>:data:material.layer`). Big endian: u64 count, then
/// per entry two strings (u32 length, bytes).
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct InstallMap {
    /// (old material path, installed material path) pairs.
    pub entries: Vec<(String, String)>,
}

impl InstallMap {
    /// Parses `InstallPathToCatalogId.dat`.
    pub fn parse(data: &[u8]) -> Result<InstallMap> {
        let cut = || Error::format("InstallPathToCatalogId: cut short");
        let count = u64::from_be_bytes(data.get(..8).ok_or_else(cut)?.try_into().unwrap()) as usize;
        let mut at = 8;
        let string = |at: &mut usize| -> Result<String> {
            let n = u32::from_be_bytes(data.get(*at..*at + 4).ok_or_else(cut)?.try_into().unwrap()) as usize;
            let bytes = data.get(*at + 4..*at + 4 + n).ok_or_else(cut)?;
            *at += 4 + n;
            String::from_utf8(bytes.to_vec()).map_err(|_| Error::format("InstallPathToCatalogId: not UTF-8"))
        };
        let mut entries = Vec::with_capacity(count.min(100_000));
        for _ in 0..count {
            let old = string(&mut at)?;
            let new = string(&mut at)?;
            entries.push((old, new));
        }
        if at != data.len() {
            return Err(Error::format("InstallPathToCatalogId: bytes after the entries"));
        }
        Ok(InstallMap { entries })
    }

    /// The file bytes; an unchanged map gives the same bytes.
    pub fn to_bytes(&self) -> Vec<u8> {
        let mut out = (self.entries.len() as u64).to_be_bytes().to_vec();
        for text in self.entries.iter().flat_map(|(a, b)| [a, b]) {
            out.extend_from_slice(&(text.len() as u32).to_be_bytes());
            out.extend_from_slice(text.as_bytes());
        }
        out
    }

    /// The installed path that replaces an old one.
    pub fn get(&self, old: &str) -> Option<&str> {
        self.entries.iter().find(|(a, _)| a == old).map(|(_, b)| b.as_str())
    }
}

/// `catalog*.cac` starts with the length-prefixed cache version (`1.0.1.x`).
pub fn looks_like_cac(data: &[u8]) -> bool {
    data.len() > 9 && data[1] == 0 && data[0] as usize + 2 <= data.len() && data[2..].starts_with(b"1.0.1.")
}

/// The strings of a `.cac` cache in order: each is a u16 (little endian)
/// length and UTF-8 bytes; zero words and counts (u32) sit between them.
/// The cache repeats `catalog.xml` (dates, uuids, ids, names, tool
/// versions); this returns the readable strings for reports.
pub fn cac_strings(data: &[u8]) -> Vec<String> {
    let mut out = Vec::new();
    let mut at = 0;
    while at + 2 <= data.len() {
        let n = u16::from_le_bytes([data[at], data[at + 1]]) as usize;
        if n > 0
            && at + 2 + n <= data.len()
            && let Ok(text) = std::str::from_utf8(&data[at + 2..at + 2 + n])
            && text.chars().all(|c| !c.is_control())
        {
            out.push(text.to_owned());
            at += 2 + n;
            continue;
        }
        at += 1;
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    const CATALOG: &str = r#"<?xml version="1.0" encoding="UTF-8" standalone="no" ?>
<archive>
  <version>2.0.8</version>
  <catalog uuid="0a1b2c3d4e-5f60-7182-93a4-b5c6d7e8f9">
    <type>material</type>
    <tool company="celsys" name="paint" version="1.9.3"/>
    <name>線 &amp; 点</name>
    <groups>
      <group uuid="g">
        <type ver="1.0.0">material</type>
        <name></name>
        <items>
          <item uuid="0c3c">
            <type ver="1.0.1">image</type>
            <name>点線</name>
            <created_date>2019/09/02 05:10:40</created_date>
            <thumbnail><fileref idref="t"/></thumbnail>
            <data><fileref idref="d"/></data>
          </item>
        </items>
      </group>
    </groups>
  </catalog>
  <files>
    <file document="false" encrypt="true" id="d" mime="application/octet-stream"><path>data/material_0.layer</path></file>
    <file document="false" encrypt="false" id="t" mime="image/png"><path>thumbnail/thumbnail.png</path></file>
  </files>
</archive>"#;

    #[test]
    fn reads_a_catalog() {
        let catalog = Catalog::parse(CATALOG.as_bytes()).unwrap();
        assert_eq!(catalog.name, "線 & 点");
        assert_eq!(catalog.kind, "material");
        assert_eq!(catalog.tool, "paint 1.9.3");
        assert_eq!(catalog.items.len(), 1);
        let item = &catalog.items[0];
        assert_eq!(item.kind, "image");
        assert!(catalog.file(item.data.as_deref().unwrap()).unwrap().encrypted);
        assert_eq!(catalog.file("t").unwrap().path, "thumbnail/thumbnail.png");
    }

    #[test]
    fn reads_an_info_list() {
        let xml = r#"<?xml version="1.0"?><infolist><version>2.0.0</version><info uuid="u"><datalist key="systemtag"><data>Resizable</data><data>BrushPattern</data></datalist><datalist key="tag"/></info></infolist>"#;
        let list = InfoList::parse(xml.as_bytes()).unwrap();
        assert_eq!(list.infos[0].get("systemtag").unwrap(), ["Resizable", "BrushPattern"]);
        assert_eq!(list.infos[0].get("tag").unwrap().len(), 0);
    }

    #[test]
    fn reads_a_folder_from_a_tar() {
        let tar = crate::tar::write(&[
            crate::tar::Entry { name: "catalog.xml".into(), data: CATALOG.as_bytes().to_vec() },
            crate::tar::Entry {
                name: "data/material_0.layer".into(),
                data: crate::c2f::write(&[crate::c2f::Chunk { kind: *b"HEAD", data: vec![], crc_ok: true }]),
            },
            crate::tar::Entry { name: "thumbnail/thumbnail.png".into(), data: vec![0x89, b'P'] },
        ])
        .unwrap();
        let folder = MaterialFolder::read(&TarSource(crate::tar::read(&tar).unwrap())).unwrap();
        assert_eq!(folder.catalog.items.len(), 1);
        assert_eq!(folder.data_files.len(), 1);
        assert!(folder.data_files[0].1.is_ok());
        assert_eq!(folder.thumbnails, ["thumbnail/thumbnail.png"]);
    }

    #[test]
    fn install_map_round_trips() {
        let map = InstallMap {
            entries: vec![(".:15_brush_pattern:a.layer".into(), ".:Paint001:u:data:material.layer".into())],
        };
        let bytes = map.to_bytes();
        assert_eq!(InstallMap::parse(&bytes).unwrap(), map);
        assert_eq!(map.get(".:15_brush_pattern:a.layer"), Some(".:Paint001:u:data:material.layer"));
        assert!(InstallMap::parse(&bytes[..bytes.len() - 1]).is_err());
    }

    #[test]
    fn cac_strings_skip_counts() {
        let mut data = vec![7, 0];
        data.extend_from_slice(b"1.0.1.6");
        data.extend_from_slice(&[0, 0, 1, 0, 0, 0]);
        data.extend_from_slice(&[3, 0]);
        data.extend_from_slice("線".as_bytes());
        assert!(looks_like_cac(&data));
        assert_eq!(cac_strings(&data), ["1.0.1.6", "線"]);
    }
}
