import { expect, it } from "vitest";
import { AppState } from "../src/ui/state";
import { loadGraph } from "./helpers/data";

const g = loadGraph();

// Bestiary mastery(Notable 5個持ち)と空 mastery を実データから取る
const masteryWithNotables = [...g.masteryNotables.entries()].find(
  ([, v]) => v.length > 0,
)![0];
const emptyMastery = [...g.masteryNotables.entries()].find(([, v]) => v.length === 0)![0];

it("3状態巡回: none → terminal → excluded → none", () => {
  const s = new AppState(g);
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
  const s = new AppState(g);
  expect(s.cycle(g.root)).toBe(false);
  expect(s.markOf(g.root)).toBe("none");
});

it("mastery一括: 揃っていれば次の状態へ、混在なら全員 terminal", () => {
  const s = new AppState(g);
  const notables = g.masteryNotables.get(masteryWithNotables)!;
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

it("Notable無し mastery は no-op", () => {
  const s = new AppState(g);
  expect(s.masteryClick(emptyMastery)).toBe(false);
  expect(s.terminals()).toEqual([]);
});

it("マーク変更でのみ onMarksChange が発火する", () => {
  const s = new AppState(g);
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
