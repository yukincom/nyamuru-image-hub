# v0.4 固定分割と採用行（2026-10-18）

学習前に固定。JSONLを正本とし、本文以外のmetadataはモデルへ入力しない。旧行は元版のデータを保持し、ここでは追加trainと新dev/testを全文掲載する。

| split | 件数 | 出典別件数 |
|---|---:|---|
| train | 1296 | {'codex_synthetic': 1144, 'user_supplied_example': 7, 'massive_human_localized': 64, 'massive_derived_synthetic': 81} |
| dev | 68 | {'codex_synthetic': 68} |
| test | 73 | {'codex_synthetic': 73} |
| legacy_v03_dev | 88 | {'massive_human_localized': 8, 'codex_synthetic': 80} |
| legacy_v03_test | 132 | {'massive_human_localized': 16, 'codex_synthetic': 116} |
| legacy_v02_dev | 138 | {'codex_synthetic': 137, 'user_supplied_example': 1} |
| legacy_v02_test | 139 | {'codex_synthetic': 139} |

## 分類別件数

| 分類 | train | dev | test | legacy_v03_dev | legacy_v03_test | legacy_v02_dev | legacy_v02_test |
|---|---:|---:|---:|---:|---:|---:|---:|
| save | 62 | 4 | 4 | 4 | 6 | 6 | 7 |
| undo | 82 | 2 | 4 | 4 | 5 | 5 | 7 |
| redo | 86 | 3 | 3 | 5 | 6 | 5 | 7 |
| page_navigate | 57 | 3 | 4 | 5 | 4 | 7 | 8 |
| view_change | 53 | 5 | 5 | 4 | 4 | 7 | 8 |
| artwork_mode_set | 42 | 2 | 3 | 4 | 10 | 4 | 8 |
| bubble_set | 90 | 4 | 4 | 4 | 12 | 9 | 9 |
| needs_clarification | 48 | 5 | 4 | 4 | 6 | 8 | 8 |
| needs_reasoning | 36 | 8 | 6 | 8 | 13 | 6 | 7 |
| compound_request | 162 | 7 | 4 | 4 | 9 | 8 | 7 |
| out_of_scope_request | 67 | 3 | 4 | 4 | 9 | 7 | 7 |
| not_command | 171 | 5 | 6 | 6 | 16 | 12 | 12 |
| panel_sync_set | 41 | 3 | 3 | 4 | 5 | 8 | 8 |
| inner_frame_snap_set | 40 | 2 | 4 | 4 | 5 | 8 | 8 |
| panel_gap_snap_set | 39 | 2 | 2 | 6 | 4 | 8 | 8 |
| generate_request | 73 | 4 | 2 | 4 | 5 | 10 | 8 |
| background_3d_candidates | 52 | 2 | 4 | 6 | 4 | 4 | 4 |
| paint_tool_set | 50 | 2 | 3 | 4 | 5 | 8 | 4 |
| text_frames_align | 45 | 2 | 4 | 4 | 4 | 8 | 4 |

## train（新規採用分）

| ID | 分類 | 本文 | slots |
|---|---|---|---|
| nyamuru_voice_2000 | save | 終わりのページは休憩してから読み直すつもり。今の修正をセーブしてくれる？ | {"target": "current_document"} |
| nyamuru_voice_2001 | save | 最後のページを開いたときに直した誤字も、いまの作品の保存に含めてね。 | {"target": "current_document"} |
| nyamuru_voice_2002 | save | 読み返す準備はできたし、さっき気になっていた誤字と吹き出しの重なりも自分で確認できたよ。これ以上は明日また見ることにするから、今の編集内容を作品に保存しておいてくれる？ いつものセーブを一回お願い。 | {"target": "current_document"} |
| nyamuru_voice_2003 | compound_request | セーブと末尾のページ表示をお願い。 | {} |
| nyamuru_voice_2004 | compound_request | 休憩前に済ませたいんだ。今の修正を保存したうえで、最後のページを開いておいてくれる？ | {} |
| nyamuru_voice_2005 | not_command | 終わりのページまで読み返してセーブも済ませたよ。続きは休憩の後にする。 | {} |
| nyamuru_voice_2006 | undo | 保存はさっき済んだんだけど、その後の一筆が余計だった。直前の描画を一回Undoして。 | {"count": 1} |
| nyamuru_voice_2007 | undo | セーブする前に見比べたいので、いちばん新しい編集の取り消しをお願い。履歴は一段戻せばいい。 | {"count": 1} |
| nyamuru_voice_2008 | undo | 今の一筆をなかったことにしたい。直前の編集を取り消して、つまりUndo一回ね。 | {"count": 1} |
| nyamuru_voice_2009 | compound_request | 余計な一筆をUndo一回で消して、その修正をセーブまでしておいて。 | {} |
| nyamuru_voice_2010 | compound_request | 保存済みの作品だけど、最後の一操作を取り消して、あらためて上書き保存してね。 | {} |
| nyamuru_voice_2011 | not_command | 最後の一筆はUndoで取り消して、保存し直したところだよ。 | {} |
| nyamuru_voice_2012 | redo | Undoで消えた変更を復活させてほしい。履歴のRedoを一回かけて、取り消す前の状態に返して。 | {"count": 1} |
| nyamuru_voice_2013 | redo | あとで実寸で確認するから、取り消した直近の変更をリドゥで一件返しておいて。 | {"count": 1} |
| nyamuru_voice_2014 | redo | 実寸表示で確認してから取り消した変更なんだけど、やっぱり採用する。Redo一回で復元して。 | {"count": 1} |
| nyamuru_voice_2015 | compound_request | リドゥ一回と実寸表示、お願い。 | {} |
| nyamuru_voice_2016 | compound_request | Undoで消えた変更を一件復元したら、細部を見るために表示も実寸へ切り替えてほしい。 | {} |
| nyamuru_voice_2017 | not_command | 取り消した変更を復元したいんだけど、履歴をどっちへ動かす操作なのか教えて。 | {} |
| nyamuru_voice_2018 | page_navigate | セーブするか決める前に十一ページを見たいから、そこを開いてもらえる？ | {"page_number": 11} |
| nyamuru_voice_2019 | page_navigate | 十一ページを表示しておいて。保存するタイミングは、私が見てから決めるね。 | {"page_number": 11} |
| nyamuru_voice_2020 | page_navigate | さっきセーブした十一ページに戻りたい。表示ページを十一に合わせて。 | {"page_number": 11} |
| nyamuru_voice_2021 | compound_request | 十一ページを開くのと、作品をセーブするのを頼むよ。 | {} |
| nyamuru_voice_2022 | compound_request | 十一ページを表示して。そこを読んでいる間に、今の作品の保存も済ませておいて。 | {} |
| nyamuru_voice_2023 | not_command | 十一ページへ移るだけでも、今の修正は自動で保存されるの？ | {} |
| nyamuru_voice_2024 | view_change | 編集ガイドのそばの細い線を見たいので、表示を一段ズームインしてくれるかな。 | {"kind": "zoom", "zoom_mode": "in", "count": 1} |
| nyamuru_voice_2025 | view_change | 拡大表示を一段お願い。線を大きく見たいということだから、ズームイン一回でいい。 | {"kind": "zoom", "zoom_mode": "in", "count": 1} |
| nyamuru_voice_2026 | view_change | 編集ガイドを出してから細部が気になったんだ。画面の倍率を一段上げて。 | {"kind": "zoom", "zoom_mode": "in", "count": 1} |
| nyamuru_voice_2027 | compound_request | ズームイン一段、編集ガイドも表示で。 | {} |
| nyamuru_voice_2028 | compound_request | 線とガイドを見比べるので、編集ガイドを出して、画面も一段拡大してほしい。 | {} |
| nyamuru_voice_2029 | not_command | 編集ガイドの線も、ズームインすれば太く見えるのかな。 | {} |
| nyamuru_voice_2030 | artwork_mode_set | 選択中のコマは昼休みの後に生成するつもりなので、いま作画方式だけ下書きに合わせておいて。 | {"mode": "draft"} |
| nyamuru_voice_2031 | artwork_mode_set | このコマはさっき一度画像生成を試して、線の様子を自分で見比べていたところなんだ。次の生成はまだ自分で考えるので、いまは作画設定を下書き方式へ変更しておいて。画像を作るタイミングは、その設定を見てから私が決めるよ。 | {"mode": "draft"} |
| nyamuru_voice_2032 | artwork_mode_set | 下書き方式を使う設定にしてほしいんだ。作画設定のdraftを選ぶ、というお願い。 | {"mode": "draft"} |
| nyamuru_voice_2033 | compound_request | 下書き方式で、この選択コマの画像生成までお願い。方式の切替からやってね。 | {} |
| nyamuru_voice_2034 | compound_request | 昼休みのうちに進めたいから、作画方式を下書きへ変えて、そのまま選択コマを丸ごと生成して。 | {} |
| nyamuru_voice_2035 | not_command | 下書き方式でこのコマを生成した場合、どんな順番で作業するの？ | {} |
| nyamuru_voice_2036 | bubble_set | つかんでいる吹き出しを斜めにずらして、右へ四ミリ、上へ三ミリの位置にして。 | {"target": "selected_bubble", "field": "bbox", "operation": "translate", "dx_mm": 4, "dy_mm": -3} |
| nyamuru_voice_2037 | bubble_set | この吹き出し、横方向は右へ四ミリで、縦方向は上へ三ミリ。それを一度の移動として反映して。 | {"target": "selected_bubble", "field": "bbox", "operation": "translate", "dx_mm": 4, "dy_mm": -3} |
| nyamuru_voice_2038 | bubble_set | しっぽを消しておいた吹き出しを選んであるよ。それを右四ミリ、上三ミリへ動かして。 | {"target": "selected_bubble", "field": "bbox", "operation": "translate", "dx_mm": 4, "dy_mm": -3} |
| nyamuru_voice_2039 | compound_request | この吹き出し、右四ミリ上三ミリへ移動、しっぽは削除で。 | {} |
| nyamuru_voice_2040 | compound_request | いま選んだ吹き出しはしっぽをなくして、位置も右へ四ミリ、上へ三ミリずらしてもらえる？ | {} |
| nyamuru_voice_2041 | needs_clarification | しっぽを消した吹き出しを、右上へ少しだけ動かして。 | {} |
| nyamuru_voice_2042 | bubble_set | 選択した吹き出しの寸法をまとめて指定するね。横三十一ミリ、縦四十三ミリに調整して。 | {"target": "selected_bubble", "field": "bbox", "operation": "resize", "width_mm": 31, "height_mm": 43} |
| nyamuru_voice_2043 | bubble_set | 四角にしておいたこの吹き出し、大きさは幅三十一、高さ四十三ミリに合わせてほしい。 | {"target": "selected_bubble", "field": "bbox", "operation": "resize", "width_mm": 31, "height_mm": 43} |
| nyamuru_voice_2044 | bubble_set | 横三十一ミリと縦四十三ミリを、この選択中の吹き出しのサイズとして入れて。幅と高さの指定だよ。 | {"target": "selected_bubble", "field": "bbox", "operation": "resize", "width_mm": 31, "height_mm": 43} |
| nyamuru_voice_2045 | compound_request | 吹き出しの輪郭は四角を選んで。大きさについても指定するので、横三十一ミリ、縦四十三ミリを反映して。 | {} |
| nyamuru_voice_2046 | compound_request | この吹き出しは四角に変更。寸法も横三十一ミリ、縦四十三ミリへ直してね。 | {} |
| nyamuru_voice_2047 | needs_reasoning | 四角いこの吹き出し、窮屈に見えない幅と高さを考えてくれない？ | {} |
| nyamuru_voice_2048 | panel_sync_set | コマシンクロが切れていたら入れて。もう入っているならそのままで、最終的にオンになっていればいいよ。 | {"enabled": true} |
| nyamuru_voice_2049 | panel_sync_set | コマシンクロの設定をオンにそろえてほしい。今どちらの状態でも、使える状態にしておいて。 | {"enabled": true} |
| nyamuru_voice_2050 | panel_sync_set | 昨日はコマシンクロを切って作業したけど、今日は有効の設定でお願い。 | {"enabled": true} |
| nyamuru_voice_2051 | compound_request | コマシンクロの有効化と作品の保存を、ひと続きで頼みたいんだ。 | {} |
| nyamuru_voice_2052 | compound_request | コマシンクロがオフならオンへ直し、既にオンなら維持して。その確認が済んだら保存も実行して。 | {} |
| nyamuru_voice_2053 | not_command | コマシンクロって、すでにオンのときにオンを頼むと反転するの？ | {} |
| nyamuru_voice_2054 | inner_frame_snap_set | 内枠スナップは、入っていれば切って、切れていればそのままにしてね。オフにそろえたい。 | {"enabled": false} |
| nyamuru_voice_2055 | inner_frame_snap_set | 内枠に引っ張られずに描きたいので、内枠スナップを使わない設定へ変えてもらえるかな。 | {"enabled": false} |
| nyamuru_voice_2056 | inner_frame_snap_set | 内枠スナップを無効にする設定でお願い。オフにしてほしい、という意味ね。 | {"enabled": false} |
| nyamuru_voice_2057 | compound_request | 内枠スナップは切って、ペンはラスターを選んで。 | {} |
| nyamuru_voice_2058 | compound_request | 手で続きを描くから、内枠スナップを無効へそろえて、使う描画ペンもラスターへ変更しておいて。 | {} |
| nyamuru_voice_2059 | needs_clarification | 内枠スナップのオンかオフか、昨日使っていたほうにして。昨日どちらだったかは覚えていない。 | {} |
| nyamuru_voice_2060 | panel_gap_snap_set | 編集ガイドを見てコマ間を確認したんだ。コマスナップは有効の設定にしておいて。 | {"enabled": true} |
| nyamuru_voice_2061 | panel_gap_snap_set | コマスナップが無効なら有効へ直して、有効なら触らずに。使える状態にそろえてね。 | {"enabled": true} |
| nyamuru_voice_2062 | panel_gap_snap_set | ガイドの確認はあとで私がするので、コマスナップのスイッチだけ今オンに合わせて。 | {"enabled": true} |
| nyamuru_voice_2063 | compound_request | 編集ガイドを出したうえで、コマスナップを有効の設定にそろえて。 | {} |
| nyamuru_voice_2064 | compound_request | コマ間を確認したい。コマスナップを使える設定にして、編集ガイドも見えるように切り替えてくれる？ | {} |
| nyamuru_voice_2065 | not_command | 編集ガイドを見たときは、コマスナップが有効になっていたと思うよ。 | {} |
| nyamuru_voice_2066 | generate_request | 凛さんの画像を作ってほしいんだけど、このページの六コマ目にいるほうの凛さんを生成してもらえる？ | {"target": "named_character", "locator": {"panel_number": 6, "character_name": "凛さん"}} |
| nyamuru_voice_2067 | generate_request | 六コマ目は背景まで作るつもりはないんだ。そこにいる凛さん一人ぶんを生成してもらえる？ | {"target": "named_character", "locator": {"panel_number": 6, "character_name": "凛さん"}} |
| nyamuru_voice_2068 | generate_request | 六コマ目を生成したときの凛さんを選んであるよ。選択している人物の画像をあらためて生成して。 | {"target": "selected_character"} |
| nyamuru_voice_2069 | compound_request | 六コマ目を丸ごと生成して、それとは別に七コマ目の凛さんだけも生成して。 | {} |
| nyamuru_voice_2070 | compound_request | 凛さんの生成を六コマ目でお願い。作品の保存も、生成が終わったところでやっておいて。 | {} |
| nyamuru_voice_2071 | needs_clarification | 六コマ目で、さっき私が名前を挙げた人の画像を生成してほしい。 | {} |
| nyamuru_voice_2072 | background_3d_candidates | 登録してある3Dから港の待合室に使えそうなものを探して、二候補に絞って見せてほしい。 | {"source": "registered_3d_models", "query": "港の待合室", "count": 2} |
| nyamuru_voice_2073 | background_3d_candidates | 下書き方式にした作品なんだけど、港の待合室に使う背景候補を登録済み3Dから二つ挙げてもらえる？ | {"source": "registered_3d_models", "query": "港の待合室", "count": 2} |
| nyamuru_voice_2074 | background_3d_candidates | 港の待合室の背景を探しているんだ。まず登録済みの3Dモデルの中を見て、場面に使えそうなものを二つ選び、その候補を見せてほしい。あとで私が見比べるための候補なので、背景として置く作業はまだ頼んでいないよ。 | {"source": "registered_3d_models", "query": "港の待合室", "count": 2} |
| nyamuru_voice_2075 | compound_request | 登録済み3Dの港の待合室候補を二つ。それと作画方式は下書きにして。 | {} |
| nyamuru_voice_2076 | compound_request | 作画設定を下書きに変更しておいて。港の待合室の背景候補も、登録済み3Dから二つ選んで示してくれる？ | {} |
| nyamuru_voice_2077 | not_command | 登録済み3Dだけで港の待合室の候補を出すには、どういう条件を伝えればいい？ | {} |
| nyamuru_voice_2078 | paint_tool_set | 文字枠はあとで自分で整えるよ。先に線を描きたいから、使うペンをラスターへ切り替えておいて。 | {"tool": "pen"} |
| nyamuru_voice_2079 | paint_tool_set | 文字枠の上端はもうそろえた。次の手描きにはラスターペンを使うので、それを選んで。 | {"tool": "pen"} |
| nyamuru_voice_2080 | paint_tool_set | ペンの選択をラスターへお願い。これから私が描く線の道具を選んでほしいんだ。 | {"tool": "pen"} |
| nyamuru_voice_2081 | compound_request | ラスターのペン選択と、選択した文字枠の上端揃えを頼む。 | {} |
| nyamuru_voice_2082 | compound_request | 手描きと文字の作業に入りたいので、ラスターペンへ切り替え、選んである文字枠は上端をそろえておいて。 | {} |
| nyamuru_voice_2083 | not_command | 文字枠をそろえてからラスターペンを使う予定だけど、今はまだ何も変えなくていい。 | {} |
| nyamuru_voice_2084 | text_frames_align | 上端を合わせる対象は、いま文字枠として選んでいる四つだよ。吹き出しは別々だけど、その四枠に頭揃えをかけて。 | {"target": "selected_text_frames", "alignment": "top", "reference": "selection_bounds"} |
| nyamuru_voice_2085 | text_frames_align | いま囲って選択した文字枠を、まとめて頭がそろう配置にしてくれるかな。あとでその状態を保存するつもり。 | {"target": "selected_text_frames", "alignment": "top", "reference": "selection_bounds"} |
| nyamuru_voice_2086 | text_frames_align | この作品はセーブできているよ。選んである四つの文字枠は、上端の高さを一致させてほしい。 | {"target": "selected_text_frames", "alignment": "top", "reference": "selection_bounds"} |
| nyamuru_voice_2087 | compound_request | 四つ選んだ文字枠は上端揃え、作品は保存でお願い。 | {} |
| nyamuru_voice_2088 | compound_request | 別々の吹き出しの文字枠を選んであるから、頭の位置をそろえて、揃えた結果までセーブしてくれる？ | {} |
| nyamuru_voice_2089 | needs_reasoning | この四つの文字枠、どの高さに置くと視線が自然に流れるか考えてほしい。 | {} |
| nyamuru_voice_2090 | save | 直前の編集を取り消して保存、と言いかけたけど、取り消しはやめる。今のままセーブをお願い。 | {"target": "current_document"} |
| nyamuru_voice_2091 | save | Undoとセーブのうち、頼むのはセーブのほうだけに決めた。作品を保存してね。 | {"target": "current_document"} |
| nyamuru_voice_2092 | save | 取り消してから残す案は採らないよ。編集をそのまま残すので、作品の保存をしておいて。 | {"target": "current_document"} |
| nyamuru_voice_2093 | compound_request | 取り消しをやめると言ったのは訂正する。Undo一回と、その結果のセーブを続けてお願い。 | {} |
| nyamuru_voice_2094 | compound_request | いまの修正は一回Undoで取り消す。それから保存する。この順番で二つとも実行してね。 | {} |
| nyamuru_voice_2095 | not_command | 取り消して保存、という案もやめにした。結論はまだ出ていないので、どちらも実行しないで。 | {} |
| nyamuru_voice_2096 | undo | 最後の五手をなかったことにしたいんだ。Undoを五回分まとめてかけてくれる？ | {"count": 5} |
| nyamuru_voice_2097 | undo | 履歴を戻す回数は五回で頼む。二回戻したところで止めず、残り三回も同じUndoで。 | {"count": 5} |
| nyamuru_voice_2098 | undo | あとでRedoして見比べるつもりだけど、今頼むのはUndoを五回分かけることだよ。 | {"count": 5} |
| nyamuru_voice_2099 | compound_request | Undo五回分をかけてから、Redoを一回返して。 | {} |
| nyamuru_voice_2100 | compound_request | 最後の五手をUndoで戻した状態を残したい。五回取り消したところで、作品も保存しておいて。 | {} |
| nyamuru_voice_2101 | needs_clarification | さっき見比べたところまでUndoで戻してほしい。何回戻すんだったかな。 | {} |
| nyamuru_voice_2102 | redo | 五回取り消してあった編集を全部戻すので、Redoを五回かけてほしい。 | {"count": 5} |
| nyamuru_voice_2103 | redo | Redoを二回分、その続きに同じRedoを三回分。計五回だけ履歴を進めてね。 | {"count": 5} |
| nyamuru_voice_2104 | redo | セーブは私が見てからするよ。今は取り消し履歴を五件ぶん、Redoで復活させて。 | {"count": 5} |
| nyamuru_voice_2105 | compound_request | Redoで五件復活させて、作品のセーブまで任せるよ。 | {} |
| nyamuru_voice_2106 | compound_request | 取り消していた五件をリドゥで復元し、配置ガイドも表示して見られるようにして。 | {} |
| nyamuru_voice_2107 | not_command | 五回取り消してから五回Redoしたら、編集前と同じ表示に戻ったよ。 | {} |
| nyamuru_voice_2108 | page_navigate | 今より四ページ先を見たいから、ページを四枚分進めてもらえる？ | {"direction": "next", "count": 4} |
| nyamuru_voice_2109 | page_navigate | 一枚先へ送って、さらに三枚先へ。同じ向きへ計四枚ページを進めてね。 | {"direction": "next", "count": 4} |
| nyamuru_voice_2110 | page_navigate | 配置ガイドを消して作業していたところなんだ。今はページを四枚先まで送って。 | {"direction": "next", "count": 4} |
| nyamuru_voice_2111 | compound_request | 配置ガイドは隠して、表示先を今から四ページ先へ送って。 | {} |
| nyamuru_voice_2112 | compound_request | 配置ガイドを消しておいてほしい。それと、今のページから四枚先へ表示を送って。 | {} |
| nyamuru_voice_2113 | not_command | 配置ガイドを消してから四枚先に進んだの、さっき見えた？ | {} |
| nyamuru_voice_2114 | view_change | 人物設定を見直すので、登場人物のタブへ画面を切り替えておいて。設定の中身は私が読むよ。 | {"kind": "tab", "tab": "characters"} |
| nyamuru_voice_2115 | view_change | 配置ガイドは表示したままでいいよ。今見たいのは登場人物のタブだから、そちらを開いて。 | {"kind": "tab", "tab": "characters"} |
| nyamuru_voice_2116 | view_change | 登場人物タブを開くといったん作業を区切れるね。そこへ移ってくれたら、人物名は私が確認する。 | {"kind": "tab", "tab": "characters"} |
| nyamuru_voice_2117 | compound_request | 登場人物タブを開き、配置ガイドを非表示にするところまでお願い。 | {} |
| nyamuru_voice_2118 | compound_request | 人物名を読む準備を頼むね。配置ガイドの非表示と登場人物タブへの切替を、両方やっておいて。 | {} |
| nyamuru_voice_2119 | not_command | 登場人物のタブを開いても、配置ガイドの表示設定は残るの？ | {} |
| nyamuru_voice_2120 | artwork_mode_set | 作画のモードをintegratedに合わせて。一体型と表示されるほうを選ぶということね。 | {"mode": "integrated"} |
| nyamuru_voice_2121 | artwork_mode_set | 編集ガイドを消した状態で試してみるつもり。いま変えてほしい作画方式は一体型だよ。 | {"mode": "integrated"} |
| nyamuru_voice_2122 | artwork_mode_set | この前は下書き方式だったけど、今回は一体型の設定を選んでおいてくれるかな。 | {"mode": "integrated"} |
| nyamuru_voice_2123 | compound_request | 作画は一体型へ、編集ガイドはオフへ変更して。 | {} |
| nyamuru_voice_2124 | compound_request | integratedを選んでから、編集ガイドを隠すところまで進めてほしい。一体型の見え方を確かめたいんだ。 | {} |
| nyamuru_voice_2125 | needs_reasoning | 一体型と下書きのどちらを使うと、この場面の修正がしやすいか判断して。 | {} |
| nyamuru_voice_2126 | bubble_set | 選んだ吹き出しのセリフ欄を埋めてほしい。入れる文は「末尾を開いて、そこでセーブして」だよ。 | {"target": "selected_bubble", "field": "text", "value": "末尾を開いて、そこでセーブして"} |
| nyamuru_voice_2127 | bubble_set | 今の吹き出しのセリフは「末尾を開いて、そこでセーブして」に決めたので、その全文に差し替えて。 | {"target": "selected_bubble", "field": "text", "value": "末尾を開いて、そこでセーブして"} |
| nyamuru_voice_2128 | bubble_set | この吹き出しには「末尾を開いて、そこでセーブして」を一続きのセリフとして設定しておいて。 | {"target": "selected_bubble", "field": "text", "value": "末尾を開いて、そこでセーブして"} |
| nyamuru_voice_2129 | compound_request | 吹き出しの文を「末尾を開いて、そこでセーブして」に直して。実際の作品も、この変更が残るよう保存してね。 | {} |
| nyamuru_voice_2130 | compound_request | この吹き出しの本文は「末尾を開いて、そこでセーブして」にして、しっぽは無しに変更して。 | {} |
| nyamuru_voice_2131 | needs_reasoning | 「末尾を開いて、そこでセーブして」ってセリフは、説明くさく聞こえるかな。 | {} |
| nyamuru_voice_2132 | bubble_set | 選んだ吹き出しは、凛さんが自分の番だと言っているところ。話者欄を凛さんにしておいて。 | {"target": "selected_bubble", "field": "speaker", "name": "凛さん"} |
| nyamuru_voice_2133 | bubble_set | この吹き出しの話者を凛さんへ変えて。名前を付けたいのは発言者の欄のことだよ。 | {"target": "selected_bubble", "field": "speaker", "name": "凛さん"} |
| nyamuru_voice_2134 | bubble_set | 本文を「私の番だね」に直しておいた吹き出しを選んだよ。話者は凛さんに指定して。 | {"target": "selected_bubble", "field": "speaker", "name": "凛さん"} |
| nyamuru_voice_2135 | compound_request | この吹き出し、凛さんの発言にして、セリフは「私の番だね」へ直して。 | {} |
| nyamuru_voice_2136 | compound_request | 凛さんが話していることにするので、選択中の吹き出しの話者を凛さんへ変更し、本文も「私の番だね」に揃えて。 | {} |
| nyamuru_voice_2137 | needs_reasoning | 「私の番だね」の吹き出し、前後を読んで凛さんと湊さんのどちらの発言にするか決めて。 | {} |
| nyamuru_voice_2138 | bubble_set | いま選んでいる吹き出し、丸い案より四角い案を採用するよ。形を四角へ変更して。 | {"target": "selected_bubble", "field": "shape", "value": "square"} |
| nyamuru_voice_2139 | bubble_set | この吹き出しの形は四角でお願い。四辺のある輪郭のほうにしてほしいんだ。 | {"target": "selected_bubble", "field": "shape", "value": "square"} |
| nyamuru_voice_2140 | bubble_set | しっぽを無くしておいたこの吹き出し、輪郭を四角に切り替えてもらえる？ | {"target": "selected_bubble", "field": "shape", "value": "square"} |
| nyamuru_voice_2141 | compound_request | 選んだ吹き出しの輪郭は四角で頼むよ。しっぽの設定もオフにしておいて。 | {} |
| nyamuru_voice_2142 | compound_request | しっぽの設定は無効にしてほしい。輪郭もこのままではなく四角を使うことに決めたので、その形へ変更して。 | {} |
| nyamuru_voice_2143 | needs_reasoning | しっぽのないこの吹き出し、四角と丸のどちらが静かな場面に合うか考えて。 | {} |
| nyamuru_voice_2144 | panel_sync_set | 一体型に切り替えた時はコマシンクロも使っていたけど、シンクロのほうは今オフにしておいて。 | {"enabled": false} |
| nyamuru_voice_2145 | panel_sync_set | コマシンクロを使わずに作業したい。設定のオンを外して、無効の状態に合わせてね。 | {"enabled": false} |
| nyamuru_voice_2146 | panel_sync_set | 作画方式はあとで選び直すから、コマシンクロについては先に無効へ設定してほしい。 | {"enabled": false} |
| nyamuru_voice_2147 | compound_request | コマシンクロは無効、作画設定は一体型でお願いします。 | {} |
| nyamuru_voice_2148 | compound_request | 今度は一体型で進めることに決めたので、その方式に変更して、コマシンクロのほうを切ってもらえる？ | {} |
| nyamuru_voice_2149 | not_command | 一体型に切り替えたとき、コマシンクロも一緒にオンになっていたか分かる？ | {} |
| nyamuru_voice_2150 | inner_frame_snap_set | 内枠へ吸いつかないようにしたいんだ。内枠スナップの設定を無効側へ合わせてほしい。 | {"enabled": false} |
| nyamuru_voice_2151 | inner_frame_snap_set | 実寸で見るのは後にするよ。いまは内枠スナップを働かせない設定にしてほしい。 | {"enabled": false} |
| nyamuru_voice_2152 | inner_frame_snap_set | 内枠スナップをオンのままにはしたくないので、無効の側へ設定を合わせてもらえる？ | {"enabled": false} |
| nyamuru_voice_2153 | compound_request | 内枠スナップは無効へ。表示倍率は実寸へ。これでお願い。 | {} |
| nyamuru_voice_2154 | compound_request | 今のチェックは外して内枠スナップを使わない設定にし、表示も実寸に合わせておいて。 | {} |
| nyamuru_voice_2155 | not_command | 内枠スナップのチェックは外さないでね。実寸への切替もまだ待ってほしい。 | {} |
| nyamuru_voice_2156 | panel_gap_snap_set | 内枠スナップを切ってほしい、と言ったけど名前を間違えた。切りたいのはコマスナップのほう。 | {"enabled": false} |
| nyamuru_voice_2157 | panel_gap_snap_set | 切ってもらう設定を言い直すね。内枠じゃなくてコマスナップ、その一項目を無効にして。 | {"enabled": false} |
| nyamuru_voice_2158 | panel_gap_snap_set | コマスナップを無効にお願い。内枠スナップまで切るという意味ではないからね。 | {"enabled": false} |
| nyamuru_voice_2159 | compound_request | 内枠スナップもコマスナップも切って。片方への言い直しではなく、二つともオフにしたい。 | {} |
| nyamuru_voice_2160 | compound_request | コマスナップをオフにする依頼はそのままで、内枠スナップをオンにする操作も追加して。 | {} |
| nyamuru_voice_2161 | needs_clarification | 内枠のほうかコマ間のほうか名前が混ざった。どちらか一方を切りたいんだけど、その設定をオフにして。 | {} |
| nyamuru_voice_2162 | generate_request | 七コマ目は人物も背景も含めた一枚が欲しいので、そのコマ全体の画像生成をお願い。 | {"target": "specified_panel", "locator": {"panel_number": 7}} |
| nyamuru_voice_2163 | generate_request | 背景だけのつもりではないよ。今のページの七番のコマを、人物込みで丸ごと生成してほしい。 | {"target": "specified_panel", "locator": {"panel_number": 7}} |
| nyamuru_voice_2164 | generate_request | 六コマ目はもう生成したので、今回は七コマ目を丸ごと生成してくれる？ | {"target": "specified_panel", "locator": {"panel_number": 7}} |
| nyamuru_voice_2165 | compound_request | 七コマ目と八コマ目を、それぞれ丸ごと画像生成して。 | {} |
| nyamuru_voice_2166 | compound_request | 七コマ目の人物も背景も含めて生成して、その画像ができたら作品を保存しておいて。 | {} |
| nyamuru_voice_2167 | not_command | 七コマ目の一枚を生成するとき、人物と背景は別の対象として頼む必要がある？ | {} |
| nyamuru_voice_2168 | background_3d_candidates | 背景候補の条件は、夜で、人のいないバス停。登録済み3Dから四つ選んで見せて。 | {"source": "registered_3d_models", "query": "夜で、人のいないバス停", "count": 4} |
| nyamuru_voice_2169 | background_3d_candidates | 三コマ目の背景を考えているよ。登録済みの3Dから、夜の無人のバス停に使える候補を四つ出して。 | {"source": "registered_3d_models", "locator": {"panel_number": 3}, "query": "夜の無人のバス停", "count": 4} |
| nyamuru_voice_2170 | background_3d_candidates | 三コマ目用の背景候補を登録済み3Dで調べてほしい。夜の無人のバス停を想定して、四案に絞ってね。 | {"source": "registered_3d_models", "locator": {"panel_number": 3}, "query": "夜の無人のバス停", "count": 4} |
| nyamuru_voice_2171 | compound_request | 三コマ目にはバス停、四コマ目には喫茶店。登録済み3Dから、それぞれの背景候補を二つずつ出して。 | {} |
| nyamuru_voice_2172 | compound_request | 夜の無人のバス停に合う背景候補を登録済み3Dから四つ出して、表示中のページも全体が収まる倍率にして。 | {} |
| nyamuru_voice_2173 | needs_reasoning | 夜の無人のバス停にするか明るい喫茶店にするか、台本の流れに合う場面設定を考えて。 | {} |
| nyamuru_voice_2174 | paint_tool_set | ベクターペンを使うというお願いは撤回するよ。次に使う道具はラスターペンへ変更して。 | {"tool": "pen"} |
| nyamuru_voice_2175 | paint_tool_set | 直前の線はもうUndoしてあるので、使う道具をラスターペンに選び直してほしい。 | {"tool": "pen"} |
| nyamuru_voice_2176 | paint_tool_set | さっきのペン指定を訂正するね。ベクターに切り替える話をやめて、ラスターのほうを選択して。 | {"tool": "pen"} |
| nyamuru_voice_2177 | compound_request | ベクターへの変更はやめる。直前の線を一回Undoして、ペンはラスターへ切り替えて。 | {} |
| nyamuru_voice_2178 | compound_request | 今描いた線の取り消しと、ラスターペンへの切替をお願い。取り消しはUndo一回ぶんだよ。 | {} |
| nyamuru_voice_2179 | not_command | ペンの指定を取り消したと言っただけだよ。描いた線をUndoしてほしいという話ではない。 | {} |
| nyamuru_voice_2180 | text_frames_align | 選択した文字枠の上側をそろえてほしい。別々の吹き出しでも、書き出しの高さが横一線になるようにね。 | {"target": "selected_text_frames", "alignment": "top", "reference": "selection_bounds"} |
| nyamuru_voice_2181 | text_frames_align | ベクターペンへ切り替える前に文字を見ておきたいので、いま選んだ複数の文字枠を上端で揃えて。 | {"target": "selected_text_frames", "alignment": "top", "reference": "selection_bounds"} |
| nyamuru_voice_2182 | text_frames_align | ベクターペンを選んだところだよ。次は、まとめて選択してある文字枠どうしの上辺を合わせて。 | {"target": "selected_text_frames", "alignment": "top", "reference": "selection_bounds"} |
| nyamuru_voice_2183 | compound_request | 文字枠の頭揃えを、今の複数選択にかけて。ペンはベクターを選択して。 | {} |
| nyamuru_voice_2184 | compound_request | ベクターペンを使う準備も頼むよ。道具をそれに切り替えたら、選択中の文字枠の上端をそろえて。 | {} |
| nyamuru_voice_2185 | needs_clarification | 複数選んだ文字枠を、どこかの端でそろえてほしいんだけど、上か下かはまだ決めていない。 | {} |
| nyamuru_voice_2186 | bubble_set | 少し顔に近い気がする。この選択中の吹き出しを左へ二ミリずらしてくれない？ | {"target": "selected_bubble", "field": "bbox", "operation": "translate", "dx_mm": -2} |
| nyamuru_voice_2187 | bubble_set | 今つかんでいる吹き出しを左へ二ミリお願い。少しだけ離すつもりだけど、距離の指定は二ミリで。 | {"target": "selected_bubble", "field": "bbox", "operation": "translate", "dx_mm": -2} |
| nyamuru_voice_2188 | bubble_set | しっぽを少し前に消したこの吹き出し、位置は左へ二ミリ動かしておいて。 | {"target": "selected_bubble", "field": "bbox", "operation": "translate", "dx_mm": -2} |
| nyamuru_voice_2189 | compound_request | 少し近すぎるね。この吹き出しを左へ二ミリ動かして、しっぽも消してほしい。 | {} |
| nyamuru_voice_2190 | compound_request | 吹き出しは左二ミリへ移動で。少し間が空くけど、その状態で作品も保存しておいて。 | {} |
| nyamuru_voice_2191 | needs_clarification | 今つかんでいる吹き出しを、左へ少しだけずらしてくれない？ | {} |
| nyamuru_voice_2192 | save | 誤字の確認も済んだし、吹き出しの重なりも見直せた。区切りがいいので今の作品を保存してくれるかな。 | {"target": "current_document"} |
| nyamuru_voice_2193 | save | 配置ガイドは後で消すつもり。今は誤字を直した状態が残ればいいから、作品をセーブしておいて。 | {"target": "current_document"} |
| nyamuru_voice_2194 | save | 誤字も直せたし配置ガイドも隠せたので、この区切りで作品の保存を頼むよ。 | {"target": "current_document"} |
| nyamuru_voice_2195 | compound_request | 誤字は確認できた。作品を保存して、配置ガイドも隠してくれるかな。 | {} |
| nyamuru_voice_2196 | compound_request | セーブして。配置ガイドも消して。 | {} |
| nyamuru_voice_2197 | not_command | 誤字の確認も配置ガイドの整理も終わって、セーブしたところだよ。 | {} |
| nyamuru_voice_2198 | view_change | 上下左右が画面に入るように、このページを全体表示してほしい。紙の端まで見える倍率に合わせて。 | {"kind": "zoom", "zoom_mode": "fit"} |
| nyamuru_voice_2199 | view_change | 見開きで確認するのはあとにするから、いまのページ一枚が収まるように表示倍率を調整して。 | {"kind": "zoom", "zoom_mode": "fit"} |
| nyamuru_voice_2200 | view_change | 見開き表示をオフにしたところ。続けて、このページの全体が画面に入る倍率へ戻してもらえる？ | {"kind": "zoom", "zoom_mode": "fit"} |
| nyamuru_voice_2201 | compound_request | 見開き表示をオフに設定して、ページ全体も画面に収めて。 | {} |
| nyamuru_voice_2202 | compound_request | 紙面の端を全部見たいんだ。見開きは切り、表示倍率は一ページ全体が入るように合わせてくれる？ | {} |
| nyamuru_voice_2203 | not_command | 見開きをオフにしたら、ページの全体が入る倍率にも自動で変わるの？ | {} |
| nyamuru_voice_2204 | generate_request | 画像を作ってほしいものを画面で選んだよ。いま選択しているそれを生成してくれるかな。 | {"target": "selection"} |
| nyamuru_voice_2205 | generate_request | 選択対象を生成してほしいという頼みだよ。画像生成を始める対象は、今画面で選んでいるものね。 | {"target": "selection"} |
| nyamuru_voice_2206 | generate_request | 余計な線はさっきUndoした。これからは今選んでいる人物の画像を生成してもらいたい。 | {"target": "selected_character"} |
| nyamuru_voice_2207 | compound_request | 直前の線をUndo一回で取り消し、四コマ目の湊さんの画像を生成して。 | {} |
| nyamuru_voice_2208 | compound_request | この人物を生成して。作品はできあがったところでセーブもして。 | {} |
| nyamuru_voice_2209 | needs_clarification | 前に見せたあの人物を生成して。いま画面で選んでいるものとは別の人だよ。 | {} |
| nyamuru_voice_2210 | save | 保存して見開きに、という今の頼みから、見開きの部分を外すね。セーブだけ済ませて。 | {"target": "current_document"} |
| nyamuru_voice_2211 | view_change | セーブと見開きをお願いするつもりだったけど、保存はやめる。表示だけ見開きに切り替えて。 | {"kind": "spread", "enabled": true} |
| nyamuru_voice_2212 | save | 見開きにして保存する話は、表示の切替だけ取り消すよ。今の作品をセーブするほうはお願い。 | {"target": "current_document"} |
| nyamuru_voice_2213 | compound_request | 見開きの切替をやめる、と言ったけどその訂正を撤回する。見開きをオンにして、作品も保存して。 | {} |
| nyamuru_voice_2214 | compound_request | 作品はセーブ、表示は見開きに変更。ここまで両方やっておいてね。 | {} |
| nyamuru_voice_2215 | not_command | 保存と見開きへの切替を頼みかけたけど、二つともやめる。いまの表示と編集をそのままにして。 | {} |

## dev（新規採用分）

| ID | 分類 | 本文 | slots |
|---|---|---|---|
| nyamuru_voice_2407 | save | 保存しておいてね、いま編集中の作品を。 | {"target": "current_document"} |
| nyamuru_voice_2431 | page_navigate | 移って、いまの一つ前のページに。 | {"direction": "previous", "count": 1} |
| nyamuru_voice_2435 | view_change | 見開き表示は切って、いや、オンにして。 | {"kind": "spread", "enabled": true} |
| nyamuru_voice_2436 | view_change | 編集ガイドはそのままにして、配置ガイドだけ表示して。 | {"kind": "guide", "guide": "placement", "enabled": true} |
| nyamuru_voice_2439 | view_change | 小さくしたいのは絵そのものじゃなくて画面の表示。ズームアウトして。 | {"kind": "zoom", "zoom_mode": "out"} |
| nyamuru_voice_2447 | artwork_mode_set | 変更するのは作画方式。一体型を選んで。 | {"mode": "integrated"} |
| nyamuru_voice_2451 | bubble_set | 選択中の吹き出しの幅は四十ミリ、いや、四十五ミリにして。高さは二十ミリで。 | {"target": "selected_bubble", "field": "bbox", "operation": "resize", "width_mm": 45, "height_mm": 20} |
| nyamuru_voice_2455 | bubble_set | つなぐのは選択中の吹き出し。二番の吹き出しへ結合して。 | {"target": "selected_bubble", "field": "join_to", "bubble_number": 2} |
| nyamuru_voice_2463 | needs_clarification | 保存して……いや、それはやめて、元に戻して。 | {} |
| nyamuru_voice_2466 | needs_reasoning | 会話がぎこちないので、二人の関係が伝わる台詞に練り直して。 | {} |
| nyamuru_voice_2467 | needs_reasoning | この二つの台詞案を比べて、人物らしいほうを選んで。 | {} |
| nyamuru_voice_2468 | needs_reasoning | 伝えたい内容は変えず、子どもにも伝わる台詞の言い方を考えて。 | {} |
| nyamuru_voice_2470 | needs_reasoning | 主人公の性格を設定に書き足したよ。それを読んで、この返答を主人公らしく直して。 | {} |
| nyamuru_voice_2471 | needs_reasoning | 見てほしいのはこのコマの読みやすさ。吹き出しの配置に直すべきところがあるか判断して。 | {} |
| nyamuru_voice_2473 | compound_request | 画面を用紙に合わせるのと、作画方式を下書きにするのをお願い。 | {} |
| nyamuru_voice_2476 | compound_request | 選択中の吹き出しのしっぽを消して。文字枠は、選択した複数の上端をそろえて。 | {} |
| nyamuru_voice_2477 | compound_request | ベクターペンにして、それに見開き表示もオンにして。 | {} |
| nyamuru_voice_2479 | compound_request | ページは移動せず、表示を原寸に戻して、人物タブも開いて。 | {} |
| nyamuru_voice_2486 | out_of_scope_request | ペンの種類はそのままで、今ある線画をベクター化して。 | {} |
| nyamuru_voice_2487 | out_of_scope_request | 吹き出しの変更じゃなくて、新しい吹き出しを一つ追加して。 | {} |
| nyamuru_voice_2494 | not_command | 次に開くときはベクターペンを使うつもり。 | {} |
| nyamuru_voice_2495 | not_command | 吹き出しのしっぽが消えてる。 | {} |
| nyamuru_voice_2527 | generate_request | 対象は三番のコマで選択している人物。これを生成して。 | {"target": "selected_character", "locator": {"panel_number": 3}} |
| nyamuru_voice_2535 | background_3d_candidates | 候補を見たいのは二番のコマ。登録済みの3D背景から選んで見せて。 | {"source": "registered_3d_models", "locator": {"panel_number": 2}} |
| nyamuru_voice_3000 | save | ここで保存を一回。まだ続きは描くけどね。 | {"target": "current_document"} |
| nyamuru_voice_3003 | save | 保存をお願い。さっきの「まだ保存しない」は撤回するね。 | {"target": "current_document"} |
| nyamuru_voice_3006 | undo | 二回、編集履歴を戻して。二つ前までで止めてね。 | {"count": 2} |
| nyamuru_voice_3009 | redo | 取り消し前の絵にしたいけど、新しく描く必要はないよ。今の取り消しを一つRedoで。 | {"count": 1} |
| nyamuru_voice_3010 | redo | もう一度というのは、Undoした編集を戻すほうの一回ね。Redoをお願い。 | {"count": 1} |
| nyamuru_voice_3014 | page_navigate | 七ページを開いてほしい。「七ページ追加」じゃなくて、番号七のページを見るほう。 | {"page_number": 7} |
| nyamuru_voice_3016 | view_change | 縮めたいのは表示のほう。紙の上の寸法は触らず、ズームアウトでお願い。 | {"kind": "zoom", "zoom_mode": "out"} |
| nyamuru_voice_3019 | view_change | 人物タブを開いた状態にしておいて、編集はまだ始めないでね。 | {"kind": "tab", "tab": "characters"} |
| nyamuru_voice_3021 | artwork_mode_set | 「下書き」を選ぶところまで頼むよ、作画設定のほうで。 | {"mode": "draft"} |
| nyamuru_voice_3026 | bubble_set | しっぽはなしでお願い、選択中の吹き出しのね。 | {"target": "selected_bubble", "field": "tail_enabled", "value": false} |
| nyamuru_voice_3027 | bubble_set | この選択中の吹き出しの話者、「先生」という役名でなく、台帳の健さんに指定して。 | {"target": "selected_bubble", "field": "speaker", "name": "健さん"} |
| nyamuru_voice_3028 | needs_clarification | 選択中の吹き出し、いまよりひと回り大きいくらいで頼む。 | {} |
| nyamuru_voice_3029 | needs_clarification | ペンはそっちに切り替えで。さっき使ったほうじゃなくて、もう片方のほう。 | {} |
| nyamuru_voice_3030 | needs_clarification | コマシンクロの設定、いまのままという意味ではないよ。変更をお願い。 | {} |
| nyamuru_voice_3031 | needs_clarification | ガイド表示を入れるところまでお願い。どのガイドかは、前に話したやつね。 | {} |
| nyamuru_voice_3032 | needs_reasoning | 主人公ならこんな返事はしなさそう。この場面での返答を、人物設定に沿って考え直して。 | {} |
| nyamuru_voice_3033 | needs_reasoning | 形はまだ決めてない。場面に合う吹き出しを選んでほしい、丸でも角ばっていてもいいから。 | {} |
| nyamuru_voice_3035 | needs_reasoning | 「怒っているから大声」と決めつけず、ここの人物の気持ちを読んでセリフを練り直してほしい。 | {} |
| nyamuru_voice_3036 | compound_request | 一つは保存、もう一つは表示を原寸に戻すこと。この二つを今お願い。 | {} |
| nyamuru_voice_3038 | compound_request | ベクターペンはお願いね。それだけで終わりにせず、コマシンクロも有効に。 | {} |
| nyamuru_voice_3039 | compound_request | 選択中の吹き出しの本文は「ちょっと待って」に差し替え、それから作品の保存。この順で両方お願い。 | {} |
| nyamuru_voice_3040 | out_of_scope_request | 保存という言い方をしたけど、今の作品とは別ファイルに残したい。別名保存のほうをお願い。 | {} |
| nyamuru_voice_3044 | not_command | 「保存してくれる？」って言ったら、もうそれは保存の依頼になるの？ | {} |
| nyamuru_voice_3045 | not_command | コマスナップはオフに、って今お願いしたいわけじゃない。使い方を先に知りたいんだ。 | {} |
| nyamuru_voice_3047 | not_command | ベクターペンになってるのは分かった。切り替え直しは要らない、そのままで。 | {} |
| nyamuru_voice_3050 | panel_sync_set | コマシンクロのほうをオフで。内枠スナップのことは言ってないよ。 | {"enabled": false} |
| nyamuru_voice_3051 | panel_sync_set | コマシンクロはオンでお願い。「オンにしないで」じゃなくて、「オンにして」ね。 | {"enabled": true} |
| nyamuru_voice_3055 | inner_frame_snap_set | 内枠スナップは有効にしておいてね。コマの位置まで今そろえなくていいから。 | {"enabled": true} |
| nyamuru_voice_3058 | panel_gap_snap_set | コマシンクロを切る件はなし。今回はコマスナップの無効化だけで。 | {"enabled": false} |
| nyamuru_voice_3061 | generate_request | 「この人を生成」の、この人は選択中の人物のこと。画像生成をそこにお願い。 | {"target": "selected_character"} |
| nyamuru_voice_3062 | generate_request | 生成してほしいのは真央ちゃん。コマは四番、その中の真央ちゃんだけね。 | {"target": "named_character", "locator": {"panel_number": 4, "character_name": "真央ちゃん"}} |
| nyamuru_voice_3063 | generate_request | コマを増やすんじゃなくて、今選んでいるコマの絵を作るほう。コマ全体の生成をお願い。 | {"target": "selected_panel"} |
| nyamuru_voice_3065 | background_3d_candidates | 舞台は小さな診療所。背景候補を二つほしい、登録済みの3Dモデルの中からね。 | {"source": "registered_3d_models", "count": 2, "query": "小さな診療所"} |
| nyamuru_voice_3071 | paint_tool_set | ラスターペンに戻してほしい、道具の設定をね。履歴を戻す操作ではないよ。 | {"tool": "pen"} |
| nyamuru_voice_3072 | text_frames_align | 上をそろえたいのは、こことここの文字枠。いま複数選んである分の上端揃えをお願い。 | {"target": "selected_text_frames", "alignment": "top", "reference": "selection_bounds"} |
| nyamuru_voice_3101 | save | この作品の保存、引き受けてもらえる？　ここまで直した内容で。 | {"target": "current_document"} |
| nyamuru_voice_3103 | undo | 最後に入れた変更を、編集履歴で取り消してほしいんだ。一回分です。 | {"count": 1} |
| nyamuru_voice_3105 | redo | 履歴の「やり直し」を一回お願い。対象は、直前にUndoした編集。 | {"count": 1} |
| nyamuru_voice_3106 | page_navigate | ページをめくる操作で、先へ二回お願いします。 | {"direction": "next", "count": 2} |
| nyamuru_voice_3111 | panel_sync_set | コマシンクロは有効を選ぶよ。設定に反映してもらえる？ | {"enabled": true} |
| nyamuru_voice_3112 | inner_frame_snap_set | 内枠スナップは、オンの設定で始められるようにしておいて。 | {"enabled": true} |
| nyamuru_voice_3114 | panel_gap_snap_set | オンでお願いします。設定するのはコマスナップ。 | {"enabled": true} |
| nyamuru_voice_3118 | paint_tool_set | 選ぶツールはベクターペン、で確定。実際の切り替えまでお願いします。 | {"tool": "vector-pen"} |
| nyamuru_voice_3120 | text_frames_align | 複数選んだ文字枠のうち、一番上の枠に合わせて、全部の上端をそろえて。 | {"target": "selected_text_frames", "alignment": "top", "reference": "selection_bounds"} |

## test（新規採用分）

| ID | 分類 | 本文 | slots |
|---|---|---|---|
| nyamuru_voice_2707 | save | 保存して。念押しだけど、今の作品を保存してね。 | {"target": "current_document"} |
| nyamuru_voice_2721 | undo | 取り消す回数は二回でお願い。編集のUndoね。 | {"count": 2} |
| nyamuru_voice_2723 | undo | Undoを一回お願い。繰り返すけど、取り消しは一回だけ。 | {"count": 1} |
| nyamuru_voice_2735 | redo | Redo一回でお願い。念押しだけど、再適用は一回だけ。 | {"count": 1} |
| nyamuru_voice_2747 | page_navigate | 次のページへ。念押しだけど、進むのは一ページね。 | {"direction": "next", "count": 1} |
| nyamuru_voice_2753 | view_change | 絵の寸法は変えず、表示を原寸にして。 | {"kind": "zoom", "zoom_mode": "actual"} |
| nyamuru_voice_2754 | view_change | 配置ガイドじゃなくて、編集ガイドを表示して。 | {"kind": "guide", "guide": "edit", "enabled": true} |
| nyamuru_voice_2755 | view_change | 作画ガイドを消して。もう一度言うね、作画ガイドは非表示で。 | {"kind": "guide", "guide": "artwork", "enabled": false} |
| nyamuru_voice_2767 | artwork_mode_set | 作画は一体型に設定して。繰り返すけど、一体型でお願い。 | {"mode": "integrated"} |
| nyamuru_voice_2770 | artwork_mode_set | 設定の変更だけ頼むね。作画は下書きモードへ。 | {"mode": "draft"} |
| nyamuru_voice_2778 | bubble_set | しっぽを消して、いや、選択中の吹き出しはしっぽありにして。 | {"target": "selected_bubble", "field": "tail_enabled", "value": true} |
| nyamuru_voice_2779 | bubble_set | 選択中の吹き出しをコマで切り取らない設定にして。念押しだけど、切取りはオフ。 | {"target": "selected_bubble", "field": "clip_to_panel", "value": false} |
| nyamuru_voice_2800 | needs_reasoning | 次に読者を驚かせたい。今のページをどう見せると効果的か考えて。 | {} |
| nyamuru_voice_2801 | needs_reasoning | セリフ本文は保ったまま、読み順が伝わる配置を考えて。 | {} |
| nyamuru_voice_2807 | needs_reasoning | 資料の会話を読んで、今のコマに使える短いセリフ案にまとめて。 | {} |
| nyamuru_voice_2809 | compound_request | 見開きをオフにして、さらにコマシンクロもオフにして。 | {} |
| nyamuru_voice_2815 | compound_request | 選択中の吹き出しの本文は変えず、しっぽを消して所属を二番のコマにして。 | {} |
| nyamuru_voice_2823 | out_of_scope_request | ページの順番を間違えた。三ページ目を一ページ目の前へ移して。 | {} |
| nyamuru_voice_2826 | out_of_scope_request | 背景の候補提示はやめて、外部サイトで教室の3Dモデルを検索して。 | {} |
| nyamuru_voice_2836 | not_command | 次の休憩前に作品を保存するつもり。 | {} |
| nyamuru_voice_2840 | not_command | この吹き出しの文字、今日は妙に大きく見えるな。 | {} |
| nyamuru_voice_2842 | not_command | 選択中の文字枠はいくつある？ | {} |
| nyamuru_voice_2851 | panel_sync_set | コマシンクロをオフにして。念のため言うけど、オフでね。 | {"enabled": false} |
| nyamuru_voice_2863 | inner_frame_snap_set | 内枠スナップはオフに設定して。繰り返すね、オフにして。 | {"enabled": false} |
| nyamuru_voice_2875 | panel_gap_snap_set | コマスナップをオフにしてね。もう一度、オフでお願い。 | {"enabled": false} |
| nyamuru_voice_2887 | generate_request | 選択中の人物を生成して。念押しだけど、生成するのは選択中の人物ね。 | {"target": "selected_character"} |
| nyamuru_voice_2899 | background_3d_candidates | 背景候補を三つお願い。繰り返すけど、候補は三つで。 | {"source": "registered_3d_models", "count": 3} |
| nyamuru_voice_2900 | background_3d_candidates | 場面は図書館。登録済み3Dモデルから背景候補をお願い。 | {"source": "registered_3d_models", "query": "図書館"} |
| nyamuru_voice_2911 | paint_tool_set | ラスターペンにして。念押しだけど、今使うのはラスターペンね。 | {"tool": "pen"} |
| nyamuru_voice_2923 | text_frames_align | 選択中の文字枠二つを頭揃えにして。念押しだけど、その二つの上端をそろえてね。 | {"target": "selected_text_frames", "alignment": "top", "reference": "selection_bounds"} |
| nyamuru_voice_3201 | save | 保存って言ったのはコピーを作る話じゃなくて、今の作品に変更を残すほう。それを実行して。 | {"target": "current_document"} |
| nyamuru_voice_3203 | save | いま保存を押してほしい。保存先や作品名は、この作品のままでいい。 | {"target": "current_document"} |
| nyamuru_voice_3204 | undo | 最後にやったのは文字の移動で、その前が線を一本描く編集。この二つをまとめてUndoして。 | {"count": 2} |
| nyamuru_voice_3205 | undo | たった今動かした吹き出し、動かす前の状態に戻せる？　新しく動かすんじゃなくて、履歴を一つ戻してほしい。 | {"count": 1} |
| nyamuru_voice_3210 | redo | さっき三回Undoしたうち、直近に取り消した二回分だけ再適用して。残り一回分は取り消したままで。 | {"count": 2} |
| nyamuru_voice_3211 | redo | Redoをお願いします。回数の指定を先に言い忘れたけど、一回です。 | {"count": 1} |
| nyamuru_voice_3212 | page_navigate | 開きたいのは六ページ目。いまの表示から何ページ離れていても、六ページ目へ直接お願い。 | {"page_number": 6} |
| nyamuru_voice_3213 | page_navigate | 次のページじゃなくて、その次まで進めてほしい。今から二ページ分ね。 | {"direction": "next", "count": 2} |
| nyamuru_voice_3215 | page_navigate | この作品はどこで終わるか見たい。途中のページは開かなくていいから、最終ページを見せて。 | {"position": "last"} |
| nyamuru_voice_3217 | view_change | 見開きって左右を並べる表示のことだよね。それを今、オンにしてほしい。 | {"kind": "spread", "enabled": true} |
| nyamuru_voice_3219 | view_change | どのタブか、名前を言うね。「小道具」。そこを開いて。 | {"kind": "tab", "tab": "props"} |
| nyamuru_voice_3222 | artwork_mode_set | いま変えたいのは画像の中身じゃなくて作画の設定。方式を一体型にするところまでお願い。 | {"mode": "integrated"} |
| nyamuru_voice_3224 | bubble_set | 選んでいる吹き出しの幅、いまの値に足すんじゃなくて、最終的な幅を三十二ミリにして。 | {"target": "selected_bubble", "field": "bbox", "operation": "resize", "width_mm": 32} |
| nyamuru_voice_3227 | bubble_set | 話している人は悠里さん、という指定だけ反映して。選択中の吹き出しの話者の欄ね。 | {"target": "selected_bubble", "field": "speaker", "name": "悠里さん"} |
| nyamuru_voice_3228 | needs_clarification | これ、広すぎるな。選択中の吹き出しの幅を少し詰めてもらえる？ | {} |
| nyamuru_voice_3231 | needs_clarification | 選択中の吹き出し、話者の名前が今の人じゃないんだよね。別の人に直して。 | {} |
| nyamuru_voice_3232 | needs_reasoning | このコマは、言葉では平気と言ってるけど顔は困ってる。セリフをそのまま使う前提で、吹き出しの形を場面に合わせて選んでほしい。 | {} |
| nyamuru_voice_3233 | needs_reasoning | 二つの吹き出し、読む順番が逆に見える気がする。どちらをどこに置くと自然か、場面を読んで案を出して。 | {} |
| nyamuru_voice_3235 | needs_reasoning | 「大きくすれば読みやすい」とは限らないと思う。選択中の吹き出しは、文章量と絵の余白を見て、ちょうどいい寸法を提案して。 | {} |
| nyamuru_voice_3237 | compound_request | このページ全体を生成してほしい。あ、それとは別に、作業中の作品の保存も今お願い。 | {} |
| nyamuru_voice_3239 | compound_request | 内枠スナップとコマスナップ、両方オンでお願い。あ、今の訂正はコマスナップだけ、そっちはオフにして。 | {} |
| nyamuru_voice_3241 | out_of_scope_request | 最終ページの次に、白紙を一枚足したい。そのページを追加してもらえる？ | {} |
| nyamuru_voice_3242 | out_of_scope_request | この作品を複製したファイルが欲しい。名前は「寄り道メモ」にして、別名保存で作って。 | {} |
| nyamuru_voice_3244 | not_command | 画面に「保存しました」って出た？　今の保存が終わったかだけ教えて。 | {} |
| nyamuru_voice_3245 | not_command | 内枠スナップ、オフにしたらコマが動くわけじゃないんだよね？　動作の説明だけ聞きたい。 | {} |
| nyamuru_voice_3247 | not_command | 次のページへ行くつもりだったけど、もう少しここを見てる。 | {} |
| nyamuru_voice_3250 | panel_sync_set | 今言った「使う」はコマシンクロの設定のこと。コマシンクロを有効にしておいてね。 | {"enabled": true} |
| nyamuru_voice_3252 | inner_frame_snap_set | 内枠スナップの設定にあるオンのほうを選んで。いまの状態にかかわらず、その値でお願い。 | {"enabled": true} |
| nyamuru_voice_3253 | inner_frame_snap_set | 内枠スナップをオフにしたいんだけど、コマのサイズ変更まではしなくていい。その設定だけ変更してもらえる？ | {"enabled": false} |
| nyamuru_voice_3255 | inner_frame_snap_set | コマスナップは触らなくていいよ。オフにしてほしいのは内枠スナップのほう。 | {"enabled": false} |
| nyamuru_voice_3261 | generate_request | 三番のコマの、美月さん。名前を指定したその人物だけを生成して、同じページの別の登場人物には広げないで。 | {"target": "named_character", "locator": {"panel_number": 3, "character_name": "美月さん"}} |
| nyamuru_voice_3264 | background_3d_candidates | 候補に出していいのは、もう登録してある3Dモデルだけ。その中で、この場面の背景に向くものを挙げて。 | {"source": "registered_3d_models"} |
| nyamuru_voice_3266 | background_3d_candidates | 背景候補の条件を足すね。「雨の路地」に合うこと。登録済みの3Dモデルだけで提案して。 | {"source": "registered_3d_models", "query": "雨の路地"} |
| nyamuru_voice_3269 | paint_tool_set | 今選ぶペンの名前は「ラスターペン」。そのツールを使える状態にして。 | {"tool": "pen"} |
| nyamuru_voice_3273 | text_frames_align | 文字枠を二つ選んであるよ。揃える基準は上側、下端や中央ではなく上端でお願い。 | {"target": "selected_text_frames", "alignment": "top", "reference": "selection_bounds"} |
| nyamuru_voice_3274 | text_frames_align | 文字の内容を直す依頼は取り消すね。選択中の複数の文字枠について、書き出し位置を上端でそろえるほうを実行して。 | {"target": "selected_text_frames", "alignment": "top", "reference": "selection_bounds"} |
| nyamuru_voice_3300 | save | ここまでの編集内容、保存してある状態にしてくれる？ | {"target": "current_document"} |
| nyamuru_voice_3304 | needs_clarification | 選択中の吹き出しの大きさ、縦も横も今よりちょっと控えめにしてくれる？ | {} |
| nyamuru_voice_3305 | needs_clarification | ガイドの表示をオフにして。種類の名前が思い出せないけど。 | {} |
| nyamuru_voice_3306 | panel_sync_set | 有効にしたい項目は、コマシンクロ。いまオンに設定をお願い。 | {"enabled": true} |
| nyamuru_voice_3308 | panel_gap_snap_set | 「コマスナップ」と書かれた設定があるね。そこを有効にして。 | {"enabled": true} |
| nyamuru_voice_3310 | paint_tool_set | これから使う道具を指定するよ。「ベクターペン」を選んで。 | {"tool": "vector-pen"} |
| nyamuru_voice_3313 | text_frames_align | 上端揃えをお願い。対象は選択中の二つの文字枠、別々の吹き出しに入っているほうです。 | {"target": "selected_text_frames", "alignment": "top", "reference": "selection_bounds"} |
