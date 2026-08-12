/**
 * ソルバー Web Worker。highs(WASM)とグラフを常駐させ、solve 要求を逐次処理する。
 * データはメインスレッドから init メッセージで受け取る(fetch の二重化を避ける)。
 */

import wasmUrl from "highs/runtime?url";
import { buildGraph, type AtlasData, type AtlasGraph } from "../data/graph";
import { loadSolver, type Highs } from "./highs";
import { solve } from "./ilpReduced";
import type { SolveResult } from "./result";

export type WorkerRequest =
  | { type: "init"; data: AtlasData }
  | { type: "solve"; gen: number; terminals: string[]; excluded: string[] };

export type WorkerResponse =
  | { type: "ready" }
  | { type: "result"; gen: number; result: SolveResult }
  | { type: "error"; gen: number; message: string };

// WebWorker の lib を tsconfig 全体に足さずに済ませるための最小構造型
const ctx = self as unknown as {
  postMessage(msg: WorkerResponse): void;
  onmessage: ((ev: MessageEvent<WorkerRequest>) => void) | null;
};

let readyPromise: Promise<{ highs: Highs; g: AtlasGraph }> | null = null;

ctx.onmessage = (ev) => {
  void handle(ev.data);
};

async function handle(msg: WorkerRequest): Promise<void> {
  if (msg.type === "init") {
    readyPromise = (async () => {
      const highs = await loadSolver(() => wasmUrl);
      return { highs, g: buildGraph(msg.data) };
    })();
    await readyPromise;
    ctx.postMessage({ type: "ready" });
    return;
  }
  if (!readyPromise) {
    ctx.postMessage({ type: "error", gen: msg.gen, message: "worker not initialized" });
    return;
  }
  try {
    const { highs, g } = await readyPromise;
    const result = solve(highs, g, msg.terminals, { excluded: msg.excluded });
    ctx.postMessage({ type: "result", gen: msg.gen, result });
  } catch (err) {
    ctx.postMessage({ type: "error", gen: msg.gen, message: String(err) });
  }
}
