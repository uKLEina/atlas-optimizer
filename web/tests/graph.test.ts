import { expect, it } from "vitest";
import { cost, reachableFrom, ROOT_ID } from "../src/data/graph";
import { loadGraph, loadRawData } from "./helpers/data";

const g = loadGraph();

it("shape", () => {
  // data.json (3.29) の実測値。リーグ更新でdata.jsonを差し替えたら要更新
  expect(g.adj.size).toBe(903);
  let degSum = 0;
  for (const s of g.adj.values()) degSum += s.size;
  expect(degSum / 2).toBe(1003);
  expect(g.masteryNotables.size).toBe(126);
});

it("root", () => {
  expect(g.root).toBe(ROOT_ID);
  expect(cost(g, g.root)).toBe(0);
  for (const n of g.adj.keys()) {
    if (n !== g.root) expect(cost(g, n)).toBe(1);
  }
  expect(g.info.get(g.root)?.name ?? "").toBe(""); // スタートノードは名前空
});

it("all reachable", () => {
  const reach = reachableFrom(g.adj, g.root);
  expect(reach.size).toBe(g.adj.size);
  for (const n of g.adj.keys()) expect(reach.has(n)).toBe(true);
});

it("no masteries or pseudo root", () => {
  expect(g.adj.has("root")).toBe(false);
  for (const n of g.adj.keys()) {
    expect(g.info.get(n)?.isMastery ?? false).toBe(false);
  }
});

it("adjacency symmetric", () => {
  for (const [u, nbrs] of g.adj) {
    for (const v of nbrs) {
      expect(g.adj.get(v)?.has(u)).toBe(true);
      expect(u).not.toBe(v);
    }
  }
});

it("mastery notables", () => {
  // Bestiary グループの例: Notable 5個(データ確認済みの実測値)
  const raw = loadRawData();
  const bestiary = Object.entries(raw.nodes).find(
    ([, v]) => v.isMastery && v.name === "Bestiary",
  )?.[0];
  expect(bestiary).toBeDefined();
  const notables = g.masteryNotables.get(bestiary!)!;
  expect(notables.length).toBe(5);
  for (const n of notables) expect(g.info.get(n)?.isNotable).toBe(true);
  // Notableを持たないmasteryグループは7つ(DESIGN.md)
  let empty = 0;
  for (const v of g.masteryNotables.values()) if (v.length === 0) empty++;
  expect(empty).toBe(7);
});
