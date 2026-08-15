# Atlas Optimizer

Path of Exile の Atlas Passive Tree のポイント配分を**厳密解**で最適化するツール。

**→ https://ukleina.github.io/atlas-optimizer/** (ブラウザ完結・インストール不要)

取りたいノードを指定すると、「指定ノードをすべて含み、スタート地点から連結で、
消費ポイントが最小」となる配置を求める。同種のツール
[Path of Pathing](https://pathofpathing.com) はヒューリスティックのため
1〜2ポイント無駄な配置を提案することがあるが(README で "optimal-ish" と明記されている)、
本ツールは**最適性の数学的証明付き**の解のみを「最適」として返す。

## 機能

- **ツリー描画 + 3状態クリック**: 指定 › 除外 › 解除。Mastery クリックで同名クラスタの
  Notable を一括トグル。除外で到達不能になった指定は無視リストに表示(エラーにしない)
- **自動最適化**: 指定を変えるたびに Web Worker が即座に解き直す(1回 ~0.1 秒)。
  最適解が出ると `✅ Optimal` バッジと消費ポイント数を表示
- **Quick select**: ファーム定番セットのワンクリック選択
  (Map Mod Effect / Item Quantity / Searing Exarch / Eater of Worlds / Maven / Final Map Boss)
- **検索**: 名前・stat テキストの部分一致でノードをハイライト
- **同点最適解のタイブレーク**: 同じポイント数なら「指定した Mastery のクラスタ →
  汎用 travel node(Mod Effect › Rarity › Quantity › Scarab › Maps)」の順で
  直感的なルートを選ぶ(厳密最適性は不変)
- **Unwavering Vision 対応**: 取得時はポイント予算表示が 138 → 158 に自動で変わる
- **PoE Planner エクスポート**: 現在の配置を [PoE Planner](https://poeplanner.com) の
  URL として出力(クリップボードにコピーして新規タブで開く)

## ステータス

- ✅ **フェーズ1**: Python リファレンス実装(`pyref/`)— CLI で動作、検証済み
- ✅ **フェーズ2**: ブラウザ完結の Web UI(TypeScript + Vite)— GitHub Pages に公開、
  master への push で自動デプロイ
- ✅ **フェーズ3**: ソルバーを**木分解 Steiner DP** に置換 — 全ケース 0.1 秒級・
  決定的・タイブレークまで大域厳密。WASM 依存も撤廃(バンドル 336KB)

```sh
# Web UI をローカルで起動(Node 24 / nvm)
cd web && npm install && npm run dev
```

## セットアップ(開発)

ゲームデータ(GGG 公式の [grindinggear/atlastree-export](https://github.com/grindinggear/atlastree-export))を
submodule として参照しているため、`--recursive` 付きで clone する:

```sh
git clone --recursive https://github.com/uKLEina/atlas-optimizer.git
cd atlas-optimizer
uv venv .venv
uv pip install --python .venv/bin/python -e pyref/
```

## CLI(リファレンス実装)

```sh
# ノードID または完全一致の名前で「取りたいノード」を指定
.venv/bin/python -m atlasopt solve --terminals "Endless Tide,Refiner's Bargain"

# 「このノードは取らない」という除外指定
.venv/bin/python -m atlasopt solve --terminals "Endless Tide" --exclude 47488

# ソルバー切替(既定は dp。reduced/naive は ILP 系の照合オラクル)
.venv/bin/python -m atlasopt solve --terminals "Endless Tide" --solver reduced

# ベンチマーク(DP と ILP の両方を実行し一致も確認)
.venv/bin/python -m atlasopt bench
```

出力は配置ノード一覧・消費ポイント数・PoE Planner でそのまま開けるインポートURL。

## 仕組み

問題は**ルート付き・ノード重み Steiner 木問題**(NP困難)。ただし Atlas Tree の
グラフ(約900ノード・約1000辺)は「巨大な木 + 中央の網1枚 + 小サイクル約30個」という
構造で **treewidth ≤ 7** に収まるため、木分解上の動的計画法で厳密解が
多項式時間で得られる。DP の値を (ポイント数, タイブレーク重み) の辞書式ペアに
することで、最適化と経路選好が1パスで両方とも大域厳密に決まる。
前段には隣接 terminal 縮約(クラスタまとめ指定を1点に潰す、厳密性不変)を挟む。

正しさは照合ピラミッド(全列挙 / Dreyfus-Wagner DP / 素朴ILP / 縮約+強化ILP /
木分解DP の相互照合+乱数テスト)で検証している。Python 実装と TypeScript 実装は
決定的に一致するよう逐語移植されており、ランダムケースで**解のノード集合単位の
完全一致**を継続的に照合する。詳細:

- [DESIGN.md](DESIGN.md) — 要件・設計決定・アルゴリズム・PoE Planner URL形式の解析
- [pyref/README.md](pyref/README.md) — リファレンス実装の構成と検証手順・リーグ更新手順

## リポジトリ構成

```
├── DESIGN.md                 # 設計ドキュメント
├── ROADMAP.md                # 進捗と作業計画
├── pyref/                    # Python リファレンス実装(atlasopt パッケージ、仕様原本兼照合オラクル)
├── web/                      # Web UI(TypeScript + Vite。ソルバーは木分解DP)
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
