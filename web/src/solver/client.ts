/**
 * ソルバー worker のメインスレッド側クライアント(プリエンプティブ版)。
 *
 * - solve 実行中に新しい要求が来たら、実行中の worker を terminate して破棄し、
 *   温存してある予備 worker に最新の要求を即座に投げる(常に最新だけを計算する)。
 *   WASM の同期実行は途中で止められないため、中断 = worker ごと殺す、が唯一の手段
 * - 予備は常に1体温めておき、昇格直後に次の予備を裏で仕込む(初期化 ~数百ms を
 *   クリティカルパスから外す)。初期化中の予備へ solve を投げてもメッセージは
 *   順に処理されるため正しく動く(worker 側が init 完了を待つ)
 * - 世代カウンタで古い応答の中身は捨てる(terminate 済み worker からは応答自体来ない)
 * - worker がクラッシュしたら(WASM の abort 等)同様に予備へ切り替え、
 *   最新の要求を投げ直す
 */

import type { AtlasData } from "../data/graph";
import type { SolveResult } from "./result";
import type { WorkerRequest, WorkerResponse } from "./worker";

interface Request {
  terminals: string[];
  excluded: string[];
  weights?: Record<string, number>;
}

export class SolverClient {
  private active: Worker;
  private spare: Worker;
  private gen = 0;
  private busy = false;
  private last: Request | null = null;

  constructor(
    private readonly data: AtlasData,
    private readonly onResult: (r: SolveResult) => void,
    private readonly onError: (message: string) => void,
    private readonly onReady?: () => void,
  ) {
    this.active = this.spawn();
    this.spare = this.spawn();
  }

  private spawn(): Worker {
    const w = new Worker(new URL("./worker.ts", import.meta.url), {
      type: "module",
    });
    w.onmessage = (ev: MessageEvent<WorkerResponse>) => {
      const msg = ev.data;
      if (msg.type === "ready") {
        if (w === this.active) this.onReady?.();
        return;
      }
      if (w !== this.active) return; // 破棄予定 worker からの残響は無視
      this.busy = false;
      if (msg.gen === this.gen) {
        if (msg.type === "result") this.onResult(msg.result);
        else this.onError(msg.message);
      }
    };
    w.onerror = () => {
      if (w === this.active) {
        this.busy = false;
        this.promote();
        const r = this.last;
        if (r) this.request(r.terminals, r.excluded, r.weights);
      } else if (w === this.spare) {
        w.terminate();
        this.spare = this.spawn();
      }
    };
    w.postMessage({ type: "init", data: this.data } satisfies WorkerRequest);
    return w;
  }

  /** 実行中の active を破棄して予備を昇格させ、次の予備を裏で仕込む */
  private promote(): void {
    this.active.terminate();
    this.active = this.spare;
    this.spare = this.spawn();
  }

  request(terminals: string[], excluded: string[], weights?: Record<string, number>): void {
    this.gen++;
    this.last = { terminals, excluded, weights };
    // 実行中の計算はこの要求で無意味になった。worker ごと中断して最新だけを解く
    if (this.busy) this.promote();
    this.busy = true;
    this.active.postMessage({
      type: "solve",
      gen: this.gen,
      terminals,
      excluded,
      weights,
    } satisfies WorkerRequest);
  }

  /** 未着手・進行中の要求を取り消す。進行中なら worker ごと破棄して CPU も解放する */
  cancel(): void {
    this.gen++;
    this.last = null;
    if (this.busy) {
      this.busy = false;
      this.promote();
    }
  }
}
