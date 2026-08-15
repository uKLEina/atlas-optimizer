/**
 * canvas 描画(毎フレーム直接描画)。
 *
 * 背景 → グループ背景 → エッジ → スタート装飾 → ノード → 指定/除外リング →
 * hover 強調を、毎フレーム canvas に直接描く(PoE Planner / Path of Pathing と同方式)。
 * スプライトは常に最高解像度のシートを使い、縮小は canvas の変換に任せる。
 * ズーム中のシート切替・タイル再生成が無いため拡縮が滑らかで、
 * pan で未描画領域が残ることも構造的にない。
 * 重さは可視範囲カリング(ノード・エッジ)と、エッジのスタイル別一括ストロークで抑える。
 *
 * ctx にはワールド→スクリーン変換(scale + offset、DPR込み)を積むので、
 * 描画コードの座標・サイズは全てワールド単位(ツリー単位)で書く。
 */

import type { AtlasData, AtlasGraph, AtlasNode } from "../data/graph";
import type { Assets } from "./assets";
import type { TreeLayout } from "./layout";
import type { MasteryIndex } from "./masteryIndex";
import type { AppState } from "./state";
import type { Viewport, WorldBounds } from "./viewport";

const TAU = Math.PI * 2;

const COLOR = {
  bg: "#07080c",
  edge: "#3a3f47",
  edgeHalf: "#77673f",
  edgeActive: "#d9b46b",
  terminal: "#43c26b",
  excluded: "#e5484d",
  ignored: "#e8a33d",
  masteryHighlight: "#ffd63c",
};

export class Renderer {
  private readonly ctx: CanvasRenderingContext2D;
  /** 常に最高解像度のシートを使う(LOD切替なし) */
  private readonly zk: string;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly data: AtlasData,
    private readonly g: AtlasGraph,
    private readonly layout: TreeLayout,
    private readonly assets: Assets,
    private readonly viewport: Viewport,
    private readonly state: AppState,
    private readonly masteryIndex: MasteryIndex,
  ) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2d context unavailable");
    this.ctx = ctx;
    this.zk = assets.zoomKeys[assets.zoomKeys.length - 1]!;
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

    const view = viewport.visibleWorldRect(400);
    const inView = (x: number, y: number): boolean =>
      x >= view.minX && x <= view.maxX && y >= view.minY && y <= view.maxY;

    this.drawBackdrop(ctx);
    this.drawGroupBackgrounds(ctx, inView);
    this.drawEdges(ctx, view);
    this.drawStartDecoration(ctx);
    this.drawNodes(ctx, inView);
    this.drawRings(ctx, inView);
    this.drawHoverOverlay(ctx);
    this.drawMasteryHighlight(ctx);
  }

  private drawBackdrop(ctx: CanvasRenderingContext2D): void {
    const b = this.layout.bounds;
    const pad = 900;
    this.assets.drawStretched(
      ctx,
      "atlasBackground",
      "AtlasPassiveBackground",
      this.zk,
      b.minX - pad,
      b.minY - pad,
      b.maxX - b.minX + pad * 2,
      b.maxY - b.minY + pad * 2,
    );
  }

  private drawGroupBackgrounds(
    ctx: CanvasRenderingContext2D,
    inView: (x: number, y: number) => boolean,
  ): void {
    const groups = this.data.groups ?? {};
    for (const group of Object.values(groups)) {
      const bg = group.background;
      if (!bg) continue;
      const x = group.x + (bg.offsetX ?? 0);
      const y = group.y + (bg.offsetY ?? 0);
      if (!inView(x, y)) continue;
      this.assets.draw(ctx, "groupBackground", bg.image, this.zk, x, y);
    }
  }

  private drawEdges(ctx: CanvasRenderingContext2D, view: WorldBounds): void {
    const solved = this.state.result?.nodes;
    // スタイル別に1本の Path2D へまとめ、stroke は3回で済ませる(毎フレーム描画の要)
    const styles = [
      { color: COLOR.edge, width: 8, path: new Path2D() },
      { color: COLOR.edgeHalf, width: 8, path: new Path2D() },
      { color: COLOR.edgeActive, width: 12, path: new Path2D() },
    ] as const;
    for (const e of this.layout.edges) {
      const pu = this.layout.positions.get(e.u)!;
      const pv = this.layout.positions.get(e.v)!;
      if (e.kind === "arc") {
        const cx = e.cx!;
        const cy = e.cy!;
        const r = e.r!;
        if (cx + r < view.minX || cx - r > view.maxX || cy + r < view.minY || cy - r > view.maxY)
          continue;
      } else if (
        Math.max(pu.x, pv.x) < view.minX ||
        Math.min(pu.x, pv.x) > view.maxX ||
        Math.max(pu.y, pv.y) < view.minY ||
        Math.min(pu.y, pv.y) > view.maxY
      ) {
        continue;
      }
      const su = solved?.has(e.u) ?? false;
      const sv = solved?.has(e.v) ?? false;
      const path = styles[su && sv ? 2 : su || sv ? 1 : 0].path;
      if (e.kind === "arc") {
        path.moveTo(e.cx! + e.r! * Math.cos(e.a0!), e.cy! + e.r! * Math.sin(e.a0!));
        path.arc(e.cx!, e.cy!, e.r!, e.a0!, e.a1!, false);
      } else {
        path.moveTo(pu.x, pu.y);
        path.lineTo(pv.x, pv.y);
      }
    }
    ctx.lineCap = "round";
    for (const st of styles) {
      ctx.strokeStyle = st.color;
      ctx.lineWidth = st.width;
      ctx.stroke(st.path);
    }
  }

  private drawStartDecoration(ctx: CanvasRenderingContext2D): void {
    const p = this.layout.positions.get(this.g.root);
    if (!p) return;
    this.assets.draw(ctx, "startNode", "AtlasPassiveSkillScreenStart", this.zk, p.x, p.y);
  }

  private drawNodes(
    ctx: CanvasRenderingContext2D,
    inView: (x: number, y: number) => boolean,
  ): void {
    const solved = this.state.result?.nodes;
    for (const [id, p] of this.layout.positions) {
      if (!inView(p.x, p.y)) continue;
      if (id === this.g.root) continue; // スタート装飾が本体
      const nd = this.data.nodes[id];
      if (!nd) continue;
      if (nd.isMastery) {
        this.assets.draw(ctx, "mastery", nd.icon ?? "", this.zk, p.x, p.y);
        continue;
      }
      this.drawNode(ctx, nd, p.x, p.y, solved?.has(id) ?? false, false);
    }
  }

  private drawNode(
    ctx: CanvasRenderingContext2D,
    nd: AtlasNode,
    x: number,
    y: number,
    allocated: boolean,
    hovered: boolean,
  ): void {
    const [iconSheet, iconKey, frameKey] = spriteKeysFor(nd, allocated, hovered);
    this.assets.draw(ctx, iconSheet, iconKey, this.zk, x, y, { clipCircle: true });
    this.assets.draw(ctx, "frame", frameKey, this.zk, x, y);
  }

  private drawRings(
    ctx: CanvasRenderingContext2D,
    inView: (x: number, y: number) => boolean,
  ): void {
    const ignored = new Set(this.state.result?.ignoredTerminals ?? []);
    const targets: [string, "terminal" | "excluded"][] = [];
    for (const id of this.state.terminals()) targets.push([id, "terminal"]);
    for (const id of this.state.excluded()) targets.push([id, "excluded"]);
    for (const [id, mark] of targets) {
      const p = this.layout.positions.get(id);
      if (!p || !inView(p.x, p.y)) continue;
      const nd = this.data.nodes[id];
      const frameW = nd
        ? (this.assets.worldSize("frame", spriteKeysFor(nd, false, false)[2], this.zk) ?? 90)
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

  /** hover 中ノードの強調(icon+frame を hover 状態で重ね描き) */
  private drawHoverOverlay(ctx: CanvasRenderingContext2D): void {
    const hover = this.state.hover;
    if (!hover || hover === this.g.root) return;
    const nd = this.data.nodes[hover];
    const p = this.layout.positions.get(hover);
    if (!nd || !p || nd.isMastery) return;
    const allocated = this.state.result?.nodes.has(hover) ?? false;
    this.drawNode(ctx, nd, p.x, p.y, allocated, true);
  }

  /**
   * mastery hover 時、同名 mastery ノード(全クラスタ)へ黄色オーバーレイを重ねて
   * 位置を示す(PoE Planner 踏襲。ユーザレビューにより Notable ではなく mastery 側)
   */
  private drawMasteryHighlight(ctx: CanvasRenderingContext2D): void {
    const hover = this.state.hover;
    if (!hover || !this.data.nodes[hover]?.isMastery) return;
    ctx.fillStyle = `${COLOR.masteryHighlight}44`;
    ctx.strokeStyle = COLOR.masteryHighlight;
    ctx.lineWidth = 6;
    for (const id of [hover, ...(this.masteryIndex.siblings.get(hover) ?? [])]) {
      const p = this.layout.positions.get(id);
      if (!p) continue;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 62, 0, TAU);
      ctx.fill();
      ctx.stroke();
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
