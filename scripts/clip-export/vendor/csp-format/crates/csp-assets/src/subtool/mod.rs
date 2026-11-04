//! Sub tools (サブツール): exported sub tools (`.sut`), CSP's tool
//! database (`Tool/EditImageTool.todb`, also the colour mixing palette's
//! `MixPaletteTool.todb`) and brush presets (`BrushPreset.bfps`).
//!
//! All are SQLite files with the same tables:
//!
//! - `Manager` (one row): `RootUuid` (top node), `CurrentNodeUuid`,
//!   `MaxVariantID`, `CommonVariantID` (settings shared by every sub tool),
//!   `PressureGraph` (筆圧検知レベルの調節, [`blob::Records`] of points),
//!   `Version`, `SavedCount`.
//! - `Node`: the tree. `NodeFirstChildUuid` / `NodeNextUuid` link it (a
//!   single zero byte or zeros mean "none"); depth 1 is a tool (ペン),
//!   depth 2 a group (ペン, マーカー), depth 3 a sub tool (Gペン). A sub
//!   tool points at its settings with `NodeVariantID` and at its initial
//!   settings (初期設定に登録) with `NodeInitVariantID`. `NodeInputOp` /
//!   `NodeOutputOp` / `NodeRangeOp` say what kind of tool it is, see
//!   [`ToolKind`].
//! - `Variant`: one row of settings per id. CSP adds columns as features
//!   appear, and a `.sut` holds only the columns its tool uses, so columns
//!   are looked up by name. Binary columns: [`blob`]. Meanings of all
//!   columns: `docs/assets/spec/subtool-columns.tsv`.
//! - `MaterialFile` (`.sut` only): materials the sub tool uses (brush tips,
//!   paper), each a tar of the material folder in `FileData`, found by
//!   `OriginalPath` (the path stored in the [`blob::MaterialList`]).
//!
//! Files are read into memory and opened there: CSP may hold its own
//! database open, and nothing is written back to the input.

pub mod blob;

use std::collections::{BTreeMap, HashMap, HashSet};

use rusqlite::Connection;
use rusqlite::types::Value;
use serde::Serialize;
use serde_json::{Map, Value as Json, json};

use csp_format::database::{Row, columns, open_bytes, quote, select_all, serialize, table_exists};

use crate::error::{Error, Result};

/// What a node does, from `NodeInputOp` (how it is used on the canvas) and
/// `NodeOutputOp` (what it changes). Codes from CSP's own tool database.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub enum ToolKind {
    /// A tool or group (no settings).
    Folder,
    /// Freehand drawing: pens, pencils, brushes, airbrushes (output 10, 11, 14).
    Brush,
    /// 消しゴム (output 12).
    Eraser,
    /// Blend / copy stamp (色混ぜ, output 13 and similar).
    Blend,
    /// 選択範囲 (output 20).
    Selection,
    /// 塗りつぶし (output 31, 50, 51).
    Fill,
    /// グラデーション (output 52, 54).
    Gradient,
    /// 図形 (output 30, 32, 33).
    Shape,
    /// テキスト (output 70).
    Text,
    /// フキダシ (output 61, 62).
    Balloon,
    /// コマ枠 (output 60, 63).
    Frame,
    /// Flash, concentration and stream lines (効果線).
    EffectLines,
    /// ベクター線の編集: 線修正, ベクター消去 and the like (output 53, 80–85).
    VectorEdit,
    /// 定規 (output 90–93).
    Ruler,
    /// View tools: 虫めがね, 手のひら, 回転 (output 1–3).
    View,
    /// 操作 and similar (output 40, 42, 45, 100, 110).
    Operation,
    /// スポイト (output 41).
    Eyedropper,
    /// ゆがみ (output 120).
    Liquify,
    /// An output code not listed here.
    Other,
}

impl ToolKind {
    /// The kind of a node's `NodeInputOp` / `NodeOutputOp`.
    pub fn of(input: i64, output: i64) -> ToolKind {
        match (input, output) {
            (0, 0) => ToolKind::Folder,
            (_, 12) => ToolKind::Eraser,
            (_, 10 | 11 | 14) => ToolKind::Brush,
            (_, 13) => ToolKind::Blend,
            (_, 20) => ToolKind::Selection,
            (_, 31 | 50 | 51) => ToolKind::Fill,
            (_, 52 | 54) => ToolKind::Gradient,
            (_, 30 | 32 | 33) => ToolKind::Shape,
            (_, 70) => ToolKind::Text,
            (_, 61 | 62) => ToolKind::Balloon,
            (_, 60 | 63) => ToolKind::Frame,
            (_, 64 | 65) => ToolKind::EffectLines,
            (_, 53 | 80..=85) => ToolKind::VectorEdit,
            (_, 90..=93) => ToolKind::Ruler,
            (_, 1..=3) => ToolKind::View,
            (_, 40 | 42 | 45 | 100 | 110) => ToolKind::Operation,
            (_, 41) => ToolKind::Eyedropper,
            (_, 120) => ToolKind::Liquify,
            _ => ToolKind::Other,
        }
    }
}

/// Which file a database came from (by its tables and use).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum DbKind {
    /// An exported sub tool (has `MaterialFile`, one tree of one node).
    SubTool,
    /// CSP's tool database or a brush preset file.
    ToolDb,
}

/// One `Node` row: a tool, a group or a sub tool.
#[derive(Debug, Clone)]
pub struct Node {
    /// The whole row, for the columns not typed here.
    pub row: Row,
    /// `NodeUuid`.
    pub uuid: Vec<u8>,
    /// `NodeName`, as shown in CSP.
    pub name: String,
    /// `NodeInputOp`.
    pub input_op: i64,
    /// `NodeOutputOp`.
    pub output_op: i64,
    /// `NodeRangeOp`.
    pub range_op: i64,
    /// `NodeVariantID`: the settings row (0 for a tool or group).
    pub variant_id: i64,
    /// `NodeInitVariantID`: the initial settings (初期設定) row.
    pub init_variant_id: i64,
    /// `NodeFirstChildUuid`, None when there is no child.
    pub first_child: Option<Vec<u8>>,
    /// `NodeNextUuid`, None when there is no next sibling.
    pub next: Option<Vec<u8>>,
}

impl Node {
    fn from_row(row: Row) -> Node {
        let link = |column: &str| row.blob(column).filter(|uuid| !is_none(uuid)).map(<[u8]>::to_vec);
        Node {
            uuid: row.blob("NodeUuid").unwrap_or_default().to_vec(),
            name: row.text("NodeName").unwrap_or_default(),
            input_op: row.int("NodeInputOp"),
            output_op: row.int("NodeOutputOp"),
            range_op: row.int("NodeRangeOp"),
            variant_id: row.int("NodeVariantID"),
            init_variant_id: row.int("NodeInitVariantID"),
            first_child: link("NodeFirstChildUuid"),
            next: link("NodeNextUuid"),
            row,
        }
    }

    /// What the node does ([`ToolKind::Folder`] when it has no settings).
    pub fn kind(&self) -> ToolKind {
        if self.variant_id == 0 { ToolKind::Folder } else { ToolKind::of(self.input_op, self.output_op) }
    }

    /// The uuid as lower-case hex digits.
    pub fn uuid_hex(&self) -> String {
        crate::serial::hex(&self.uuid)
    }
}

/// "No node": an empty blob, a single zero byte or all zeros.
pub fn is_none(uuid: &[u8]) -> bool {
    uuid.iter().all(|&b| b == 0)
}

/// A material stored in a `.sut`.
#[derive(Debug, Clone, Serialize)]
pub struct MaterialFile {
    /// `OriginalPath`: the path the sub tool's material list names.
    pub original_path: String,
    /// `CatalogPath`.
    pub catalog_path: String,
    /// `InstallFolder`, as stored.
    pub install_folder: i64,
    /// `FileData`: a tar of the material folder.
    #[serde(skip)]
    pub file_data: Vec<u8>,
}

impl MaterialFile {
    /// The files of the material folder.
    pub fn entries(&self) -> Result<Vec<crate::tar::Entry>> {
        crate::tar::read(&self.file_data)
    }

    /// The material's thumbnail (PNG), a picture of the brush tip or paper.
    pub fn thumbnail(&self) -> Option<Vec<u8>> {
        self.entries().ok()?.into_iter().find(|e| e.name.ends_with("thumbnail.png")).map(|e| e.data)
    }
}

/// A place in the tree.
#[derive(Debug, Clone, Serialize)]
pub struct TreeEntry {
    /// Index into [`SubToolDb::nodes`].
    pub node: usize,
    /// Depth in the tree (0 the root).
    pub depth: usize,
    /// Names of the nodes above (the unnamed root left out).
    pub path: Vec<String>,
}

/// Problems with the tree links.
#[derive(Debug, Clone, Default, Serialize)]
pub struct TreeCheck {
    /// Nodes reached from the root.
    pub reachable: usize,
    /// Nodes in the table.
    pub nodes: usize,
    /// Links to uuids no node has.
    pub missing_links: usize,
    /// Nodes reached twice (a cycle or a shared child).
    pub repeated: usize,
    /// Nodes not reached from the root. CSP leaves these behind (a real
    /// tool database had one eraser node no link pointed at); they are
    /// reported but do not make the tree broken.
    pub unreachable: usize,
    /// Sub tools whose settings row is missing.
    pub missing_variants: usize,
}

impl TreeCheck {
    /// The links form a proper tree (unreachable nodes are allowed).
    pub fn closed(&self) -> bool {
        self.missing_links == 0 && self.repeated == 0 && self.missing_variants == 0
    }
}

/// A sub tool file or tool database, read into memory.
pub struct SubToolDb {
    connection: Connection,
    /// Which kind of file it is.
    pub kind: DbKind,
    /// The `Manager` row.
    pub manager: Row,
    /// Every `Node` row, in table order.
    pub nodes: Vec<Node>,
    /// Every `Variant` row, by `VariantID`.
    pub variants: BTreeMap<i64, Row>,
    /// `MaterialFile` rows (`.sut` only).
    pub materials: Vec<MaterialFile>,
}

impl std::fmt::Debug for SubToolDb {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("SubToolDb")
            .field("kind", &self.kind)
            .field("nodes", &self.nodes.len())
            .field("variants", &self.variants.len())
            .finish()
    }
}

/// Whether the bytes look like a sub tool file (a SQLite file).
pub fn looks_like(data: &[u8]) -> bool {
    data.starts_with(b"SQLite format 3\0")
}

impl SubToolDb {
    /// Reads a file into memory and opens it; the file is not changed.
    pub fn open(path: impl AsRef<std::path::Path>) -> Result<SubToolDb> {
        SubToolDb::from_bytes(&std::fs::read(path)?)
    }

    /// Opens the bytes of a sub tool file or tool database.
    pub fn from_bytes(data: &[u8]) -> Result<SubToolDb> {
        if !looks_like(data) {
            return Err(Error::format("not a sub tool file (not SQLite)"));
        }
        let connection = open_bytes(data)?;
        for table in ["Manager", "Node", "Variant"] {
            if !table_exists(&connection, table)? {
                return Err(Error::format(format!("not a sub tool file: no {table} table")));
            }
        }
        let mut db = SubToolDb {
            kind: if table_exists(&connection, "MaterialFile")? { DbKind::SubTool } else { DbKind::ToolDb },
            manager: Row::default(),
            nodes: Vec::new(),
            variants: BTreeMap::new(),
            materials: Vec::new(),
            connection,
        };
        db.reload()?;
        Ok(db)
    }

    fn reload(&mut self) -> Result<()> {
        let c = &self.connection;
        self.manager =
            select_all(c, "Manager")?.into_iter().next().ok_or_else(|| Error::format("Manager has no row"))?;
        self.nodes = select_all(c, "Node")?.into_iter().map(Node::from_row).collect();
        self.variants = select_all(c, "Variant")?.into_iter().map(|row| (row.int("VariantID"), row)).collect();
        self.materials = select_all(c, "MaterialFile")?
            .into_iter()
            .map(|row| MaterialFile {
                original_path: row.text("OriginalPath").unwrap_or_default(),
                catalog_path: row.text("CatalogPath").unwrap_or_default(),
                install_folder: row.int("InstallFolder"),
                file_data: row.blob("FileData").unwrap_or_default().to_vec(),
            })
            .collect();
        Ok(())
    }

    /// The database (in memory).
    pub fn connection(&self) -> &Connection {
        &self.connection
    }

    /// The database as a file (with any edits).
    pub fn to_bytes(&self) -> Result<Vec<u8>> {
        serialize(&self.connection)
    }

    /// `Manager.RootUuid`, the top node.
    pub fn root_uuid(&self) -> Option<Vec<u8>> {
        self.manager.blob("RootUuid").filter(|u| !is_none(u)).map(<[u8]>::to_vec)
    }

    /// The settings shared by every sub tool (`Manager.CommonVariantID`).
    pub fn common_variant(&self) -> Option<&Row> {
        self.variants.get(&self.manager.int("CommonVariantID"))
    }

    fn index_by_uuid(&self) -> HashMap<&[u8], usize> {
        self.nodes.iter().enumerate().map(|(i, n)| (n.uuid.as_slice(), i)).collect()
    }

    /// The tree in display order. A `.sut` whose root is missing lists its
    /// nodes as they are.
    pub fn tree(&self) -> Vec<TreeEntry> {
        self.walk().0
    }

    fn walk(&self) -> (Vec<TreeEntry>, TreeCheck) {
        let index = self.index_by_uuid();
        let mut out = Vec::new();
        let mut check = TreeCheck { nodes: self.nodes.len(), ..TreeCheck::default() };
        check.missing_variants =
            self.nodes.iter().filter(|n| n.variant_id != 0 && !self.variants.contains_key(&n.variant_id)).count();
        let Some(root) = self.root_uuid().filter(|u| index.contains_key(u.as_slice())) else {
            out.extend((0..self.nodes.len()).map(|node| TreeEntry { node, depth: 0, path: Vec::new() }));
            check.reachable = self.nodes.len();
            return (out, check);
        };
        let mut seen = HashSet::new();
        // Depth first: a node, then its children, then its next sibling.
        let mut stack: Vec<(Vec<u8>, usize, Vec<String>)> = vec![(root, 0, Vec::new())];
        while let Some((uuid, depth, path)) = stack.pop() {
            let Some(&i) = index.get(uuid.as_slice()) else {
                check.missing_links += 1;
                continue;
            };
            if !seen.insert(i) {
                check.repeated += 1;
                continue;
            }
            let node = &self.nodes[i];
            if let Some(next) = &node.next {
                stack.push((next.clone(), depth, path.clone()));
            }
            if let Some(child) = &node.first_child {
                let mut child_path = path.clone();
                // The unnamed root is not part of the names.
                if !(depth == 0 && node.name.is_empty()) {
                    child_path.push(node.name.clone());
                }
                stack.push((child.clone(), depth + 1, child_path));
            }
            out.push(TreeEntry { node: i, depth, path });
        }
        check.reachable = seen.len();
        check.unreachable = self.nodes.len() - seen.len();
        (out, check)
    }

    /// Problems with the tree links.
    pub fn check_tree(&self) -> TreeCheck {
        self.walk().1
    }

    /// Sub tools (nodes with settings) in tree order.
    pub fn sub_tools(&self) -> Vec<TreeEntry> {
        self.tree().into_iter().filter(|e| self.nodes[e.node].variant_id != 0).collect()
    }

    /// The settings row with this `VariantID`.
    pub fn variant(&self, id: i64) -> Option<&Row> {
        self.variants.get(&id)
    }

    /// Find a sub tool by name (or "group/name" path suffix).
    pub fn find(&self, name: &str) -> Option<TreeEntry> {
        self.sub_tools().into_iter().find(|e| {
            let node = &self.nodes[e.node];
            node.name == name || format!("{}/{}", e.path.join("/"), node.name).ends_with(name)
        })
    }

    /// The settings of a variant as JSON: every non-NULL column, binary
    /// columns decoded.
    pub fn variant_json(&self, id: i64) -> Option<Json> {
        let row = self.variants.get(&id)?;
        Some(row_json(row))
    }

    /// Set one setting. The column is added when the table lacks it.
    pub fn set_value(&mut self, variant_id: i64, column: &str, value: Value) -> Result<()> {
        if !self.variants.contains_key(&variant_id) {
            return Err(Error::format(format!("no settings row {variant_id}")));
        }
        self.ensure_column("Variant", column, &value)?;
        let sql = format!("UPDATE Variant SET {} = ?1 WHERE VariantID = ?2", quote(column));
        self.connection.execute(&sql, rusqlite::params![value, variant_id])?;
        self.reload()
    }

    fn ensure_column(&self, table: &str, column: &str, value: &Value) -> Result<()> {
        if columns(&self.connection, table)?.iter().any(|(name, _)| name == column) {
            return Ok(());
        }
        let kind = match value {
            Value::Integer(_) => "INTEGER",
            Value::Real(_) => "REAL",
            Value::Text(_) => "TEXT",
            Value::Blob(_) => "BLOB",
            Value::Null => "",
        };
        self.connection
            .execute(&format!("ALTER TABLE {} ADD COLUMN {} {kind} DEFAULT NULL", quote(table), quote(column)), [])?;
        Ok(())
    }

    /// Rename a node.
    pub fn rename(&mut self, node: usize, name: &str) -> Result<()> {
        let uuid = self.nodes.get(node).ok_or_else(|| Error::format("no such node"))?.uuid.clone();
        self.connection.execute("UPDATE Node SET NodeName = ?1 WHERE NodeUuid = ?2", rusqlite::params![name, uuid])?;
        self.reload()
    }

    /// Material references of a variant (brush tips and paper textures),
    /// by column.
    pub fn material_refs(&self, variant_id: i64) -> Vec<(String, blob::MaterialRef)> {
        let Some(row) = self.variants.get(&variant_id) else { return Vec::new() };
        let mut refs = Vec::new();
        for (column, value) in row.iter() {
            if blob::kind_of_column(column) != blob::BlobKind::MaterialList {
                continue;
            }
            if let Value::Blob(data) = value
                && let Ok(list) = blob::MaterialList::parse(data)
            {
                refs.extend(list.materials.into_iter().map(|m| (column.to_owned(), m)));
            }
        }
        refs
    }

    /// Write one sub tool as a `.sut`: its node (unlinked), its settings
    /// and initial settings rows (only the columns they use), the
    /// manager row, and the materials `resolve` can supply (a tar of the
    /// material folder for each referenced path).
    pub fn extract_sut(&self, node: usize, resolve: &dyn Fn(&blob::MaterialRef) -> Option<Vec<u8>>) -> Result<Vec<u8>> {
        let node = self.nodes.get(node).ok_or_else(|| Error::format("no such node"))?;
        if node.variant_id == 0 {
            return Err(Error::format(format!("{} is a folder, not a sub tool", node.name)));
        }
        let out = Connection::open_in_memory()?;
        let manager_sql = table_sql(&self.connection, "Manager")?;
        out.execute_batch(&manager_sql)?;
        let ids: Vec<i64> =
            [node.variant_id, node.init_variant_id].into_iter().filter(|id| self.variants.contains_key(id)).collect();
        // Node table as in CSP's .sut files (without the material columns
        // of the tool database).
        let node_columns: Vec<String> = columns(&self.connection, "Node")?
            .into_iter()
            .map(|(name, _)| name)
            .filter(|name| !name.starts_with("NodeMaterial"))
            .collect();
        let node_decl = declare(&self.connection, "Node", &node_columns)?;
        out.execute_batch(&format!("CREATE TABLE Node({node_decl});"))?;
        let mut used: Vec<String> = Vec::new();
        for (name, _) in columns(&self.connection, "Variant")? {
            let keep = matches!(name.as_str(), "_PW_ID" | "VariantID" | "VariantShowSeparator" | "VariantShowParam")
                || ids.iter().any(|id| self.variants[id].is_set(&name));
            if keep {
                used.push(name);
            }
        }
        let variant_decl = declare(&self.connection, "Variant", &used)?;
        out.execute_batch(&format!(
            "CREATE TABLE Variant({variant_decl});
             CREATE TABLE MaterialFile(_PW_ID INTEGER PRIMARY KEY AUTOINCREMENT, InstallFolder INTEGER DEFAULT NULL, OriginalPath TEXT DEFAULT NULL, OldMaterial INTEGER DEFAULT NULL, FileData BLOB DEFAULT NULL, CatalogPath TEXT DEFAULT NULL, MaterialUuid TEXT DEFAULT NULL);"
        ))?;
        // Manager: same values, the root is the sub tool.
        let manager_columns: Vec<String> = self.manager.columns().iter().filter(|c| *c != "_PW_ID").cloned().collect();
        let mut values: Vec<Value> =
            manager_columns.iter().map(|c| self.manager.get(c).cloned().unwrap_or(Value::Null)).collect();
        for (i, c) in manager_columns.iter().enumerate() {
            match c.as_str() {
                "RootUuid" => values[i] = Value::Blob(node.uuid.clone()),
                "CurrentNodeUuid" => values[i] = Value::Blob(vec![0]),
                _ => {}
            }
        }
        insert(&out, "Manager", &manager_columns, &values)?;
        let node_values: Vec<Value> = node_columns
            .iter()
            .filter(|c| *c != "_PW_ID")
            .map(|c| match c.as_str() {
                "NodeNextUuid" | "NodeFirstChildUuid" | "NodeSelectedUuid" => Value::Blob(vec![0]),
                _ => node.row.get(c).cloned().unwrap_or(Value::Null),
            })
            .collect();
        let node_names: Vec<String> = node_columns.iter().filter(|c| *c != "_PW_ID").cloned().collect();
        insert(&out, "Node", &node_names, &node_values)?;
        let variant_names: Vec<String> = used.iter().filter(|c| *c != "_PW_ID").cloned().collect();
        for id in &ids {
            let row = &self.variants[id];
            let values: Vec<Value> = variant_names.iter().map(|c| row.get(c).cloned().unwrap_or(Value::Null)).collect();
            insert(&out, "Variant", &variant_names, &values)?;
        }
        let mut seen = HashSet::new();
        for id in &ids {
            for (_, material) in self.material_refs(*id) {
                if !seen.insert(material.path.clone()) {
                    continue;
                }
                if let Some(tar) = resolve(&material) {
                    let user = material.user_relative_path();
                    let catalog = user.as_ref().map(|p| {
                        let parts: Vec<&str> = p.split('/').take(3).collect();
                        format!(".:{}", parts.join(":"))
                    });
                    insert(
                        &out,
                        "MaterialFile",
                        &["InstallFolder", "OriginalPath", "OldMaterial", "FileData", "CatalogPath", "MaterialUuid"]
                            .map(String::from),
                        &[
                            Value::Integer(if user.is_some() { 0 } else { 1 }),
                            Value::Text(material.path.trim_end_matches('\0').to_owned()),
                            Value::Integer(0),
                            Value::Blob(tar),
                            Value::Text(catalog.unwrap_or_default()),
                            Value::Text(String::new()),
                        ],
                    )?;
                }
            }
        }
        serialize(&out)
    }
}

fn table_sql(connection: &Connection, table: &str) -> Result<String> {
    let sql: String =
        connection
            .query_row("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?1", [table], |row| row.get(0))?;
    Ok(format!("{sql};"))
}

/// Column declarations of `names` as the source table declares them.
fn declare(connection: &Connection, table: &str, names: &[String]) -> Result<String> {
    let declared: HashMap<String, String> = columns(connection, table)?.into_iter().collect();
    Ok(names
        .iter()
        .map(|name| {
            let kind = declared.get(name).map(String::as_str).unwrap_or("");
            if name == "_PW_ID" {
                "_PW_ID INTEGER PRIMARY KEY AUTOINCREMENT".to_owned()
            } else if kind.is_empty() {
                format!("{name} NULL DEFAULT NULL")
            } else {
                format!("{name} {kind} DEFAULT NULL")
            }
        })
        .collect::<Vec<_>>()
        .join(", "))
}

fn insert(connection: &Connection, table: &str, names: &[String], values: &[Value]) -> Result<()> {
    let placeholders: Vec<String> = (1..=names.len()).map(|i| format!("?{i}")).collect();
    let sql = format!(
        "INSERT INTO {} ({}) VALUES ({})",
        quote(table),
        names.iter().map(|n| quote(n)).collect::<Vec<_>>().join(", "),
        placeholders.join(", ")
    );
    connection.execute(&sql, rusqlite::params_from_iter(values.iter()))?;
    Ok(())
}

/// A row as JSON, binary columns decoded.
pub fn row_json(row: &Row) -> Json {
    let mut map = Map::new();
    for (column, value) in row.iter() {
        let json = match value {
            Value::Null => continue,
            Value::Integer(v) => json!(v),
            Value::Real(v) => json!(v),
            Value::Text(v) => json!(v),
            Value::Blob(data) => match blob::kind_of_column(column) {
                blob::BlobKind::Unknown if column.ends_with("Uuid") => json!(crate::serial::hex(data)),
                blob::BlobKind::Unknown => json!({ "hex": crate::serial::hex(data) }),
                _ => blob::to_json(column, data),
            },
        };
        map.insert(column.to_owned(), json);
    }
    Json::Object(map)
}

/// Every blob of every variant parses and re-serialises to its bytes.
/// Returns (checked, failures as (variant id, column, error)).
pub fn check_blobs(db: &SubToolDb) -> (usize, Vec<(i64, String, String)>) {
    let mut checked = 0;
    let mut failures = Vec::new();
    let manager_graph = db.manager.blob("PressureGraph").map(|d| (0i64, "PressureGraph".to_owned(), d.to_vec()));
    let rows = db.variants.iter().flat_map(|(id, row)| {
        row.iter().filter_map(move |(c, v)| match v {
            Value::Blob(d) => Some((*id, c.to_owned(), d.clone())),
            _ => None,
        })
    });
    for (id, column, data) in rows.chain(manager_graph) {
        if blob::kind_of_column(&column) == blob::BlobKind::Unknown {
            continue;
        }
        checked += 1;
        match blob::round_trips(&column, &data) {
            Ok(true) => {}
            Ok(false) => failures.push((id, column, "bytes differ".into())),
            Err(error) => failures.push((id, column, error.to_string())),
        }
    }
    (checked, failures)
}

#[cfg(test)]
mod tests;
