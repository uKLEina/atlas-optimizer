/**
 * ソルバー worker のメインスレッド側クライアント。
 *
 * - solve 実行中に来た要求は「最新1件だけ」保持し、完了後に投げる
 * - 世代カウンタで古い応答の**中身**だけ捨てる。busy 解除と pending の送出は
 *   応答の新旧に関わらず必ず行う(かつてここを怠って連打デッドロックを起こした)
 * - worker がクラッシュしたら自動で再起動し、最新の要求を投げ直す
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
  private worker!: Worker;
  private gen = 0;
  private busy = false;
  private pending: Request | null = null;
  private last: Request | null = null;

  constructor(
    private readonly data: AtlasData,
    private readonly onResult: (r: SolveResult) => void,
    private readonly onError: (message: string) => void,
    private readonly onReady?: () => void,
  ) {
    this.spawn();
  }

  private spawn(): void {
    this.worker = new Worker(new URL("./worker.ts", import.meta.url), {
      type: "module",
    });
    this.worker.onmessage = (ev: MessageEvent<WorkerResponse>) => {
      const msg = ev.data;
      if (msg.type === "ready") {
        this.onReady?.();
        return;
      }
      this.busy = false;
      if (msg.gen === this.gen) {
        if (msg.type === "result") this.onResult(msg.result);
        else this.onError(msg.message);
      }
      this.flush();
    };
    this.worker.onerror = () => {
      // worker が死んだ(WASM の abort 等)。作り直して最新の要求を投げ直す
      this.worker.terminate();
      this.busy = false;
      this.spawn();
      if (!this.pending && this.last) this.pending = this.last;
      // ready を待たずに post してよい(worker 側が init 完了を待つ)
      this.flush();
    };
    this.worker.postMessage({ type: "init", data: this.data } satisfies WorkerRequest);
  }

  /**
   * 未着手・進行中の要求を取り消す。世代を進めるので進行中 solve の応答は
   * 中身だけ捨てられる(busy 解除と flush は通常どおり動く)
   */
  cancel(): void {
    this.gen++;
    this.pending = null;
    this.last = null;
  }

  request(terminals: string[], excluded: string[], weights?: Record<string, number>): void {
    this.gen++;
    this.last = { terminals, excluded, weights };
    if (this.busy) {
      this.pending = { terminals, excluded, weights };
      return;
    }
    this.busy = true;
    this.post({ type: "solve", gen: this.gen, terminals, excluded, weights });
  }

  private flush(): void {
    if (!this.pending || this.busy) return;
    const { terminals, excluded, weights } = this.pending;
    this.pending = null;
    this.busy = true;
    this.post({ type: "solve", gen: this.gen, terminals, excluded, weights });
  }

  private post(msg: WorkerRequest): void {
    this.worker.postMessage(msg);
  }
}
