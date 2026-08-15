#!/usr/bin/env python
"""TS版照合用のケース+期待値生成器 — fuzz ピラミッドの越境版。

検証済みの pyref ilp_reduced をオラクルとして points / ignored_terminals を焼き込み、
さらに pyref DP(決定的)のノード集合も焼き込む。TS 側は
`cd web && CROSSCHECK_CASES=<file> npm run crosscheck` で、TS DP が
points / ignored の一致に加えて**ノード集合単位で pyref DP と完全一致**することを
検証する(DP は両実装とも決定的なため集合一致まで要求できる)。

- ケースごとの乱数は "{seed}:{index}" から導出(fuzz.py と同じ。並列度によらず再現可能)
- 期待値として使えるのは最適性証明付きの解のみ。time limit 等で証明できなかった
  ケースは出力から除外し、meta.skipped に記録する
- 先頭に決定的なエッジケース(空 terminals / root 指定 / 除外 terminal / 到達不能)を置く

使い方:  python crosscheck.py --cases 100 --seed 0 --out ../web/tests/fixtures/crosscheck.json
"""

from __future__ import annotations

import argparse
import datetime
import json
import os
import random
import sys
import time
from concurrent.futures import ProcessPoolExecutor, as_completed

from atlasopt import dp, ilp_reduced, load
from atlasopt.decomposition import build_decomposition
from atlasopt.graph import AtlasGraph
from atlasopt.validate import validate

# terminal 数の分布(fuzz.py の dw/naive/large tier の規模を踏襲)
SIZES = (((1, 7), 0.45), ((8, 14), 0.20), ((15, 60), 0.35))

# 決定的なエッジケース: (terminals, excluded)
SPECIALS = (
    ((), ()),  # 空 terminals
    (("29045",), ()),  # root を terminal 指定(黙って落ちる仕様)
    (("58043",), ("58043",)),  # terminal 自身を除外 → ignored
    (("58043",), ("47488",)),  # 唯一の隣を除外して到達不能 → ignored
)

_g: AtlasGraph | None = None
_td = None
_args = None


def _init_worker(data_path, args) -> None:
    global _g, _td, _args
    _g = load(data_path)
    _td = build_decomposition(_g.adj, _g.root)
    _args = args


def _solve_case(g, td, terms, excluded, time_limit):
    """1ケースを解いて出力用 dict を返す。非最適なら None、オラクル異常なら例外。"""
    res = ilp_reduced.solve(g, terms, excluded, time_limit=time_limit)
    problems = validate(g, res, terms, excluded)
    if problems:
        raise AssertionError(f"oracle produced invalid solution: {problems}")
    if res.status != "optimal":
        return None
    # DP(決定的)のノード集合も期待値に焼き込む。ILP オラクルとの一致は生成時に検証
    res_dp = dp.solve(g, terms, excluded=excluded, td=td)
    problems = validate(g, res_dp, terms, excluded)
    if problems:
        raise AssertionError(f"dp produced invalid solution: {problems}")
    if res_dp.points != res.points or tuple(res_dp.ignored_terminals) != tuple(
        res.ignored_terminals
    ):
        raise AssertionError(
            f"dp/ilp mismatch: dp={res_dp.points} ilp={res.points} terms={terms}"
        )
    return {
        "terminals": list(terms),
        "excluded": list(excluded),
        "expected": {
            "points": res.points,
            "ignored": list(res.ignored_terminals),
            "dpNodes": sorted(res_dp.nodes),
        },
        "pyrefSolveTime": round(res.solve_time, 3),
    }


def run_case(index: int, seed: int):
    rng = random.Random(f"{seed}:{index}")
    lo, hi = rng.choices([s for s, _ in SIZES], weights=[w for _, w in SIZES])[0]
    nodes = sorted(set(_g.adj) - {_g.root})
    terms = rng.sample(nodes, rng.randint(lo, hi))
    excluded = []
    if rng.random() < 0.5:
        excluded = rng.sample(nodes, rng.randint(1, 15))
    return index, _solve_case(_g, _td, terms, excluded, _args.time_limit)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--cases", type=int, default=100)
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--data", default=None)
    ap.add_argument("--jobs", type=int, default=max(1, (os.cpu_count() or 2) - 2))
    ap.add_argument("--time-limit", type=float, default=60.0)
    ap.add_argument("--out", required=True)
    args = ap.parse_args()

    t0 = time.time()
    g = load(args.data)

    td = build_decomposition(g.adj, g.root)
    emitted = []
    for terms, excluded in SPECIALS:
        payload = _solve_case(g, td, terms, excluded, args.time_limit)
        assert payload is not None, "special case must be optimal"
        emitted.append(payload)

    skipped: list[int] = []
    results: dict[int, dict] = {}
    done = 0

    def collect(index, payload):
        nonlocal done
        done += 1
        if payload is None:
            skipped.append(index)
            print(f"[{done}/{args.cases}] case{index}  SKIP (not proven optimal)")
        else:
            results[index] = payload
            print(f"[{done}/{args.cases}] case{index}  K={len(payload['terminals'])}")

    if args.jobs <= 1:
        _init_worker(args.data, args)
        for i in range(args.cases):
            collect(*run_case(i, args.seed))
    else:
        with ProcessPoolExecutor(
            max_workers=args.jobs, initializer=_init_worker, initargs=(args.data, args)
        ) as pool:
            futs = [pool.submit(run_case, i, args.seed) for i in range(args.cases)]
            for fut in as_completed(futs):
                collect(*fut.result())

    emitted.extend(results[i] for i in sorted(results))
    for cid, case in enumerate(emitted):
        case["id"] = cid

    n_edges = sum(len(s) for s in g.adj.values()) // 2
    doc = {
        "meta": {
            "seed": args.seed,
            "requested": args.cases,
            "specials": len(SPECIALS),
            "emitted": len(emitted),
            "skipped": skipped,
            "dataNodes": len(g.adj),
            "dataEdges": n_edges,
            "generatedAt": datetime.date.today().isoformat(),
        },
        "cases": emitted,
    }
    with open(args.out, "w") as f:
        json.dump(doc, f, indent=1)
        f.write("\n")

    print(
        f"\n{len(emitted)} cases ({len(SPECIALS)} specials + {len(results)} random, "
        f"{len(skipped)} skipped) in {time.time() - t0:.0f}s -> {args.out}"
    )
    if skipped:
        print(f"skipped indices: {skipped}", file=sys.stderr)


if __name__ == "__main__":
    main()
