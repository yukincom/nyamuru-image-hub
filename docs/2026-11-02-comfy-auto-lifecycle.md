# 生成ボタンからのComfyUI起動と生成画面closeでの終了

2026-11-02。利用者の指定により、生成ボタンで起動し、生成画面を閉じると終了する経路を実装した。候補実装は復旧用のローカルcommit `732177a` に区切り、その上へ今回の変更を加えた。

## 確認した現状と接続先

着手時のニャムルは起動済みAPIへ接続するだけで、自動起動は無かった。Comfy Desktopは起動していたが8188に待受は無く、設定の `autoLaunchOnStartup` は未指定だった。Desktopを開くことと、登録されたローカル環境の起動は別の操作になる。

実際の登録を読み、次の既存環境を使用した。Desktopの登録、共有モデル、入力・出力の設定は書き換えていない。

```text
本体: /Users/yukin_co/ComfyUI-Installs/ComfyUI/ComfyUI
Python: 上記の .venv/bin/python3
モデル参照: ~/Library/Application Support/Comfy Desktop/instance-model-paths/inst-1793342976415.yaml
入力/出力: /Users/yukin_co/ComfyUI-Shared/input と output
API: http://127.0.0.1:8188
```

起動はComfyUIの通常の `main.py` と既存Pythonを使い、設定されたloopbackアドレス・ポート、Desktopの起動引数と共有パス、`--disable-auto-launch` を渡す。環境・モデルの新設やダウンロードは行わない。既存環境を明示する場合は `NYAMURU_COMFYUI_DIR`、必要に応じて `NYAMURU_COMFYUI_PYTHON` を使う。ログは正本の `.astro/comfyui.log` に置く。

参照した公式仕様: [ComfyUI起動引数](https://github.com/Comfy-Org/docs/blob/main/development/comfyui-server/startup-flags.mdx)、[Desktopの起動設定](https://github.com/Comfy-Org/Comfy-Desktop/blob/main/src/main/settings.ts)。

## 状態の所有と終了

- 起動管理は既存のローカルsupervisorへ接続した。生成画面の利用情報は `/api/image-generation/start`・`stop` で管理し、英訳・送信・文章LLM復帰の利用情報とは分ける。`5枚を生成する` と会話からの明示生成は、ComfyUIのAPI起動を確認してから既存の生成処理へ進む。
- 候補の比較・選択中は保持する。採用後の画面終了、閉じる、Escapeは共通の終了処理へ通す。ページ終了・外側からのunmountでも同じ利用情報を通知する。生成完了時の文章LLM復帰は既存経路を使う。
- 同時に複数の生成画面が使う場合は最後のcloseまで保持する。自分の送信処理やComfyUIのキューが残っている間は終了を保留し、idle後に終了する。
- ニャムルが起動した子プロセスだけを終了する。起動済みAPIは借りて使い、画面closeやニャムル終了で停止しない。ポートが応答しない場合も、接続拒否以外の状態では別のプロセスを追加しない。起動待ちの失敗や親の終了でも所有する子を回収する。
- 生成画面を閉じた後はComfyUIのメモリ内履歴が無くなるため、候補の出力位置と取得したPNGのSHA-256を既存ジョブへ保存する。後日の未採用削除は同じ実体だけを照合し、上書きなどで内容が違うファイルは削除しない。モデル生成や採用画像の追加・Undo/Redoは変更しない。

## 検証

| 確認 | 結果・範囲 |
|---|---|
| runtime/client試験 | Node 27件成功。所有・借用、最後のclose、起動待ち終了、起動失敗、別サービス、キュー待ち、既存Desktop設定の再利用。API・子プロセスは模擬 |
| supervisor試験 | Node 22件成功。一時的な実HTTP経由の起動・終了を含む。ComfyUI/LLMは模擬 |
| Python | 拡張18件、候補4件、生成接続17件成功。PNG・ファイル削除・指紋照合は実処理、ComfyUI履歴や生成は模擬 |
| ブラウザー（模擬） | 実Dialog・PaintEditorで3ケース28項目成功。開始の順番、候補表示中の保持、採用後・閉じる・Escapeでの解放 |
| ブラウザー（実runtime） | 同じ3ケース28項目を、通常supervisorと実ComfyUIの起動・終了APIで成功。生成HTTPと候補PNGだけ模擬。各closeで実プロセスの終了応答を確認 |
| 単独の実runtime確認 | ComfyUI 0.43.2を5,299msで起動。system stats、解放確認API 200、削除APIの不正入力400を確認。終了成功と8188の接続拒否・待受解放まで確認。モデル推論なし |
| 型検査 | 448ファイル、error 0・warning 0、hint 24 |

実モデルによる5候補生成・画質と、通常作品フォルダーへの保存再読込は今回実行していない。MangaScreenの処理は未着手。既存拡張の3ファイルを配置し、正本との一致を確認した。

通常サーバーを正本から再起動し、PID `6092`（4321/8786、PTY `86107`）へ反映した。元のテスト作品は複製・保存していない。通常タブで作品フォルダー選択を開いたが、ネイティブの選択ウィンドウはこちらから操作できず、利用者による選択待ち。利用者指定で通常サーバーとタブを継続する。検証用のVite `89478`（4342、PTY `4762`）と検証タブを終了し、4342と8188の待受解放を確認した。今回の変更は未commitで利用者確認待ち。全件試験・build・pushは行っていない。

[ComfyUI接続仕様](COMFYUI_WORKFLOW_SPEC.md)
