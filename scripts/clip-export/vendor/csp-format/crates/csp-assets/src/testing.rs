//! Synthetic files for tests (no CSP data): a tool database with a pen
//! tool holding two sub tools (one with a brush tip material), an auto
//! action set, a gradient set, shortcut tables and modifier key settings.

use rusqlite::Connection;

use crate::action::ActionSet;
use crate::gradient::{Gradient, GradientData, GradientGroup, GradientSet, Stop};
use crate::serial::{Document, Object, Value};
use crate::subtool::blob::{self, MaterialList, MaterialRef, Records};

pub const TIP_UUID: &str = "0a1b2c3d4e-5f60-7182-93a4-b5c6d7e8f9";

pub fn uuid(n: u8) -> Vec<u8> {
    vec![n; 16]
}

pub fn tip_list() -> Vec<u8> {
    MaterialList {
        materials: vec![MaterialRef {
            path: format!(".:56:16:{TIP_UUID}:data:material_0.layer"),
            kind: Some(2),
            name: Some("丸".into()),
            flag: Some(1),
            install_path: Some(String::new()),
            rest: vec![0, 0, 0, 0],
        }],
    }
    .to_bytes()
}

/// root → ペン → G-ペン (settings 1, initial 101, brush tip) and 丸ペン
/// (settings 2, initial 102); common settings 9.
pub fn tool_db() -> Vec<u8> {
    let c = Connection::open_in_memory().unwrap();
    c.execute_batch(
        "CREATE TABLE Manager(_PW_ID INTEGER PRIMARY KEY AUTOINCREMENT, ToolType INTEGER DEFAULT NULL, Version INTEGER DEFAULT NULL, RootUuid BLOB DEFAULT NULL, CurrentNodeUuid BLOB DEFAULT NULL, CommonVariantID INTEGER DEFAULT NULL);
         CREATE TABLE Node(_PW_ID INTEGER PRIMARY KEY AUTOINCREMENT, NodeUuid BLOB DEFAULT NULL, NodeName TEXT DEFAULT NULL, NodeInputOp INTEGER DEFAULT NULL, NodeOutputOp INTEGER DEFAULT NULL, NodeRangeOp INTEGER DEFAULT NULL, NodeVariantID INTEGER DEFAULT NULL, NodeInitVariantID INTEGER DEFAULT NULL, NodeFirstChildUuid BLOB DEFAULT NULL, NodeNextUuid BLOB DEFAULT NULL, NodeSelectedUuid BLOB DEFAULT NULL, NodeMaterialPath TEXT DEFAULT NULL);
         CREATE TABLE Variant(_PW_ID INTEGER PRIMARY KEY AUTOINCREMENT, VariantID INTEGER DEFAULT NULL, VariantShowSeparator INTEGER DEFAULT NULL, VariantShowParam BLOB DEFAULT NULL, BrushSize REAL DEFAULT NULL, BrushSizeEffector BLOB DEFAULT NULL, BrushPatternImageArray BLOB DEFAULT NULL, Opacity INTEGER DEFAULT NULL);",
    )
    .unwrap();
    c.execute(
        "INSERT INTO Manager(ToolType, Version, RootUuid, CurrentNodeUuid, CommonVariantID) VALUES (0, 126, ?1, ?2, 9)",
        rusqlite::params![uuid(1), uuid(3)],
    )
    .unwrap();
    let none = vec![0u8];
    // uuid, name, input op, output op, variant, initial variant, first child, next.
    type NodeRow = (Vec<u8>, &'static str, i64, i64, i64, i64, Vec<u8>, Vec<u8>);
    let nodes: [NodeRow; 4] = [
        (uuid(1), "", 0, 0, 0, 0, uuid(2), none.clone()),
        (uuid(2), "ペン", 1, 10, 0, 0, uuid(3), none.clone()),
        (uuid(3), "G-ペン", 1, 10, 1, 101, none.clone(), uuid(4)),
        (uuid(4), "丸ペン", 1, 10, 2, 102, none.clone(), none.clone()),
    ];
    for (id, name, input, output, variant, init, child, next) in nodes {
        c.execute(
            "INSERT INTO Node(NodeUuid, NodeName, NodeInputOp, NodeOutputOp, NodeRangeOp, NodeVariantID, NodeInitVariantID, NodeFirstChildUuid, NodeNextUuid, NodeSelectedUuid, NodeMaterialPath) VALUES (?1, ?2, ?3, ?4, 0, ?5, ?6, ?7, ?8, ?9, 'x')",
            rusqlite::params![id, name, input, output, variant, init, child, next, none],
        )
        .unwrap();
    }
    let show = blob::show_items_bytes(&[1, 2, 3]);
    // Pressure → size, minimum 20 %, graph (0,0)-(1,1).
    let effector = blob::Effector {
        header_size: 44,
        offered: blob::INPUT_PRESSURE | blob::INPUT_TILT,
        inputs: blob::INPUT_PRESSURE,
        minimum: [20, 0, 0, 0],
        word7: 0,
        word10: Some(100),
        pressure_graph: Some(Records::from_points(&[[0.0, 0.0], [1.0, 1.0]])),
        tilt_graph: None,
        velocity_graph: None,
    }
    .to_bytes();
    for (id, size, tip) in [
        (1, Some(5.0), Some(tip_list())),
        (101, Some(5.0), Some(tip_list())),
        (2, Some(3.0), None),
        (102, None, None),
        (9, None, None),
    ] {
        c.execute(
            "INSERT INTO Variant(VariantID, VariantShowSeparator, VariantShowParam, BrushSize, BrushSizeEffector, BrushPatternImageArray, Opacity) VALUES (?1, 0, ?2, ?3, ?4, ?5, 100)",
            rusqlite::params![id, show, size, if size.is_some() { Some(effector.clone()) } else { None }, tip],
        )
        .unwrap();
    }
    csp_format::database::serialize(&c).unwrap()
}

/// One action 下描きレイヤーの作成 with one command.
pub fn action_set() -> ActionSet {
    let parameter = Object::new(
        "",
        vec![("layername".into(), Value::String("下描き".into())), ("compositemode".into(), Value::int(0))],
    );
    let item = Object::new(
        "typeActionItem",
        vec![
            ("actionItemShowSettings".into(), Value::bool(false)),
            ("actionItemEnable".into(), Value::bool(true)),
            ("actionItemKind".into(), Value::String("layeractionrasterdetailnew".into())),
            ("actionItemParameter".into(), Value::Object(parameter)),
            ("actionItemOpenParameter".into(), Value::bool(false)),
        ],
    );
    let empty_head = Object::new("", vec![]).head;
    let action = Object::new(
        "typeAction",
        vec![
            ("actionUuid".into(), Value::String("0123456789-abcd-ef01-2345-6789abcdef".into())),
            ("actionOpenArray".into(), Value::bool(false)),
            ("actionItemArray".into(), Value::Array { head: empty_head.clone(), items: vec![Value::Object(item)] }),
            ("actionName".into(), Value::String("下描きレイヤーの作成".into())),
        ],
    );
    let root = Object::new(
        "typeActionSet",
        vec![
            ("actionArray".into(), Value::Array { head: empty_head, items: vec![Value::Object(action)] }),
            ("actionSetName".into(), Value::String("Test".into())),
            ("applicationUuid".into(), Value::String("742DEA58-ED6B-4402-BC11-20DFC6D08040".into())),
        ],
    );
    ActionSet { document: Document { root, trailing: Vec::new() } }
}

/// One group "Test" with a black → transparent white gradient.
pub fn gradient_set() -> GradientSet {
    GradientSet {
        groups: vec![GradientGroup {
            name: "Test".into(),
            gradients: vec![Gradient {
                name: "黒→透明".into(),
                data: GradientData::new(vec![Stop::rgba8([0, 0, 0, 255], 0.0), Stop::rgba8([255, 255, 255, 0], 1.0)]),
            }],
        }],
    }
}

/// A workspace's shortcut tables: two commands with keys, one without, and
/// the pen tool of [`tool_db`] on P.
pub fn workspace_shortcuts() -> Vec<u8> {
    let c = Connection::open_in_memory().unwrap();
    c.execute_batch(
        "CREATE TABLE workspaceshortcutmenu(_PW_ID INTEGER PRIMARY KEY AUTOINCREMENT, menucommandtype TEXT,
           menucommand TEXT, shortcut TEXT, modifier INTEGER);
         CREATE TABLE workspaceshortcuttool(_PW_ID INTEGER PRIMARY KEY AUTOINCREMENT, uuid BLOB, shortcut TEXT);
         INSERT INTO workspaceshortcutmenu(menucommandtype, menucommand, shortcut, modifier) VALUES
           ('advancedcommand', 'applicationpreference', 'K', 4), ('basiccommand', 'redo', 'Z', 6),
           ('advancedcommand', 'filesaveaspng', 'NULL', 0);",
    )
    .unwrap();
    c.execute("INSERT INTO workspaceshortcuttool(uuid, shortcut) VALUES (?1, 'P')", [uuid(2)]).unwrap();
    csp_format::database::serialize(&c).unwrap()
}

/// A `.tomd`: common settings (Space → the pen tool of [`tool_db`]) and a
/// pen row (Shift → operation 100), plus a row without data.
pub fn modifier_keys() -> Vec<u8> {
    let words = |w: &[u32]| w.iter().flat_map(|w| w.to_be_bytes()).collect::<Vec<u8>>();
    let mut common = words(&[8, 1, 36, 8, 2, 0, 16]);
    common.extend(uuid(2));
    let pen = words(&[8, 1, 16, 1, 1, 100]);
    let c = Connection::open_in_memory().unwrap();
    c.execute_batch(
        "CREATE TABLE ToolModifyKey(_PW_ID INTEGER PRIMARY KEY AUTOINCREMENT, Version INTEGER);
         INSERT INTO ToolModifyKey(Version) VALUES (130);
         CREATE TABLE ModifyKeySetting(_PW_ID INTEGER PRIMARY KEY AUTOINCREMENT, InputOperation INTEGER,
           OutputOperation INTEGER, RangeOperation INTEGER, SettingData BLOB);",
    )
    .unwrap();
    let insert = "INSERT INTO ModifyKeySetting(InputOperation, OutputOperation, RangeOperation, SettingData) VALUES (?1, ?2, 0, ?3)";
    c.execute(insert, rusqlite::params![0, 0, common]).unwrap();
    c.execute(insert, rusqlite::params![1, 10, pen]).unwrap();
    c.execute(insert, rusqlite::params![2, 2, None::<Vec<u8>>]).unwrap();
    csp_format::database::serialize(&c).unwrap()
}
