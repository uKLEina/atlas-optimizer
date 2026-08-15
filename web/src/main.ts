/**
 * エントリポイント: データ取得 → グラフ/レイアウト/アセット準備 → UI 配線。
 */

// フォントは同梱配信(外部リクエスト無し・オフライン可)。UI は Inter、タイトルは Cinzel
import "@fontsource-variable/inter";
import "@fontsource/cinzel/600.css";
import "./style.css";
import { buildGraph, type AtlasData } from "./data/graph";
import { SolverClient } from "./solver/client";
import { TiebreakIndex } from "./solver/tiebreak";
import { Assets } from "./ui/assets";
import { buildBonusPoints } from "./ui/bonusPoints";
import { Interaction } from "./ui/interaction";
import { buildLayout } from "./ui/layout";
import { buildMasteryIndex } from "./ui/masteryIndex";
import { Panel } from "./ui/panel";
import { buildQuickSets } from "./ui/quickSelect";
import { Renderer } from "./ui/renderer";
import { AppState } from "./ui/state";
import { Tooltip } from "./ui/tooltip";
import { Viewport } from "./ui/viewport";

// DP 化(フェーズ3)でソルブが ~0.1 秒級になったため短めでよい
const SOLVE_DEBOUNCE_MS = 150;

async function init(): Promise<void> {
  const loading = document.getElementById("loading")!;
  const canvas = document.getElementById("tree") as HTMLCanvasElement;

  loading.textContent = "Loading tree data…";
  const res = await fetch("atlas/data.json");
  if (!res.ok) throw new Error(`Failed to fetch data.json: HTTP ${res.status}`);
  const data = (await res.json()) as AtlasData;

  const g = buildGraph(data);
  const layout = buildLayout(data);
  const assets = new Assets(data);
  await assets.load((done, total) => {
    loading.textContent = `Loading assets… ${done}/${total}`;
  });

  const masteryIndex = buildMasteryIndex(data);
  const state = new AppState(g, masteryIndex);
  const viewport = new Viewport(canvas);

  let dirty = true;
  const requestDraw = (): void => {
    dirty = true;
  };
  const renderer = new Renderer(canvas, data, g, layout, assets, viewport, state, masteryIndex);
  const frame = (): void => {
    if (dirty) {
      dirty = false;
      renderer.draw();
    }
    requestAnimationFrame(frame);
  };

  const tooltip = new Tooltip(document.getElementById("tooltip")!);
  new Panel(
    data,
    g,
    state,
    layout,
    viewport,
    requestDraw,
    buildQuickSets(data, g),
    buildBonusPoints(data),
  );
  new Interaction(canvas, data, g.root, layout, assets, viewport, state, tooltip, requestDraw).attach();

  const tiebreak = new TiebreakIndex(data, g);
  const solver = new SolverClient(
    data,
    (result) => state.setResult(result),
    (message) => state.setError(message),
  );
  let debounceTimer: number | undefined;
  state.onMarksChange(() => {
    window.clearTimeout(debounceTimer);
    if (state.terminals().length === 0) {
      // 解くものが無い(リセット直後など)。ソルバーを呼ばず即座に初期表示へ
      solver.cancel();
      state.clearResult();
      return;
    }
    state.setSolving();
    debounceTimer = window.setTimeout(() => {
      // タイブレーク重みは指定内容(アクティブMastery)に依存するため要求ごとに計算
      const weights = Object.fromEntries(tiebreak.weightsFor(state.terminals()));
      solver.request(state.terminals(), state.excluded(), weights);
    }, SOLVE_DEBOUNCE_MS);
  });
  state.subscribe(requestDraw);

  const resize = (): void => {
    renderer.resize();
    requestDraw();
  };
  window.addEventListener("resize", resize);
  renderer.resize();
  viewport.fit(layout.bounds);

  loading.remove();
  requestAnimationFrame(frame);

  // E2E(Playwright)・デバッグ用のフック。UIの動作には関与しない
  (window as unknown as Record<string, unknown>)["__atlas"] = {
    state,
    viewport,
    layout,
    renderer,
    requestDraw,
  };
}

void init().catch((err: unknown) => {
  const loading = document.getElementById("loading");
  if (loading) loading.textContent = `Initialization failed: ${String(err)}`;
  console.error(err);
});
