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

## TS版との照合(crosscheck)

`crosscheck.py` は fuzz と同じ流儀でランダムケースを作り、pyref をオラクルとして
期待値(points / ignored)を JSON に焼き込む。TS 版(`web/`)はこれを読んで全一致を
検証する:

```sh
# 標準 fixture(web/tests/fixtures/crosscheck.json、seed 0)の再生成
python crosscheck.py --cases 100 --seed 0 --out ../web/tests/fixtures/crosscheck.json

# TS 側の照合実行
cd ../web && npm run crosscheck

# 別 seed で新規ケースを回す場合
python crosscheck.py --cases 50 --seed 1 --out /tmp/cc.json
cd ../web && CROSSCHECK_CASES=/tmp/cc.json npm run crosscheck
```

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
2. `tests/test_graph.py` と `web/tests/graph.test.ts` の実測値(ノード数など)を更新
3. `export.py` の `TREE_VERSION_3_29` を更新
   (<https://cdn.poeplanner.com/json/versions.json> の `atlasVersions` 参照)
4. `pytest` と `fuzz.py` を再実行
5. crosscheck fixture を再生成し(上記)、`cd web && npm test && npm run crosscheck` を通す

木分解・DP は実行時にデータから毎回計算するため、構造変化への追加作業は無い。
ただし `test_decomposition.py` が **treewidth 上界 ≤ 7 をアサート**しており、
新リーグでグラフが濃くなって幅が上がるとここで落ちる(性能劣化の早期検知が目的)。
落ちた場合は `python -m atlasopt bench` で DP の実測時間を確認し、
実用域(<1秒)なら上界の数字を更新して続行してよい。幅が大きく跳ねた場合の保険として、
照合オラクルの ILP(`ilp_reduced.py` / `web/src/solver/ilpReduced.ts`)は
本番切り替え可能な完全動作状態で温存している(worker の import を戻すだけ)。
