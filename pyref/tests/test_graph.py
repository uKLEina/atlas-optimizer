from atlasopt import ROOT_ID
from atlasopt.graph import reachable_from


def test_shape(g):
    # data.json (3.29) の実測値。リーグ更新でdata.jsonを差し替えたら要更新
    assert len(g.adj) == 903
    assert sum(len(s) for s in g.adj.values()) // 2 == 1003
    assert len(g.mastery_notables) == 126


def test_root(g):
    assert g.root == ROOT_ID
    assert g.cost(g.root) == 0
    assert all(g.cost(n) == 1 for n in g.adj if n != g.root)
    assert g.info[g.root].get("name", "") == ""  # スタートノードは名前空


def test_all_reachable(g):
    assert reachable_from(g.adj, g.root) == set(g.adj)


def test_no_masteries_or_pseudo_root(g):
    assert "root" not in g.adj
    assert not any(g.info[n].get("isMastery") for n in g.adj)


def test_adjacency_symmetric(g):
    for u, nbrs in g.adj.items():
        for v in nbrs:
            assert u in g.adj[v]
            assert u != v


def test_mastery_notables(g):
    # Bestiary グループの例: Notable 5個(データ確認済みの実測値)
    import json

    from atlasopt.graph import _default_data

    raw = json.loads(_default_data().read_text())
    bestiary = next(
        k for k, v in raw["nodes"].items() if v.get("isMastery") and v["name"] == "Bestiary"
    )
    notables = g.mastery_notables[bestiary]
    assert len(notables) == 5
    assert all(g.info[n].get("isNotable") for n in notables)
    # Notableを持たないmasteryグループは7つ(DESIGN.md)
    assert sum(1 for v in g.mastery_notables.values() if not v) == 7
