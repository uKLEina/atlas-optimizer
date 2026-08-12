# atlasopt — Python リファレンス実装

Atlas Tree ポイント配分最適化ツールのリファレンス実装。プロダクション実装
(TypeScript + highs-js)の照合オラクルとして機能する。設計の経緯・決定事項は
リポジトリ直下の `DESIGN.md` を参照。

## セットアップ

リポジトリ直下の仮想環境を使う:

```sh
uv pip install --python .venv/bin/python -e pyref/ pytest
```

## 使い方

```sh
# 最適化(ノードIDまたは完全一致の名前で指定)
python -m atlasopt solve --terminals "Endless Tide,45343" --exclude 47488

# ベンチマーク再現
python -m atlasopt bench
```

`solve` は配置ノード一覧・ポイント数・PoE Planner インポートURLを出力する。

## 検証

```sh
cd pyref
python -m pytest             # ユニットテスト
python fuzz.py --cases 100   # 乱数照合(照合ピラミッド、プロセス並列で~2分)
```

fuzz は4層で `ilp_reduced`(採用定式化)を検証する:

| tier | 内容 |
|---|---|
| ball | 小部分グラフ上で 全列挙 vs Dreyfus-Wagner vs reduced の3実装一致 |
| dw | 全グラフ・terminal 1〜7 で DW vs reduced(最適値・無視リスト) |
| naive | terminal 8〜12 で素朴ILP(証明付き)vs reduced |
| large | terminal 15〜60。妥当性検証+不変量+素朴ILPの上下界区間チェック |

## モジュール構成

- `graph.py` — data.json 読み込み(mastery除外、29045=root・コスト0)
- `reduction.py` — 葉刈り+チェーン縮約と解の展開
- `ilp_reduced.py` — **採用定式化(TS移植の仕様原本)**
- `ilp_naive.py` — 素朴定式化(オラクル)
- `brute.py` — Dreyfus-Wagner DP と全列挙(ILPと独立なオラクル)
- `validate.py` — 解の実行可能性検証
- `export.py` — PoE Planner URL encode/decode
- `cli.py` — CLI

## リーグ更新時

1. `git submodule update --remote vendor/atlastree-export` で新リーグのデータを取得
2. `tests/test_graph.py` の実測値(ノード数など)を更新
3. `export.py` の `TREE_VERSION_3_29` を更新
   (<https://cdn.poeplanner.com/json/versions.json> の `atlasVersions` 参照)
4. `pytest` と `fuzz.py` を再実行
