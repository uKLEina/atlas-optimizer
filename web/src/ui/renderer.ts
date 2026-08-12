/**
 * canvas 描画。描画順: 背景 → グループ背景 → エッジ → スタート装飾 →
 * ノード(アイコン+フレーム)→ mastery → 指定/除外リング。
 *
 * ctx の変換に world→screen(scale + offset、DPR込み)を積むので、
 * 以降の座標・サイズは全てワールド単位(ツリー単位)で書く。
 */

import type { AtlasData, AtlasGraph, AtlasNode } from "../data/graph";
import type { Assets } from "./assets";
import type { TreeLayout } from "./layout";
import type { AppState } from "./state";
import type { Viewport } from "./viewport";

const TAU = Math.PI * 2;

const COLOR = {
  bg: "#07080c",
  edge: "#3a3f47",
  edgeHalf: "#77673f",
  edgeActive: "#d9b46b",
  terminal: "#43c26b",
  excluded: "#e5484d",
  ignored: "#e8a33d",
};

export class Renderer {
  private readonly ctx: CanvasRenderingContext2D;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly data: AtlasData,
    private readonly g: AtlasGraph,
    private readonly layout: TreeLayout,
    private readonly assets: Assets,
    private readonly viewport: Viewport,
    private readonly state: AppState,
  ) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2d context unavailable");
    this.ctx = ctx;
  }

  /** CSSサイズ×DPRで実ピクセルを合わせる。リサイズ時に呼ぶ */
  resize(): void {
    const dpr = window.devicePixelRatio || 1;
    const { clientWidth, clientHeight } = this.canvas;
    this.canvas.width = Math.round(clientWidth * dpr);
    this.canvas.height = Math.round(clientHeight * dpr);
  }

  draw(): void {
    const { ctx, viewport } = this;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = COLOR.bg;
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    const s = viewport.scale;
    ctx.setTransform(dpr * s, 0, 0, dpr * s, dpr * viewport.offsetX, dpr * viewport.offsetY);
    ctx.imageSmoothingEnabled = true;

    const zk = this.assets.pickZoom(s * dpr);
    const view = viewport.visibleWorldRect(400);
    const inView = (x: number, y: number): boolean =>
      x >= view.minX && x <= view.maxX && y >= view.minY && y <= view.maxY;

    this.drawBackdrop(zk);
    this.drawGroupBackgrounds(zk, inView);
    this.drawEdges();
    this.drawStartDecoration(zk);
    this.drawNodes(zk, inView);
    this.drawRings(inView);
  }

  private drawBackdrop(zk: string): void {
    const b = this.layout.bounds;
    const pad = 900;
    this.assets.drawStretched(
      this.ctx,
      "atlasBackground",
      "AtlasPassiveBackground",
      zk,
      b.minX - pad,
      b.minY - pad,
      b.maxX - b.minX + pad * 2,
      b.maxY - b.minY + pad * 2,
    );
  }

  private drawGroupBackgrounds(zk: string, inView: (x: number, y: number) => boolean): void {
    const groups = this.data.groups ?? {};
    for (const group of Object.values(groups)) {
      const bg = group.background;
      if (!bg) continue;
      const x = group.x + (bg.offsetX ?? 0);
      const y = group.y + (bg.offsetY ?? 0);
      if (!inView(x, y)) continue;
      this.assets.draw(this.ctx, "groupBackground", bg.image, zk, x, y);
    }
  }

  private drawEdges(): void {
    const { ctx } = this;
    const solved = this.state.result?.nodes;
    ctx.lineCap = "round";
    for (const e of this.layout.edges) {
      const active = (solved?.has(e.u) ?? false) && (solved?.has(e.v) ?? false);
      const half = !active && ((solved?.has(e.u) ?? false) || (solved?.has(e.v) ?? false));
      ctx.strokeStyle = active ? COLOR.edgeActive : half ? COLOR.edgeHalf : COLOR.edge;
      ctx.lineWidth = active ? 12 : 8;
      ctx.beginPath();
      if (e.kind === "arc") {
        ctx.arc(e.cx!, e.cy!, e.r!, e.a0!, e.a1!, false);
      } else {
        const pu = this.layout.positions.get(e.u)!;
        const pv = this.layout.positions.get(e.v)!;
        ctx.moveTo(pu.x, pu.y);
        ctx.lineTo(pv.x, pv.y);
      }
      ctx.stroke();
    }
  }

  private drawStartDecoration(zk: string): void {
    const p = this.layout.positions.get(this.g.root);
    if (!p) return;
    this.assets.draw(this.ctx, "startNode", "AtlasPassiveSkillScreenStart", zk, p.x, p.y);
  }

  private drawNodes(zk: string, inView: (x: number, y: number) => boolean): void {
    const solved = this.state.result?.nodes;
    const hover = this.state.hover;
    for (const [id, p] of this.layout.positions) {
      if (!inView(p.x, p.y)) continue;
      if (id === this.g.root) continue; // スタート装飾が本体
      const nd = this.data.nodes[id];
      if (!nd) continue;
      const allocated = solved?.has(id) ?? false;
      const hovered = hover === id;
      if (nd.isMastery) {
        this.assets.draw(this.ctx, "mastery", nd.icon ?? "", zk, p.x, p.y);
        continue;
      }
      const [iconSheet, iconKey, frameKey] = spriteKeysFor(nd, allocated, hovered);
      this.assets.draw(this.ctx, iconSheet, iconKey, zk, p.x, p.y, { clipCircle: true });
      this.assets.draw(this.ctx, "frame", frameKey, zk, p.x, p.y);
    }
  }

  private drawRings(inView: (x: number, y: number) => boolean): void {
    const { ctx } = this;
    const ignored = new Set(this.state.result?.ignoredTerminals ?? []);
    const zk = this.assets.pickZoom(this.viewport.scale);
    const targets: [string, "terminal" | "excluded"][] = [];
    for (const id of this.state.terminals()) targets.push([id, "terminal"]);
    for (const id of this.state.excluded()) targets.push([id, "excluded"]);
    for (const [id, mark] of targets) {
      const p = this.layout.positions.get(id);
      if (!p || !inView(p.x, p.y)) continue;
      const nd = this.data.nodes[id];
      const frameW = nd
        ? (this.assets.worldSize("frame", spriteKeysFor(nd, false, false)[2], zk) ?? 90)
        : 90;
      const r = frameW / 2 + 10;
      ctx.lineWidth = 7;
      ctx.beginPath();
      if (mark === "terminal" && ignored.has(id)) {
        ctx.strokeStyle = COLOR.ignored;
        ctx.setLineDash([14, 10]);
      } else {
        ctx.strokeStyle = mark === "terminal" ? COLOR.terminal : COLOR.excluded;
      }
      ctx.arc(p.x, p.y, r, 0, TAU);
      ctx.stroke();
      ctx.setLineDash([]);
      if (mark === "excluded") {
        const d = r * Math.SQRT1_2;
        ctx.beginPath();
        ctx.moveTo(p.x - d, p.y - d);
        ctx.lineTo(p.x + d, p.y + d);
        ctx.stroke();
      }
    }
  }
}

/** ノード種別と状態からシート/アイコンキー/フレームキーを決める */
export function spriteKeysFor(
  nd: AtlasNode,
  allocated: boolean,
  hovered: boolean,
): [iconSheet: string, iconKey: string, frameKey: string] {
  if (nd.isWormhole) {
    // wormhole の icon フィールドはシートに存在しない(探索で確認)。固定キーを使う
    const frame = allocated
      ? "WormholeFrameAllocated"
      : hovered
        ? "WormholeFrameHighlight"
        : "WormholeFrameUnallocated";
    return [allocated ? "wormholeActive" : "wormholeInactive", "Wormhole", frame];
  }
  const icon = nd.icon ?? "";
  if (nd.isKeystone) {
    const frame = allocated
      ? "KeystoneFrameAllocated"
      : hovered
        ? "KeystoneFrameCanAllocate"
        : "KeystoneFrameUnallocated";
    return [allocated ? "keystoneActive" : "keystoneInactive", icon, frame];
  }
  if (nd.isNotable) {
    const frame = allocated
      ? "NotableFrameAllocated"
      : hovered
        ? "NotableFrameCanAllocate"
        : "NotableFrameUnallocated";
    return [allocated ? "notableActive" : "notableInactive", icon, frame];
  }
  const frame = allocated
    ? "PSSkillFrameActive"
    : hovered
      ? "PSSkillFrameHighlighted"
      : "PSSkillFrame";
  return [allocated ? "normalActive" : "normalInactive", icon, frame];
}
