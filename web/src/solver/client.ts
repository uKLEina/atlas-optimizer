/**
 * ソルバー worker のメインスレッド側クライアント。
 * - solve 実行中に来た要求は「最新1件だけ」保持し、完了後に投げる
 * - 世代カウンタで古い応答を捨てる
 */

import type { AtlasData } from "../data/graph";
import type { SolveResult } from "./result";
import type { WorkerRequest, WorkerResponse } from "./worker";

export class SolverClient {
  private readonly worker: Worker;
  private gen = 0;
  private busy = false;
  private pending: { terminals: string[]; excluded: string[] } | null = null;

  constructor(
    data: AtlasData,
    private readonly onResult: (r: SolveResult) => void,
    private readonly onError: (message: string) => void,
    private readonly onReady?: () => void,
  ) {
    this.worker = new Worker(new URL("./worker.ts", import.meta.url), {
      type: "module",
    });
    this.worker.onmessage = (ev: MessageEvent<WorkerResponse>) => {
      const msg = ev.data;
      if (msg.type === "ready") {
        this.onReady?.();
        return;
      }
      if (msg.gen !== this.gen) return; // 古い応答は捨てる
      this.busy = false;
      if (msg.type === "result") this.onResult(msg.result);
      else this.onError(msg.message);
      this.flush();
    };
    this.post({ type: "init", data });
  }

  request(terminals: string[], excluded: string[]): void {
    this.gen++;
    if (this.busy) {
      this.pending = { terminals, excluded };
      return;
    }
    this.busy = true;
    this.post({ type: "solve", gen: this.gen, terminals, excluded });
  }

  private flush(): void {
    if (!this.pending) return;
    const { terminals, excluded } = this.pending;
    this.pending = null;
    this.busy = true;
    this.post({ type: "solve", gen: this.gen, terminals, excluded });
  }

  private post(msg: WorkerRequest): void {
    this.worker.postMessage(msg);
  }
}
