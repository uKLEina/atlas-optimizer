import { expect, it } from "vitest";
import { buildBonusPoints, effectiveTotal } from "../src/ui/bonusPoints";
import { loadRawData } from "./helpers/data";

const data = loadRawData();
const bonus = buildBonusPoints(data);

it("ボーナスノードは Unwavering Vision(65225、+20)のみ", () => {
  expect([...bonus.entries()]).toEqual([["65225", 20]]);
  expect(data.nodes["65225"]!.name).toBe("Unwavering Vision");
});

it("effectiveTotal: 解に含まれる時だけ予算に加算する", () => {
  expect(effectiveTotal(138, bonus, undefined)).toBe(138);
  expect(effectiveTotal(138, bonus, new Set(["29045"]))).toBe(138);
  expect(effectiveTotal(138, bonus, new Set(["29045", "65225"]))).toBe(158);
});
