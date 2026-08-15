import { expect, it } from "vitest";
import type { AtlasGraph } from "../src/data/graph";
import { loadSolver } from "../src/solver/highs";
import { solve } from "../src/solver/ilpReduced";
import { TiebreakIndex } from "../src/solver/tiebreak";
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
    ["a1", 7],
    ["a2", 7],
    ["b1", 1],
    ["b2", 1],
  ]);
  const res = solve(highs, g, ["t"], { nodeWeights: heavyA });
  expect(res.status).toBe("optimal");
  expect(res.points).toBe(3);
  expect([...res.nodes].sort()).toEqual(["b1", "b2", "r", "t"]);
  const heavyB = new Map([
    ["a1", 1],
    ["a2", 1],
    ["b1", 7],
    ["b2", 7],
  ]);
  const res2 = solve(highs, g, ["t"], { nodeWeights: heavyB });
  expect([...res2.nodes].sort()).toEqual(["a1", "a2", "r", "t"]);
});

it("重みがどれだけ大きくても遠回りは選ばれない(2フェーズなので構造的に安全)", () => {
  // r - a1 - t(2pt)と r - c1 - c2 - c3 - t(4pt)。最短側に巨大な重み
  const adj = new Map<string, ReadonlySet<string>>([
    ["r", new Set(["a1", "c1"])],
    ["a1", new Set(["r", "t"])],
    ["c1", new Set(["r", "c2"])],
    ["c2", new Set(["c1", "c3"])],
    ["c3", new Set(["c2", "t"])],
    ["t", new Set(["a1", "c3"])],
  ]);
  const g: AtlasGraph = { adj, info: new Map(), masteryNotables: new Map(), root: "r" };
  const res = solve(highs, g, ["t"], { nodeWeights: new Map([["a1", 10_000]]) });
  expect(res.status).toBe("optimal");
  expect(res.points).toBe(2);
  expect([...res.nodes].sort()).toEqual(["a1", "r", "t"]);
});

it("重みの検証: 負は拒否", () => {
  const g = diamond();
  expect(() => solve(highs, g, ["t"], { nodeWeights: new Map([["a1", -1]]) })).toThrow(
    /non-negative/,
  );
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
    expect(neutral.get(id), id).toBe(expectedTier);
  }
  // カテゴリ外の travel node(tier 6)も存在する
  expect(() => findNode((id) => !inMasteryGroup(id) && neutral.get(id) === 6)).not.toThrow();
});

it("Mastery グループのノードは回避(tier 7)、指定すると当該グループ全体が最優先(重み0)", () => {
  const member = findNode((id) => inMasteryGroup(id));
  expect(neutral.get(member)).toBe(7);

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
  expect(active.get(otherMember)).toBe(7);
});
