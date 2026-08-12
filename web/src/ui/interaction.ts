/**
 * マウス操作: ドラッグでパン、ホイールでズーム(カーソル中心)、
 * クリックで3状態トグル(mastery は一括)、hover でツールチップ。
 */

import type { AtlasData } from "../data/graph";
import type { TreeLayout } from "./layout";
import type { AppState } from "./state";
import type { Tooltip } from "./tooltip";
import type { Viewport } from "./viewport";

const CLICK_SLOP_PX = 5;
const ZOOM_STEP = 1.15;

export class Interaction {
  private dragging = false;
  private moved = false;
  private lastX = 0;
  private lastY = 0;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly data: AtlasData,
    private readonly rootId: string,
    private readonly layout: TreeLayout,
    private readonly viewport: Viewport,
    private readonly state: AppState,
    private readonly tooltip: Tooltip,
    private readonly requestDraw: () => void,
  ) {}

  attach(): void {
    const c = this.canvas;
    c.addEventListener("pointerdown", (ev) => {
      this.dragging = true;
      this.moved = false;
      this.lastX = ev.clientX;
      this.lastY = ev.clientY;
      try {
        c.setPointerCapture(ev.pointerId);
      } catch {
        // 合成イベント(E2Eテスト)では capture できないことがある。実害なし
      }
    });
    c.addEventListener("pointermove", (ev) => {
      if (this.dragging) {
        const dx = ev.clientX - this.lastX;
        const dy = ev.clientY - this.lastY;
        if (Math.abs(dx) + Math.abs(dy) > 0) {
          if (Math.hypot(dx, dy) > CLICK_SLOP_PX) this.moved = true;
          this.viewport.pan(dx, dy);
          this.lastX = ev.clientX;
          this.lastY = ev.clientY;
          this.requestDraw();
        }
      } else {
        this.updateHover(ev);
      }
    });
    c.addEventListener("pointerup", (ev) => {
      this.dragging = false;
      if (!this.moved) this.click(ev);
    });
    c.addEventListener("pointerleave", () => {
      this.state.setHover(null);
      this.tooltip.hide();
    });
    c.addEventListener(
      "wheel",
      (ev) => {
        ev.preventDefault();
        const rect = c.getBoundingClientRect();
        const factor = ev.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
        this.viewport.zoomAt(ev.clientX - rect.left, ev.clientY - rect.top, factor);
        this.requestDraw();
      },
      { passive: false },
    );
  }

  private screenToWorld(ev: PointerEvent | MouseEvent): [number, number] {
    const rect = this.canvas.getBoundingClientRect();
    return this.viewport.toWorld(ev.clientX - rect.left, ev.clientY - rect.top);
  }

  hitTest(wx: number, wy: number): string | null {
    let best: string | null = null;
    let bestD = Infinity;
    for (const [id, p] of this.layout.positions) {
      const d = Math.hypot(p.x - wx, p.y - wy);
      if (d < bestD) {
        bestD = d;
        best = id;
      }
    }
    if (best === null || bestD > this.hitRadius(best)) return null;
    return best;
  }

  private hitRadius(id: string): number {
    if (id === this.rootId) return 0; // root はクリック対象外
    const nd = this.data.nodes[id];
    if (!nd) return 0;
    if (nd.isMastery) return 56;
    if (nd.isWormhole) return 60;
    if (nd.isKeystone) return 54;
    if (nd.isNotable) return 40;
    return 30;
  }

  private click(ev: PointerEvent): void {
    const [wx, wy] = this.screenToWorld(ev);
    const id = this.hitTest(wx, wy);
    if (!id) return;
    const nd = this.data.nodes[id];
    if (nd?.isMastery) this.state.masteryClick(id);
    else this.state.cycle(id);
  }

  private updateHover(ev: PointerEvent): void {
    const [wx, wy] = this.screenToWorld(ev);
    const id = this.hitTest(wx, wy);
    this.state.setHover(id);
    this.canvas.style.cursor = id ? "pointer" : "grab";
    if (id && id !== this.rootId) {
      const nd = this.data.nodes[id];
      if (nd && (nd.name || (nd.stats?.length ?? 0) > 0)) {
        this.tooltip.show(nd, ev.clientX, ev.clientY);
        this.requestDraw();
        return;
      }
    }
    this.tooltip.hide();
    this.requestDraw();
  }
}
