import { expect, it } from "vitest";
import type { AtlasGraph } from "../src/data/graph";
import { loadSolver } from "../src/solver/highs";
import { solve } from "../src/solver/ilpReduced";
import { TIEBREAK_STEP, TiebreakIndex } from "../src/solver/tiebreak";
import { loadGraph, loadRawData } from "./helpers/data";

const highs = await loadSolver();

/** root→t への同点2経路(a1-a2 / b1-b2)。pyref tests/test_tiebreak.py と同型 */
function diamond(): AtlasGraph {
  const adj = new Map<string, ReadonlySet<string>>([
    ["r", new Set(["a1", "b1"])],
    ["a1", new Set(["r", "a2"])],
    ["a2", new Set(["a1", "t"])],
    ["b1", new Set(["r", "b2"])],
    ["b2", new Set(["b1", "t"])],
    ["t", new Set(["a2", "b2"])],
  ]);
  return { adj, info: new Map(), masteryNotables: new Map(), root: "r" };
}

it("同点2経路から重みの小さい経路を選ぶ(縮約の平行辺選択込み)", () => {
  const g = diamond();
  const heavyA = new Map([
    ["a1", 7e-5],
    ["a2", 7e-5],
    ["b1", 1e-5],
    ["b2", 1e-5],
  ]);
  const res = solve(highs, g, ["t"], { nodeWeights: heavyA });
  expect(res.status).toBe("optimal");
  expect(res.points).toBe(3);
  expect([...res.nodes].sort()).toEqual(["b1", "b2", "r", "t"]);
  const heavyB = new Map([
    ["a1", 1e-5],
    ["a2", 1e-5],
    ["b1", 7e-5],
    ["b2", 7e-5],
  ]);
  const res2 = solve(highs, g, ["t"], { nodeWeights: heavyB });
  expect([...res2.nodes].sort()).toEqual(["a1", "a2", "r", "t"]);
});

it("重みの検証: 負・総和0.5以上は拒否", () => {
  const g = diamond();
  expect(() => solve(highs, g, ["t"], { nodeWeights: new Map([["a1", -1e-5]]) })).toThrow(
    /non-negative/,
  );
  expect(() => solve(highs, g, ["t"], { nodeWeights: new Map([["a1", 0.6]]) })).toThrow(/0\.5/);
});

// ---- ポリシー(TiebreakIndex)。代表ノードは stat パターンで拾い、id 直書きしない ----

const data = loadRawData();
const realG = loadGraph();
const index = new TiebreakIndex(data, realG);
const neutral = index.weightsFor([]);

const masteryGroups = new Set(
  Object.entries(data.nodes)
    .filter(([id, n]) => id !== "root" && n.isMastery && n.group !== undefined)
    .map(([, n]) => n.group),
);
const findNode = (pred: (id: string) => boolean): string => {
  for (const id of realG.adj.keys()) {
    if (id !== realG.root && pred(id)) return id;
  }
  throw new Error("node not found");
};
const inMasteryGroup = (id: string): boolean => masteryGroups.has(data.nodes[id]?.group);

it("travel node のカテゴリ序列が指定どおり", () => {
  const patterns = [
    /increased effect of Explicit Modifiers on your Maps/,
    /increased Rarity of Items found in your Maps/,
    /increased Quantity of Items found in your Maps/,
    /increased Scarabs found in your Maps/,
    /increased Maps found in your Maps/,
  ];
  const reps = patterns.map((re, i) => {
    // 複数カテゴリ持ち(例: Item Quantity and Rarity)は上位 tier になるため、
    // 代表には「当該カテゴリのみ」を持つノードを選ぶ
    const higher = patterns.slice(0, i);
    const id = findNode((id) => {
      const stats = data.nodes[id]?.stats ?? [];
      return (
        !inMasteryGroup(id) &&
        stats.some((s) => re.test(s)) &&
        !higher.some((h) => stats.some((s) => h.test(s)))
      );
    });
    return { id, expectedTier: i + 1 };
  });
  for (const { id, expectedTier } of reps) {
    expect(neutral.get(id), id).toBeCloseTo(expectedTier * TIEBREAK_STEP, 10);
  }
  // カテゴリ外の travel node(tier 6)も存在する
  expect(() =>
    findNode((id) => !inMasteryGroup(id) && neutral.get(id) === 6 * TIEBREAK_STEP),
  ).not.toThrow();
});

it("Mastery グループのノードは回避(tier 7)、指定すると当該グループ全体が最優先(重み0)", () => {
  const member = findNode((id) => inMasteryGroup(id));
  expect(neutral.get(member)).toBeCloseTo(7 * TIEBREAK_STEP, 10);

  const grp = data.nodes[member]!.group;
  const active = index.weightsFor([member]);
  // 同グループの全ノードが重み0(マップに載らない)になる
  for (const id of realG.adj.keys()) {
    if (id !== realG.root && data.nodes[id]?.group === grp) {
      expect(active.get(id), id).toBeUndefined();
    }
  }
  // 無関係の mastery グループは引き続き回避
  const otherMember = findNode((id) => inMasteryGroup(id) && data.nodes[id]?.group !== grp);
  expect(active.get(otherMember)).toBeCloseTo(7 * TIEBREAK_STEP, 10);
});

it("重みの総和は 0.5 未満(最適性保存の前提)", () => {
  let total = 0;
  for (const w of neutral.values()) total += w;
  expect(total).toBeGreaterThan(0);
  expect(total).toBeLessThan(0.5);
});
