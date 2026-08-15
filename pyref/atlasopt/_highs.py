"""highspy の薄いラッパー(2つの定式化で共通の部品)。"""

from __future__ import annotations

import highspy

INF = highspy.kHighsInf


def new_model(time_limit: float) -> highspy.Highs:
    h = highspy.Highs()
    h.setOptionValue("output_flag", False)
    h.setOptionValue("time_limit", float(time_limit))
    return h


def add_vars(h, costs, uppers, n_integer):
    """先頭 n_integer 個をバイナリ/整数、残りを連続変数として追加する。"""
    n = len(costs)
    h.addVars(n, [0.0] * n, list(uppers))
    h.changeColsCost(n, list(range(n)), [float(c) for c in costs])
    kinds = [highspy.HighsVarType.kInteger] * n_integer + [
        highspy.HighsVarType.kContinuous
    ] * (n - n_integer)
    h.changeColsIntegrality(n, list(range(n)), kinds)


def status_of(h) -> str:
    st = h.getModelStatus()
    if st == highspy.HighsModelStatus.kOptimal:
        return "optimal"
    if st == highspy.HighsModelStatus.kInfeasible:
        return "infeasible"
    return "feasible"  # time limit 等。呼び出し側で dual_bound と併せて判断する
