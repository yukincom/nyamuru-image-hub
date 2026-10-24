# OSS公開チェックリスト

公開、tag作成、GitHub Release作成の前に、対象commitで次を確認します。開発・公開先は `yukincom/nyamuru-image-hub` に統一し、利用者が指示した範囲の検証済み変更を公開します。すでに許可された公開操作について、同じ承認を繰り返し求める必要はありません。

## Versionと変更内容

- [ ] 公開対象のcommit SHAと、fork固有のversion名を確定した
- [ ] `package.json`と`package-lock.json`のversionが一致している
- [ ] `docs/FORK_CHANGELOG.md`へ公開内容と日付を記録した
- [ ] READMEや画面にversionを表示する場合、同じ値へ揃えた

## ライセンスと公開境界

- [ ] `LICENSE`、`public/THIRD_PARTY_NOTICES.txt`、追加したcode・文章・画像・modelの出典とlicenseを確認した
- [ ] 採用済み操作分類器 `models/nyamuru-voice-v04-seed43/` のみをモデル配布対象とし、同じリポジトリのRelease資産と取得後の実体、出典・MIT licenseと `python3 scripts/install_voice_intent.py --check` の成功を確認した
- [ ] 他のmodel重み、仮想環境、非公開原稿、OCR出力、私的な生成結果、個人path、credential、cacheがGitへ含まれていない。同梱するUI画像・合成test fixture・公開sampleは出典と個別の権利表示を確認した
- [ ] 次の検査でmodel重みの追跡対象が0件である（大文字・小文字を区別しない）

```bash
git ls-files | grep -Ei '\.(bin|ckpt|gguf|onnx|pt|pth|safetensors)$'
```

出力がある場合は公開を止め、各fileの目的と配布licenseを確認します。新規cloneでは `python3 scripts/install_voice_intent.py --download` 後の実体を検証し、ポインターだけの状態を配布完了と扱いません。

## 検証

- [ ] `npm ci`が成功した
- [ ] `npm run verify`が成功した
- [ ] `git diff --check`が成功した
- [ ] `dist/standalone/nyamuru-image-hub.html`と`dist/standalone/THIRD_PARTY_NOTICES.txt`が生成された
- [ ] 通常siteとstandalone版の主要操作をbrowserでsmoke testした
- [ ] 実model、scanner、CLIP STUDIOなどを確認していない場合、その境界を変更履歴へ明記した
- [ ] 作業treeがcleanで、検証したSHAと公開対象SHAが一致している

## 公開操作

- [ ] push先が公開 `origin` の意図したbranchであり、開発履歴・別作業の変更を混ぜていない
- [ ] 対象と実行内容が利用者の公開指示の範囲内である
- [ ] `main` へのpush後、対象SHAの `Fork CI` / `verify` の結果を確認した（pull requestは必須にしない）
- [ ] tag、GitHub Release、Pages配信を行う場合、その操作も指示の範囲内である
