/**
 * サイドパネル: ポイント数 / 最適性バッジ / 無視された指定 / エクスポート / リセット。
 *
 * バッジは厳密性の表示なので optimal と feasible の区別を崩さないこと(本ツールの存在意義):
 *   optimal → "✅ Optimal"(ソルバーの最適性証明済み) / feasible → "Feasible (not proven optimal)"
 */

import type { AtlasData, AtlasGraph } from "../data/graph";
import { encodeUrl } from "../export/poeplanner";
import type { TreeLayout } from "./layout";
import type { QuickSet } from "./quickSelect";
import type { AppState } from "./state";
import type { Viewport } from "./viewport";

export class Panel {
  private readonly pointsEl: HTMLElement;
  private readonly statusEl: HTMLElement;
  private readonly ignoredWrapEl: HTMLElement;
  private readonly ignoredEl: HTMLElement;
  private readonly exportBtn: HTMLButtonElement;
  private readonly resetBtn: HTMLButtonElement;
  private readonly toastEl: HTMLElement;

  constructor(
    private readonly data: AtlasData,
    private readonly g: AtlasGraph,
    private readonly state: AppState,
    private readonly layout: TreeLayout,
    private readonly viewport: Viewport,
    private readonly requestDraw: () => void,
    quickSets: readonly QuickSet[] = [],
  ) {
    this.pointsEl = mustGet("points-used");
    this.statusEl = mustGet("status");
    this.ignoredWrapEl = mustGet("ignored-wrap");
    this.ignoredEl = mustGet("ignored");
    this.exportBtn = mustGet("export") as HTMLButtonElement;
    this.resetBtn = mustGet("reset") as HTMLButtonElement;
    this.toastEl = mustGet("toast");

    mustGet("points-total").textContent = String(data.points?.totalPoints ?? 138);
    const quickButtons = mustGet("quick-buttons");
    for (const set of quickSets) {
      if (set.ids.length === 0) continue; // リーグ更新でセットが空になったら出さない
      const btn = document.createElement("button");
      btn.textContent = set.label;
      btn.title = `Toggle ${set.ids.length} nodes`;
      if (set.accent) btn.style.borderLeft = `3px solid ${set.accent}`;
      btn.addEventListener("click", () => this.state.quickToggle(set.ids));
      quickButtons.append(btn);
    }
    this.exportBtn.addEventListener("click", () => void this.export());
    this.resetBtn.addEventListener("click", () => this.state.reset());
    this.state.subscribe(() => this.update());
    this.update();
  }

  private update(): void {
    const { state } = this;
    const res = state.result;
    const total = this.data.points?.totalPoints ?? 138;
    const points = res?.points ?? 0;
    this.pointsEl.textContent = String(points);
    this.pointsEl.classList.toggle("over", points > total);

    let text: string;
    let cls: string;
    if (state.solving) {
      text = "Solving…";
      cls = "solving";
    } else if (state.solveError) {
      text = `Error: ${state.solveError}`;
      cls = "error";
    } else if (!res) {
      text = "Click nodes to select targets";
      cls = "idle";
    } else if (res.status === "optimal") {
      text = "✅ Optimal";
      cls = "optimal";
    } else if (res.status === "feasible") {
      text = "Feasible (not proven optimal)";
      cls = "feasible";
    } else {
      text = "Infeasible (likely a bug)";
      cls = "error";
    }
    this.statusEl.textContent = text;
    this.statusEl.className = `status ${cls}`;

    const ignored = res?.ignoredTerminals ?? [];
    this.ignoredWrapEl.hidden = ignored.length === 0;
    this.ignoredEl.replaceChildren(
      ...ignored.map((id) => {
        const li = document.createElement("li");
        li.textContent = this.g.info.get(id)?.name || id;
        li.title = "Click to jump to this node";
        li.addEventListener("click", () => {
          const p = this.layout.positions.get(id);
          if (p) {
            this.viewport.centerOn(p.x, p.y);
            this.requestDraw();
          }
        });
        return li;
      }),
    );

    this.exportBtn.disabled = !res || res.nodes.size === 0;
  }

  private async export(): Promise<void> {
    const res = this.state.result;
    if (!res || res.nodes.size === 0) return;
    const url = encodeUrl([...res.nodes]);
    try {
      await navigator.clipboard.writeText(url);
      this.toast("URL copied — opening PoE Planner");
    } catch {
      this.toast("Opening PoE Planner (copy failed)");
    }
    window.open(url, "_blank", "noopener");
  }

  private toast(message: string): void {
    this.toastEl.textContent = message;
    this.toastEl.hidden = false;
    window.setTimeout(() => {
      this.toastEl.hidden = true;
    }, 2500);
  }
}

function mustGet(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} not found`);
  return el;
}
