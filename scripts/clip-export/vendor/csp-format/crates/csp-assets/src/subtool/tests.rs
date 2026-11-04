//! Sub tool databases, on the synthetic one of [`crate::testing`].

use rusqlite::types::Value;

use super::*;
use crate::testing::{TIP_UUID, tool_db, uuid};

#[test]
fn reads_the_tree() {
    let db = SubToolDb::from_bytes(&tool_db()).unwrap();
    assert_eq!(db.kind, DbKind::ToolDb);
    assert!(db.check_tree().closed());
    let names: Vec<(usize, &str)> = db.tree().iter().map(|e| (e.depth, db.nodes[e.node].name.as_str())).collect();
    assert_eq!(names, [(0, ""), (1, "ペン"), (2, "G-ペン"), (2, "丸ペン")]);
    let pens = db.sub_tools();
    assert_eq!(pens.len(), 2);
    assert_eq!(pens[0].path, ["ペン"]);
    assert_eq!(db.nodes[pens[0].node].kind(), ToolKind::of(1, 10));
    assert_eq!(db.find("ペン/丸ペン").map(|e| e.node), Some(pens[1].node));
    assert!(db.common_variant().is_some());
}

#[test]
fn blobs_round_trip_and_decode() {
    let db = SubToolDb::from_bytes(&tool_db()).unwrap();
    let (checked, failures) = check_blobs(&db);
    assert!(checked > 0);
    assert!(failures.is_empty(), "{failures:?}");
    let json = db.variant_json(1).unwrap();
    assert_eq!(json["BrushSize"], 5.0);
    assert_eq!(json["BrushPatternImageArray"]["materials"][0]["name"], "丸");
    let refs = db.material_refs(1);
    assert_eq!(refs[0].1.uuid(), Some(TIP_UUID));
    assert_eq!(refs[0].1.user_relative_path().unwrap(), format!("56/16/{TIP_UUID}/data/material_0.layer"));
}

#[test]
fn a_cycle_is_reported() {
    let db = SubToolDb::from_bytes(&tool_db()).unwrap();
    db.connection().execute("UPDATE Node SET NodeNextUuid = ?1 WHERE NodeName = '丸ペン'", [uuid(3)]).unwrap();
    let db = SubToolDb::from_bytes(&db.to_bytes().unwrap()).unwrap();
    let check = db.check_tree();
    assert_eq!(check.repeated, 1);
    assert!(!check.closed());
}

#[test]
fn edits_are_written() {
    let mut db = SubToolDb::from_bytes(&tool_db()).unwrap();
    let pen = db.find("G-ペン").unwrap().node;
    db.rename(pen, "Gペン改").unwrap();
    db.set_value(1, "BrushSize", Value::Real(12.5)).unwrap();
    db.set_value(1, "BrushNewSetting", Value::Integer(7)).unwrap();
    let again = SubToolDb::from_bytes(&db.to_bytes().unwrap()).unwrap();
    assert!(again.find("Gペン改").is_some());
    assert_eq!(again.variant(1).unwrap().real("BrushSize"), 12.5);
    assert_eq!(again.variant(1).unwrap().int("BrushNewSetting"), 7);
    assert!(db.set_value(55, "BrushSize", Value::Real(1.0)).is_err());
}

#[test]
fn extracts_one_sub_tool() {
    let db = SubToolDb::from_bytes(&tool_db()).unwrap();
    let pen = db.find("G-ペン").unwrap().node;
    let folder =
        crate::tar::write(&[crate::tar::Entry { name: "catalog.xml".into(), data: b"<archive/>".to_vec() }]).unwrap();
    let sut = db.extract_sut(pen, &|m| (m.uuid() == Some(TIP_UUID)).then(|| folder.clone())).unwrap();
    let sut = SubToolDb::from_bytes(&sut).unwrap();
    assert_eq!(sut.kind, DbKind::SubTool);
    assert_eq!(sut.nodes.len(), 1);
    assert_eq!(sut.nodes[0].name, "G-ペン");
    assert!(sut.check_tree().closed());
    assert_eq!(sut.variants.len(), 2);
    assert_eq!(sut.variant(1).unwrap().real("BrushSize"), 5.0);
    // Only used columns, no tool database material columns.
    let variant_columns: Vec<String> =
        columns(sut.connection(), "Variant").unwrap().into_iter().map(|(n, _)| n).collect();
    assert!(variant_columns.contains(&"BrushPatternImageArray".to_owned()));
    let node_columns: Vec<String> = columns(sut.connection(), "Node").unwrap().into_iter().map(|(n, _)| n).collect();
    assert!(!node_columns.iter().any(|n| n.starts_with("NodeMaterial")));
    assert_eq!(sut.materials.len(), 1);
    assert_eq!(sut.materials[0].catalog_path, format!(".:56:16:{TIP_UUID}"));
    assert_eq!(sut.materials[0].entries().unwrap()[0].name, "catalog.xml");
    assert!(db.extract_sut(db.find("ペン").map(|_| 1).unwrap(), &|_| None).is_err());
}
