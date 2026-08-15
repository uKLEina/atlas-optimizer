"""前処理縮約と解の展開。

手順(DESIGN.md の通り):
1. 除外ノードをグラフから削除
2. root から到達不能になった terminal を無視リストへ(PoP踏襲。エラーにしない)
3. **隣接 terminal 縮約**: terminal(と root)の誘導部分グラフの各連結成分を
   代表1ノードへ潰す。辺コストが無いため「隣接 terminal 間の辺は使って損がない」
   が成立し、厳密性は不変(フェーズ3 ステージ0)。代表は root を含む成分なら root、
   それ以外は最小 id(TS と一致する決定的選択)。terminals は代表 id になり、
   潰した成分は merged に記録して展開時に復元する
4. 非terminalの葉を再帰的に刈り込み
5. 非terminalの次数2ノードをチェーンごと重み付き辺に縮約(内部ノード数 = 辺重み)
6. 平行辺は (w, eps) の辞書式最小のみ残す(w = ポイント数が主、
   タイブレーク重み eps は同点時のみ。同一 w の平行チェーンの選択は
   ここで決まるため、eps を見ないとタイブレークが縮約段階で潰れてしまう)

縮約辺は内部ノード列を保持し、ソルバーが使った辺を元のノード集合に展開できる。
node_weights はタイブレーク用の微小ノード重み(ilp_reduced.solve 参照)。
"""

from __future__ import annotations

from dataclasses import dataclass, field

import networkx as nx

from .graph import AtlasGraph, reachable_from


@dataclass(frozen=True)
class ReducedGraph:
    root: str
    terminals: tuple[str, ...]  # rootを除く、到達可能なterminalの**代表id**(隣接縮約後)
    ignored_terminals: tuple[str, ...]  # 除外/到達不能で無視されたterminal
    graph: nx.Graph  # 辺属性: w(内部ノード数), eps(内部ノードのタイブレーク重み和), path
    # 代表id → 潰した成分の全ノード(代表含む)。展開時に復元する
    merged: dict[str, frozenset[str]] = field(default_factory=dict)


def build(g: AtlasGraph, terminals, excluded=(), node_weights=None) -> ReducedGraph:
    wt = (node_weights or {}).get
    excluded = frozenset(excluded)
    if g.root in excluded:
        raise ValueError("start node cannot be excluded")
    unknown = (set(terminals) | set(excluded)) - set(g.adj)
    if unknown:
        raise ValueError(f"unknown or non-allocatable node ids: {sorted(unknown)}")

    reachable = reachable_from(g.adj, g.root, banned=excluded)
    wanted = set(terminals) - {g.root}
    ignored = sorted(t for t in wanted if t in excluded or t not in reachable)
    raw_terms = sorted(wanted - set(ignored))

    # 隣接 terminal 縮約(root 含む)。代表は root 優先、次いで最小 id
    keepset = set(raw_terms) | {g.root}
    rep: dict[str, str] = {}
    merged: dict[str, frozenset[str]] = {}
    for s in keepset:
        if s in rep:
            continue
        comp = {s}
        stack = [s]
        while stack:
            x = stack.pop()
            for y in g.adj[x]:
                if y in keepset and y not in comp:
                    comp.add(y)
                    stack.append(y)
        r = g.root if g.root in comp else min(comp)
        for x in comp:
            rep[x] = r
        if len(comp) > 1:
            merged[r] = frozenset(comp)
    terms = sorted({rep[t] for t in raw_terms} - {g.root})
    keep = set(terms) | {g.root}

    # 到達可能部分だけで MultiGraph を作る(平行辺は縮約中・代表への融合で発生しうる)
    H = nx.MultiGraph()
    H.add_nodes_from(n for n in reachable if rep.get(n, n) == n)
    for u in reachable:
        for v in g.adj[u]:
            if v in reachable and u < v:
                ru, rv = rep.get(u, u), rep.get(v, v)
                if ru != rv:
                    H.add_edge(ru, rv, w=0, eps=0.0, path=())

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
            H.add_edge(
                a,
                b,
                w=d1["w"] + d2["w"] + 1,
                eps=d1["eps"] + d2["eps"] + wt(n, 0.0),
                path=d1["path"] + (n,) + d2["path"],
            )

    S = nx.Graph()
    S.add_nodes_from(H.nodes)
    for u, v, d in H.edges(data=True):
        if u == v:
            continue
        # (w, eps) の辞書式比較: ポイント数が主、タイブレーク重みは同点時のみ。
        # 和で比べると eps が大きいときに w の優劣を覆しうる(厳密性が壊れる)
        cost = (d["w"], d["eps"])
        if not S.has_edge(u, v) or cost < (S[u][v]["w"], S[u][v]["eps"]):
            S.add_edge(u, v, w=d["w"], eps=d["eps"], path=d["path"])

    return ReducedGraph(
        root=g.root,
        terminals=tuple(terms),
        ignored_terminals=tuple(ignored),
        graph=S,
        merged=merged,
    )


def expand(reduced: ReducedGraph, core_nodes, used_edges) -> frozenset[str]:
    """縮約グラフ上の解(コアノード集合+使用辺)を元グラフのノード集合へ展開する。"""
    sel = set(core_nodes)
    S = reduced.graph
    for u, v in used_edges:
        sel.update(S[u][v]["path"])
    # 隣接縮約で潰した terminal 成分を復元する(成分は誘導部分グラフとして連結)
    for r, comp in reduced.merged.items():
        if r in sel:
            sel.update(comp)
    return frozenset(sel)
