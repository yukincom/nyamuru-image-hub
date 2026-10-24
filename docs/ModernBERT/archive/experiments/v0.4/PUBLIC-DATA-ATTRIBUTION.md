# MASSIVE 1.1 の出典と変更

原データ: Amazon MASSIVE 1.1, ja-JP。Amazon Science / Alexa。

Copyright Amazon.com Inc. or its affiliates.

- [公式リポジトリ](https://github.com/alexa/massive)
- [公開データ](https://huggingface.co/datasets/AmazonScience/massive)
- [公式1.1アーカイブ](https://amazon-massive-nlu-dataset.s3.amazonaws.com/amazon-massive-dataset-1.1.tar.gz)
- [論文: MASSIVE: A 1M-Example Multilingual Natural Language Understanding Dataset with 51 Typologically-Diverse Languages](https://arxiv.org/abs/2204.08582), Jack FitzGerald et al., 2022。

データのライセンスは [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)。同梱の `source/public/massive-1.1/LICENSE` に原文を保存しています。原ja-JP.jsonlのSHA256は `c22df382db6aa4a23dd1e7f62a2ac8f01c6158865771ad25201696be7201ab79`。取得・検査記録は同じフォルダのinspection.jsonを参照。

MASSIVEは英語SLURPの人手ローカライズを含む公開資料です。ここでは日本の漫画編集アプリを実際に操作した発話ログとは扱いません。選定原文はtextを変えず、ニャムルの19分類で再注釈しました。質問・説明依頼をnot_command、アプリ外の明示操作依頼をout_of_scope_requestに置く判断は、このアプリの操作分類契約によるものです。

`massive_derived_synthetic` は公開例の言い回しを参考に、対象・内容を漫画編集へ変えた合成例です。元の意図を保つ翻訳ではありません。元の語句がほとんど残らない例もあり、人の原発話として数えません。全行に元ID・元本文・元ラベル・元partition・変更説明を記録し、派生例はtrainのみに使用しています。

この出典表記と同梱ライセンスはMASSIVE原文とその派生に関するものです。他のユーザー提供例・既存資料・合成例に、一括のライセンスを新たに付与するものではありません。
