/**
 * スプライトシートの管理: メタ解析、画像プリロード(basename で重複排除)、
 * ワールド座標への描画。
 *
 * - data.json の sprites[category][zoomKey] = { filename(CDN URL), coords }
 * - ローカルには CDN URL の basename が assets/ に全て存在する(探索で検証済み)
 * - ズームキーは sprites から動的に導出する(imageZoomLevels は1個足りない)。
 *   描画側は常に最大キー(最高解像度)を使い、縮小は canvas 変換に任せる
 * - スクリーンpx = ツリー単位 × zoom なので、ワールドサイズ = スプライトpx / zoom
 */

import type { AtlasData, SpriteCoord, SpriteSheet } from "../data/graph";

const TAU = Math.PI * 2;

export interface SheetRef {
  img: HTMLImageElement;
  coords: Record<string, SpriteCoord>;
  zoom: number;
}

export function spriteBasename(filename: string): string {
  const noQuery = filename.split("?")[0] ?? filename;
  return noQuery.slice(noQuery.lastIndexOf("/") + 1);
}

export class Assets {
  private readonly sprites: Record<string, Record<string, SpriteSheet>>;
  private readonly images = new Map<string, HTMLImageElement>();
  /**
   * 切り出し済みタイルのキャッシュ。毎フレームの clip()+シート切り出しは
   * ズーム操作が目に見えて重くなるため、初回だけ小 canvas に固めて以後はそれを描く
   */
  private readonly tiles = new Map<string, HTMLCanvasElement>();
  /** 昇順のズームキー(文字列のまま保持) */
  readonly zoomKeys: string[];

  constructor(
    data: AtlasData,
    private readonly baseUrl = "atlas/assets/",
  ) {
    if (!data.sprites) throw new Error("data.json lacks sprites");
    this.sprites = data.sprites;
    const normal = this.sprites["normalActive"];
    if (!normal) throw new Error("sprites.normalActive not found");
    this.zoomKeys = Object.keys(normal).sort((a, b) => Number(a) - Number(b));
  }

  async load(onProgress?: (done: number, total: number) => void): Promise<void> {
    const names = new Set<string>();
    for (const category of Object.values(this.sprites)) {
      for (const sheet of Object.values(category)) {
        names.add(spriteBasename(sheet.filename));
      }
    }
    let done = 0;
    const total = names.size;
    await Promise.all(
      [...names].map(async (name) => {
        const img = new Image();
        img.src = this.baseUrl + name;
        await img.decode();
        this.images.set(name, img);
        done++;
        onProgress?.(done, total);
      }),
    );
  }

  get(category: string, zoomKey: string): SheetRef | undefined {
    const sheets = this.sprites[category];
    if (!sheets) return undefined;
    // masteryOverlay のようにズームキーが1つしか無いカテゴリはそれを使う
    const key = sheets[zoomKey] ? zoomKey : Object.keys(sheets)[0];
    if (key === undefined) return undefined;
    const sheet = sheets[key]!;
    const img = this.images.get(spriteBasename(sheet.filename));
    if (!img) return undefined;
    return { img, coords: sheet.coords, zoom: Number(key) };
  }

  /** アイコンのワールド上のサイズ(幅)。無ければ undefined */
  worldSize(category: string, iconKey: string, zoomKey: string): number | undefined {
    const ref = this.get(category, zoomKey);
    const c = ref?.coords[iconKey];
    return c && ref ? c.w / ref.zoom : undefined;
  }

  /**
   * ワールド座標 (wx, wy) を中心にスプライトを描く。
   * clipCircle はアイコンシート(JPEG・α無し)の角を落とすためのもの。
   */
  draw(
    ctx: CanvasRenderingContext2D,
    category: string,
    iconKey: string,
    zoomKey: string,
    wx: number,
    wy: number,
    opts: { clipCircle?: boolean; scale?: number } = {},
  ): boolean {
    const ref = this.get(category, zoomKey);
    const c = ref?.coords[iconKey];
    if (!ref || !c) return false;
    const factor = opts.scale ?? 1;
    const w = (c.w / ref.zoom) * factor;
    const h = (c.h / ref.zoom) * factor;
    const tile = this.tile(category, iconKey, ref, c, opts.clipCircle ?? false);
    ctx.drawImage(tile, wx - w / 2, wy - h / 2, w, h);
    return true;
  }

  private tile(
    category: string,
    iconKey: string,
    ref: SheetRef,
    c: SpriteCoord,
    clip: boolean,
  ): HTMLCanvasElement {
    const key = `${category}|${iconKey}|${ref.zoom}|${clip ? 1 : 0}`;
    let tile = this.tiles.get(key);
    if (!tile) {
      tile = document.createElement("canvas");
      tile.width = c.w;
      tile.height = c.h;
      const tctx = tile.getContext("2d")!;
      if (clip) {
        tctx.beginPath();
        tctx.arc(c.w / 2, c.h / 2, (Math.min(c.w, c.h) / 2) * 0.92, 0, TAU);
        tctx.clip();
      }
      tctx.drawImage(ref.img, c.x, c.y, c.w, c.h, 0, 0, c.w, c.h);
      this.tiles.set(key, tile);
    }
    return tile;
  }

  /** 世界矩形いっぱいにスプライトを引き伸ばして描く(背景用) */
  drawStretched(
    ctx: CanvasRenderingContext2D,
    category: string,
    iconKey: string,
    zoomKey: string,
    x: number,
    y: number,
    w: number,
    h: number,
  ): boolean {
    const ref = this.get(category, zoomKey);
    const c = ref?.coords[iconKey];
    if (!ref || !c) return false;
    ctx.drawImage(ref.img, c.x, c.y, c.w, c.h, x, y, w, h);
    return true;
  }
}
