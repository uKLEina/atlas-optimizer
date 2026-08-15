# Atlas Optimizer

Path of Exile の Atlas Passive Tree のポイント配分を**厳密解**で最適化するツール。

取りたいノードを指定すると、「指定ノードをすべて含み、スタート地点から連結で、
消費ポイントが最小」となる配置を求める。同種のツール
[Path of Pathing](https://pathofpathing.com) はヒューリスティックのため
1〜2ポイント無駄な配置を提案することがあるが(README で "optimal-ish" と明記されている)、
本ツールは**最適性の数学的証明付き**の解のみを「最適」として返す。

## ステータス

- ✅ **フェーズ1**: Python リファレンス実装(`pyref/`)— CLI で動作、検証済み
- ✅ **フェーズ2**: ブラウザ完結の Web UI(TypeScript + [highs-js](https://github.com/lovasoa/highs-js))
  — ツリー描画・3状態クリック・自動最適化・PoE Planner エクスポートまで実装済み

```sh
# Web UI の起動(Node 24 / nvm)
cd web && npm install && npm run dev
```

## セットアップ

ゲームデータ(GGG 公式の [grindinggear/atlastree-export](https://github.com/grindinggear/atlastree-export))を
submodule として参照しているため、`--recursive` 付きで clone する:

```sh
git clone --recursive <このリポジトリのURL>
cd atlas-optimizer
uv venv .venv
uv pip install --python .venv/bin/python -e pyref/
```

## 使い方

```sh
# ノードID または完全一致の名前で「取りたいノード」を指定
.venv/bin/python -m atlasopt solve --terminals "Endless Tide,Refiner's Bargain"

# 「このノードは取らない」という除外指定
.venv/bin/python -m atlasopt solve --terminals "Endless Tide" --exclude 47488
```

出力は配置ノード一覧・消費ポイント数・[PoE Planner](https://poeplanner.com) で
そのまま開けるインポートURL。除外によりスタート地点から到達不能になった指定ノードは
無視される(Path of Pathing と同じ挙動)。

## 仕組み

問題は**ルート付き・ノード重み Steiner 木問題**(NP困難)だが、Atlas Tree の
グラフ(約900ノード・約1000辺、treewidth ≤ 6)に対しては前処理縮約
(葉刈り+次数2チェーンの縮約)と強化した整数計画法
([HiGHS](https://highs.dev/))の組み合わせで、terminal 数 60 でも
サブ秒〜数秒で最適性証明付きの厳密解が得られる。

正しさは4層の照合ピラミッド(全列挙 / Dreyfus-Wagner DP / 素朴ILP / 採用定式化の
相互照合+乱数テスト)で検証している。詳細:

- [DESIGN.md](DESIGN.md) — 要件・設計決定・アルゴリズム・PoE Planner URL形式の解析
- [pyref/README.md](pyref/README.md) — リファレンス実装の構成と検証手順

## リポジトリ構成

```
├── DESIGN.md                 # 設計ドキュメント
├── ROADMAP.md                # 進捗と作業計画
├── pyref/                    # Python リファレンス実装(atlasopt パッケージ、照合オラクル)
├── web/                      # Web UI(TypeScript + Vite + highs-js)
└── vendor/atlastree-export/  # ゲームデータ・アセット(GGG公式、submodule)
```

## データについて

`vendor/atlastree-export` 以下のツリーデータおよびアセットは
Grinding Gear Games の著作物であり、公式リポジトリから submodule として
参照している。リーグ更新時は `git submodule update --remote` で追従する
(追従後のテスト更新手順は [pyref/README.md](pyref/README.md) を参照)。

## ライセンス

本リポジトリのコードは [MIT License](LICENSE)。

ただし `vendor/atlastree-export` 以下のゲームデータ・画像
(および公開サイトが配信するそれらの複製)は Grinding Gear Games の
著作物であり、MIT ライセンスの対象外。本ツールは GGG とは無関係の
非公式コミュニティツールである。
