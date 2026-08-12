import { expect, it } from "vitest";
import { build } from "../src/solver/reduction";
import { loadGraph } from "./helpers/data";
import { mulberry32, randInt, sample } from "./helpers/prng";

const g = loadGraph();

it("structure invariants", () => {
  const rng = mulberry32(0);
  const allNodes = [...g.adj.keys()].sort();
  for (let round = 0; round < 10; round++) {
    const terms = sample(rng, allNodes, randInt(rng, 1, 40));
    const red = build(g, terms);
    expect(red.nodes.has(g.root)).toBe(true);
    for (const t of red.terminals) expect(red.nodes.has(t)).toBe(true);
    expect(red.ignoredTerminals).toEqual([]);
    const core = red.nodes;
    const seenInternal = new Set<string>();
    for (const e of red.edges.values()) {
      expect(e.w).toBe(e.path.length);
      const path = new Set(e.path);
      expect(path.size).toBe(e.path.length); // 内部ノードは重複しない
      for (const p of path) {
        expect(core.has(p)).toBe(false); // 内部ノードはコアに現れない
        expect(seenInternal.has(p)).toBe(false); // 辺間でも重複しない
        seenInternal.add(p);
      }
    }
  }
});

it("excluded terminal is ignored", () => {
  const t = "58043"; // Endless Tide
  const red = build(g, [t], [t]);
  expect(red.ignoredTerminals).toEqual([t]);
  expect(red.terminals).toEqual([]);
});

it("unreachable terminal is ignored", () => {
  // Endless Tide (58043) は次数1で、唯一の隣 47488 を除外すると到達不能になる
  expect([...g.adj.get("58043")!]).toEqual(["47488"]);
  const red = build(g, ["58043"], ["47488"]);
  expect(red.ignoredTerminals).toEqual(["58043"]);
});

it("root terminal is dropped", () => {
  const red = build(g, [g.root]);
  expect(red.terminals).toEqual([]);
  expect(red.ignoredTerminals).toEqual([]);
});

it("cannot exclude root", () => {
  expect(() => build(g, ["58043"], [g.root])).toThrow(/start node cannot be excluded/);
});

it("unknown id rejected", () => {
  expect(() => build(g, ["999999"])).toThrow(/unknown or non-allocatable/);
});
