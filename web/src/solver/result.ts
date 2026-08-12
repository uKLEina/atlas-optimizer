/** 求解結果(pyref/atlasopt/result.py の移植)。 */

export type SolveStatus = "optimal" | "feasible" | "infeasible";

export interface SolveResult {
  /** 消費ポイント数 = |nodes| - 1(rootはコスト0)。infeasible 時は -1 */
  points: number;
  /** 選択ノード集合(root含む) */
  nodes: ReadonlySet<string>;
  status: SolveStatus;
  /** 除外/到達不能で無視された terminal(辞書順) */
  ignoredTerminals: readonly string[];
  /** ILP求解時間(秒)。前処理は含まない */
  solveTime: number;
  /**
   * ソルバーの下界。pyref は HiGHS の mip_dual_bound を常に持つが、highs-js は
   * これを公開しないため optimal 時のみ points と同値を設定する(意図的な差分)。
   * 「最適性の証明」判定は status === "optimal" に一本化されている。
   */
  dualBound?: number;
}
