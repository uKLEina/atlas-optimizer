"""ソルバー共通の結果型。"""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class SolveResult:
    """最適化の結果。

    points: 消費ポイント数(= 選択ノード数 - 1。root/スタートノードはコスト0)
    nodes: 選択ノード集合(root含む)
    status: "optimal"(最適性証明付き) / "feasible"(実行可能解のみ) / "infeasible"
    dual_bound: ソルバーの下界。status == "optimal" なら points に一致する
    ignored_terminals: 除外設定などでrootから到達不能となり無視されたterminal
    solve_time: ILP求解時間(秒)。前処理は含まない
    """

    points: int
    nodes: frozenset[str]
    status: str
    dual_bound: float = 0.0
    ignored_terminals: tuple[str, ...] = ()
    solve_time: float = 0.0
