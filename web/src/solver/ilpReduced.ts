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
}

export function solve(
  highs: Highs,
  g: AtlasGraph,
  terminals: Iterable<string>,
  options: SolveOptions = {},
): SolveResult {
  const { excluded = [], timeLimit = 60 } = options;
  const red = build(g, terminals, excluded);
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
  const arcs: (readonly [string, string, number])[] = [];
  for (const e of red.edges.values()) {
    arcs.push([e.u, e.v, e.w]);
    arcs.push([e.v, e.u, e.w]);
  }
  const K = red.terminals.length;
  const yName = (v: string): string => `y_${v}`;
  const xName = (ai: number): string => `x_${ai}`;
  const fName = (ai: number): string => `f_${ai}`;

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
  const sol = highs.solve(lp, { time_limit: timeLimit });
  const solveTime = (performance.now() - t0) / 1000;

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
      solveTime,
    };
  }

  const primal = (name: string): number => {
    const col = sol.Columns[name];
    if (!col || !("Primal" in col)) throw new Error(`missing primal for ${name}`);
    return col.Primal;
  };
  const core = V.filter((v) => primal(yName(v)) > 0.5);
  const used: (readonly [string, string])[] = [];
  arcs.forEach(([u, v], ai) => {
    if (primal(xName(ai)) > 0.5) used.push([u, v]);
  });
  const nodes = expand(red, core, used);
  const points = Math.round(sol.ObjectiveValue);
  return {
    points,
    nodes,
    status,
    dualBound: status === "optimal" ? points : undefined,
    ignoredTerminals: red.ignoredTerminals,
    solveTime,
  };
}
