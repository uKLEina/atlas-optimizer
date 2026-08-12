"""ILPと独立な厳密オラクル2種(最適値のみを返す)。

- dreyfus_wagner: ノード重み版 Dreyfus-Wagner DP。全グラフで terminal 数 ~8 まで実用的
- enumerate_exact: 部分集合の全列挙。~20ノードの小グラフ専用だが、これ以上ないほど単純

解の復元は行わない。ILP側の解は validate.py が実行可能性を確認するので、
オラクルは最適「値」の一致だけを保証すればよい(実装が単純になりバグが入りにくい)。
"""

from __future__ import annotations

import heapq
from itertools import combinations

from .graph import AtlasGraph, reachable_from


def dreyfus_wagner(g: AtlasGraph, terminals, excluded=()) -> tuple[int, tuple[str, ...]]:
    """(最適ポイント数, 無視されたterminal) を返す。

    f[S][v] = 「v と S 内の全terminalを含む連結部分グラフの最小ノードコスト(vのコスト込み)」
    遷移: 部分集合の分割によるマージ + Dijkstra風の伝播(vの隣へ広げる)。
    """
    excluded = frozenset(excluded)
    if g.root in excluded:
        raise ValueError("start node cannot be excluded")
    reachable = reachable_from(g.adj, g.root, banned=excluded)
    wanted = set(terminals) - {g.root}
    ignored = tuple(sorted(t for t in wanted if t not in reachable))
    terms = sorted(wanted & reachable)
    if not terms:
        return 0, ignored

    k = len(terms)
    full = (1 << k) - 1
    INF = float("inf")
    cost = {v: g.cost(v) for v in reachable}
    adj = {v: [u for u in g.adj[v] if u in reachable] for v in reachable}

    f: list[dict[str, float]] = [dict() for _ in range(full + 1)]
    for i, t in enumerate(terms):
        f[1 << i][t] = cost[t]

    for S in range(1, full + 1):
        fS = f[S]
        # マージ: S の真部分集合との結合(重複計算は許容。正しさ優先)
        sub = (S - 1) & S
        while sub:
            comp = S ^ sub
            if sub < comp:  # 各分割を一度だけ
                f1, f2 = f[sub], f[comp]
                for v in f1.keys() & f2.keys():
                    c = f1[v] + f2[v] - cost[v]
                    if c < fS.get(v, INF):
                        fS[v] = c
            sub = (sub - 1) & S
        # 伝播: f[S] を距離ラベルとした Dijkstra(隣へ進むと隣のコストを加算)
        heap = [(c, v) for v, c in fS.items()]
        heapq.heapify(heap)
        while heap:
            c, v = heapq.heappop(heap)
            if c > fS.get(v, INF):
                continue
            for u in adj[v]:
                nc = c + cost[u]
                if nc < fS.get(u, INF):
                    fS[u] = nc
                    heapq.heappush(heap, (nc, u))

    best = f[full].get(g.root, INF)
    assert best < INF, "terminals are reachable, so a solution must exist"
    return round(best), ignored


def enumerate_exact(adj: dict[str, frozenset[str]], root: str, terminals) -> int:
    """小グラフ上の最適ポイント数を部分集合の全列挙で求める(rootコスト0)。

    root と terminal は必ず含め、残りノードの全部分集合を試して
    連結なものの最小コストを取る。O(2^自由ノード数)。
    """
    required = frozenset(terminals) | {root}
    free = sorted(set(adj) - required)
    assert len(free) <= 22, "graph too large for enumeration"

    def connected(sel: frozenset[str]) -> bool:
        seen = {root}
        stack = [root]
        while stack:
            for u in adj[stack.pop()]:
                if u in sel and u not in seen:
                    seen.add(u)
                    stack.append(u)
        return required <= seen

    best = None
    # コスト = |sel| - 1 (root分を引く) なので、小さい部分集合から試して見つけ次第確定
    for size in range(len(free) + 1):
        for extra in combinations(free, size):
            sel = required | frozenset(extra)
            if connected(sel):
                best = len(sel) - 1
                break
        if best is not None:
            break
    assert best is not None, "no connected solution exists in the given subgraph"
    return best


def bfs_ball(g: AtlasGraph, start: str, max_nodes: int) -> dict[str, frozenset[str]]:
    """start からの BFS で max_nodes 個まで集めた誘導部分グラフの隣接構造。"""
    order = [start]
    seen = {start}
    i = 0
    while i < len(order) and len(order) < max_nodes:
        for u in sorted(g.adj[order[i]]):
            if u not in seen:
                seen.add(u)
                order.append(u)
                if len(order) >= max_nodes:
                    break
        i += 1
    ball = frozenset(order)
    return {v: g.adj[v] & ball for v in ball}
