//! Shortcut keys: `Shortcut/default.khc` (ショートカットキー設定) and the
//! copy each workspace keeps (`.spws`).
//!
//! SQLite. `shortcutmenu` (`workspaceshortcutmenu` in a workspace) has one
//! row per command and key: `menucommandtype` (`basiccommand` for undo,
//! copy and the like, `advancedcommand` for menu commands), `menucommand`
//! (the command id, e.g. `filesaveas`, or a UUID for some commands),
//! `shortcut` (the key name, `NULL` as text when none) and `modifier`
//! (bits: 1 Alt, 2 Shift, 4 Ctrl). A command with several keys has several
//! rows. `workspaceshortcuttool` maps a key to a tool by the tool node's
//! UUID (`Node.NodeUuid` of the tool DB).
//!
//! Modifier key settings (修飾キー設定, `Shortcut/DefaultToolModifyKey.tomd`):
//! `ModifyKeySetting` has one row per kind of tool (`InputOperation`,
//! `OutputOperation`, `RangeOperation` as in `Node.NodeInputOp` …; all 0 for
//! the common settings) and a big-endian `SettingData` BLOB:
//!
//! ```text
//! u32 8, u32 count
//! entry × count: u32 size (with these 12 bytes), u32 keys, u32 action, payload
//!   keys: bits 1 Shift, 2 Ctrl, 4 Alt, 8 Space (others: pen buttons and the like)
//!   action 2: u32 0, u32 16, tool node UUID (switch to that tool)
//!   action 1: u32 operation number; 64, 4, 65536, 131072: u32 value
//! ```
//!
//! Note the modifier bits differ from the shortcut tables'.

use rusqlite::Connection;
use serde::Serialize;

use csp_format::database::{open_bytes, select_all, table_exists};

use crate::error::{Error, Result};

/// Modifier bit of Alt in the shortcut tables.
pub const ALT: i64 = 1;
/// Modifier bit of Shift in the shortcut tables.
pub const SHIFT: i64 = 2;
/// Modifier bit of Ctrl in the shortcut tables.
pub const CTRL: i64 = 4;

/// A command's key (`shortcutmenu` / `workspaceshortcutmenu` row).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Shortcut {
    /// `basiccommand` or `advancedcommand`.
    pub kind: String,
    /// `menucommand`: the command's id.
    pub command: String,
    /// Key name as CSP stores it (`S`, `F2`, `DELETE`, `NUM+` …).
    pub key: String,
    /// [`CTRL`], [`SHIFT`] and [`ALT`] bits.
    pub modifiers: i64,
}

impl Shortcut {
    /// The key as CSP shows it, e.g. `Ctrl+Shift+S`.
    pub fn label(&self) -> String {
        let mut out = String::new();
        for (bit, name) in [(CTRL, "Ctrl+"), (SHIFT, "Shift+"), (ALT, "Alt+")] {
            if self.modifiers & bit != 0 {
                out.push_str(name);
            }
        }
        out.push_str(&self.key);
        out
    }
}

/// A tool's key (`workspaceshortcuttool` row).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ToolShortcut {
    /// The tool node's UUID as hex.
    pub tool: String,
    /// Key name as CSP stores it.
    pub key: String,
}

/// The shortcuts of a `.khc` (ショートカット設定) or `.spws` (workspace).
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
pub struct Shortcuts {
    /// Commands with a key (rows without one are left out).
    pub commands: Vec<Shortcut>,
    /// Commands listed without a key.
    pub unassigned: Vec<String>,
    /// Tools with a key.
    pub tools: Vec<ToolShortcut>,
}

fn no_key(key: &str) -> bool {
    key.is_empty() || key == "NULL"
}

impl Shortcuts {
    /// Opens the bytes of a `.khc` or `.spws`.
    pub fn from_bytes(data: &[u8]) -> Result<Shortcuts> {
        if !crate::subtool::looks_like(data) {
            return Err(Error::format("not a shortcut file (not SQLite)"));
        }
        Shortcuts::read(&open_bytes(data)?)
    }

    /// Reads the shortcut tables of an open database.
    pub fn read(connection: &Connection) -> Result<Shortcuts> {
        let menu = ["shortcutmenu", "workspaceshortcutmenu"]
            .into_iter()
            .find(|t| table_exists(connection, t).unwrap_or(false))
            .ok_or_else(|| Error::format("no shortcutmenu table (not a .khc or .spws file)"))?;
        let mut out = Shortcuts::default();
        for row in select_all(connection, menu)? {
            let command = row.text("menucommand").unwrap_or_default();
            let key = row.text("shortcut").unwrap_or_default();
            if no_key(&key) {
                out.unassigned.push(command);
                continue;
            }
            out.commands.push(Shortcut {
                kind: row.text("menucommandtype").unwrap_or_default(),
                command,
                key,
                modifiers: row.int("modifier"),
            });
        }
        for row in select_all(connection, "workspaceshortcuttool")? {
            let key = row.text("shortcut").unwrap_or_default();
            if no_key(&key) {
                continue;
            }
            let tool = crate::serial::hex(row.blob("uuid").unwrap_or_default());
            out.tools.push(ToolShortcut { tool, key });
        }
        Ok(out)
    }

    /// The keys of one command.
    pub fn keys(&self, command: &str) -> Vec<String> {
        self.commands.iter().filter(|s| s.command == command).map(Shortcut::label).collect()
    }
}

/// Keys of a modifier key setting entry.
pub const MOD_SHIFT: u32 = 1;
/// Modifier key setting bit of Ctrl.
pub const MOD_CTRL: u32 = 2;
/// Modifier key setting bit of Alt.
pub const MOD_ALT: u32 = 4;
/// Modifier key setting bit of Space.
pub const MOD_SPACE: u32 = 8;

/// What a modifier key setting does.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub enum ModifierAction {
    /// Switch to the tool with this node UUID (hex) while the keys are held.
    Tool(String),
    /// Action 1: an operation of the tool (e.g. 100 straight line).
    Operation(u32),
    /// Another action number and its payload.
    Other {
        /// The action number.
        action: u32,
        /// Its payload as hex.
        payload: String,
    },
}

/// One modifier key setting: the keys and what they do.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ModifierEntry {
    /// [`MOD_SHIFT`], [`MOD_CTRL`], [`MOD_ALT`] and [`MOD_SPACE`] bits.
    pub keys: u32,
    /// What the keys do.
    pub action: ModifierAction,
}

impl ModifierEntry {
    /// The keys as CSP shows them, e.g. `Ctrl+Space`; unknown bits as hex.
    pub fn label(&self) -> String {
        let mut parts = Vec::new();
        for (bit, name) in [(MOD_CTRL, "Ctrl"), (MOD_SHIFT, "Shift"), (MOD_ALT, "Alt"), (MOD_SPACE, "Space")] {
            if self.keys & bit != 0 {
                parts.push(name.to_string());
            }
        }
        let rest = self.keys & !(MOD_SHIFT | MOD_CTRL | MOD_ALT | MOD_SPACE);
        if rest != 0 {
            parts.push(format!("0x{rest:x}"));
        }
        parts.join("+")
    }
}

/// The modifier key settings of one kind of tool (by its operation codes).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModifierRule {
    /// `NodeInputOp` of the tools the rule is for.
    pub input_op: i64,
    /// `NodeOutputOp` of the tools the rule is for.
    pub output_op: i64,
    /// `NodeRangeOp` of the tools the rule is for.
    pub range_op: i64,
    /// The entries.
    pub entries: Vec<ModifierEntry>,
}

fn word(data: &[u8], at: usize) -> Result<u32> {
    data.get(at..at + 4)
        .map(|w| u32::from_be_bytes(w.try_into().unwrap()))
        .ok_or_else(|| Error::format(format!("modifier keys: 4 bytes needed at {at:#x} of {}", data.len())))
}

/// One `SettingData` BLOB.
pub fn parse_setting_data(data: &[u8]) -> Result<Vec<ModifierEntry>> {
    if word(data, 0)? != 8 {
        return Err(Error::format("modifier keys: SettingData does not start with 8"));
    }
    let count = word(data, 4)?;
    let mut at = 8;
    let mut entries = Vec::new();
    for _ in 0..count {
        let size = word(data, at)? as usize;
        if size < 12 || at + size > data.len() {
            return Err(Error::format(format!("modifier keys: {size}-byte entry at {at:#x}")));
        }
        let (keys, action) = (word(data, at + 4)?, word(data, at + 8)?);
        let payload = &data[at + 12..at + size];
        let action = match (action, payload.len()) {
            (2, 24) if payload[..8] == [0, 0, 0, 0, 0, 0, 0, 16] => {
                ModifierAction::Tool(crate::serial::hex(&payload[8..]))
            }
            (1, 4) => ModifierAction::Operation(word(payload, 0)?),
            _ => ModifierAction::Other { action, payload: crate::serial::hex(payload) },
        };
        entries.push(ModifierEntry { keys, action });
        at += size;
    }
    if at != data.len() {
        return Err(Error::format(format!("modifier keys: {} bytes after the entries", data.len() - at)));
    }
    Ok(entries)
}

/// The rules of a `.tomd` file (rows without `SettingData` are left out).
pub fn modifier_keys(data: &[u8]) -> Result<Vec<ModifierRule>> {
    if !crate::subtool::looks_like(data) {
        return Err(Error::format("not a modifier key file (not SQLite)"));
    }
    let connection = open_bytes(data)?;
    if !table_exists(&connection, "ModifyKeySetting")? {
        return Err(Error::format("no ModifyKeySetting table (not a .tomd file)"));
    }
    let mut rules = Vec::new();
    for row in select_all(&connection, "ModifyKeySetting")? {
        let Some(blob) = row.blob("SettingData") else { continue };
        rules.push(ModifierRule {
            input_op: row.int("InputOperation"),
            output_op: row.int("OutputOperation"),
            range_op: row.int("RangeOperation"),
            entries: parse_setting_data(blob)?,
        });
    }
    Ok(rules)
}

#[cfg(test)]
mod tests {
    use super::*;
    use csp_format::database::serialize;

    fn khc() -> Vec<u8> {
        let c = Connection::open_in_memory().unwrap();
        c.execute_batch(
            "CREATE TABLE shortcutinfo(_PW_ID INTEGER PRIMARY KEY AUTOINCREMENT);
             CREATE TABLE shortcutmenu(_PW_ID INTEGER PRIMARY KEY AUTOINCREMENT, menucommandtype TEXT,
               menucommand TEXT, shortcut TEXT, modifier INTEGER);
             INSERT INTO shortcutmenu(menucommandtype, menucommand, shortcut, modifier) VALUES
               ('advancedcommand', 'filesaveas', 'S', 6), ('advancedcommand', 'filesaveaspng', 'NULL', 0),
               ('basiccommand', 'undo', 'Z', 4), ('basiccommand', 'undo', 'Z', 0),
               ('advancedcommand', 'editpaint', 'DELETE', 1);",
        )
        .unwrap();
        serialize(&c).unwrap()
    }

    #[test]
    fn reads_commands_and_keys() {
        let s = Shortcuts::from_bytes(&khc()).unwrap();
        assert_eq!(s.keys("filesaveas"), ["Ctrl+Shift+S"]);
        assert_eq!(s.keys("undo"), ["Ctrl+Z", "Z"]);
        assert_eq!(s.keys("editpaint"), ["Alt+DELETE"]);
        assert_eq!(s.unassigned, ["filesaveaspng"]);
        assert!(s.tools.is_empty());
    }

    #[test]
    fn rejects_other_databases() {
        let c = Connection::open_in_memory().unwrap();
        c.execute_batch("CREATE TABLE other(a);").unwrap();
        assert!(Shortcuts::from_bytes(&serialize(&c).unwrap()).is_err());
        assert!(Shortcuts::from_bytes(b"SLCC").is_err());
    }

    #[test]
    fn reads_modifier_key_entries() {
        let mut data = [8u32, 3].iter().flat_map(|w| w.to_be_bytes()).collect::<Vec<u8>>();
        for w in [36u32, MOD_CTRL | MOD_SPACE, 2, 0, 16] {
            data.extend(w.to_be_bytes());
        }
        data.extend([7u8; 16]);
        for w in [16u32, MOD_SHIFT, 1, 100, 16, MOD_CTRL | MOD_ALT, 64, 0] {
            data.extend(w.to_be_bytes());
        }
        let entries = parse_setting_data(&data).unwrap();
        assert_eq!(entries[0].label(), "Ctrl+Space");
        assert_eq!(entries[0].action, ModifierAction::Tool("07".repeat(16)));
        assert_eq!(entries[1].action, ModifierAction::Operation(100));
        assert_eq!(entries[2].label(), "Ctrl+Alt");
        assert_eq!(entries[2].action, ModifierAction::Other { action: 64, payload: "00000000".into() });
        assert!(parse_setting_data(&data[..data.len() - 2]).is_err());
    }
}
