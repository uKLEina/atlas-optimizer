"""前処理縮約と解の展開。

手順(DESIGN.md の通り):
1. 除外ノードをグラフから削除
2. root から到達不能になった terminal を無視リストへ(PoP踏襲。エラーにしない)
3. 非terminalの葉を再帰的に刈り込み
4. 非terminalの次数2ノードをチェーンごと重み付き辺に縮約(内部ノード数 = 辺重み)
5. 平行辺は最小重みのみ残す

縮約辺は内部ノード列を保持し、ソルバーが使った辺を元のノード集合に展開できる。
"""

from __future__ import annotations

from dataclasses import dataclass

import networkx as nx

from .graph import AtlasGraph, reachable_from


@dataclass(frozen=True)
class ReducedGraph:
    root: str
    terminals: tuple[str, ...]  # rootを除く、到達可能なterminalのみ
    ignored_terminals: tuple[str, ...]  # 除外/到達不能で無視されたterminal
    graph: nx.Graph  # 辺属性: w(内部ノード数), path(内部ノードのtuple)


def build(g: AtlasGraph, terminals, excluded=()) -> ReducedGraph:
    excluded = frozenset(excluded)
    if g.root in excluded:
        raise ValueError("start node cannot be excluded")
    unknown = (set(terminals) | set(excluded)) - set(g.adj)
    if unknown:
        raise ValueError(f"unknown or non-allocatable node ids: {sorted(unknown)}")

    reachable = reachable_from(g.adj, g.root, banned=excluded)
    wanted = set(terminals) - {g.root}
    ignored = sorted(t for t in wanted if t in excluded or t not in reachable)
    terms = sorted(wanted - set(ignored))
    keep = set(terms) | {g.root}

    # 到達可能部分だけで MultiGraph を作る(平行辺は縮約中に発生しうる)
    H = nx.MultiGraph()
    H.add_nodes_from(reachable)
    for u in reachable:
        for v in g.adj[u]:
            if v in reachable and u < v:
                H.add_edge(u, v, w=0, path=())

    changed = True
    while changed:
        changed = False
        # 非terminalの葉(次数0含む)を刈る
        for n in list(H.nodes):
            if n not in keep and H.degree(n) <= 1:
                H.remove_node(n)
                changed = True
        # 非terminalの次数2ノードを縮約
        for n in list(H.nodes):
            if n in keep or n not in H or H.degree(n) != 2:
                continue
            edges = list(H.edges(n, keys=True, data=True))
            if len(edges) != 2:
                continue  # 平行辺2本で次数2(=行き止まりループ)。葉刈りに任せず削除
            (u1, v1, _, d1), (u2, v2, _, d2) = edges
            a = v1 if u1 == n else u1
            b = v2 if u2 == n else u2
            H.remove_node(n)
            changed = True
            if a == b:
                continue  # チェーンが輪に潰れた。輪を経由する意味はないので捨てる
            H.add_edge(a, b, w=d1["w"] + d2["w"] + 1, path=d1["path"] + (n,) + d2["path"])

    S = nx.Graph()
    S.add_nodes_from(H.nodes)
    for u, v, d in H.edges(data=True):
        if u == v:
            continue
        if not S.has_edge(u, v) or d["w"] < S[u][v]["w"]:
            S.add_edge(u, v, w=d["w"], path=d["path"])

    return ReducedGraph(
        root=g.root,
        terminals=tuple(terms),
        ignored_terminals=tuple(ignored),
        graph=S,
    )


def expand(reduced: ReducedGraph, core_nodes, used_edges) -> frozenset[str]:
    """縮約グラフ上の解(コアノード集合+使用辺)を元グラフのノード集合へ展開する。"""
    sel = set(core_nodes)
    S = reduced.graph
    for u, v in used_edges:
        sel.update(S[u][v]["path"])
    return frozenset(sel)
