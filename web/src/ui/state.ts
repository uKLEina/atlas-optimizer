/**
 * アプリ状態: ノードの3状態(中立/指定/除外)、求解結果、hover。
 *
 * UI要件(DESIGN.md):
 * - クリックで「指定→除外→中立」の3状態トグル
 * - mastery クリックは**同名 mastery 全クラスタ**の Notable へ一括適用
 *   (全員同状態なら次の状態へ巡回、混在なら全員「指定」。Notable 無しなら no-op)
 * - root は常に起点なのでトグル対象外
 */

import type { AtlasGraph } from "../data/graph";
import type { SolveResult } from "../solver/result";
import type { MasteryIndex } from "./masteryIndex";

export type NodeMark = "none" | "terminal" | "excluded";

const CYCLE: Record<NodeMark, NodeMark> = {
  none: "terminal",
  terminal: "excluded",
  excluded: "none",
};

type Listener = () => void;

export class AppState {
  private readonly marks = new Map<string, NodeMark>();
  private readonly changeListeners = new Set<Listener>();
  private readonly markListeners = new Set<Listener>();
  result: SolveResult | null = null;
  solving = false;
  solveError: string | null = null;
  hover: string | null = null;
  /** 検索ヒット中のノード集合(強調表示用)。空なら検索非アクティブ */
  search: ReadonlySet<string> = new Set();

  constructor(
    private readonly g: AtlasGraph,
    private readonly masteryIndex: MasteryIndex,
  ) {}

  /** あらゆる変化(再描画・パネル更新用) */
  subscribe(fn: Listener): void {
    this.changeListeners.add(fn);
  }

  /** 指定/除外の変化のみ(ソルブのトリガー用) */
  onMarksChange(fn: Listener): void {
    this.markListeners.add(fn);
  }

  private emit(marksChanged: boolean): void {
    if (marksChanged) for (const fn of this.markListeners) fn();
    for (const fn of this.changeListeners) fn();
  }

  markOf(id: string): NodeMark {
    return this.marks.get(id) ?? "none";
  }

  /** 通常ノードの3状態トグル。root・グラフ外(mastery等)は対象外 */
  cycle(id: string): boolean {
    if (id === this.g.root || !this.g.adj.has(id)) return false;
    const next = CYCLE[this.markOf(id)];
    if (next === "none") this.marks.delete(id);
    else this.marks.set(id, next);
    this.emit(true);
    return true;
  }

  /** mastery クリック: 同名 mastery 全クラスタの Notable 群への一括適用 */
  masteryClick(masteryId: string): boolean {
    const notables = this.masteryIndex.notables.get(masteryId);
    if (!notables || notables.length === 0) return false;
    const states = notables.map((n) => this.markOf(n));
    const uniform = states.every((s) => s === states[0]);
    const next: NodeMark = uniform ? CYCLE[states[0]!] : "terminal";
    for (const n of notables) {
      if (next === "none") this.marks.delete(n);
      else this.marks.set(n, next);
    }
    this.emit(true);
    return true;
  }

  /**
   * クイック選択ボタン用の一括トグル: 全員 terminal なら全員解除、
   * それ以外(未選択・混在)なら全員 terminal。excluded 状態は経由しない
   * (mastery クリックの3状態巡回とは意図的に別挙動。ボタンは選択/解除の往復)
   */
  quickToggle(ids: readonly string[]): boolean {
    if (ids.length === 0) return false;
    const allTerminal = ids.every((id) => this.markOf(id) === "terminal");
    for (const id of ids) {
      if (allTerminal) this.marks.delete(id);
      else this.marks.set(id, "terminal");
    }
    this.emit(true);
    return true;
  }

  terminals(): string[] {
    return [...this.marks.entries()].filter(([, m]) => m === "terminal").map(([n]) => n);
  }

  excluded(): string[] {
    return [...this.marks.entries()].filter(([, m]) => m === "excluded").map(([n]) => n);
  }

  reset(): void {
    this.marks.clear();
    this.emit(true);
  }

  setHover(id: string | null): void {
    if (this.hover === id) return;
    this.hover = id;
    this.emit(false);
  }

  setSearch(matches: ReadonlySet<string>): void {
    this.search = matches;
    this.emit(false);
  }

  setSolving(): void {
    this.solving = true;
    this.solveError = null;
    this.emit(false);
  }

  /** 結果を即座に破棄して初期表示へ(terminal が無くなった時。ソルブ不要) */
  clearResult(): void {
    this.result = null;
    this.solving = false;
    this.solveError = null;
    this.emit(false);
  }

  setResult(r: SolveResult): void {
    this.result = r;
    this.solving = false;
    this.solveError = null;
    this.emit(false);
  }

  setError(message: string): void {
    this.solving = false;
    this.solveError = message;
    this.emit(false);
  }
}
