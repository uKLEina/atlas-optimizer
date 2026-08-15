"""タイブレーク(node_weights)のテスト。

ポイント最適性を絶対に壊さず、同点最適解の中の選好だけを変えることを確認する。
"""

import random

import pytest

from atlasopt.graph import AtlasGraph
from atlasopt.ilp_reduced import solve


def diamond() -> AtlasGraph:
    """root→t への同点2経路(a1-a2 / b1-b2)を持つ菱形グラフ。

    非terminalの次数2ノードは縮約で平行辺に潰れるため、
    同点チェーンの選択が縮約段階(eps込み比較)で正しく決まることも検証できる。
    """
    adj = {
        "r": frozenset({"a1", "b1"}),
        "a1": frozenset({"r", "a2"}),
        "a2": frozenset({"a1", "t"}),
        "b1": frozenset({"r", "b2"}),
        "b2": frozenset({"b1", "t"}),
        "t": frozenset({"a2", "b2"}),
    }
    return AtlasGraph(adj=adj, info={n: {} for n in adj}, mastery_notables={}, root="r")


def test_prefers_low_weight_route():
    g = diamond()
    res = solve(g, ["t"], node_weights={"a1": 7e-5, "a2": 7e-5, "b1": 1e-5, "b2": 1e-5})
    assert res.status == "optimal"
    assert res.points == 3
    assert res.nodes == frozenset({"r", "b1", "b2", "t"})
    # 重みを逆にすれば逆の経路が選ばれる
    res2 = solve(g, ["t"], node_weights={"a1": 1e-5, "a2": 1e-5, "b1": 7e-5, "b2": 7e-5})
    assert res2.nodes == frozenset({"r", "a1", "a2", "t"})


def test_no_weights_behaves_as_before():
    g = diamond()
    res = solve(g, ["t"])
    assert res.status == "optimal"
    assert res.points == 3


def test_points_unchanged_on_real_graph(g):
    # 実データ: 全ノードに重みを付けても points は無重み解と一致する(最適性保存)
    rnd = random.Random(7)
    terminals = [t for t in rnd.sample(sorted(g.adj), 8) if t != g.root]
    weights = {n: rnd.choice([0.0, 1e-5, 3e-5, 7e-5]) for n in g.adj if n != g.root}
    base = solve(g, terminals)
    weighted = solve(g, terminals, node_weights=weights)
    assert weighted.status == "optimal"
    assert weighted.points == base.points


def test_weight_validation():
    g = diamond()
    with pytest.raises(ValueError):
        solve(g, ["t"], node_weights={"a1": -1e-5})
    with pytest.raises(ValueError):
        solve(g, ["t"], node_weights={"a1": 0.6})
