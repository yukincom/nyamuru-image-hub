//! Auto actions (オートアクション): CSP's own action sets
//! (`Action/*.laf`; セットの書き出し writes the same `.laf`) and `.las`.
//! Both are [`crate::serial`] documents:
//!
//! ```text
//! typeActionSet: actionSetName, applicationUuid, actionArray
//!   typeAction: actionName, actionUuid, actionOpenArray (bool: expanded
//!               in the palette), actionItemArray
//!     typeActionItem: actionItemKind (the command, e.g.
//!                     "layeractionrasterdetailnew" = 新規ラスターレイヤー),
//!                     actionItemEnable (the tick box),
//!                     actionItemShowSettings (show the dialog when run),
//!                     actionItemOpenParameter (bool), actionItemParameter
//!                     (an object; members depend on the command)
//! ```
//!
//! On 読み込み CSP gives every action a new `actionUuid` (W3).
//!
//! The command list and their parameters are in
//! `docs/assets/spec/action-kinds.tsv`. Edits go through the document, so
//! everything this module does not model is written back unchanged.

use serde::Serialize;
use serde_json::Value as Json;

use crate::error::{Error, Result};
use crate::serial::{Document, Object, Value};

/// The name CSP's auto action palette shows for a command, for the kinds
/// in `action-kinds.tsv` (W3: all of them loaded into CSP); `None` for others.
pub fn kind_name(kind: &str) -> Option<&'static str> {
    KIND_NAMES.iter().find(|(k, _)| *k == kind).map(|(_, name)| *name)
}

const KIND_NAMES: &[(&str, &str)] = &[
    ("92015820-D5B9-44D4-81B6-1F674762E420", "放射ぼかし"),
    ("FFD22A25-ABB3-4fdf-A6F2-596CC0E24BEF", "ガウスぼかし"),
    ("adjustmentactionToneCurve", "トーンカーブ"),
    ("adjustmentactiongradientmap", "グラデーションマップ"),
    ("adjustmentactionhsv", "色相・彩度・明度"),
    ("applicationactionchangecurrentcolor", "描画色の変更"),
    ("editactionbordering", "選択範囲をフチ取り"),
    ("editactionchangelinecolor", "線の色を描画色に変更"),
    ("editactioncut", "切り取り"),
    ("editactiondetailpaint", "高度な塗りつぶし"),
    ("editactionpaint", "塗りつぶし"),
    ("editactionpaste", "貼り付け"),
    ("layeractionchangebelowclip", "下のレイヤーでクリッピングの変更"),
    ("layeractionchangedraftlayer", "下描きレイヤーの設定"),
    ("layeractionchangename", "レイヤー名の変更"),
    ("layeractioncopy", "レイヤーを複製"),
    ("layeractiondelete", "レイヤーを削除"),
    ("layeractionfoldernewandinsert", "フォルダーを作成してレイヤーを挿入"),
    ("layeractionmergealllayer", "画像を統合"),
    ("layeractionmergelowerlayer", "下のレイヤーと結合"),
    ("layeractionmergeselectedlayer", "選択中のレイヤーを結合"),
    ("layeractionmergevisiblelayercopy", "表示レイヤーのコピーを結合"),
    ("layeractionrasterdetailnew", "新規ラスターレイヤー（詳細）"),
    ("layeractionrasterize", "ラスタライズ"),
    ("layeractionrasternew", "新規ラスターレイヤー"),
    ("layeractionselectcontinuouslayer", "指定したレイヤーまでを選択"),
    ("layeractionselectlowerlayer", "下のレイヤーを編集対象にする"),
    ("layeractionselectupperlayer", "上のレイヤーを編集対象にする"),
    ("layeractionsetcompositemode", "合成モードの変更"),
    ("layeractionsetcurrentlayer", "編集レイヤーの変更"),
    ("layeractionsetopacity", "不透明度の変更"),
    ("layeractionsetuselayercolor", "レイヤーカラー使用の変更"),
    ("layeractionsetusetone", "トーン使用の変更"),
    ("selectactiondeselect", "選択を解除"),
    ("selectactionexpand", "選択範囲を拡張"),
    ("selectactionreduce", "選択範囲を縮小"),
    ("toolactionmovelayer", "レイヤーを移動"),
];

/// One command of an action.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ActionItem {
    /// The command (`layeractionrasternew`, …; see [`kind_name`]).
    pub kind: String,
    /// The command is switched on (チェック).
    pub enabled: bool,
    /// ダイアログを表示 is on.
    pub show_settings: bool,
    /// The command's parameters (serialisation JSON form).
    pub parameter: Json,
}

/// One auto action.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Action {
    /// `actionName`.
    pub name: String,
    /// `actionUuid`.
    pub uuid: String,
    /// The commands, in order.
    pub items: Vec<ActionItem>,
}

/// An auto action set, with the document it came from.
#[derive(Debug, Clone, PartialEq)]
pub struct ActionSet {
    /// The parsed file.
    pub document: Document,
}

fn bool_of(object: &Object, key: &str) -> bool {
    object.i64(key).unwrap_or(0) != 0
}

impl ActionSet {
    /// Parses a `.laf` or `.las` file.
    pub fn parse(data: &[u8]) -> Result<ActionSet> {
        let document = Document::parse(data)?;
        if document.root.array("actionArray").is_none() {
            return Err(Error::format("auto action set: no actionArray"));
        }
        Ok(ActionSet { document })
    }

    /// The file; an unchanged set gives the same bytes.
    pub fn to_bytes(&self) -> Vec<u8> {
        self.document.to_bytes()
    }

    /// `actionSetName`.
    pub fn name(&self) -> &str {
        self.document.root.str("actionSetName").unwrap_or("")
    }

    /// Renames the set.
    pub fn set_name(&mut self, name: &str) {
        self.document.root.set("actionSetName", Value::String(name.into()));
    }

    /// The actions, in order.
    pub fn actions(&self) -> Vec<Action> {
        let Some(actions) = self.document.root.array("actionArray") else { return Vec::new() };
        actions
            .iter()
            .filter_map(Value::as_object)
            .map(|action| Action {
                name: action.str("actionName").unwrap_or("").into(),
                uuid: action.str("actionUuid").unwrap_or("").into(),
                items: action
                    .array("actionItemArray")
                    .unwrap_or(&[])
                    .iter()
                    .filter_map(Value::as_object)
                    .map(|item| ActionItem {
                        kind: item.str("actionItemKind").unwrap_or("").into(),
                        enabled: bool_of(item, "actionItemEnable"),
                        show_settings: bool_of(item, "actionItemShowSettings"),
                        parameter: item
                            .object("actionItemParameter")
                            .map(|p| Document { root: p.clone(), trailing: Vec::new() }.to_json())
                            .unwrap_or(Json::Null),
                    })
                    .collect(),
            })
            .collect()
    }

    fn action_objects_mut(&mut self) -> Option<&mut Vec<Value>> {
        match self.document.root.get_mut("actionArray")? {
            Value::Array { items, .. } => Some(items),
            _ => None,
        }
    }

    /// Tick or untick one item (action index, item index).
    pub fn set_enabled(&mut self, action: usize, item: usize, enabled: bool) -> Result<()> {
        let actions = self.action_objects_mut().ok_or_else(|| Error::format("no actions"))?;
        let Some(Value::Object(action)) = actions.get_mut(action) else {
            return Err(Error::format("no such action"));
        };
        let Some(Value::Array { items, .. }) = action.get_mut("actionItemArray") else {
            return Err(Error::format("action has no items"));
        };
        let Some(Value::Object(item)) = items.get_mut(item) else {
            return Err(Error::format("no such item"));
        };
        item.set("actionItemEnable", Value::bool(enabled));
        Ok(())
    }

    /// Keep only the actions for which `keep(index, name)` is true.
    pub fn retain_actions(&mut self, mut keep: impl FnMut(usize, &str) -> bool) {
        if let Some(actions) = self.action_objects_mut() {
            let mut index = 0;
            actions.retain(|a| {
                let name = a.as_object().and_then(|o| o.str("actionName")).unwrap_or("").to_owned();
                let result = keep(index, &name);
                index += 1;
                result
            });
        }
    }

    /// Append the actions of another set (CSP needs distinct uuids; actions
    /// whose uuid is already present are skipped).
    pub fn append_from(&mut self, other: &ActionSet) -> usize {
        let present: Vec<String> = self.actions().into_iter().map(|a| a.uuid).collect();
        let incoming: Vec<Value> = other
            .document
            .root
            .array("actionArray")
            .unwrap_or(&[])
            .iter()
            .filter(|a| {
                a.as_object().and_then(|o| o.str("actionUuid")).is_some_and(|u| !present.iter().any(|p| p == u))
            })
            .cloned()
            .collect();
        let count = incoming.len();
        if let Some(actions) = self.action_objects_mut() {
            actions.extend(incoming);
        }
        count
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_and_edits() {
        let mut set = ActionSet::parse(&crate::testing::action_set().to_bytes()).unwrap();
        assert_eq!(set.name(), "Test");
        let actions = set.actions();
        assert_eq!(actions[0].items[0].kind, "layeractionrasterdetailnew");
        assert_eq!(kind_name("layeractionrasterdetailnew"), Some("新規ラスターレイヤー（詳細）"));
        assert_eq!(kind_name("unknown"), None);
        assert!(actions[0].items[0].enabled);
        assert_eq!(actions[0].items[0].parameter["layername"], "下描き");
        set.set_enabled(0, 0, false).unwrap();
        set.set_name("Renamed");
        let again = ActionSet::parse(&set.to_bytes()).unwrap();
        assert!(!again.actions()[0].items[0].enabled);
        assert_eq!(again.name(), "Renamed");
        let mut other = crate::testing::action_set();
        assert_eq!(other.append_from(&again), 0);
        other.retain_actions(|_, _| false);
        assert!(other.actions().is_empty());
        assert_eq!(other.append_from(&again), 1);
    }
}
