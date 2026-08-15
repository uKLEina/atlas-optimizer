/**
 * 採用定式化: 前処理縮約 + 強化ILP(pyref/atlasopt/ilp_reduced.py の移植。あちらが仕様原本)。
 *
 * 縮約グラフ(reduction.build)上で解く。ノードコストに加え、縮約辺には
 * チェーン内部ノード数のコスト w が付く。
 *
 * モデル:
 *   min  Σ cost(v)·y_v + Σ w(a)·x_a
 *   s.t. フロー保存: Σf_out - Σf_in = K (root) / -1 (terminal) / 0 (その他)
 *        f_a ≤ K·x_a
 *        x_a ≤ y_tail(a),  x_a ≤ y_head(a)
 *        Σ_{a∈in(v)} x_a ≤ 1   (v ≠ root)   … 木構造(入次数≤1)への強化制約
 *        y, x ∈ {0,1},  0 ≤ f ≤ K
 *
 * x はどちらか一方の向きしか使われないため、使用された縮約辺の内部ノードは
 * ちょうど一度だけ課金される。入次数制約は解空間を最適解を失わずに狭める
 * (任意の連結解は全域木を root 向き有向化することで満たせる)。
 *
 * タイブレーク(nodeWeights): 同点最適解の中からの選好。2フェーズの辞書式最適化:
 *   フェーズ1: 従来どおりポイント数を最小化(純整数目的なので速く、証明も従来通り)
 *   フェーズ2: 「Σ cost·y + Σ w·x = フェーズ1の最適値」を等式制約に加え、
 *              Σ eps·y + Σ eps(a)·x のみを最小化する
 * 重みは主目的に一切混ざらないため、ポイント最適性の厳密性は構造的に不変。
 * フェーズ2が時間切れ等で optimal にならなければフェーズ1の解へフォールバックする
 * (選好はベストエフォート、最適性は無条件)。重みは非負なら任意スケールでよいが、
 * 整数にすると目的の整数性が保たれてフェーズ2も速い。
 * points は目的値の丸めではなく |nodes| - 1 で数える(root はコスト0)。
 *
 * pyref との差分: highspy の行列 API の代わりに LP 形式テキストを生成する。
 * 整数性は General セクション、0/1 上限と terminal/root の固定は Bounds で表現
 * (Binary セクションと Bounds の解釈衝突を避ける。意味論は highspy 版と同一)。
 */

import { cost, type AtlasGraph } from "../data/graph";
import type { Highs } from "./highs";
import { buildLp, type LpConstraint, type LpTerm } from "./lp";
import { build, expand } from "./reduction";
import type { SolveResult } from "./result";

export interface SolveOptions {
  excluded?: Iterable<string>;
  /** 秒。pyref の time_limit と同じ既定値 */
  timeLimit?: number;
  /** タイブレーク用のノード重み(非負。整数ティア推奨)。省略時は従来どおり */
  nodeWeights?: ReadonlyMap<string, number>;
  /**
   * フェーズ2の時間上限(秒)。時間切れでも暫定解が有効(整数かつ同点)なら採用し、
   * 無ければフェーズ1の経路のまま返す
   */
  phase2TimeLimit?: number;
}

export function solve(
  highs: Highs,
  g: AtlasGraph,
  terminals: Iterable<string>,
  options: SolveOptions = {},
): SolveResult {
  const { excluded = [], timeLimit = 60, nodeWeights, phase2TimeLimit = 3 } = options;
  if (nodeWeights) {
    for (const w of nodeWeights.values()) {
      if (w < 0) throw new Error("nodeWeights must be non-negative");
    }
  }
  const wt = (v: string): number => nodeWeights?.get(v) ?? 0;
  const red = build(g, terminals, excluded, nodeWeights);
  if (red.terminals.length === 0) {
    return {
      points: 0,
      nodes: new Set([g.root]),
      status: "optimal",
      dualBound: 0,
      ignoredTerminals: red.ignoredTerminals,
      solveTime: 0,
    };
  }

  const V = [...red.nodes].sort();
  const arcs: (readonly [string, string, number, number])[] = []; // [u, v, w, eps]
  for (const e of red.edges.values()) {
    arcs.push([e.u, e.v, e.w, e.eps]);
    arcs.push([e.v, e.u, e.w, e.eps]);
  }
  const K = red.terminals.length;
  const yName = (v: string): string => `y_${v}`;
  const xName = (ai: number): string => `x_${ai}`;
  const fName = (ai: number): string => `f_${ai}`;

  // フェーズ1の目的: ポイント数(従来と同一の純整数目的)
  const objective: LpTerm[] = [];
  for (const v of V) {
    const c = cost(g, v);
    if (c !== 0) objective.push([c, yName(v)]);
  }
  arcs.forEach(([, , w], ai) => {
    if (w !== 0) objective.push([w, xName(ai)]);
  });

  const outArcs = new Map<string, number[]>(V.map((v) => [v, []]));
  const inArcs = new Map<string, number[]>(V.map((v) => [v, []]));
  arcs.forEach(([u, v], ai) => {
    outArcs.get(u)!.push(ai);
    inArcs.get(v)!.push(ai);
  });

  const termSet = new Set(red.terminals);
  const constraints: LpConstraint[] = [];
  for (const v of V) {
    const terms: LpTerm[] = [
      ...outArcs.get(v)!.map((ai): LpTerm => [1, fName(ai)]),
      ...inArcs.get(v)!.map((ai): LpTerm => [-1, fName(ai)]),
    ];
    const rhs = v === g.root ? K : termSet.has(v) ? -1 : 0;
    constraints.push({ terms, sense: "=", rhs });
  }
  arcs.forEach(([u, v], ai) => {
    constraints.push({
      terms: [
        [1, fName(ai)],
        [-K, xName(ai)],
      ],
      sense: "<=",
      rhs: 0,
    });
    constraints.push({
      terms: [
        [1, xName(ai)],
        [-1, yName(u)],
      ],
      sense: "<=",
      rhs: 0,
    });
    constraints.push({
      terms: [
        [1, xName(ai)],
        [-1, yName(v)],
      ],
      sense: "<=",
      rhs: 0,
    });
  });
  for (const v of V) {
    const ins = inArcs.get(v)!;
    if (v !== g.root && ins.length > 0) {
      constraints.push({
        terms: ins.map((ai): LpTerm => [1, xName(ai)]),
        sense: "<=",
        rhs: 1,
      });
    }
  }

  const fixed = new Set([...red.terminals, g.root]);
  const bounds: string[] = [];
  for (const v of V) {
    bounds.push(fixed.has(v) ? ` ${yName(v)} = 1` : ` 0 <= ${yName(v)} <= 1`);
  }
  arcs.forEach((_, ai) => {
    bounds.push(` 0 <= ${xName(ai)} <= 1`);
    bounds.push(` 0 <= ${fName(ai)} <= ${K}`);
  });
  const generals = [...V.map(yName), ...arcs.map((_, ai) => xName(ai))];

  const lp = buildLp(objective, constraints, bounds, generals);

  const t0 = performance.now();
  let sol = highs.solve(lp, { time_limit: timeLimit });

  const status =
    sol.Status === "Optimal"
      ? "optimal"
      : sol.Status === "Infeasible"
        ? "infeasible"
        : "feasible";
  if (status === "infeasible") {
    // build が到達性を保証するので起きないはず
    return {
      points: -1,
      nodes: new Set(),
      status,
      ignoredTerminals: red.ignoredTerminals,
      solveTime: (performance.now() - t0) / 1000,
    };
  }

  const toResult = (s: typeof sol): SolveResult => {
    const primal = (name: string): number => {
      const col = s.Columns[name];
      if (!col || !("Primal" in col)) throw new Error(`missing primal for ${name}`);
      return col.Primal;
    };
    const core = V.filter((v) => primal(yName(v)) > 0.5);
    const used: (readonly [string, string])[] = [];
    arcs.forEach(([u, v], ai) => {
      if (primal(xName(ai)) > 0.5) used.push([u, v]);
    });
    const nodes = expand(red, core, used);
    // 目的値には eps が混ざりうるため、ポイントは解のノード数から直接数える(root はコスト0)
    const points = nodes.size - 1;
    return {
      points,
      nodes,
      status,
      dualBound: status === "optimal" ? points : undefined,
      ignoredTerminals: red.ignoredTerminals,
      solveTime: (performance.now() - t0) / 1000,
    };
  };

  // フェーズ2(タイブレーク): 同点制約の下で重みだけを最小化。
  // optimal にならなければフェーズ1の解のまま(選好はベストエフォート)
  const hasWeights = V.some((v) => wt(v) !== 0) || arcs.some(([, , , eps]) => eps !== 0);
  if (status === "optimal" && hasWeights) {
    const pointsObj = Math.round(sol.ObjectiveValue); // フェーズ1は整数コストなので丸めで厳密
    const primal1 = (name: string): number => {
      const col = sol.Columns[name];
      return col && "Primal" in col ? col.Primal : 0;
    };
    const objective2: LpTerm[] = [];
    let epsCut = 0; // フェーズ1の解の eps 値(カットオフ上界)
    for (const v of V) {
      if (wt(v) !== 0) {
        objective2.push([wt(v), yName(v)]);
        epsCut += wt(v) * primal1(yName(v));
      }
    }
    arcs.forEach(([, , , eps], ai) => {
      if (eps !== 0) {
        objective2.push([eps, xName(ai)]);
        epsCut += eps * primal1(xName(ai));
      }
    });
    const eqTerms: LpTerm[] = [];
    for (const v of V) {
      const c = cost(g, v);
      if (c !== 0) eqTerms.push([c, yName(v)]);
    }
    arcs.forEach(([, , w], ai) => {
      if (w !== 0) eqTerms.push([w, xName(ai)]);
    });
    const lp2 = buildLp(
      objective2,
      [
        ...constraints,
        { terms: eqTerms, sense: "=", rhs: pointsObj },
        // フェーズ1の解より悪い分枝を最初から刈る(フェーズ2の高速化)
        { terms: objective2, sense: "<=", rhs: epsCut + 1e-6 },
      ],
      bounds,
      generals,
    );
    const remaining = Math.min(
      Math.max(timeLimit - (performance.now() - t0) / 1000, 1),
      phase2TimeLimit,
    );
    // 選好はベストエフォートなので、フェーズ2はギャップを緩めて証明を軽くする。
    // ポイント数の厳密性は同点等式制約が保証しており、ここには影響しない
    const sol2 = highs.solve(lp2, { time_limit: remaining, mip_rel_gap: 0.02, mip_abs_gap: 3 });
    // 密ビルドではフェーズ2の最適性証明が終わらないことがある(同点の木が大量で
    // LP下界が弱い)。時間切れでも暫定解が有効なら採用する。採用条件は自前で検証:
    // 全整数変数が 0/1 に整数化していて、かつ展開後のポイントがフェーズ1の最適値と
    // 一致すること。どちらかでも欠ければフェーズ1の解へフォールバックする
    if (sol2.Status === "Optimal" || sol2.Status === "Time limit reached") {
      const integral = [...V.map(yName), ...arcs.map((_, ai) => xName(ai))].every((nm) => {
        const col = sol2.Columns[nm];
        if (!col || !("Primal" in col)) return false;
        return Math.abs(col.Primal - Math.round(col.Primal)) < 1e-6;
      });
      if (integral) {
        try {
          const cand = toResult(sol2);
          if (cand.points === pointsObj) return cand;
        } catch {
          // 抽出に失敗(暫定解なし)。フェーズ1へフォールバック
        }
      }
    }
  }

  return toResult(sol);
}
