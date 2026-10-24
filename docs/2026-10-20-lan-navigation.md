# LAN版の接続とログイン — 2026-10-20

このページは接続コードを使っていた時点の修正記録です。その後、利用者の要望でコード入力を廃止しました。現在の仕様は [コード入力なしのLAN接続](./2026-10-20-lan-direct-access.md) を参照してください。ブラウザー検証用fixtureも `tests/lanAccess.browser.mjs` へ更新しています。

接続コードを入力して「編集を始める」を押すと「別のサイトからの操作は許可されていません」と表示される問題を修正しました。証明書の警告とは別に、HTTPS接続後のLANサーバーが返していたエラーです。併せて、外部リンクから接続画面を開くときの拒否も修正しました。

## 原因と変更

ログイン画面に付けていた `Referrer-Policy: no-referrer` により、ブラウザーのフォームPOSTは `Origin: null` になっていました。同じサイトからの正しい送信も、サーバーのOrigin検証で拒否される組み合わせです。応答を `Referrer-Policy: same-origin` に変更し、同じサイトの送信元情報を保持します。`Origin: null` 自体は引き続き拒否します。フォーム送信とこの設定の関係は [MDN: Referrer-PolicyとOrigin](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Referrer-Policy#effect_on_the_origin_header) を参照してください。

既存の入口は `Sec-Fetch-Site: cross-site` を一律に拒否していました。通常のリンク移動もこの値になるため、トップ画面を開くだけのGETまで拒否していました。

既存の判定内で、URLが `/`、メソッドがGET、`Sec-Fetch-Mode: navigate`、`Sec-Fetch-Dest: document` のときだけ、別サイトからのページ移動を許可します。接続元LAN・Host・Originの確認、接続コード認証は維持します。ログインPOST、処理API、iframe・画像・スクリプト・fetchからの別サイト要求は引き続き拒否します。

ヘッダーの意味は [MDN: Sec-Fetch-Site](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Sec-Fetch-Site) を参照してください。

## 反映

Mac Studio側は、利用者が起動しているLANサーバーをそのターミナルで `Ctrl+C` で終了し、`npm run lan` で起動し直します。有線IPを指定していた場合は同じ指定で起動します。編集用Macでは接続画面を再読み込みしてからコードを入力します。

接続コードはMacの `.local-vision/lan-access-code` へ保存し、次回以降も同じコードを使います。初回にだけランダムな24文字のコードを作成し、ファイル権限を600にします。保存済みコードが壊れている場合は、勝手に変更せずエラーで停止します。意図して変更するときだけ、サーバーを終了してから `npm run lan -- --reset-code` で起動します。

この更新前のコードは保存されていないため、更新後の最初の起動で一度だけ新しいコードになります。以後、通常の再起動では変わりません。ログインCookieは再起動時に更新されるため、同じコードの再入力は必要です。保存先は既存のGit除外対象で、作品保存先や証明書は変わりません。

調査中は利用者の稼働サーバーを停止・再起動していません。修正前のサーバーでURLを直接入力すれば外部リンクの判定は避けられますが、フォーム送信の問題を直すにはサーバーの再起動が必要です。

## 検証

証明書検証を有効にした隔離HTTPSテストで、修正前のトップ画面へのリンク移動が403になることを再現しました。回帰テストはログイン画面の表示、ログイン後の画面表示、認証状態を新規発行しないこと、別サイトからのログイン・API操作・埋め込みの拒否を確認します。

`node tests/lanLogin.browser.mjs` は接続画面そのものを検証する専用fixtureです。ブラウザーからloopback HTTPを通り、CA検証付きHTTPSで実際のLAN入口へ接続します。Originの変換はfixture自身のOriginだけで、`null` や外部Originは書き換えません。実ブラウザーの修正前ログで `POST /__nyamuru/login`、`Origin: null`、`Sec-Fetch-Site: same-origin`、403を再現しました。作品や稼働LLMには接続しません。停止は `Ctrl+C`、10分で自動終了します。

修正後は、このMacの実ブラウザーで外部リンクからログイン画面へ進み、接続コードを手入力してログイン成功画面へ到達しました。フォームPOSTに正しいOriginが付き303、認証Cookieを使った遷移後のGETが200となることも確認しました。手動検証のサーバーは終了時に停止しました。

接続コードの検証では、別プロセスから同じ保存コードを読めること、再起動後のログイン成功、明示的な更新後の旧コード拒否、旧Cookieの失効、保存ファイルの権限、不正な内容やsymlinkを勝手に上書きしないことを確認しました。LAN関連テスト9件はすべて成功しています。

`npm test` はNode 1038件中1035件成功・3件skip、Python 428件（57件skip）・18件（1件skip）・45件（21件skip）で成功しました。`npm run build` の通常版・単体HTMLも成功しています。`npm run verify` は型チェックで、並行作業中の `tests/voiceCommands.browser.tsx:151` にある `panel.figures` が未定義の可能性を示すエラー1件で停止しました。このファイルは今回の変更対象外で、編集していません。

OS X 10.11.6 / Chrome 103の実機操作は未検証です。今回の接続判定の修正と、編集画面の古いブラウザーへの互換対応は別の範囲です。
