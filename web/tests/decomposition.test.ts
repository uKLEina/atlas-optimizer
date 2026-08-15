import { expect, it } from "vitest";
import { buildDecomposition, verify } from "../src/solver/decomposition";
import { loadGraph } from "./helpers/data";

const g = loadGraph();

it("実グラフの分解が妥当で width ≤ 7", () => {
  const td = buildDecomposition(g.adj, g.root);
  expect(verify(g.adj, td, g.root)).toEqual([]);
  expect(td.width).toBeLessThanOrEqual(7);
  expect(td.bags.length).toBe(g.adj.size);
});

it("決定的(2回実行で同一)", () => {
  const td1 = buildDecomposition(g.adj, g.root);
  const td2 = buildDecomposition(g.adj, g.root);
  expect(td1).toEqual(td2);
});

it("パスとサイクルの width 厳密値", () => {
  const path = new Map<string, ReadonlySet<string>>([
    ["a", new Set(["b"])],
    ["b", new Set(["a", "c"])],
    ["c", new Set(["b"])],
  ]);
  const td = buildDecomposition(path, "a");
  expect(verify(path, td, "a")).toEqual([]);
  expect(td.width).toBe(1);
  const cycle = new Map<string, ReadonlySet<string>>([
    ["a", new Set(["b", "c"])],
    ["b", new Set(["a", "c"])],
    ["c", new Set(["a", "b"])],
  ]);
  const td2 = buildDecomposition(cycle, "a");
  expect(verify(cycle, td2, "a")).toEqual([]);
  expect(td2.width).toBe(2);
});
