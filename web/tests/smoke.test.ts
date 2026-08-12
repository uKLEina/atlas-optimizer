import { expect, it } from "vitest";
import { loadSolver, type HighsSolution } from "../src/solver/highs";

// Columns の型は Optimal/Infeasible のユニオンなので Primal の存在を確認して取り出す
function primal(solution: HighsSolution, name: string): number {
  const col = solution.Columns[name];
  if (!col || !("Primal" in col)) {
    throw new Error(`変数 ${name} の Primal が存在しない`);
  }
  return col.Primal;
}

it("小さな ILP を厳密に解ける", async () => {
  const highs = await loadSolver();
  const solution = highs.solve(`Maximize
 obj: x + 2 y + 3 z
Subject To
 c1: x + y + z <= 2
Binary
 x y z
End`);

  expect(solution.Status).toBe("Optimal");
  expect(solution.ObjectiveValue).toBe(5);
  expect(primal(solution, "x")).toBe(0);
  expect(primal(solution, "y")).toBe(1);
  expect(primal(solution, "z")).toBe(1);
});

it("実行不能な問題で Infeasible が返る", async () => {
  const highs = await loadSolver();
  const solution = highs.solve(`Minimize
 obj: x
Subject To
 c1: x >= 2
 c2: x <= 1
End`);

  expect(solution.Status).toBe("Infeasible");
});
