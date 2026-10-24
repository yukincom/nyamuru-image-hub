# 描写範囲の説明絵付き選択（2026-10-08）

コマ情報とページ前景の「描写範囲」を、猫耳キャラの説明絵と名称から選べるポップアップにした。既存の`FigureSize`保存経路に4種類を追加し、11種類から名称または絵のクリックで仮選択し、「確定」で反映して閉じる。

- 選択中はキャラクターと文字を濃いオリーブ、その他は薄いオリーブで表示。選択中の枠とチェック表示も付ける。
- キャラクターはくびれのない寸胴、低い股下と短い脚、親指だけが分かれたミトン型の手。身体の一部は肩まわりの切り取りを例示する。
- 全身図はロング・全身・膝上・腰上の4枠、拡大図は胸上・肩上・顔・大アップの4枠を重ねる。手・足・身体の一部は下段の小さな名称ボタンから選び、選択部位を全身図に示す。
- 図とその下の一覧は、各列で上ほど寄り、下ほど引きの順。左列はWS→KS→FF→LS、右列はBCU→CU→US→BS。BCUの略号は枠の右上に置き、CU/USと重ならないようにする。
- 絵の枠内全体がクリック対象。ポインター位置をSVG座標へ変換し、包含する最小面積の枠を選ぶ。大きい枠は内側の枠を除いた外周で選べる。選択中の枠が最前面でも当たり判定は変わらない。略号・名称からも仮選択できる。
- カーソルを乗せた範囲・枠・名称を濃いオリーブでプレビューする。ホバーでは選択を確定せず、離れると仮選択中の範囲に戻る。
- 利用者の指定により下部の詳細説明・英語訳・アクション案内を表示しない。図と名称の下に選択中の名称、キャンセル、確定をまとめる。
- 矢印キーとHome/Endで候補へ移動、候補上のEnter/Spaceで仮選択。「確定」で親へ反映して閉じる。キャンセル、Escape、閉じるボタン、欄外クリックでは変更せず閉じる。
- スクロール領域から切れないようbodyへポータル表示し、画面内に収める。閉じる操作と確定時は呼出ボタンへフォーカスを戻す。
- Qwenへのカット固定訳は小文字。説明絵は操作の目安であり、Qwenが必ずその切れ位置を生成するという意味ではない。

## 絵の出典と保存先

[利用者提示のEDIUSの画面サイズ図](https://www.ediusworld.com/jp/pimopic/cat2_126.html)を用途の参考にし、内蔵`image_gen`で新しい抽象的な猫耳の人物ピクトグラムを作成した。レイアウトは参考図と同じ全身図・拡大図と重ね枠の構成に合わせた。元図の人物や文字の画像は流用せず、枠・略号・名称はコードで描画する。

採用画像: `src/assets/figure-framing-cat.png`（1024×1536）。アプリはこの正本内のファイルを`?url`で取り込み、standaloneビルドにもインライン化する。モデルの既定出力先には実行依存を作らない。

初回の透過画像はぼけが付いたため不採用。白背景の不透明な絵に直した後、利用者の追加指定により寸胴・低い股下・ミトン型の手・オリーブ色へ修正した。採用時の最終プロンプト（編集元は旧版の同アセット）:

```text
Edit target: the supplied green cat-eared humanoid UI pictogram. Keep its friendly simple cat-eared head, two white oval eyes, white smile, front view, centered full-body layout and entire ear tips and feet within the same portrait 1024x1536 canvas on opaque pure white. Change the body to a much more abstract, chunky, straight-sided mascot: a continuous broad barrel/rounded-rectangle torso, no waist indentation whatsoever, no hourglass silhouette, no chest or hip emphasis. Lower the crotch noticeably: make the torso longer and the legs short, with the crotch starting around y=1130 on this 1536-high image and feet ending around y=1410. Keep both arms slightly separated from the sides so hands are readable. Replace both hands with simple mitten silhouettes: one smooth rounded mitten lobe for all four fingers together, and only one distinct thumb on each hand; no individual finger lines, no separate fingers. Recolor the complete solid figure to a muted olive green, approximately #65704b, suited to an understated olive UI palette. Use one completely flat opaque olive color and pure white facial marks, crisp clean edges, no texture, shading, gradient, glow, outlines, transparency, text, frames or decoration. This is a neutral simplified instructional mascot, not a detailed human body. Show one figure only.
```

## 種類と固定英訳

追加した保存値とQwenへのコード固定訳は以下のとおり。その他の7種類は保存値を維持する。これはUIの説明語と固定訳であり、Qwen公式の解剖学的な切れ位置の規格ではない。

| 保存値 | 描写範囲 | 固定英訳 |
|---|---|---|
| long | ロングショット | long shot. |
| knee-up | 膝から上 | knee-up shot. |
| shoulder-up | 肩から上 | shoulders-up shot. |
| face-detail | 大アップ | extreme close-up of the face. |

既存の型、保存・読込検証、クライアントとPython bridgeの列挙値、人物解析worker、配置ピクトグラム、仕様書を揃えた。描写範囲はLLM翻訳に回さない。顔の大アップの解析では身体全体の姿勢を推測せず、膝上の観察結果を膝上として保持する。

## 検証

- `npm run check`: 306 files、errors/warnings/hintsすべて0。
- `npm run build`: Astroとstandaloneの両方が成功。既存のチャンクサイズ・FigureSizeSvgの動的／静的import重複・sitemap設定に関する警告あり。
- Node 71件、Python 48件成功。全11種類の保存・再読込・生成プロンプト、追加4種類の固定訳と解析の保持を検証。
- 稼働中のUI（4321）で名称と略号のクリック、再展開、矢印移動、Escapeを確認。絵の8領域を実クリックし、内側優先と大きい枠の外周選択、クリック後も開いたままで作品値が変わらないことを確認。カーソル移動で膝上の色だけが変わり選択は顔のままであること、確定で閉じて反映すること、キャンセルで未反映になることも確認。独立の読み取りレビュー後、BCUラベル位置を調整し、再レビューで追加指摘なし。
- 検証で変更した値は元の2人物とも「顔」に戻し、両者のアクション文が不変であることを確認。作品フォルダへの保存は行っていない。
- ブラウザーのコンソールエラーなし。重ね枠版の確認画像は `/private/tmp/figure-size-picker-nested-2026-10-08.jpg`。
- 詳細説明の削除後、型チェック306 files診断0と通常・standaloneビルド成功。実画面で説明欄がないこと、腰上の仮選択でも開いたままであること、キャンセル後に元の「顔」が維持されることを確認。画面は `/private/tmp/figure-size-picker-compact-2026-10-08.png`。
- 生成・解析のアイドルと両ロックを確認後、画像連携bridgeのみ再読込（親PID43293→52391）。稼働中の準備APIで追加4種類の保存英訳と入力hashを確認し、診断ジョブ4件を公式削除APIで削除、診断leaseを解放。8080のLLM listenerは同一、画像生成は未実行。証跡 `/private/tmp/qwen-nested-framing-live-verification.json`。

固定翻訳とラフ参照の調査は `2026_10_08_qwen_framing.md` に記録。
