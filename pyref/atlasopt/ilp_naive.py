"""素朴なILP定式化(オラクル役)。

縮約なし・補助変数なしの単一品種フロー定式化。LP緩和が緩く大きい terminal 数では
遅い/証明が終わらないが、実装が単純でバグが入りにくいため照合の基準として使う。
time limit 到達時は status="feasible" となり、[dual_bound, points] が最適値を挟む
区間として使える。

モデル(root から各 terminal へ 1 単位のフロー):
  min  Σ cost(v)·y_v
  s.t. フロー保存: Σf_out - Σf_in = K (root) / -1 (terminal) / 0 (その他)
       f_a ≤ K·y_tail(a),  f_a ≤ K·y_head(a)
       y ∈ {0,1},  0 ≤ f ≤ K
"""

from __future__ import annotations

import time

from ._highs import INF, add_vars, new_model, status_of
from .graph import AtlasGraph, reachable_from
from .result import SolveResult


def solve(g: AtlasGraph, terminals, excluded=(), time_limit: float = 300.0) -> SolveResult:
    excluded = frozenset(excluded)
    if g.root in excluded:
        raise ValueError("start node cannot be excluded")

    reachable = reachable_from(g.adj, g.root, banned=excluded)
    wanted = set(terminals) - {g.root}
    ignored = tuple(sorted(t for t in wanted if t not in reachable))
    terms = sorted(wanted & reachable)
    if not terms:
        return SolveResult(0, frozenset({g.root}), "optimal", 0.0, ignored)

    V = sorted(reachable)
    vidx = {v: i for i, v in enumerate(V)}
    arcs = []
    for u in V:
        for v in g.adj[u]:
            if v in reachable:
                arcs.append((u, v))  # 両方向が別arcとして入る
    n, m = len(V), len(arcs)
    K = len(terms)

    h = new_model(time_limit)
    # 変数: y (n個, バイナリ) → f (m個, 連続)
    add_vars(
        h,
        costs=[g.cost(v) for v in V] + [0.0] * m,
        uppers=[1.0] * n + [float(K)] * m,
        n_integer=n,
    )
    for t in [*terms, g.root]:
        h.changeColBounds(vidx[t], 1.0, 1.0)

    out_arcs: dict[str, list[int]] = {v: [] for v in V}
    in_arcs: dict[str, list[int]] = {v: [] for v in V}
    for ai, (u, v) in enumerate(arcs):
        out_arcs[u].append(ai)
        in_arcs[v].append(ai)

    for v in V:
        idxs = [n + ai for ai in out_arcs[v]] + [n + ai for ai in in_arcs[v]]
        vals = [1.0] * len(out_arcs[v]) + [-1.0] * len(in_arcs[v])
        rhs = float(K) if v == g.root else (-1.0 if v in terms else 0.0)
        h.addRow(rhs, rhs, len(idxs), idxs, vals)
    for ai, (u, v) in enumerate(arcs):
        h.addRow(-INF, 0.0, 2, [n + ai, vidx[u]], [1.0, -float(K)])
        h.addRow(-INF, 0.0, 2, [n + ai, vidx[v]], [1.0, -float(K)])

    t0 = time.time()
    h.run()
    dt = time.time() - t0

    status = status_of(h)
    if status == "infeasible":  # 到達性を確認済みなので起きないはず
        return SolveResult(-1, frozenset(), "infeasible", 0.0, ignored, dt)
    sol = h.getSolution()
    chosen = frozenset(V[i] for i in range(n) if sol.col_value[i] > 0.5)
    return SolveResult(
        points=round(h.getObjectiveValue()),
        nodes=chosen,
        status=status,
        dual_bound=h.getInfo().mip_dual_bound,
        ignored_terminals=ignored,
        solve_time=dt,
    )
