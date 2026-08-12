# 開発ロードマップ

進捗状況と作業計画。設計決定事項は `DESIGN.md` を参照。

## フェーズ全体

| フェーズ | 内容 | 状態 |
|---|---|---|
| 1 | Python リファレンス実装(`pyref/`) | ✅ 完了 |
| 2 | TypeScript ソルバー + Web UI(`web/`) | 🚧 全マイルストーン完了、ユーザの最終目視確認のみ残 |

## フェーズ2 マイルストーン

ロジックとUIを分離し、正しさの検証(1〜3)を UI 着手前に完了させる。
UIから作ると「動いているように見えるが正しさが不明」な状態に陥るため。

1. **足場 + highs-js スモークテスト** — ✅ 完了(2026-08-12)
   `web/` に Vite+TS+Vitest の雛形を作り、highs-js で小さいLPが解けることを確認する。
   WASMソルバーの動作が最大の技術リスクのため最優先で潰す。
   Vitest(Node)2件パス・`vite build` で WASM バンドル確認済み。
   ブラウザ(`npm run dev`)でも Optimal/目的値5 の表示を実地確認済み
2. **ロジック移植(UI無し)** — ✅ 完了(2026-08-12)
   `graph.py` → `reduction.py` → `ilp_reduced.py` → `export.py` の順に移植。
   pyref の pytest も Vitest へ移植して通す。
   `web/src/{data,solver,export}` に移植済み、Vitest 25件パス。
   highspy のプログラム的 API は LP 形式テキスト生成(`solver/lp.ts`)に置換。
   オラクル系(brute/ilp_naive)と CLI は移植対象外(照合はマイルストーン3)。
   pyref 実行結果のゴールデン3件(K=10 の 81pt 含む)で points 一致を確認済み
3. **pyref照合** — ✅ 完了(2026-08-12)
   pyref 側でランダムケース+期待解を JSON に出力し、TS側の全一致を検証する
   (fuzz ピラミッドの越境版)。これが通って初めて「TS版は正しい」とみなす。
   `pyref/crosscheck.py`(生成)+ `web/tests/crosscheck.test.ts`(照合)。
   標準 fixture(seed 0、104ケース)で全一致、別 seed 54ケースでも全一致、
   期待値改変時に失敗することも確認済み。実行は `cd web && npm run crosscheck`
4. **UI** — ✅ 完了(2026-08-12、見た目の最終確認はユーザレビュー待ち)
   canvas 描画 → 3状態クリック → 最適化実行 → PoE Planner エクスポート。
   フル描画(スプライトのアイコン/状態別フレーム/mastery/スタート装飾/グループ背景、
   接続線・軌道弧は canvas 線)+ Web Worker 自動ソルブ(300ms デバウンス+世代管理)。
   Playwright E2E で描画・クリック3状態・mastery一括・ignored表示・エクスポートを検証済み。
   起動: `cd web && npm run dev`
