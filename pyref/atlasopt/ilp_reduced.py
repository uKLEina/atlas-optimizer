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

タイブレーク(node_weights): 同点最適解の中からの選好。2フェーズの辞書式最適化:
  フェーズ1: 従来どおりポイント数を最小化(純整数目的なので速く、証明も従来通り)
  フェーズ2: 「Σ cost·y + Σ w·x = フェーズ1の最適値」を等式制約に加え、
             Σ eps·y + Σ eps(a)·x のみを最小化する
重みは主目的に一切混ざらないため、ポイント最適性の厳密性は構造的に不変。
フェーズ2が時間切れ等で optimal にならなければフェーズ1の解へフォールバックする
(選好はベストエフォート、最適性は無条件)。重みは非負なら任意スケールでよいが、
整数にすると目的の整数性が保たれてフェーズ2も速い。
points は目的値の丸めではなく |nodes| - 1 で数える(root はコスト0)。
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
    if node_weights and min(node_weights.values()) < 0.0:
        raise ValueError("node_weights must be non-negative")
    wt = node_weights.get

    red = build(g, terminals, excluded, node_weights)
    if not red.terminals:
        # 指定なし、または全 terminal が隣接縮約で root へ融合したケース。
        # 後者は「root 成分ぶんのノードを取るだけ」が厳密な最適解
        nodes = frozenset({g.root}) | red.merged.get(g.root, frozenset())
        return SolveResult(
            len(nodes) - 1, nodes, "optimal", float(len(nodes) - 1), red.ignored_terminals
        )

    S = red.graph
    V = sorted(S.nodes)
    vidx = {v: i for i, v in enumerate(V)}
    arcs = []  # (u, v, w, eps)
    for u, v, d in S.edges(data=True):
        arcs.append((u, v, d["w"], d["eps"]))
        arcs.append((v, u, d["w"], d["eps"]))
    n, m = len(V), len(arcs)
    K = len(red.terminals)
    X = lambda ai: n + ai
    F = lambda ai: n + m + ai

    out_arcs: dict[str, list[int]] = {v: [] for v in V}
    in_arcs: dict[str, list[int]] = {v: [] for v in V}
    for ai, (u, v, _, _) in enumerate(arcs):
        out_arcs[u].append(ai)
        in_arcs[v].append(ai)

    def base_model(limit: float, y_costs: list[float], arc_costs: list[float]):
        """目的関数だけ差し替え可能な共通モデル(制約はフェーズ1/2で同一)。"""
        h = new_model(limit)
        # 変数: y (n個) → x (m個) → f (m個)
        add_vars(
            h,
            costs=y_costs + arc_costs + [0.0] * m,
            uppers=[1.0] * (n + m) + [float(K)] * m,
            n_integer=n + m,
        )
        for t in [*red.terminals, g.root]:
            h.changeColBounds(vidx[t], 1.0, 1.0)
        for v in V:
            idxs = [F(ai) for ai in out_arcs[v]] + [F(ai) for ai in in_arcs[v]]
            vals = [1.0] * len(out_arcs[v]) + [-1.0] * len(in_arcs[v])
            rhs = float(K) if v == g.root else (-1.0 if v in red.terminals else 0.0)
            h.addRow(rhs, rhs, len(idxs), idxs, vals)
        for ai, (u, v, _, _) in enumerate(arcs):
            h.addRow(-INF, 0.0, 2, [F(ai), X(ai)], [1.0, -float(K)])
            h.addRow(-INF, 0.0, 2, [X(ai), vidx[u]], [1.0, -1.0])
            h.addRow(-INF, 0.0, 2, [X(ai), vidx[v]], [1.0, -1.0])
        for v in V:
            if v != g.root and in_arcs[v]:
                idxs = [X(ai) for ai in in_arcs[v]]
                h.addRow(-INF, 1.0, len(idxs), idxs, [1.0] * len(idxs))
        return h

    t0 = time.time()
    h1 = base_model(
        time_limit,
        y_costs=[float(g.cost(v)) for v in V],
        arc_costs=[float(w) for _, _, w, _ in arcs],
    )
    h1.run()
    status = status_of(h1)
    if status == "infeasible":  # build が到達性を保証するので起きないはず
        return SolveResult(
            -1, frozenset(), "infeasible", 0.0, red.ignored_terminals, time.time() - t0
        )
    sol = h1.getSolution()
    dual_bound = h1.getInfo().mip_dual_bound

    # フェーズ2(タイブレーク): 同点制約の下で重みだけを最小化
    has_weights = any(wt(v, 0.0) for v in V) or any(e for _, _, _, e in arcs)
    if status == "optimal" and has_weights:
        points_obj = round(h1.getObjectiveValue())  # フェーズ1は整数コストなので丸めで厳密
        remaining = min(max(time_limit - (time.time() - t0), 1.0), 3.0)
        h2 = base_model(
            remaining,
            y_costs=[float(wt(v, 0.0)) for v in V],
            arc_costs=[float(e) for _, _, _, e in arcs],
        )
        # 選好はベストエフォートなのでギャップを緩めて証明を軽くする
        # (ポイント数の厳密性は下の同点等式制約が保証しており、ここには影響しない)
        h2.setOptionValue("mip_rel_gap", 0.02)
        h2.setOptionValue("mip_abs_gap", 3.0)
        idxs = [vidx[v] for v in V if g.cost(v)] + [X(ai) for ai, a in enumerate(arcs) if a[2]]
        vals = [float(g.cost(v)) for v in V if g.cost(v)] + [
            float(a[2]) for a in arcs if a[2]
        ]
        h2.addRow(float(points_obj), float(points_obj), len(idxs), idxs, vals)
        # フェーズ1の解より悪い分枝を最初から刈るカットオフ(フェーズ2の高速化)
        eps_idxs = [vidx[v] for v in V if wt(v, 0.0)] + [
            X(ai) for ai, a in enumerate(arcs) if a[3]
        ]
        eps_vals = [float(wt(v, 0.0)) for v in V if wt(v, 0.0)] + [
            float(a[3]) for a in arcs if a[3]
        ]
        eps_cut = sum(c * sol.col_value[i] for i, c in zip(eps_idxs, eps_vals))
        h2.addRow(-INF, eps_cut + 1e-6, len(eps_idxs), eps_idxs, eps_vals)
        h2.run()
        # 密ビルドではフェーズ2の最適性証明が終わらないことがある(同点の木が大量で
        # LP下界が弱い)。時間切れでも暫定解が有効なら採用する。採用条件は自前で検証:
        # 全整数変数が 0/1 に整数化していて、かつ展開後のポイントがフェーズ1の最適値と
        # 一致すること。どちらかでも欠ければフェーズ1の解のまま
        if status_of(h2) in ("optimal", "feasible"):
            cand = h2.getSolution()
            cv = cand.col_value
            if len(cv) >= n + m and all(abs(v - round(v)) < 1e-6 for v in cv[: n + m]):
                core2 = [V[i] for i in range(n) if cv[i] > 0.5]
                used2 = [
                    (arcs[ai][0], arcs[ai][1]) for ai in range(m) if cv[X(ai)] > 0.5
                ]
                if len(expand(red, core2, used2)) - 1 == points_obj:
                    sol = cand
    dt = time.time() - t0

    core = [V[i] for i in range(n) if sol.col_value[i] > 0.5]
    used = [(arcs[ai][0], arcs[ai][1]) for ai in range(m) if sol.col_value[X(ai)] > 0.5]
    nodes = expand(red, core, used)
    return SolveResult(
        # 目的値ではなく解のノード数から直接数える(root はコスト0)
        points=len(nodes) - 1,
        nodes=nodes,
        status=status,
        dual_bound=dual_bound,
        ignored_terminals=red.ignored_terminals,
        solve_time=dt,
    )
