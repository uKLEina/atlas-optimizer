import wasmUrl from "highs/runtime?url";
import { loadSolver } from "./solver/highs";

// スモークテスト用の小さな ILP(最適値 5: y = z = 1, x = 0)
const SAMPLE_LP = `Maximize
 obj: x + 2 y + 3 z
Subject To
 c1: x + y + z <= 2
Binary
 x y z
End`;

const out = document.querySelector<HTMLPreElement>("#out");
if (!out) throw new Error("#out not found");

try {
  const highs = await loadSolver(() => wasmUrl);
  const solution = highs.solve(SAMPLE_LP);
  out.textContent = [
    `Status: ${solution.Status} (expected: Optimal)`,
    `ObjectiveValue: ${solution.ObjectiveValue} (expected: 5)`,
    "",
    JSON.stringify(solution, null, 2),
  ].join("\n");
} catch (err) {
  out.textContent = `FAILED: ${String(err)}`;
  throw err;
}
