"""採用定式化: 前処理縮約 + 強化ILP。TypeScript移植の仕様原本。

縮約グラフ(reduction.build)上で解く。ノードコストに加え、縮約辺には
チェーン内部ノード数のコスト w が付く。

モデル:
  min  Σ cost(v)·y_v + Σ w(a)·x_a
  s.t. フロー保存: Σf_out - Σf_in = K (root) / -1 (terminal) / 0 (その他)
       f_a ≤ K·x_a
       x_a ≤ y_tail(a),  x_a ≤ y_head(a)
       Σ_{a∈in(v)} x_a ≤ 1   (v ≠ root)   … 木構造(入次数≤1)への強化制約
       y, x ∈ {0,1},  0 ≤ f ≤ K

x はどちらか一方の向きしか使われないため、使用された縮約辺の内部ノードは
ちょうど一度だけ課金される。入次数制約は解空間を最適解を失わずに狭める
(任意の連結解は全域木を root 向き有向化することで満たせる)。

タイブレーク(node_weights): 同点最適解の中からの選好。ノード v のコストを
cost(v) + eps_v、縮約辺のコストを w + Σeps(内部ノード) にする。
eps は非負かつ総和 < 0.5 を強制するため、ポイント数(整数)の最適性は不変
(ポイント数が1少ない解は目的値で常に勝つ)。points は目的値の丸めではなく
|nodes| - 1 で数える(root はコスト0)。
"""

from __future__ import annotations

import time

from ._highs import INF, add_vars, new_model, status_of
from .graph import AtlasGraph
from .reduction import build, expand
from .result import SolveResult


def solve(
    g: AtlasGraph, terminals, excluded=(), time_limit: float = 60.0, node_weights=None
) -> SolveResult:
    node_weights = dict(node_weights or {})
    if node_weights:
        if min(node_weights.values()) < 0.0:
            raise ValueError("node_weights must be non-negative")
        if sum(node_weights.values()) >= 0.5:
            raise ValueError("sum of node_weights must be < 0.5 to preserve optimality")
    wt = node_weights.get

    red = build(g, terminals, excluded, node_weights)
    if not red.terminals:
        return SolveResult(0, frozenset({g.root}), "optimal", 0.0, red.ignored_terminals)

    S = red.graph
    V = sorted(S.nodes)
    vidx = {v: i for i, v in enumerate(V)}
    arcs = []
    for u, v, d in S.edges(data=True):
        arcs.append((u, v, d["w"] + d["eps"]))
        arcs.append((v, u, d["w"] + d["eps"]))
    n, m = len(V), len(arcs)
    K = len(red.terminals)

    h = new_model(time_limit)
    # 変数: y (n個) → x (m個) → f (m個)
    add_vars(
        h,
        costs=[g.cost(v) + wt(v, 0.0) for v in V] + [float(w) for _, _, w in arcs] + [0.0] * m,
        uppers=[1.0] * (n + m) + [float(K)] * m,
        n_integer=n + m,
    )
    X = lambda ai: n + ai
    F = lambda ai: n + m + ai
    for t in [*red.terminals, g.root]:
        h.changeColBounds(vidx[t], 1.0, 1.0)

    out_arcs: dict[str, list[int]] = {v: [] for v in V}
    in_arcs: dict[str, list[int]] = {v: [] for v in V}
    for ai, (u, v, _) in enumerate(arcs):
        out_arcs[u].append(ai)
        in_arcs[v].append(ai)

    for v in V:
        idxs = [F(ai) for ai in out_arcs[v]] + [F(ai) for ai in in_arcs[v]]
        vals = [1.0] * len(out_arcs[v]) + [-1.0] * len(in_arcs[v])
        rhs = float(K) if v == g.root else (-1.0 if v in red.terminals else 0.0)
        h.addRow(rhs, rhs, len(idxs), idxs, vals)
    for ai, (u, v, _) in enumerate(arcs):
        h.addRow(-INF, 0.0, 2, [F(ai), X(ai)], [1.0, -float(K)])
        h.addRow(-INF, 0.0, 2, [X(ai), vidx[u]], [1.0, -1.0])
        h.addRow(-INF, 0.0, 2, [X(ai), vidx[v]], [1.0, -1.0])
    for v in V:
        if v != g.root and in_arcs[v]:
            idxs = [X(ai) for ai in in_arcs[v]]
            h.addRow(-INF, 1.0, len(idxs), idxs, [1.0] * len(idxs))

    t0 = time.time()
    h.run()
    dt = time.time() - t0

    status = status_of(h)
    if status == "infeasible":  # build が到達性を保証するので起きないはず
        return SolveResult(-1, frozenset(), "infeasible", 0.0, red.ignored_terminals, dt)
    sol = h.getSolution()
    core = [V[i] for i in range(n) if sol.col_value[i] > 0.5]
    used = [(arcs[ai][0], arcs[ai][1]) for ai in range(m) if sol.col_value[X(ai)] > 0.5]
    nodes = expand(red, core, used)
    return SolveResult(
        # 目的値には eps が混ざるため、ポイントは解のノード数から直接数える(root はコスト0)
        points=len(nodes) - 1,
        nodes=nodes,
        status=status,
        dual_bound=h.getInfo().mip_dual_bound,
        ignored_terminals=red.ignored_terminals,
        solve_time=dt,
    )
