"""木分解(min-fill)のテスト。フェーズ3 ステージ1。"""

import random

from atlasopt.decomposition import build_decomposition, verify


def _random_adj(rng: random.Random, n: int, p: float) -> dict[str, frozenset[str]]:
    """連結になるまで作り直す簡易ランダムグラフ(パス辺で連結を底上げ)。"""
    names = [f"n{i}" for i in range(n)]
    adj: dict[str, set[str]] = {v: set() for v in names}
    for i in range(n - 1):  # 連結の保証
        adj[names[i]].add(names[i + 1])
        adj[names[i + 1]].add(names[i])
    for i in range(n):
        for j in range(i + 2, n):
            if rng.random() < p:
                adj[names[i]].add(names[j])
                adj[names[j]].add(names[i])
    return {v: frozenset(ns) for v, ns in adj.items()}


def test_real_graph_decomposition(g):
    td = build_decomposition(g.adj, g.root)
    assert verify(g.adj, td, g.root) == []
    # CLAUDE.md の「treewidth ≤ 6」の実証。min-fill は上界なので ≤ 7 を許容しつつ実測を固定
    assert td.width <= 7
    assert len(td.bags) == len(g.adj)


def test_real_graph_deterministic(g):
    td1 = build_decomposition(g.adj, g.root)
    td2 = build_decomposition(g.adj, g.root)
    assert td1 == td2


def test_random_graphs_valid():
    rng = random.Random(0)
    for n, p in [(10, 0.2), (30, 0.1), (50, 0.05), (40, 0.3)]:
        adj = _random_adj(rng, n, p)
        td = build_decomposition(adj, "n0")
        assert verify(adj, td, "n0") == [], f"n={n} p={p}"


def test_path_and_cycle():
    path = {"a": frozenset("b"), "b": frozenset("ac"), "c": frozenset("b")}
    td = build_decomposition(path, "a")
    assert verify(path, td, "a") == []
    assert td.width == 1
    cycle = {
        "a": frozenset("bc"),
        "b": frozenset("ac"),
        "c": frozenset("ab"),
    }
    td = build_decomposition(cycle, "a")
    assert verify(cycle, td, "a") == []
    assert td.width == 2
