//! Which CSP format a file is: the family from its first bytes, the
//! purpose from its name (A1). The table lists every format found in CSP's
//! settings folders, its install folder and its material folders
//! (`docs/assets/spec/formats.md`).

use serde::Serialize;

/// How the bytes are laid out.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub enum Family {
    /// SQLite database (most settings, sub tools, workspaces).
    Sqlite,
    /// [`crate::serial`] documents (auto actions, gradient sets).
    Serial,
    /// `SLCC` colour sets.
    ColorSet,
    /// [`crate::c2f`] chunk envelope (encrypted material data).
    C2f,
    /// `.clip` canvas (CSFCHUNK), see the `csp-format` crate.
    Clip,
    /// PNG image.
    Png,
    /// XML text.
    Xml,
    /// ustar archive.
    Tar,
    /// Material catalogue cache (`catalog*.cac`).
    CatalogCache,
    /// UTF-8 text (cloud sync stamps, the launcher's menu pages).
    Text,
    /// No bytes.
    Empty,
    /// No signature: known only by name (see [`FORMATS`]) or not known.
    Unknown,
}

/// The family of a file from its first bytes.
pub fn family(data: &[u8]) -> Family {
    if data.is_empty() {
        Family::Empty
    } else if data.starts_with(b"SQLite format 3\0") {
        Family::Sqlite
    } else if crate::serial::looks_like(data) {
        Family::Serial
    } else if data.starts_with(b"SLCC") {
        Family::ColorSet
    } else if data.starts_with(crate::c2f::SIGNATURE) {
        Family::C2f
    } else if data.starts_with(b"CSFCHUNK") {
        Family::Clip
    } else if data.starts_with(b"\x89PNG\r\n\x1a\n") {
        Family::Png
    } else if data.starts_with(b"<?xml") || data.starts_with(b"\xef\xbb\xbf<?xml") {
        Family::Xml
    } else if data.len() >= 262 && &data[257..262] == b"ustar" {
        Family::Tar
    } else if crate::material::looks_like_cac(data) {
        Family::CatalogCache
    } else if !data.contains(&0)
        && std::str::from_utf8(data).is_ok_and(|t| !t.chars().any(|c| c.is_control() && !c.is_whitespace()))
    {
        Family::Text
    } else {
        Family::Unknown
    }
}

/// One known format.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct Format {
    /// File extension (lower case, with the dot) or exact file name.
    pub pattern: &'static str,
    /// How its bytes are laid out.
    pub family: Family,
    /// What CSP calls it / uses it for.
    pub purpose: &'static str,
    /// Typed support in this crate.
    pub support: Support,
}

/// How much of a format this crate reads.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Support {
    /// Typed read and write.
    Typed,
    /// Generic SQLite read and write, columns described in the spec.
    Catalogued,
    /// Only the envelope or metadata is read (encrypted or out of scope).
    Envelope,
}

use Family::*;
use Support::*;

/// Known formats: exchange formats first, then CSP's own settings.
pub const FORMATS: &[Format] = &[
    Format {
        pattern: ".sut", family: Sqlite, purpose: "サブツール（書き出し・読み込み用）", support: Typed
    },
    Format {
        pattern: ".laf",
        family: Serial,
        purpose: "オートアクションセット（CSP 内部、書き出し・読み込み用）",
        support: Typed,
    },
    Format {
        pattern: ".las",
        family: Serial,
        purpose: "オートアクションセット（同じ形式の別の拡張子。CSP 1.5 系の書き出しは .laf）",
        support: Typed,
    },
    Format {
        pattern: ".cls", family: ColorSet, purpose: "カラーセット（書き出し・読み込み用）", support: Typed
    },
    Format {
        pattern: ".todb",
        family: Sqlite,
        purpose: "ツールのデータベース（全ツール・サブツールの設定）",
        support: Typed,
    },
    Format {
        pattern: ".bfps",
        family: Sqlite,
        purpose: "ブラシ形状のプリセット（サブツールと同じ表）",
        support: Typed,
    },
    Format { pattern: ".sgs", family: Serial, purpose: "グラデーションセット", support: Typed },
    Format {
        pattern: ".spws",
        family: Sqlite,
        purpose: "ワークスペース（プリセット・登録したもの）",
        support: Catalogued,
    },
    Format {
        pattern: ".spwi",
        family: Sqlite,
        purpose: "ワークスペースの一覧と現在のワークスペース",
        support: Catalogued,
    },
    Format { pattern: ".khc", family: Sqlite, purpose: "ショートカットキー設定", support: Typed },
    Format { pattern: ".tomd", family: Sqlite, purpose: "修飾キー設定（ツールごと）", support: Typed },
    Format {
        pattern: ".tlbr", family: Sqlite, purpose: "コマンドバー / クイックアクセスの項目", support: Catalogued
    },
    Format {
        pattern: ".sal", family: Sqlite, purpose: "コマンドバーの項目（アクション付き）", support: Catalogued
    },
    Format { pattern: ".tgm", family: Sqlite, purpose: "ツールパレットのグループ", support: Catalogued },
    Format { pattern: ".prgr", family: Sqlite, purpose: "筆圧検知レベルの調節", support: Catalogued },
    Format {
        pattern: ".dtdb", family: Sqlite, purpose: "ダウンロードしたツール（素材）の管理", support: Catalogued
    },
    Format {
        pattern: ".bsm", family: Sqlite, purpose: "ブラシサイズパレットのプリセット", support: Catalogued
    },
    Format {
        pattern: ".pcs", family: Sqlite, purpose: "カラーセットパレットの状態（全セット）", support: Catalogued
    },
    Format { pattern: ".pcc", family: Sqlite, purpose: "描画色・背景色・透明色", support: Catalogued },
    Format { pattern: ".pcb", family: Sqlite, purpose: "中間色パレット", support: Catalogued },
    Format { pattern: ".pcg", family: Sqlite, purpose: "近似色パレット", support: Catalogued },
    Format { pattern: ".pmx", family: Sqlite, purpose: "色混ぜパレット", support: Catalogued },
    Format { pattern: ".clhs", family: Sqlite, purpose: "カラーヒストリー", support: Catalogued },
    Format { pattern: ".qmm", family: Sqlite, purpose: "クイックメニュー", support: Catalogued },
    Format { pattern: ".psv", family: Sqlite, purpose: "サブビュー", support: Catalogued },
    Format { pattern: ".mfts", family: Sqlite, purpose: "素材パレットのタブの状態", support: Catalogued },
    Format {
        pattern: ".mfta", family: Sqlite, purpose: "素材・作品のフォルダーとタグ", support: Catalogued
    },
    Format {
        pattern: ".asli", family: Sqlite, purpose: "オートアクションの一覧の状態", support: Catalogued
    },
    Format {
        pattern: ".cmdb", family: Sqlite, purpose: "素材・作品のカタログデータベース", support: Catalogued
    },
    Format {
        pattern: ".cscr", family: Sqlite, purpose: "素材パスの置き換え表（CSP 同梱）", support: Catalogued
    },
    Format {
        pattern: ".sqlite",
        family: Sqlite,
        purpose: "各種設定（環境設定 Config.sqlite など）",
        support: Catalogued,
    },
    Format {
        pattern: "canvasviewsettings", family: Sqlite, purpose: "キャンバスの表示設定", support: Catalogued
    },
    Format {
        pattern: "dialogbox",
        family: Sqlite,
        purpose: "ダイアログの前回の値（新規作成など）",
        support: Catalogued,
    },
    Format {
        pattern: "dialogstate",
        family: Sqlite,
        purpose: "ショートカット設定ダイアログの状態",
        support: Catalogued,
    },
    Format { pattern: "digitizersettings", family: Sqlite, purpose: "タブレットの設定", support: Catalogued },
    Format { pattern: "exportsettings", family: Sqlite, purpose: "画像の書き出し設定", support: Catalogued },
    Format {
        pattern: "exportsettingsforbatch", family: Sqlite, purpose: "一括書き出しの設定", support: Catalogued
    },
    Format {
        pattern: "multipageexportsettings",
        family: Sqlite,
        purpose: "複数ページ書き出しの設定",
        support: Catalogued,
    },
    Format {
        pattern: "exportsettingspreset",
        family: Sqlite,
        purpose: "書き出し設定のプリセット",
        support: Catalogued,
    },
    Format { pattern: "fontcollection", family: Sqlite, purpose: "フォントリスト", support: Catalogued },
    Format {
        pattern: "popupfontcollection",
        family: Sqlite,
        purpose: "フォントのポップアップの状態",
        support: Catalogued,
    },
    Format { pattern: "mixedfont", family: Sqlite, purpose: "合成フォント", support: Catalogued },
    Format {
        pattern: "layerpropertydefault",
        family: Sqlite,
        purpose: "レイヤープロパティの既定値",
        support: Catalogued,
    },
    Format {
        pattern: "lastmodifiedcanvaspath",
        family: Sqlite,
        purpose: "最後に保存したキャンバスの場所",
        support: Catalogued,
    },
    Format { pattern: "recentfiles", family: Sqlite, purpose: "最近使ったファイル", support: Catalogued },
    Format {
        pattern: "sizeset", family: Sqlite, purpose: "新規作成のサイズのプリセット", support: Catalogued
    },
    Format { pattern: "counter", family: Sqlite, purpose: "使用回数の統計", support: Catalogued },
    Format { pattern: "timelinesettings", family: Sqlite, purpose: "タイムラインの設定", support: Catalogued },
    Format {
        pattern: "functioncurvesettings", family: Sqlite, purpose: "関数カーブの設定", support: Catalogued
    },
    Format { pattern: "joypadsettings", family: Sqlite, purpose: "左手デバイスの設定", support: Catalogued },
    Format {
        pattern: "wtabmatesettings", family: Sqlite, purpose: "CLIP STUDIO TABMATE の設定", support: Catalogued
    },
    Format {
        pattern: "tabmatebleSettings",
        family: Sqlite,
        purpose: "TABMATE（Bluetooth）の設定",
        support: Catalogued,
    },
    Format {
        pattern: "toolrotationsettings", family: Sqlite, purpose: "ツールの回転の設定", support: Catalogued
    },
    Format { pattern: "wacom", family: Sqlite, purpose: "ワコムのスタイラスの設定", support: Catalogued },
    Format {
        pattern: ".xml",
        family: Xml,
        purpose: "素材の目録（catalog.xml / info.xml / layerData.xml など）",
        support: Typed,
    },
    Format { pattern: ".cac", family: CatalogCache, purpose: "素材の目録のキャッシュ", support: Typed },
    Format { pattern: ".layer", family: C2f, purpose: "画像素材のデータ（暗号化）", support: Envelope },
    Format {
        pattern: ".tool", family: C2f, purpose: "サブツール素材のデータ（暗号化）", support: Envelope
    },
    Format { pattern: ".pose", family: C2f, purpose: "ポーズ素材（暗号化）", support: Envelope },
    Format {
        pattern: ".zip",
        family: C2f,
        purpose: "素材フォルダーの catalog.zip / info.zip（暗号化）",
        support: Envelope,
    },
    Format { pattern: ".tar", family: Tar, purpose: "素材の説明（description.tar）", support: Typed },
    Format { pattern: ".png", family: Png, purpose: "素材のサムネイル", support: Typed },
    Format {
        pattern: "webwhitelist.xml",
        family: C2f,
        purpose: "アプリ内ブラウザーで開いてよいサイトの一覧（暗号化）",
        support: Envelope,
    },
    Format {
        pattern: "installpathtocatalogid.dat",
        family: Unknown,
        purpose: "旧形式の素材パス → インストール済み素材パスの対応表",
        support: Typed,
    },
    Format {
        pattern: "xxx.dat",
        family: Unknown,
        purpose: "素材フォルダーの状態（難読化、20 バイト）",
        support: Envelope,
    },
    Format {
        pattern: "asxx.dat", family: Unknown, purpose: "素材フォルダーの状態（17 バイト）", support: Envelope
    },
    Format {
        pattern: "created.dat", family: Empty, purpose: "素材フォルダーの印（自作の素材）", support: Typed
    },
    Format {
        pattern: "downloaded.dat",
        family: Empty,
        purpose: "素材フォルダーの印（ダウンロードした素材）",
        support: Typed,
    },
    Format { pattern: "cloudupdate2.txt", family: Text, purpose: "クラウド同期の日時", support: Typed },
    Format { pattern: "cloudsyncalready", family: Text, purpose: "クラウド同期済みの印", support: Typed },
    Format {
        pattern: "cloudUploadNotCompletedError",
        family: Text,
        purpose: "クラウドへの送信失敗の記録",
        support: Typed,
    },
    Format {
        pattern: "workspacelist.txt",
        family: Unknown,
        purpose: "ワークスペースの一覧（4 バイトの 0 のみ確認）",
        support: Envelope,
    },
    Format {
        pattern: ".3dp",
        family: Xml,
        purpose: "3D 素体の体型プリセット（celsysdocument、対象外）",
        support: Envelope,
    },
    Format {
        pattern: ".pep",
        family: Xml,
        purpose: "3D の手・ポーズのプリセット（celsysdocument、対象外）",
        support: Envelope,
    },
    Format {
        pattern: ".tga", family: Unknown, purpose: "色混ぜパレットのキャンバス（TGA 画像）", support: Envelope
    },
    Format {
        pattern: ".txt", family: Text, purpose: "テキスト（ランチャーのメニュー一覧など）", support: Envelope
    },
    Format {
        pattern: ".html", family: Text, purpose: "CLIP STUDIO ランチャーのメニュー（対象外）", support: Envelope
    },
    Format {
        pattern: ".js", family: Text, purpose: "CLIP STUDIO ランチャーのメニュー（対象外）", support: Envelope
    },
    Format {
        pattern: ".css", family: Text, purpose: "CLIP STUDIO ランチャーのメニュー（対象外）", support: Envelope
    },
    Format {
        pattern: ".svg", family: Text, purpose: "CLIP STUDIO ランチャーのアイコン（対象外）", support: Envelope
    },
];

/// The format entry for a file name, if known.
pub fn format_of(file_name: &str) -> Option<&'static Format> {
    let lower = file_name.to_lowercase();
    // Whole names first ("ja-jp_webWhiteList (2).xml": the language prefix
    // and CSP's backup suffix vary), then extensions.
    let without_copy = match (lower.find(" ("), lower.rfind(").")) {
        (Some(start), Some(end)) if start < end => format!("{}{}", &lower[..start], &lower[end + 1..]),
        (Some(start), None) if lower.ends_with(')') => lower[..start].to_owned(),
        _ => lower.clone(),
    };
    FORMATS
        .iter()
        .find(|f| {
            let pattern = f.pattern.to_lowercase();
            !pattern.starts_with('.')
                && (without_copy == pattern
                    || (pattern.contains('.') && without_copy.ends_with(&format!("_{pattern}"))))
        })
        .or_else(|| FORMATS.iter().find(|f| f.pattern.starts_with('.') && lower.ends_with(f.pattern)))
}

/// What a file is: the family from its bytes and the known format from its
/// name. `consistent` is false when the bytes do not match the name.
#[derive(Debug, Clone, Serialize)]
pub struct Detected {
    /// The family from the bytes.
    pub family: Family,
    /// The known format of this file name, if any.
    pub format: Option<&'static Format>,
    /// The bytes match the name's format.
    pub consistent: bool,
}

/// What a file is, from its name and bytes.
pub fn detect(file_name: &str, data: &[u8]) -> Detected {
    let family = family(data);
    let format = format_of(file_name);
    let consistent = match format {
        Some(format) => format.family == family || family == Family::Empty,
        None => family != Family::Unknown,
    };
    Detected { family, format, consistent }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_by_bytes_and_name() {
        assert_eq!(family(b"SQLite format 3\0...."), Family::Sqlite);
        assert_eq!(family(b"SLCC\x00\x01"), Family::ColorSet);
        assert_eq!(family(b"\x89C2F\r\n\x1a\n"), Family::C2f);
        assert_eq!(family(b""), Family::Empty);
        assert_eq!(format_of("Brush.SUT").unwrap().support, Support::Typed);
        assert_eq!(format_of("default (2).pcs").unwrap().pattern, ".pcs");
        assert_eq!(format_of("exportsettings").unwrap().family, Family::Sqlite);
        assert_eq!(format_of("canvasviewsettings (2)").unwrap().pattern, "canvasviewsettings");
        assert_eq!(format_of("ja-jp_webWhiteList (2).xml").unwrap().family, Family::C2f);
        assert_eq!(format_of("catalog.xml").unwrap().pattern, ".xml");
        assert_eq!(format_of("tabmatebleSettings").unwrap().family, Family::Sqlite);
        assert_eq!(family(b"2025/12/03 09:50:02"), Family::Text);
        assert!(detect("cloudUpdate2.txt", b"2025/12/03").consistent);
        assert!(detect("asxx.dat", b"\x10\0\0\0").consistent);
        let detected = detect("x.sut", b"SLCC");
        assert!(!detected.consistent);
    }
}
