import { expect, it } from "vitest";
import type { AtlasGraph } from "../src/data/graph";
import { loadSolver } from "../src/solver/highs";
import { solve } from "../src/solver/ilpReduced";
import { validate } from "../src/solver/validate";
import { loadGraph } from "./helpers/data";
import { choice, mulberry32, sample } from "./helpers/prng";

const g = loadGraph();
const highs = await loadSolver();

function bfsDist(graph: AtlasGraph, target: string): number {
  const dist = new Map([[graph.root, 0]]);
  const queue = [graph.root];
  for (let i = 0; i < queue.length; i++) {
    const cur = queue[i]!;
    for (const n of graph.adj.get(cur)!) {
      if (!dist.has(n)) {
        dist.set(n, dist.get(cur)! + 1);
        queue.push(n);
      }
    }
  }
  const d = dist.get(target);
  if (d === undefined) throw new Error(`unreachable: ${target}`);
  return d;
}

it("empty terminals", () => {
  const res = solve(highs, g, []);
  expect(res.points).toBe(0);
  expect([...res.nodes]).toEqual([g.root]);
  expect(res.status).toBe("optimal");
});

it("single terminal equals BFS distance", { timeout: 120_000 }, () => {
  // 単一terminalの最小ポイント数は(rootがコスト0なので)BFS距離に一致する
  const rng = mulberry32(1);
  const nodes = [...g.adj.keys()].filter((n) => n !== g.root).sort();
  for (const t of sample(rng, nodes, 12)) {
    const res = solve(highs, g, [t]);
    expect(res.status).toBe("optimal");
    expect(validate(g, res, [t])).toEqual([]);
    expect(res.points, `terminal ${t}`).toBe(bfsDist(g, t));
  }
});

it("exclusion changes solution", { timeout: 60_000 }, () => {
  const t = "58043"; // Endless Tide: 唯一の隣 47488 を経由する必要がある
  const base = solve(highs, g, [t]);
  expect(base.nodes.has("47488")).toBe(true);
  const res = solve(highs, g, [t], { excluded: ["47488"] });
  expect(res.ignoredTerminals).toEqual([t]);
  expect(res.points).toBe(0); // terminalが無視され、何も取らない
  expect(validate(g, res, [t], ["47488"])).toEqual([]);
});

it("exclusion forces detour", { timeout: 120_000 }, () => {
  // terminalへの経路上のノードを1つ除外しても、迂回があれば解ける(コストは同じか増える)
  const rng = mulberry32(4);
  const nodes = [...g.adj.keys()].filter((n) => n !== g.root).sort();
  let checked = 0;
  while (checked < 3) {
    const t = choice(rng, nodes);
    const base = solve(highs, g, [t]);
    const mid = [...base.nodes].filter((n) => n !== g.root && n !== t);
    if (mid.length === 0) continue;
    const ex = choice(
      rng,
      mid.sort((a, b) => Number(a) - Number(b)),
    );
    const res = solve(highs, g, [t], { excluded: [ex] });
    expect(validate(g, res, [t], [ex])).toEqual([]);
    if (res.ignoredTerminals.length === 0) {
      expect(res.status).toBe("optimal");
      expect(res.points).toBeGreaterThanOrEqual(base.points);
    }
    checked++;
  }
});

// pyref 実行結果の埋め込み(照合オラクル)。ノード集合は同点最適が複数ありうるため
// 比較せず、points / status / ignoredTerminals のみ検証する。
// 生成: .venv/bin/python -c "from atlasopt import load, ilp_reduced; ..."(2026-08-12)
const GOLDENS = [
  {
    name: "Endless Tide 単体",
    terminals: ["58043"],
    excluded: [] as string[],
    points: 19,
    ignored: [] as string[],
  },
  {
    name: "bench seed42 K=10 相当",
    terminals: "5515,17982,11349,62028,28029,26020,25151,20107,61918,16908".split(","),
    excluded: [] as string[],
    points: 81,
    ignored: [] as string[],
  },
  {
    name: "除外で terminal 1つが無視されるケース",
    terminals: ["58043", "5515"],
    excluded: ["47488"],
    points: 35,
    ignored: ["58043"],
  },
];

for (const gc of GOLDENS) {
  it(`pyref golden: ${gc.name}`, { timeout: 120_000 }, () => {
    const res = solve(highs, g, gc.terminals, { excluded: gc.excluded });
    expect(res.status).toBe("optimal");
    expect(res.points).toBe(gc.points);
    expect([...res.ignoredTerminals]).toEqual(gc.ignored);
    expect(validate(g, res, gc.terminals, gc.excluded)).toEqual([]);
  });
}

it("root-adjacent terminal solves via contraction fast path", () => {
  // 全 terminal が root へ融合する縮約の早期リターン経路
  const nb = [...g.adj.get(g.root)!].sort()[0]!;
  const res = solve(highs, g, [nb]);
  expect(res.status).toBe("optimal");
  expect(res.points).toBe(1);
  expect([...res.nodes].sort()).toEqual([nb, g.root].sort());
  expect(validate(g, res, [nb])).toEqual([]);
});
