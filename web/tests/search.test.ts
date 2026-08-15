import { expect, it } from "vitest";
import { buildSearchIndex, searchNodes } from "../src/ui/search";
import { loadRawData } from "./helpers/data";

const data = loadRawData();
const index = buildSearchIndex(data);

it("名前の部分一致(大文字小文字無視)", () => {
  const hits = searchNodes(index, "unwavering vision");
  expect(hits.has("65225")).toBe(true);
  expect(hits.size).toBe(1);
});

it("stat テキストにも一致する", () => {
  const hits = searchNodes(index, "Quantity of Items found in your Maps");
  expect(hits.size).toBeGreaterThanOrEqual(15); // Item Quantity の minor 15個+同statを持つノード
  for (const id of hits) {
    const nd = data.nodes[id]!;
    const text = [nd.name ?? "", ...(nd.stats ?? [])].join("\n").toLowerCase();
    expect(text).toContain("quantity of items found in your maps");
  }
});

it("1文字から発動し、空・空白のみは非アクティブ", () => {
  expect(searchNodes(index, "").size).toBe(0);
  expect(searchNodes(index, "  ").size).toBe(0);
  expect(searchNodes(index, "a").size).toBeGreaterThan(0);
});

it("前後の空白は無視して一致する", () => {
  expect(searchNodes(index, "  Eater of Worlds  ").size).toBeGreaterThan(0);
});
