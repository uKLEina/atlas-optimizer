#!/usr/bin/env python
"""乱数照合ハーネス — 4層の照合ピラミッドで ilp_reduced と dp の正しさを検証する。

  ball : 小部分グラフ上で 全列挙 vs DW vs reduced(3実装一致)
  dw   : 全グラフ・terminal 1〜7 で DW vs reduced(値と無視リスト)
  naive: terminal 8〜12 で naive(証明付き) vs reduced
  large: terminal 15〜60。validate + 不変量 + naiveのdual/incumbent区間チェック

全 tier で木分解 DP(atlasopt.dp)も解き、points と無視リストの一致を照合する
(フェーズ3 ステージ3 の品質ゲート)。large ではタイブレーク重み付き DP の
ポイント不変も確認する。

全ケースで validate() による実行可能性検証を行う。乱択で除外設定も混ぜる。
ケースは互いに独立で、`--jobs` でプロセス並列に実行できる。ケースごとの乱数は
"{seed}:{index}" から導出するため、並列度によらず再現可能。

使い方:  python fuzz.py --cases 100 --seed 0 --jobs 8
"""

from __future__ import annotations

import argparse
import os
import random
import sys
import time
from concurrent.futures import ProcessPoolExecutor, as_completed

from atlasopt import dp, ilp_naive, ilp_reduced, load
from atlasopt.brute import bfs_ball, dreyfus_wagner, enumerate_exact
from atlasopt.decomposition import build_decomposition
from atlasopt.graph import AtlasGraph
from atlasopt.validate import validate

TIERS = {"ball": 0.20, "dw": 0.45, "naive": 0.08, "large": 0.27}

_g: AtlasGraph | None = None  # ワーカープロセスごとに1回だけロードする
_td = None  # 木分解(グラフにのみ依存するのでワーカーごとに1回)
_args = None


def _init_worker(data_path, args) -> None:
    global _g, _td, _args
    _g = load(data_path)
    _td = build_decomposition(_g.adj, _g.root)
    _args = args


def check_dp(g, td, errs, terms, excluded, expect_points, expect_ignored):
    """木分解 DP が既知の最適値・無視リストと一致することを確認する。"""
    res = dp.solve(g, terms, excluded=excluded, td=td)
    check_valid(g, errs, res, terms, excluded)
    if res.status != "optimal" or res.points != expect_points:
        errs.append(f"dp={res.points}/{res.status} expected points={expect_points}")
    if tuple(res.ignored_terminals) != tuple(expect_ignored):
        errs.append(f"dp ignored={res.ignored_terminals} expected {tuple(expect_ignored)}")


def check_valid(g, errs, res, terms, excluded=()):
    problems = validate(g, res, terms, excluded)
    if problems:
        errs.append(f"invalid solution: {problems}")


def pick_excluded(g, rng, prob):
    if rng.random() >= prob:
        return []
    return rng.sample(sorted(set(g.adj) - {g.root}), rng.randint(1, 15))


def run_ball(g, rng, errs):
    adj = bfs_ball(g, g.root, rng.randint(12, 20))
    sub = AtlasGraph(adj=adj, info={n: {} for n in adj}, mastery_notables={}, root=g.root)
    terms = rng.sample(sorted(set(adj) - {g.root}), rng.randint(1, 4))
    v_enum = enumerate_exact(adj, g.root, terms)
    v_dw, _ = dreyfus_wagner(sub, terms)
    res = ilp_reduced.solve(sub, terms)
    check_valid(sub, errs, res, terms)
    if res.status != "optimal" or not (v_enum == v_dw == res.points):
        errs.append(f"enum={v_enum} dw={v_dw} reduced={res.points}/{res.status} terms={terms}")
    check_dp(sub, build_decomposition(sub.adj, sub.root), errs, terms, (), v_enum, ())


def run_dw(g, rng, errs):
    nodes = sorted(set(g.adj) - {g.root})
    terms = rng.sample(nodes, rng.randint(1, 7))
    excluded = pick_excluded(g, rng, 0.5)
    v_dw, ignored_dw = dreyfus_wagner(g, terms, excluded)
    res = ilp_reduced.solve(g, terms, excluded)
    check_valid(g, errs, res, terms, excluded)
    if res.status != "optimal" or res.points != v_dw or res.ignored_terminals != ignored_dw:
        errs.append(
            f"dw={v_dw}/{ignored_dw} reduced={res.points}/{res.ignored_terminals}"
            f"/{res.status} terms={terms} excl={excluded}"
        )
    check_dp(g, _td, errs, terms, excluded, v_dw, ignored_dw)


def run_naive(g, rng, errs, time_limit):
    nodes = sorted(set(g.adj) - {g.root})
    terms = rng.sample(nodes, rng.randint(8, 12))
    excluded = pick_excluded(g, rng, 0.3)
    res = ilp_reduced.solve(g, terms, excluded)
    check_valid(g, errs, res, terms, excluded)
    ref = ilp_naive.solve(g, terms, excluded, time_limit=time_limit)
    if res.status != "optimal":
        errs.append(f"reduced not optimal: {res.status}")
    elif res.ignored_terminals != ref.ignored_terminals:
        errs.append(f"ignored mismatch: {res.ignored_terminals} vs {ref.ignored_terminals}")
    elif ref.status == "optimal":
        if res.points != ref.points:
            errs.append(f"naive={ref.points} reduced={res.points} terms={terms} excl={excluded}")
    elif not (ref.dual_bound - 1e-6 <= res.points <= ref.points):
        errs.append(f"reduced={res.points} outside naive [{ref.dual_bound}, {ref.points}]")
    if res.status == "optimal":
        check_dp(g, _td, errs, terms, excluded, res.points, res.ignored_terminals)


def run_large(g, rng, errs, time_limit):
    nodes = sorted(set(g.adj) - {g.root})
    terms = rng.sample(nodes, rng.randint(15, 60))
    excluded = pick_excluded(g, rng, 0.5)
    res = ilp_reduced.solve(g, terms, excluded)
    check_valid(g, errs, res, terms, excluded)
    if res.status != "optimal":
        errs.append(f"reduced not optimal: {res.status}")
        return
    # 不変量1: terminalの順序を変えても同値
    shuffled = terms[:]
    rng.shuffle(shuffled)
    res2 = ilp_reduced.solve(g, shuffled, excluded)
    if res2.points != res.points:
        errs.append(f"order dependence: {res.points} vs {res2.points}")
    # 不変量2: 解に含まれるノードをterminalに追加しても同値
    if len(res.nodes) > 1:
        extra = rng.choice(sorted(res.nodes - {g.root}))
        res3 = ilp_reduced.solve(g, [*terms, extra], excluded)
        if res3.points != res.points:
            errs.append(f"adding selected node {extra} changed points: {res.points}->{res3.points}")
    # naiveの区間 [dual, incumbent] に入っているか
    ref = ilp_naive.solve(g, terms, excluded, time_limit=time_limit)
    if ref.status == "optimal" and res.points != ref.points:
        errs.append(f"naive={ref.points} reduced={res.points}")
    elif ref.status == "feasible" and not (ref.dual_bound - 1e-6 <= res.points <= ref.points):
        errs.append(f"reduced={res.points} outside naive [{ref.dual_bound}, {ref.points}]")
    # DP 照合 + タイブレーク重み付きでもポイント不変
    check_dp(g, _td, errs, terms, excluded, res.points, res.ignored_terminals)
    weights = {n: rng.choice([0, 1, 3, 7]) for n in nodes}
    res_w = dp.solve(g, terms, excluded=excluded, node_weights=weights, td=_td)
    check_valid(g, errs, res_w, terms, excluded)
    if res_w.points != res.points:
        errs.append(f"weighted dp changed points: {res.points} -> {res_w.points}")


def run_case(index: int, seed: int) -> tuple[int, str, list[str]]:
    g = _g
    rng = random.Random(f"{seed}:{index}")
    tier = rng.choices(list(TIERS), weights=list(TIERS.values()))[0]
    errs: list[str] = []
    try:
        if tier == "ball":
            run_ball(g, rng, errs)
        elif tier == "dw":
            run_dw(g, rng, errs)
        elif tier == "naive":
            run_naive(g, rng, errs, _args.naive_limit)
        else:
            run_large(g, rng, errs, _args.large_naive_limit)
    except Exception as e:  # ハーネス自体の例外も失敗として報告する
        errs.append(f"exception: {type(e).__name__}: {e}")
    return index, tier, errs


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--cases", type=int, default=100)
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--data", default=None)
    ap.add_argument("--jobs", type=int, default=max(1, (os.cpu_count() or 2) - 2))
    ap.add_argument("--naive-limit", type=float, default=90.0)
    ap.add_argument("--large-naive-limit", type=float, default=15.0)
    args = ap.parse_args()

    t0 = time.time()
    counts: dict[str, int] = {}
    failures: list[str] = []
    done = 0

    def collect(index, tier, errs):
        nonlocal done
        done += 1
        counts[tier] = counts.get(tier, 0) + 1
        print(f"[{done}/{args.cases}] case{index} {tier}" + ("" if not errs else "  FAIL"))
        for e in errs:
            failures.append(f"case{index}({tier},seed={args.seed}): {e}")
            print(f"    {e}")

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

    print(f"\n{args.cases} cases in {time.time() - t0:.0f}s  jobs={args.jobs}  tiers={counts}")
    if failures:
        print(f"{len(failures)} FAILURES:")
        for f_ in failures:
            print(" ", f_)
        sys.exit(1)
    print("all OK")


if __name__ == "__main__":
    main()
