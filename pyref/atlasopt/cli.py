"""コマンドラインインターフェース。

  python -m atlasopt solve --terminals 45343,Endless\\ Tide --exclude 12345
  python -m atlasopt bench
"""

from __future__ import annotations

import argparse
import random
import sys

from . import dp, export, graph, ilp_naive, ilp_reduced
from .validate import validate


def _resolve(g: graph.AtlasGraph, tokens: list[str]) -> list[str]:
    """ノードIDまたは完全一致の名前をIDへ解決する。"""
    by_name: dict[str, list[str]] = {}
    for nid, nd in g.info.items():
        by_name.setdefault(nd.get("name", ""), []).append(nid)
    out = []
    for tok in tokens:
        tok = tok.strip()
        if not tok:
            continue
        if tok in g.adj:
            out.append(tok)
        elif tok in by_name:
            hits = by_name[tok]
            if len(hits) > 1:
                sys.exit(f"name '{tok}' is ambiguous: {hits} — use an id")
            out.append(hits[0])
        else:
            sys.exit(f"unknown node id or name: '{tok}'")
    return out


def _cmd_solve(args) -> None:
    g = graph.load(args.data)
    # 既定は木分解 DP(フェーズ3)。ILP 2種は照合オラクルとして残す
    solver = {"dp": dp, "reduced": ilp_reduced, "naive": ilp_naive}[args.solver]
    terminals = _resolve(g, args.terminals.split(","))
    excluded = _resolve(g, args.exclude.split(",")) if args.exclude else []

    res = solver.solve(g, terminals, excluded, time_limit=args.time_limit)
    problems = validate(g, res, terminals, excluded)
    if problems:
        sys.exit("INVALID SOLUTION (implementation bug): " + "; ".join(problems))

    print(f"status: {res.status}  points: {res.points}  ({res.solve_time:.2f}s)")
    if res.status != "optimal":
        print(f"  (not proven optimal; lower bound {res.dual_bound:.1f})")
    for t in res.ignored_terminals:
        print(f"ignored (unreachable): {t} {g.info[t].get('name', '')}")
    for nid in sorted(res.nodes, key=int):
        nd = g.info[nid]
        mark = "*" if nid in terminals else " "
        print(f"  {mark} {nid:>6} {nd.get('name', '')}")
    print(export.encode_url(res.nodes))


def _cmd_bench(args) -> None:
    g = graph.load(args.data)
    notables = sorted(n for n, d in g.info.items() if d.get("isNotable"))
    rng = random.Random(42)
    from .decomposition import build_decomposition

    td = build_decomposition(g.adj, g.root)
    for k in (10, 20, 30, 40, 50, 60):
        terms = rng.sample(notables, k)
        res = dp.solve(g, terms, td=td)
        res_ilp = ilp_reduced.solve(g, terms, time_limit=args.time_limit)
        assert not validate(g, res, terms), "bench produced invalid solution"
        assert res.points == res_ilp.points, f"dp/ilp mismatch at K={k}"
        print(
            f"K={k:2d}  points={res.points:3d}  dp={res.solve_time:5.2f}s"
            f"  ilp={res_ilp.solve_time:5.2f}s"
        )


def main(argv=None) -> None:
    p = argparse.ArgumentParser(prog="atlasopt")
    p.add_argument("--data", default=None, help="data.json のパス(省略時はリポジトリ直下)")
    sub = p.add_subparsers(dest="cmd", required=True)

    ps = sub.add_parser("solve", help="指定ノードを含む最小ポイント配置を求める")
    ps.add_argument("--terminals", required=True, help="カンマ区切りのノードID/名前")
    ps.add_argument("--exclude", default="", help="除外ノード(カンマ区切り)")
    ps.add_argument("--solver", choices=("dp", "reduced", "naive"), default="dp")
    ps.add_argument("--time-limit", type=float, default=60.0)
    ps.set_defaults(func=_cmd_solve)

    pb = sub.add_parser("bench", help="DESIGN.md のベンチ表を再現する")
    pb.add_argument("--time-limit", type=float, default=60.0)
    pb.set_defaults(func=_cmd_bench)

    args = p.parse_args(argv)
    args.func(args)


if __name__ == "__main__":
    main()
