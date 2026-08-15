"""木分解 Steiner DP のテスト(フェーズ3 ステージ2)。

正しさの基準は既存の ilp_reduced(検証済みオラクル)との一致。
タイブレークは DP が大域厳密なので、ILP(ベストエフォート)以下の eps を出すこと。
"""

import random

import pytest

from atlasopt import dp
from atlasopt.decomposition import build_decomposition
from atlasopt.graph import AtlasGraph
from atlasopt.ilp_reduced import solve as ilp_solve
from atlasopt.validate import validate


@pytest.fixture(scope="module")
def td(g):
    return build_decomposition(g.adj, g.root)


def bfs_dist(g, target):
    dist = {g.root: 0}
    queue = [g.root]
    for cur in queue:
        for n in g.adj[cur]:
            if n not in dist:
                dist[n] = dist[cur] + 1
                queue.append(n)
    return dist[target]


def test_empty_terminals(g, td):
    res = dp.solve(g, [], td=td)
    assert res.points == 0
    assert res.nodes == frozenset({g.root})
    assert res.status == "optimal"


def test_single_terminal_equals_bfs(g, td):
    rng = random.Random(11)
    for t in rng.sample(sorted(set(g.adj) - {g.root}), 8):
        res = dp.solve(g, [t], td=td)
        assert res.status == "optimal"
        assert validate(g, res, [t]) == []
        assert res.points == bfs_dist(g, t)


def test_matches_ilp_on_random_cases(g, td):
    rng = random.Random(12)
    all_nodes = sorted(g.adj)
    for case in range(10):
        terms = rng.sample(all_nodes, rng.randint(1, 25))
        excluded = []
        if case % 3 == 0:
            excluded = [n for n in rng.sample(all_nodes, 5) if n != g.root and n not in terms]
        res_dp = dp.solve(g, terms, excluded=excluded, td=td)
        res_ilp = ilp_solve(g, terms, excluded=excluded)
        assert res_dp.status == "optimal"
        assert validate(g, res_dp, terms, excluded) == []
        assert res_dp.points == res_ilp.points, f"case {case}"
        assert res_dp.ignored_terminals == res_ilp.ignored_terminals


def test_tiebreak_exact_on_random_cases(g, td):
    # DP のタイブレークは大域厳密なので、任意の重みで ILP(ベストエフォート)以下の eps
    rng = random.Random(13)
    all_nodes = sorted(g.adj)
    weights = {n: rng.choice([0, 1, 3, 7]) for n in all_nodes if n != g.root}

    def eps_of(nodes):
        return sum(weights.get(n, 0) for n in nodes)

    for _ in range(5):
        terms = rng.sample(all_nodes, rng.randint(2, 15))
        res_dp = dp.solve(g, terms, node_weights=weights, td=td)
        res_ilp = ilp_solve(g, terms, node_weights=weights)
        assert res_dp.points == res_ilp.points
        assert eps_of(res_dp.nodes) <= eps_of(res_ilp.nodes)


def test_diamond_tiebreak_exact():
    adj = {
        "r": frozenset({"a1", "b1"}),
        "a1": frozenset({"r", "a2"}),
        "a2": frozenset({"a1", "t"}),
        "b1": frozenset({"r", "b2"}),
        "b2": frozenset({"b1", "t"}),
        "t": frozenset({"a2", "b2"}),
    }
    g = AtlasGraph(adj=adj, info={n: {} for n in adj}, mastery_notables={}, root="r")
    res = dp.solve(g, ["t"], node_weights={"a1": 7, "a2": 7, "b1": 1, "b2": 1})
    assert res.points == 3
    assert res.nodes == frozenset({"r", "b1", "b2", "t"})
    res2 = dp.solve(g, ["t"], node_weights={"a1": 1, "a2": 1, "b1": 7, "b2": 7})
    assert res2.nodes == frozenset({"r", "a1", "a2", "t"})


def test_ignored_terminals(g, td):
    # 除外された terminal・到達不能になった terminal は無視される(reduction と同じ意味論)
    res = dp.solve(g, ["58043"], excluded=["58043"], td=td)
    assert res.ignored_terminals == ("58043",)
    assert res.points == 0
    res2 = dp.solve(g, ["58043"], excluded=["47488"], td=td)
    assert res2.ignored_terminals == ("58043",)


def test_deterministic(g, td):
    rng = random.Random(14)
    terms = rng.sample(sorted(g.adj), 12)
    r1 = dp.solve(g, terms, td=td)
    r2 = dp.solve(g, terms, td=td)
    assert r1.nodes == r2.nodes


def test_weight_validation(g, td):
    with pytest.raises(ValueError):
        dp.solve(g, ["58043"], node_weights={"58043": -1}, td=td)
