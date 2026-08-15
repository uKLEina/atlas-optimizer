import random
from collections import deque

import pytest

from atlasopt import ilp_naive, ilp_reduced
from atlasopt.brute import bfs_ball, dreyfus_wagner, enumerate_exact
from atlasopt.graph import AtlasGraph
from atlasopt.validate import validate


def bfs_dist(g, target):
    dist = {g.root: 0}
    q = deque([g.root])
    while q:
        c = q.popleft()
        for n in g.adj[c]:
            if n not in dist:
                dist[n] = dist[c] + 1
                q.append(n)
    return dist[target]


def test_empty_terminals(g):
    res = ilp_reduced.solve(g, [])
    assert res.points == 0
    assert res.nodes == frozenset({g.root})
    assert res.status == "optimal"


def test_single_terminal_equals_bfs_distance(g):
    # 単一terminalの最小ポイント数は(rootがコスト0なので)BFS距離に一致する
    rng = random.Random(1)
    for t in rng.sample(sorted(set(g.adj) - {g.root}), 12):
        res = ilp_reduced.solve(g, [t])
        assert res.status == "optimal"
        assert not validate(g, res, [t])
        assert res.points == bfs_dist(g, t), t


def test_reduced_matches_dreyfus_wagner(g):
    rng = random.Random(2)
    nodes = sorted(set(g.adj) - {g.root})
    for _ in range(5):
        terms = rng.sample(nodes, rng.randint(2, 6))
        res = ilp_reduced.solve(g, terms)
        dw_points, dw_ignored = dreyfus_wagner(g, terms)
        assert res.status == "optimal"
        assert not validate(g, res, terms)
        assert res.points == dw_points, terms
        assert res.ignored_terminals == dw_ignored


def test_reduced_matches_naive(g):
    rng = random.Random(3)
    notables = sorted(n for n, d in g.info.items() if d.get("isNotable"))
    terms = rng.sample(notables, 5)
    r1 = ilp_reduced.solve(g, terms)
    r2 = ilp_naive.solve(g, terms, time_limit=240.0)
    assert r1.status == "optimal"
    assert r2.status == "optimal"
    assert not validate(g, r2, terms)
    assert r1.points == r2.points


def test_exclusion_changes_solution(g):
    t = "58043"  # Endless Tide: 唯一の隣 47488 を経由する必要がある
    base = ilp_reduced.solve(g, [t])
    assert "47488" in base.nodes
    res = ilp_reduced.solve(g, [t], excluded=["47488"])
    assert res.ignored_terminals == (t,)
    assert res.points == 0  # terminalが無視され、何も取らない
    assert not validate(g, res, [t], excluded=["47488"])


def test_exclusion_forces_detour(g):
    # terminalへの経路上のノードを1つ除外しても、迂回があれば解ける(コストは同じか増える)
    rng = random.Random(4)
    nodes = sorted(set(g.adj) - {g.root})
    checked = 0
    while checked < 3:
        t = rng.choice(nodes)
        base = ilp_reduced.solve(g, [t])
        mid = [n for n in base.nodes if n not in (g.root, t)]
        if not mid:
            continue
        ex = rng.choice(sorted(mid, key=int))
        res = ilp_reduced.solve(g, [t], excluded=[ex])
        assert not validate(g, res, [t], excluded=[ex])
        if not res.ignored_terminals:
            assert res.status == "optimal"
            assert res.points >= base.points
        checked += 1


def test_ball_oracles_agree(g):
    # 小さい部分グラフ上で 全列挙 / DW / 縮約ILP の3実装が一致する
    adj = bfs_ball(g, g.root, 18)
    sub = AtlasGraph(adj=adj, info={n: {} for n in adj}, mastery_notables={}, root=g.root)
    rng = random.Random(5)
    nodes = sorted(set(adj) - {g.root})
    for _ in range(5):
        terms = rng.sample(nodes, rng.randint(1, 4))
        v_enum = enumerate_exact(adj, g.root, terms)
        v_dw, _ = dreyfus_wagner(sub, terms)
        res = ilp_reduced.solve(sub, terms)
        assert res.status == "optimal"
        assert v_enum == v_dw == res.points, terms


def test_root_adjacent_terminal_solves_exactly(g):
    # 全 terminal が root へ融合する縮約の早期リターン経路
    from atlasopt.ilp_reduced import solve

    nb = sorted(g.adj[g.root])[0]
    res = solve(g, [nb])
    assert res.status == "optimal"
    assert res.points == 1
    assert res.nodes == frozenset({g.root, nb})
