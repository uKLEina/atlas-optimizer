/**
 * pan/zoom ビューポート。世界座標(ツリー単位)⇔スクリーン座標(CSS px)の変換。
 * screen = world · scale + offset。devicePixelRatio は renderer 側で吸収する。
 */

export interface WorldBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

const MIN_SCALE = 0.04;
const MAX_SCALE = 0.7;

export class Viewport {
  scale = 0.1;
  offsetX = 0;
  offsetY = 0;

  constructor(private readonly canvas: HTMLCanvasElement) {}

  /** 世界矩形が収まるように初期化(padding は世界単位) */
  fit(bounds: WorldBounds, padding = 900): void {
    const w = bounds.maxX - bounds.minX + padding * 2;
    const h = bounds.maxY - bounds.minY + padding * 2;
    const { clientWidth, clientHeight } = this.canvas;
    this.scale = Math.max(MIN_SCALE, Math.min(clientWidth / w, clientHeight / h));
    const cx = (bounds.minX + bounds.maxX) / 2;
    const cy = (bounds.minY + bounds.maxY) / 2;
    this.offsetX = clientWidth / 2 - cx * this.scale;
    this.offsetY = clientHeight / 2 - cy * this.scale;
  }

  toScreen(wx: number, wy: number): [number, number] {
    return [wx * this.scale + this.offsetX, wy * this.scale + this.offsetY];
  }

  toWorld(sx: number, sy: number): [number, number] {
    return [(sx - this.offsetX) / this.scale, (sy - this.offsetY) / this.scale];
  }

  /** カーソル位置を不動点にしてズーム */
  zoomAt(sx: number, sy: number, factor: number): void {
    const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, this.scale * factor));
    const [wx, wy] = this.toWorld(sx, sy);
    this.scale = next;
    this.offsetX = sx - wx * next;
    this.offsetY = sy - wy * next;
  }

  pan(dx: number, dy: number): void {
    this.offsetX += dx;
    this.offsetY += dy;
  }

  /** 世界座標 (wx, wy) を画面中央へ */
  centerOn(wx: number, wy: number): void {
    this.offsetX = this.canvas.clientWidth / 2 - wx * this.scale;
    this.offsetY = this.canvas.clientHeight / 2 - wy * this.scale;
  }

  /** 現在の可視世界矩形(margin は世界単位、カリング用) */
  visibleWorldRect(margin = 0): WorldBounds {
    const [minX, minY] = this.toWorld(0, 0);
    const [maxX, maxY] = this.toWorld(this.canvas.clientWidth, this.canvas.clientHeight);
    return {
      minX: minX - margin,
      minY: minY - margin,
      maxX: maxX + margin,
      maxY: maxY + margin,
    };
  }
}
