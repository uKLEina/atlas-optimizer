/**
 * ソルバー Web Worker。グラフと木分解を常駐させ、solve 要求を逐次処理する。
 * データはメインスレッドから init メッセージで受け取る(fetch の二重化を避ける)。
 *
 * フェーズ3でソルバーは木分解 DP(dp.ts)に置き換わった。WASM(highs-js)は
 * 本番経路から外れ、テスト側の照合オラクル(ilpReduced)専用になっている。
 */

import { buildGraph, type AtlasData, type AtlasGraph } from "../data/graph";
import { buildDecomposition, type TreeDecomposition } from "./decomposition";
import { solve } from "./dp";
import type { SolveResult } from "./result";

export type WorkerRequest =
  | { type: "init"; data: AtlasData }
  | {
      type: "solve";
      gen: number;
      terminals: string[];
      excluded: string[];
      /** タイブレーク用のノード重み(tiebreak.ts が生成)。省略可 */
      weights?: Record<string, number>;
    };

export type WorkerResponse =
  | { type: "ready" }
  | { type: "result"; gen: number; result: SolveResult }
  | { type: "error"; gen: number; message: string };

// WebWorker の lib を tsconfig 全体に足さずに済ませるための最小構造型
const ctx = self as unknown as {
  postMessage(msg: WorkerResponse): void;
  onmessage: ((ev: MessageEvent<WorkerRequest>) => void) | null;
};

let ready: { g: AtlasGraph; td: TreeDecomposition } | null = null;

ctx.onmessage = (ev) => {
  const msg = ev.data;
  if (msg.type === "init") {
    const g = buildGraph(msg.data);
    ready = { g, td: buildDecomposition(g.adj, g.root) };
    ctx.postMessage({ type: "ready" });
    return;
  }
  if (!ready) {
    ctx.postMessage({ type: "error", gen: msg.gen, message: "worker not initialized" });
    return;
  }
  try {
    const result = solve(ready.g, msg.terminals, {
      excluded: msg.excluded,
      nodeWeights: msg.weights ? new Map(Object.entries(msg.weights)) : undefined,
      td: ready.td,
    });
    ctx.postMessage({ type: "result", gen: msg.gen, result });
  } catch (err) {
    ctx.postMessage({ type: "error", gen: msg.gen, message: String(err) });
  }
};
