"""解の妥当性検証。

ソルバーの「最適性証明」は渡したモデルに対するものでしかないため、
返ってきた解が元の問題の実行可能解であることを必ず独立に確認する。
"""

from __future__ import annotations

from .graph import AtlasGraph, reachable_from
from .result import SolveResult


def validate(g: AtlasGraph, result: SolveResult, terminals, excluded=()) -> list[str]:
    """問題点のリストを返す(空なら妥当)。"""
    problems: list[str] = []
    sel = set(result.nodes)
    excluded = set(excluded)
    wanted = set(terminals) - {g.root}

    if g.root not in sel:
        problems.append("root not in solution")

    hit = sel & excluded
    if hit:
        problems.append(f"solution contains excluded nodes: {sorted(hit)}")

    ignored = set(result.ignored_terminals)
    missing = wanted - ignored - sel
    if missing:
        problems.append(f"terminals missing from solution: {sorted(missing)}")

    # 無視されたterminalは本当に到達不能か(過剰に無視していないか)
    reachable = reachable_from(g.adj, g.root, banned=frozenset(excluded))
    bogus = {t for t in ignored if t in reachable and t not in excluded}
    if bogus:
        problems.append(f"terminals ignored despite being reachable: {sorted(bogus)}")

    # 連結性: 選択ノードの誘導部分グラフ上で root から全選択ノードに届くか
    banned = frozenset(set(g.adj) - sel)
    if sel and reachable_from(g.adj, g.root, banned=banned) != sel:
        problems.append("solution is not connected")

    expected_points = sum(g.cost(n) for n in sel)
    if result.points != expected_points:
        problems.append(f"points mismatch: reported {result.points}, recomputed {expected_points}")

    return problems
