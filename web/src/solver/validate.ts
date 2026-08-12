/**
 * 解の妥当性検証(pyref/atlasopt/validate.py の移植)。
 *
 * ソルバーの「最適性証明」は渡したモデルに対するものでしかないため、
 * 返ってきた解が元の問題の実行可能解であることを必ず独立に確認する。
 */

import { cost, reachableFrom, type AtlasGraph } from "../data/graph";
import type { SolveResult } from "./result";

/** 問題点のリストを返す(空なら妥当)。 */
export function validate(
  g: AtlasGraph,
  result: SolveResult,
  terminals: Iterable<string>,
  excluded: Iterable<string> = [],
): string[] {
  const problems: string[] = [];
  const sel = new Set(result.nodes);
  const excludedSet = new Set(excluded);
  const wanted = new Set(terminals);
  wanted.delete(g.root);

  if (!sel.has(g.root)) {
    problems.push("root not in solution");
  }

  const hit = [...sel].filter((n) => excludedSet.has(n)).sort();
  if (hit.length > 0) {
    problems.push(`solution contains excluded nodes: ${hit.join(", ")}`);
  }

  const ignored = new Set(result.ignoredTerminals);
  const missing = [...wanted].filter((t) => !ignored.has(t) && !sel.has(t)).sort();
  if (missing.length > 0) {
    problems.push(`terminals missing from solution: ${missing.join(", ")}`);
  }

  // 無視されたterminalは本当に到達不能か(過剰に無視していないか)
  const reachable = reachableFrom(g.adj, g.root, excludedSet);
  const bogus = [...ignored].filter((t) => reachable.has(t) && !excludedSet.has(t)).sort();
  if (bogus.length > 0) {
    problems.push(`terminals ignored despite being reachable: ${bogus.join(", ")}`);
  }

  // 連結性: 選択ノードの誘導部分グラフ上で root から全選択ノードに届くか
  if (sel.size > 0) {
    const banned = new Set([...g.adj.keys()].filter((n) => !sel.has(n)));
    const reach = reachableFrom(g.adj, g.root, banned);
    const same = reach.size === sel.size && [...sel].every((n) => reach.has(n));
    if (!same) {
      problems.push("solution is not connected");
    }
  }

  let expectedPoints = 0;
  for (const n of sel) expectedPoints += cost(g, n);
  if (result.points !== expectedPoints) {
    problems.push(`points mismatch: reported ${result.points}, recomputed ${expectedPoints}`);
  }

  return problems;
}
