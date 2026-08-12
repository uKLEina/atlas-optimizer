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
