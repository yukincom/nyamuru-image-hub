# 過去の版のネーム（固定の見本）

前の版の name-studio が書いたネームです。`tests/past.rs`（Rust）と `app/src/past.test.ts`（画面側）が、
どれも開けて、保存し直しても中身が欠けないことを確かめます。

- `full-project-prNN.json`: その PR の時点の `contract.test.ts` の全項目の見本（`git show <commit>:crates/name-model/tests/fixtures/full-project.json`）。
- `koma-2026-10-22.namestudio`: 2026-10-22 の版で作って保存したネーム（コマ割り・フキダシの確認用、作り物の中身）。

決まり:

- ここのファイルは**作り直さない・書き換えない**（`vitest -u` の対象外）。テストが落ちたら、直すのはアプリの読み込み側です。
- ネームデータの項目を足す・変える PR では、その PR の `full-project.json` をここに `full-project-prNN.json` として足します（足し忘れると `the_current_data_is_kept_as_a_past_name_too` が落ちます）。
- 項目の名前を変える・消すときは `FORMAT_VERSION` を上げ、古い形からの読み替えを `normalize`（画面）と Rust の読み込みに書きます。ここの見本はそのまま開けなければなりません。
