"""木分解(min-fill ヒューリスティック)と妥当性検証。フェーズ3 ステージ1。

分解はグラフのノード・辺集合のみに依存するため、データ(リーグ)更新時に
一度計算すればよい。terminal 指定ごとの再計算は不要。

min-fill: 「消去したとき近傍間に張る必要がある補充辺が最少の頂点」を貪欲に消す。
タイは (fill, degree, id) で解消する(決定的。TS 移植と一致させるため)。
bag の木は「消去頂点の近傍のうち最も早く消える頂点の bag を親にする」標準構成で、
最後に root ノードを含む bag へ根を付け替える(DP の終端条件のため)。
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class TreeDecomposition:
    bags: tuple[frozenset[str], ...]
    parent: tuple[int, ...]  # 各 bag の親 bag index(根は -1)
    root_bag: int  # root ノードを含む bag(分解木の根)
    width: int  # max |bag| - 1


def build_decomposition(adj: dict[str, frozenset[str]], root: str) -> TreeDecomposition:
    if root not in adj:
        raise ValueError(f"root {root} not in graph")
    nbrs: dict[str, set[str]] = {v: set(ns) for v, ns in adj.items()}

    def fill_count(v: str) -> int:
        ns = nbrs[v]
        cnt = 0
        for a in ns:
            cnt += len(ns - nbrs[a]) - 1  # a 自身は常に非隣接扱いになるため引く
        return cnt // 2

    fills = {v: fill_count(v) for v in nbrs}
    order: list[str] = []
    bags: list[frozenset[str]] = []
    bag_nbrs: list[set[str]] = []  # 消去時点の近傍(親決定用)
    remaining = set(nbrs)
    while remaining:
        v = min(remaining, key=lambda x: (fills[x], len(nbrs[x]), x))
        ns = set(nbrs[v])
        order.append(v)
        bags.append(frozenset({v} | ns))
        bag_nbrs.append(ns)
        for a in ns:
            nbrs[a] |= ns - {a}
            nbrs[a].discard(v)
        del nbrs[v]
        remaining.discard(v)
        # fill 値が変わりうるのは近傍とその近傍だけ
        dirty = set(ns)
        for a in ns:
            dirty |= nbrs[a]
        for a in dirty & remaining:
            fills[a] = fill_count(a)

    # 消去順による木(forest)を作り、root ノードを含む bag へ根を付け替える
    pos = {v: i for i, v in enumerate(order)}
    tree_adj: list[set[int]] = [set() for _ in bags]
    for i, ns in enumerate(bag_nbrs):
        if ns:
            p = pos[min(ns, key=lambda a: pos[a])]
            tree_adj[i].add(p)
            tree_adj[p].add(i)

    root_bag = min(i for i, b in enumerate(bags) if root in b)
    parent = [-1] * len(bags)
    seen = {root_bag}
    stack = [root_bag]
    while stack:
        i = stack.pop()
        for j in tree_adj[i]:
            if j not in seen:
                seen.add(j)
                parent[j] = i
                stack.append(j)
    if len(seen) != len(bags):
        raise AssertionError("decomposition tree is not connected")  # 連結グラフでは起きない

    width = max(len(b) for b in bags) - 1
    return TreeDecomposition(
        bags=tuple(bags), parent=tuple(parent), root_bag=root_bag, width=width
    )


def verify(
    adj: dict[str, frozenset[str]], td: TreeDecomposition, root: str | None = None
) -> list[str]:
    """木分解の3条件を検証し、問題点のリストを返す(空なら妥当)。"""
    problems: list[str] = []
    n_bags = len(td.bags)

    # 親配列が根 root_bag の木であること
    if not 0 <= td.root_bag < n_bags:
        problems.append("root_bag out of range")
    elif td.parent[td.root_bag] != -1:
        problems.append("root_bag has a parent")
    if sum(1 for p in td.parent if p == -1) != 1:
        problems.append("parent array has multiple roots")
    if root is not None and root not in td.bags[td.root_bag]:
        problems.append("root node not in root_bag")

    # (1) 全頂点被覆
    covered: set[str] = set()
    for b in td.bags:
        covered |= b
    missing = set(adj) - covered
    if missing:
        problems.append(f"vertices not covered: {sorted(missing)[:5]}...")

    # (2) 全辺被覆
    for u, ns in adj.items():
        for v in ns:
            if u < v and not any(u in b and v in b for b in td.bags):
                problems.append(f"edge not covered: {u}-{v}")

    # (3) running intersection: 各頂点を含む bag 集合が分解木上で連結
    #     連結 ⇔ (bag数) - (親子とも当該頂点を含む木辺数) == 1
    bags_of: dict[str, list[int]] = {}
    for i, b in enumerate(td.bags):
        for v in b:
            bags_of.setdefault(v, []).append(i)
    for v, idxs in bags_of.items():
        edges = sum(1 for i in idxs if td.parent[i] != -1 and v in td.bags[td.parent[i]])
        if len(idxs) - edges != 1:
            problems.append(f"running intersection violated for {v}")

    if td.width != max(len(b) for b in td.bags) - 1:
        problems.append("width mismatch")
    return problems
