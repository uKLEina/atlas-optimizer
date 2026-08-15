# Atlas Optimizer

Path of Exile の Atlas Tree ポイント配分を**厳密解**で最適化するツール。
既存ツール Path of Pathing はヒューリスティックで非最適解を出すことがあり、
「最適性の数学的証明付き」が本ツールの存在意義。**この厳密性を損なう変更は不可。**

要件・設計決定・アルゴリズム・ベンチマーク・PoE Planner URL形式の詳細は
すべて `DESIGN.md` にある。進捗と作業計画は `ROADMAP.md`。作業前に必ず読むこと。

## 現在地(2026-08-15)

- **フェーズ1完了**: Python リファレンス実装(`pyref/`、パッケージ名 atlasopt)
- **フェーズ2完了**: TypeScript ソルバー+ツリー描画UI。ブラウザ完結・ローカル動作。
  起動は `cd web && npm run dev`。GitHub Pages に公開済み
  (https://ukleina.github.io/atlas-optimizer/、master への push で自動デプロイ)
- **フェーズ3完了**: 本番ソルバーを**木分解 Steiner DP** に置換(DESIGN.md 参照)。
  ILP(HiGHS)は照合オラクルへ降格し、本番バンドルから WASM が消えた
- pyref は**照合オラクル兼仕様原本**。TS版は pyref とのランダム照合で正しさを担保する
  (`pyref/fuzz.py` の照合ピラミッド。詳細は `pyref/README.md`)

## 経緯の要点(DESIGN.mdに無いコンテキスト)

- 元データは GGG 公式リポジトリ grindinggear/atlastree-export を
  `vendor/atlastree-export` に submodule としてマウントして参照する
  (`data.json` と、フェーズ2のUIで使う `assets/` の画像類)。
  リーグ更新は `git submodule update --remote`。パス解決は
  `pyref/atlasopt/graph.py` が vendor優先→ルート直下 `data.json` の順で行う
- PoE Planner URL 形式は poeplanner.com の minified JSバンドルを解析して特定した。
  生成URLが実際にサイトで開けること・ポイント数表示が一致することはユーザが実地検証済み
- 素朴なILP定式化(縮約なし)は「解は出るが最適性証明が終わらない」ことを実測済み。
  縮約+強化制約が本質(DESIGN.md「不採用とした選択肢」参照)
- グラフは treewidth ≤ 7(min-fill 実測)。温存していた treewidth DP は
  フェーズ3で採用済み。ILP 2種は照合オラクルとしてテスト・fuzz・crosscheck 生成に残る

## コマンド

```sh
uv pip install --python .venv/bin/python -e pyref/ pytest   # セットアップ
.venv/bin/python -m atlasopt solve --terminals "Endless Tide"
.venv/bin/python -m atlasopt bench
cd pyref && ../.venv/bin/python -m pytest                    # 22件、~7秒
cd pyref && ../.venv/bin/python fuzz.py --cases 100          # 乱数照合、~2分
```

## 変更時のルール

- pyref のソルバー・縮約・分解・エクスポートに触れたら `pytest` と `fuzz.py --cases 100` を必ず通す
- web(TS版)のソルバー・縮約・分解・エクスポートに触れたら
  `cd web && npm test && npm run crosscheck` を必ず通す(pyref との照合)
- `pyref/atlasopt/dp.py` + `decomposition.py` が採用アルゴリズムの仕様原本。
  TS版は**逐語移植**(消去順・反復順・タイの先勝ちまで一致させる)。ここを崩すと
  crosscheck のノード集合完全一致が壊れる。`ilp_reduced.py` は照合オラクル
- スタートノード 29045 はコスト0。ここを1と数えるとすべての結果が1ずれる(過去にやった)
- `data.json` 差し替え時: `tests/test_graph.py` の実測値、`export.py` の treeVersion を更新
  (手順は `pyref/README.md` の「リーグ更新時」)
