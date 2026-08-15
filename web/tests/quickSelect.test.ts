import { expect, it } from "vitest";
import { buildMasteryIndex } from "../src/ui/masteryIndex";
import { buildQuickSets } from "../src/ui/quickSelect";
import { AppState } from "../src/ui/state";
import { loadGraph, loadRawData } from "./helpers/data";

const data = loadRawData();
const g = loadGraph();
const sets = new Map(buildQuickSets(data, g).map((s) => [s.key, s]));

it("Map Mod Effect: minor 16個のみ(Notable の Multiplying/Mounting Modifiers は含まない)", () => {
  const s = sets.get("modEffect")!;
  expect(s.ids.length).toBe(16);
  for (const id of s.ids) {
    const nd = data.nodes[id]!;
    expect(nd.isNotable ?? false).toBe(false);
    expect(nd.stats!.some((t) => t.includes("effect of Explicit Modifiers on your Maps"))).toBe(
      true,
    );
  }
  expect(s.ids).not.toContain("30266"); // Multiplying Modifiers
  expect(s.ids).not.toContain("34393"); // Mounting Modifiers
});

it("Item Quantity: minor 15個", () => {
  const s = sets.get("quantity")!;
  expect(s.ids.length).toBe(15);
  for (const id of s.ids) {
    expect(
      data.nodes[id]!.stats!.some((t) => t.includes("Quantity of Items found in your Maps")),
    ).toBe(true);
  }
});

it.each([
  ["exarch", "Searing Exarch", "54499"], // Baptised by Fire(double progress)
  ["eater", "Eater of Worlds", "8182"], // Etched by Acid(double progress)
])("%s: KS+NT2+PackSize minor 8 = 11個、Item Chance と double progress は除外", (key, name, dp) => {
  const s = sets.get(key)!;
  expect(s.ids.length).toBe(11);
  expect(s.ids).not.toContain(dp);
  for (const id of s.ids) {
    const stats = data.nodes[id]!.stats!;
    expect(stats.some((t) => t.includes(name))).toBe(true);
    expect(stats.some((t) => /Implicit Modifier|double progress/.test(t))).toBe(false);
  }
  const minors = s.ids.filter((id) => {
    const nd = data.nodes[id]!;
    return !nd.isKeystone && !nd.isNotable;
  });
  expect(minors.length).toBe(8);
});

it("Maven: Chisel 2 + Witness minor 4 + The Most Toys + Destructive Play = 8個", () => {
  const s = sets.get("maven")!;
  // "the Maven"/"The Maven" の表記ゆれ両方を拾えていること(過去に大小区別で4個漏らした)
  expect([...s.ids].sort()).toEqual([
    "12302", // Maven Chisel Chance
    "18900", // The Most Toys
    "30365", // Maven Witness Additional Boss Chance
    "34384", // Destructive Play
    "42332", // Maven Witness Additional Boss Chance
    "58508", // Maven Witness Additional Boss Chance
    "59602", // Maven Witness Additional Boss Chance
    "62212", // Maven Chisel Chance
  ]);
});

it("Final Map Boss: 7個。Destructive Play は含まず、名指しの2 Notable は含む", () => {
  const s = sets.get("mapBoss")!;
  expect(s.ids.length).toBe(7);
  expect(s.ids).not.toContain("34384"); // Destructive Play(Maven セットの担当)
  expect(s.ids).toContain("18476"); // Conquered Conquerors
  expect(s.ids).toContain("34352"); // Significant Troves
});

it("Maven → Final Map Boss を順にトグルしても Destructive Play は外れない", () => {
  const state = new AppState(g, buildMasteryIndex(data));
  const maven = sets.get("maven")!.ids;
  const boss = sets.get("mapBoss")!.ids;
  state.quickToggle(maven); // Maven 選択(DP 含む)
  state.quickToggle(boss); // Boss 選択
  state.quickToggle(boss); // Boss 解除
  expect(state.markOf("34384")).toBe("terminal"); // DP は Maven の選択のまま
  for (const id of boss) expect(state.markOf(id)).toBe("none");
});

it("quickToggle: 未選択→全 terminal、混在→全 terminal、全 terminal→全解除", () => {
  const state = new AppState(g, buildMasteryIndex(data));
  const ids = sets.get("modEffect")!.ids;
  state.quickToggle(ids);
  for (const id of ids) expect(state.markOf(id)).toBe("terminal");
  state.cycle(ids[0]!); // terminal → excluded(混在化)
  state.quickToggle(ids);
  for (const id of ids) expect(state.markOf(id)).toBe("terminal");
  state.quickToggle(ids);
  for (const id of ids) expect(state.markOf(id)).toBe("none");
});
