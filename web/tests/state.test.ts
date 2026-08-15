import { expect, it } from "vitest";
import { buildMasteryIndex } from "../src/ui/masteryIndex";
import { AppState } from "../src/ui/state";
import { loadGraph, loadRawData } from "./helpers/data";

const g = loadGraph();
const index = buildMasteryIndex(loadRawData());

const newState = (): AppState => new AppState(g, index);

// Notable を持つ mastery と、同名クラスタが複数ある mastery を実データから取る
const masteryWithNotables = [...index.notables.entries()].find(([, v]) => v.length > 0)![0];
const multiCluster = [...index.siblings.entries()].find(
  ([id, sibs]) => sibs.length > 0 && (index.notables.get(id)?.length ?? 0) > 0,
)?.[0];

it("3状態巡回: none → terminal → excluded → none", () => {
  const s = newState();
  const id = "58043";
  expect(s.markOf(id)).toBe("none");
  s.cycle(id);
  expect(s.markOf(id)).toBe("terminal");
  expect(s.terminals()).toEqual([id]);
  s.cycle(id);
  expect(s.markOf(id)).toBe("excluded");
  expect(s.excluded()).toEqual([id]);
  s.cycle(id);
  expect(s.markOf(id)).toBe("none");
  expect(s.terminals()).toEqual([]);
});

it("root は巡回対象外", () => {
  const s = newState();
  expect(s.cycle(g.root)).toBe(false);
  expect(s.markOf(g.root)).toBe("none");
});

it("mastery一括: 揃っていれば次の状態へ、混在なら全員 terminal", () => {
  const s = newState();
  const notables = index.notables.get(masteryWithNotables)!;
  // 全員 none → 全員 terminal
  expect(s.masteryClick(masteryWithNotables)).toBe(true);
  for (const n of notables) expect(s.markOf(n)).toBe("terminal");
  // 全員 terminal → 全員 excluded
  s.masteryClick(masteryWithNotables);
  for (const n of notables) expect(s.markOf(n)).toBe("excluded");
  // 混在にする → 全員 terminal に揃う
  s.cycle(notables[0]!); // excluded → none
  s.masteryClick(masteryWithNotables);
  for (const n of notables) expect(s.markOf(n)).toBe("terminal");
  // 全員 excluded → 全員 none
  s.masteryClick(masteryWithNotables); // → excluded
  s.masteryClick(masteryWithNotables); // → none
  for (const n of notables) expect(s.markOf(n)).toBe("none");
});

it("mastery一括は同名の全クラスタに及ぶ(グループ単位ではない)", () => {
  expect(multiCluster, "同名クラスタが複数ある mastery が実データに存在する").toBeDefined();
  const union = index.notables.get(multiCluster!)!;
  const ownGroup = g.masteryNotables.get(multiCluster!) ?? [];
  expect(union.length).toBeGreaterThan(ownGroup.length); // 他クラスタの分も含む
  const s = newState();
  s.masteryClick(multiCluster!);
  for (const n of union) expect(s.markOf(n)).toBe("terminal");
});

it("Notable の無い mastery は no-op", () => {
  const s = newState();
  for (const [id, v] of index.notables) {
    if (v.length === 0) {
      expect(s.masteryClick(id)).toBe(false);
    }
  }
  expect(s.terminals()).toEqual([]);
});

it("マーク変更でのみ onMarksChange が発火する", () => {
  const s = newState();
  let marks = 0;
  let any = 0;
  s.onMarksChange(() => marks++);
  s.subscribe(() => any++);
  s.cycle("58043");
  expect(marks).toBe(1);
  s.setHover("47488");
  s.setSolving();
  expect(marks).toBe(1); // hover/solving では発火しない
  expect(any).toBeGreaterThan(1);
});
