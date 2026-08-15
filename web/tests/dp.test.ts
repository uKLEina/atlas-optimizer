/**
 * 木分解 Steiner DP のテスト(pyref/tests/test_dp.py の移植)。
 * 正しさの基準は TS 側 ILP(ilpReduced、pyref と crosscheck 済みのオラクル)との一致。
 */

import { expect, it } from "vitest";
import type { AtlasGraph } from "../src/data/graph";
import { buildDecomposition } from "../src/solver/decomposition";
import { solve as dpSolve } from "../src/solver/dp";
import { loadSolver } from "../src/solver/highs";
import { solve as ilpSolve } from "../src/solver/ilpReduced";
import { validate } from "../src/solver/validate";
import { loadGraph } from "./helpers/data";
import { choice, mulberry32, randInt, sample } from "./helpers/prng";

const g = loadGraph();
const td = buildDecomposition(g.adj, g.root);
const highs = await loadSolver();

function bfsDist(target: string): number {
  const dist = new Map([[g.root, 0]]);
  const queue = [g.root];
  for (let i = 0; i < queue.length; i++) {
    for (const n of g.adj.get(queue[i]!)!) {
      if (!dist.has(n)) {
        dist.set(n, dist.get(queue[i]!)! + 1);
        queue.push(n);
      }
    }
  }
  return dist.get(target)!;
}

it("空 terminals", () => {
  const res = dpSolve(g, [], { td });
  expect(res.points).toBe(0);
  expect([...res.nodes]).toEqual([g.root]);
  expect(res.status).toBe("optimal");
});

it("単一 terminal は BFS 距離に一致", () => {
  const rng = mulberry32(21);
  const nodes = [...g.adj.keys()].filter((n) => n !== g.root).sort();
  for (const t of sample(rng, nodes, 8)) {
    const res = dpSolve(g, [t], { td });
    expect(res.status).toBe("optimal");
    expect(validate(g, res, [t])).toEqual([]);
    expect(res.points, t).toBe(bfsDist(t));
  }
});

it("ランダムケースで ILP と一致(除外込み)", { timeout: 120_000 }, () => {
  const rng = mulberry32(22);
  const nodes = [...g.adj.keys()].sort();
  for (let round = 0; round < 8; round++) {
    const terms = sample(rng, nodes, randInt(rng, 1, 25));
    const excluded =
      round % 3 === 0
        ? sample(rng, nodes, 5).filter((n) => n !== g.root && !terms.includes(n))
        : [];
    const resDp = dpSolve(g, terms, { excluded, td });
    const resIlp = ilpSolve(highs, g, terms, { excluded });
    expect(resDp.status).toBe("optimal");
    expect(validate(g, resDp, terms, excluded)).toEqual([]);
    expect(resDp.points, `round ${round}`).toBe(resIlp.points);
    expect([...resDp.ignoredTerminals]).toEqual([...resIlp.ignoredTerminals]);
  }
});

it("タイブレークは大域厳密(任意重みで ILP 以下の eps)", { timeout: 120_000 }, () => {
  const rng = mulberry32(23);
  const nodes = [...g.adj.keys()].sort();
  const weights = new Map(
    nodes.filter((n) => n !== g.root).map((n) => [n, choice(rng, [0, 1, 3, 7])]),
  );
  const epsOf = (sel: ReadonlySet<string>): number => {
    let s = 0;
    for (const n of sel) s += weights.get(n) ?? 0;
    return s;
  };
  for (let round = 0; round < 4; round++) {
    const terms = sample(rng, nodes, randInt(rng, 2, 15));
    const resDp = dpSolve(g, terms, { nodeWeights: weights, td });
    const resIlp = ilpSolve(highs, g, terms, { nodeWeights: weights });
    expect(resDp.points).toBe(resIlp.points);
    expect(epsOf(resDp.nodes)).toBeLessThanOrEqual(epsOf(resIlp.nodes));
  }
});

it("diamond のタイブレークが厳密", () => {
  const adj = new Map<string, ReadonlySet<string>>([
    ["r", new Set(["a1", "b1"])],
    ["a1", new Set(["r", "a2"])],
    ["a2", new Set(["a1", "t"])],
    ["b1", new Set(["r", "b2"])],
    ["b2", new Set(["b1", "t"])],
    ["t", new Set(["a2", "b2"])],
  ]);
  const dg: AtlasGraph = { adj, info: new Map(), masteryNotables: new Map(), root: "r" };
  const res = dpSolve(dg, ["t"], {
    nodeWeights: new Map([
      ["a1", 7],
      ["a2", 7],
      ["b1", 1],
      ["b2", 1],
    ]),
  });
  expect(res.points).toBe(3);
  expect([...res.nodes].sort()).toEqual(["b1", "b2", "r", "t"]);
});

it("ignored terminal の意味論は reduction と同じ", () => {
  const res = dpSolve(g, ["58043"], { excluded: ["58043"], td });
  expect([...res.ignoredTerminals]).toEqual(["58043"]);
  expect(res.points).toBe(0);
  const res2 = dpSolve(g, ["58043"], { excluded: ["47488"], td });
  expect([...res2.ignoredTerminals]).toEqual(["58043"]);
});

it("決定的(2回実行で同一ノード集合)", () => {
  const rng = mulberry32(24);
  const terms = sample(rng, [...g.adj.keys()].sort(), 12);
  const r1 = dpSolve(g, terms, { td });
  const r2 = dpSolve(g, terms, { td });
  expect([...r1.nodes].sort()).toEqual([...r2.nodes].sort());
});
