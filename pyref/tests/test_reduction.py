import random

import pytest

from atlasopt.reduction import build


def test_structure_invariants(g):
    rng = random.Random(0)
    all_nodes = sorted(g.adj)
    for _ in range(10):
        terms = rng.sample(all_nodes, rng.randint(1, 40))
        red = build(g, terms)
        S = red.graph
        assert g.root in S
        assert all(t in S for t in red.terminals)
        assert not red.ignored_terminals
        core = set(S.nodes)
        seen_internal: set[str] = set()
        for u, v, d in S.edges(data=True):
            assert d["w"] == len(d["path"])
            path = set(d["path"])
            assert len(path) == len(d["path"])  # 内部ノードは重複しない
            assert not path & core  # 内部ノードはコアに現れない
            assert not path & seen_internal  # 辺間でも重複しない
            seen_internal |= path


def test_excluded_terminal_is_ignored(g):
    t = "58043"  # Endless Tide
    red = build(g, [t], excluded=[t])
    assert red.ignored_terminals == (t,)
    assert red.terminals == ()


def test_unreachable_terminal_is_ignored(g):
    # Endless Tide (58043) は次数1で、唯一の隣 47488 を除外すると到達不能になる
    assert g.adj["58043"] == frozenset({"47488"})
    red = build(g, ["58043"], excluded=["47488"])
    assert red.ignored_terminals == ("58043",)


def test_root_terminal_is_dropped(g):
    red = build(g, [g.root])
    assert red.terminals == ()
    assert red.ignored_terminals == ()


def test_cannot_exclude_root(g):
    with pytest.raises(ValueError):
        build(g, ["58043"], excluded=[g.root])


def test_unknown_id_rejected(g):
    with pytest.raises(ValueError):
        build(g, ["999999"])


def test_adjacent_terminal_contraction(g):
    # 隣接する2つの terminal は1つの代表(最小id)へ潰れ、merged に成分が残る
    red = build(g, ["58043", "47488"])  # Endless Tide とその唯一の隣
    assert len(red.terminals) == 1
    rep = red.terminals[0]
    assert rep == min("58043", "47488")
    assert red.merged[rep] == frozenset({"58043", "47488"})


def test_terminals_merged_into_root(g):
    # root に隣接する terminal は root へ融合し、terminals は空になる
    nb = sorted(g.adj[g.root])[0]
    red = build(g, [nb])
    assert red.terminals == ()
    assert nb in red.merged[g.root]
