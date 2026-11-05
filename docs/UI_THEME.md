# UI配色ルール

Nyamuruの操作画面は低彩度のセージ＋サンド、文字は墨黒を基本とする。共通の配色は `src/styles/global/workspace-and-page.css` の `:root` で定義し、`src/styles/global.css` から読み込む。画面ごとの色値再定義や装飾用の鮮やかなピンクは追加しない。

| 用途 | CSS token | 色 |
|---|---|---|
| 主要な文字 | `--ink` | `#242424` |
| 補助文字・未選択の文字 | `--muted` | `#626b65` |
| 見出し・反映等の主操作面 | `--accent-fill` | `#dce9df` |
| 主操作hover | `--accent-fill-hover` | `#ccddcf` |
| 選択中の帯・タブ背景 | `--accent-soft` | `#edf3ee` |
| 小さな現在位置の丸・下線・focus・輪郭 | `--accent` | `#57756a` |
| 選択・変更等の補助操作面 | `--control` | `#f1e2cf` |
| 補助操作hover・輪郭 | `--control-hover` / `--control-border` | `#e7d5bb` / `#7f684e` |
| 未選択の丸・背景 | `--neutral-soft` / `--canvas` | `#eeece8` / `#f6f5f3` |

広い面を濃色で塗らず、淡色面に墨黒を置く。濃いセージに白文字を置くのは小さな丸数字などに限定する。現在位置は色だけでなく丸・下線・太字を併用し、新規作成手順は `aria-current="step"` も付ける。暗い画像ビューアやコード表示の白文字は維持する。

エラー・削除は `--danger*`、不足・注意は `--warning*` を使い、通常の選択色へ混ぜない。既存の成功・要確認・素材種別の意味色は区別を保つ。通知の色を変えても実行結果や状態を判定・変更しない。

`--paper`、`--panel-bg-*`、フキダシ・文字・画像など作品の描画色、生成用4色palette、素材・マスコット画像はテーマの対象外。ドキュメントページの装飾とPWAのtheme colorは対象。

配色変更時は `tests/newCreationPresentation.test.mjs` と `tests/uiTheme.test.mjs`、通常/hover/focus、PC/狭幅の実表示を確認する。比率テストは指定した色組合せの検証であり、全画面のアクセシビリティ適合や全利用者の見え方を保証するものではない。
