"""木分解上の辞書式 Steiner DP(フェーズ3 ステージ2。設計は DESIGN.md 設計メモ)。

ルート付き・ノード重み Steiner 木を、静的な木分解(decomposition.build_decomposition)
の上で厳密に解く。DP の値は (points, eps) の辞書式ペアなので、ポイント最小化と
タイブレークが1パスで両方とも大域厳密に決まる。計算量は terminal 数に依存しない。

nice 化: 各 bag ノードを leaf / introduce / forget / join の列に正規化する。
状態: bag 内各頂点の割当(-1 = 非選択 / ブロックid = 選択)。ブロックidは
出現順で正規化した canonical 形。値 = その部分木で確定した辞書式最小コスト。

連結性の保証: forget でブロック唯一の頂点が消える状態は棄却する(その成分は以後
どの頂点とも併合できず root に繋がれない)。root は根 bag(root_bag)に属し
分解木の頂上まで忘れられないため、根 bag で「ブロックがちょうど1個」の状態だけが
連結な解に対応する。

決定性: nice 化の頂点順・状態の反復順・同値コストの先勝ちがすべて固定なので、
同一入力は同一解を返す。
"""

from __future__ import annotations

import time
from dataclasses import dataclass

from .decomposition import TreeDecomposition, build_decomposition
from .graph import AtlasGraph, reachable_from
from .result import SolveResult

Cost = tuple[int, float]  # (points, eps) 辞書式


@dataclass
class _Nice:
    kind: str  # "leaf" | "intro" | "forget" | "join"
    bag: tuple[str, ...]  # 昇順
    children: tuple[int, ...]
    v: str | None = None  # intro/forget の対象頂点


def _build_nice(td: TreeDecomposition) -> tuple[list[_Nice], int]:
    """rooted bag 木を nice 木(子が先に並ぶ配列)へ変換し、根 index を返す。"""
    children: dict[int, list[int]] = {}
    for i, p in enumerate(td.parent):
        if p >= 0:
            children.setdefault(p, []).append(i)
    for lst in children.values():
        lst.sort()

    nice: list[_Nice] = []

    def add(kind: str, bag: tuple[str, ...], ch: tuple[int, ...], v: str | None = None) -> int:
        nice.append(_Nice(kind, bag, ch, v))
        return len(nice) - 1

    # 反復的 post-order(木の縦深さが900級なので再帰は使わない)
    order: list[int] = []
    stack = [td.root_bag]
    while stack:
        i = stack.pop()
        order.append(i)
        stack.extend(children.get(i, []))
    order.reverse()

    result_of: dict[int, int] = {}
    for i in order:
        target = tuple(sorted(td.bags[i]))
        parts: list[int] = []
        for c in children.get(i, []):
            idx = result_of[c]
            cur = set(td.bags[c])
            for v in sorted(td.bags[c] - td.bags[i]):
                cur.discard(v)
                idx = add("forget", tuple(sorted(cur)), (idx,), v)
            for v in sorted(td.bags[i] - td.bags[c]):
                cur.add(v)
                idx = add("intro", tuple(sorted(cur)), (idx,), v)
            parts.append(idx)
        if not parts:
            idx = add("leaf", (), ())
            cur = set()
            for v in target:
                cur.add(v)
                idx = add("intro", tuple(sorted(cur)), (idx,), v)
            parts = [idx]
        acc = parts[0]
        for other in parts[1:]:
            acc = add("join", target, (acc, other))
        result_of[i] = acc
    return nice, result_of[td.root_bag]


def _normalize(labels: list[int]) -> tuple[int, ...]:
    """ブロックidを出現順 0,1,2,… に振り直す(-1 は非選択のまま)。"""
    mapping: dict[int, int] = {}
    out = []
    for x in labels:
        if x < 0:
            out.append(-1)
        else:
            if x not in mapping:
                mapping[x] = len(mapping)
            out.append(mapping[x])
    return tuple(out)


def solve(
    g: AtlasGraph,
    terminals,
    excluded=(),
    time_limit: float = 60.0,  # 互換のため受けるが DP は決定的高速なので未使用
    node_weights=None,
    td: TreeDecomposition | None = None,
) -> SolveResult:
    node_weights = dict(node_weights or {})
    if node_weights and min(node_weights.values()) < 0.0:
        raise ValueError("node_weights must be non-negative")
    wt = node_weights.get
    excluded = frozenset(excluded)
    if g.root in excluded:
        raise ValueError("start node cannot be excluded")
    unknown = (set(terminals) | set(excluded)) - set(g.adj)
    if unknown:
        raise ValueError(f"unknown or non-allocatable node ids: {sorted(unknown)}")

    reachable = reachable_from(g.adj, g.root, banned=excluded)
    wanted = set(terminals) - {g.root}
    ignored = tuple(sorted(t for t in wanted if t in excluded or t not in reachable))
    terms = frozenset(wanted - set(ignored))
    if not terms:
        return SolveResult(0, frozenset({g.root}), "optimal", 0.0, ignored)

    t0 = time.time()
    td = td or build_decomposition(g.adj, g.root)
    nice, root_idx = _build_nice(td)
    forced = terms | {g.root}

    def vcost(v: str) -> Cost:
        return (0, 0.0) if v == g.root else (1, float(wt(v, 0.0)))

    # tables[i]: 状態key(正規化ラベルtuple) → (cost, back)
    # back: intro → (childKey, selected) / forget → childKey / join → (lKey, rKey)
    tables: list[dict[tuple[int, ...], tuple[Cost, object]]] = [dict() for _ in nice]

    for i, node in enumerate(nice):
        table = tables[i]
        if node.kind == "leaf":
            table[()] = ((0, 0.0), None)
            continue

        if node.kind == "intro":
            v = node.v
            assert v is not None
            (ci,) = node.children
            child_bag = nice[ci].bag
            pv = node.bag.index(v)
            nbr_pos = [
                p for p, u in enumerate(node.bag) if u != v and u in g.adj[v]
            ]
            selectable = v not in excluded and v in reachable
            for ck, (cc, _) in tables[ci].items():
                # 子 bag のラベル列に v の位置を差し込む
                base = list(ck[:pv]) + [-2] + list(ck[pv:])  # -2 = プレースホルダ
                if v not in forced:
                    base_ns = base.copy()
                    base_ns[pv] = -1
                    key = _normalize(base_ns)
                    prev = table.get(key)
                    cand = (cc, (ck, False))
                    if prev is None or cc < prev[0]:
                        table[key] = cand
                if selectable:
                    lab = base.copy()
                    new_id = max((x for x in lab if x >= 0), default=-1) + 1
                    lab[pv] = new_id
                    # v と隣接する選択済み頂点のブロックを併合(辺コストは無いので常に併合してよい)
                    merge = {lab[p] for p in nbr_pos if lab[p] >= 0}
                    if merge:
                        tgt = min(merge | {new_id})
                        lab = [tgt if (x in merge or x == new_id) else x for x in lab]
                    key = _normalize(lab)
                    cost = (cc[0] + vcost(v)[0], cc[1] + vcost(v)[1])
                    prev = table.get(key)
                    if prev is None or cost < prev[0]:
                        table[key] = (cost, (ck, True))
            continue

        if node.kind == "forget":
            v = node.v
            assert v is not None
            (ci,) = node.children
            child_bag = nice[ci].bag
            pv = child_bag.index(v)
            for ck, (cc, _) in tables[ci].items():
                lbl = ck[pv]
                if lbl >= 0 and sum(1 for x in ck if x == lbl) == 1:
                    continue  # ブロック唯一の頂点を忘れる = その成分は root に繋がれない
                key = _normalize([x for p, x in enumerate(ck) if p != pv])
                prev = table.get(key)
                if prev is None or cc < prev[0]:
                    table[key] = (cc, ck)
            continue

        # join
        li, ri = node.children
        bag = node.bag
        by_mask: dict[tuple[bool, ...], list[tuple[tuple[int, ...], Cost]]] = {}
        for rk, (rc, _) in tables[ri].items():
            mask = tuple(x >= 0 for x in rk)
            by_mask.setdefault(mask, []).append((rk, rc))
        for lk, (lc, _) in tables[li].items():
            mask = tuple(x >= 0 for x in lk)
            partners = by_mask.get(mask)
            if not partners:
                continue
            dp_pts = sum(vcost(u)[0] for p, u in enumerate(bag) if mask[p])
            dp_eps = sum(vcost(u)[1] for p, u in enumerate(bag) if mask[p])
            for rk, rc in partners:
                # 位置 union-find でブロック併合
                parent = list(range(len(bag)))

                def find(x: int) -> int:
                    while parent[x] != x:
                        parent[x] = parent[parent[x]]
                        x = parent[x]
                    return x

                for key2 in (lk, rk):
                    first: dict[int, int] = {}
                    for p, x in enumerate(key2):
                        if x >= 0:
                            if x in first:
                                ra, rb = find(first[x]), find(p)
                                if ra != rb:
                                    parent[rb] = ra
                            else:
                                first[x] = p
                lab = [find(p) if mask[p] else -1 for p in range(len(bag))]
                key = _normalize(lab)
                cost = (lc[0] + rc[0] - dp_pts, lc[1] + rc[1] - dp_eps)
                prev = table.get(key)
                if prev is None or cost < prev[0]:
                    table[key] = (cost, (lk, rk))

    # 根 bag: ブロックがちょうど1個の状態が連結解。root は forced なので必ずそのブロックに居る
    root_table = tables[root_idx]
    best_key = None
    best_cost: Cost | None = None
    for key, (cost, _) in root_table.items():
        blocks = {x for x in key if x >= 0}
        if len(blocks) != 1:
            continue
        if best_cost is None or cost < best_cost:
            best_cost = cost
            best_key = key
    if best_key is None:
        # terminal が到達不能なら ignored 済みのため、ここには来ないはず
        return SolveResult(-1, frozenset(), "infeasible", 0.0, ignored, time.time() - t0)

    # バックポインタを辿って選択ノードを復元
    nodes: set[str] = set()
    stack2: list[tuple[int, tuple[int, ...]]] = [(root_idx, best_key)]
    while stack2:
        i, key = stack2.pop()
        node = nice[i]
        back = tables[i][key][1]
        if node.kind == "leaf":
            continue
        if node.kind == "intro":
            ck, selected = back  # type: ignore[misc]
            if selected:
                nodes.add(node.v)  # type: ignore[arg-type]
            stack2.append((node.children[0], ck))
        elif node.kind == "forget":
            stack2.append((node.children[0], back))  # type: ignore[arg-type]
        else:  # join
            lk, rk = back  # type: ignore[misc]
            stack2.append((node.children[0], lk))
            stack2.append((node.children[1], rk))

    return SolveResult(
        points=len(nodes) - 1,
        nodes=frozenset(nodes),
        status="optimal",
        dual_bound=float(len(nodes) - 1),
        ignored_terminals=ignored,
        solve_time=time.time() - t0,
    )
