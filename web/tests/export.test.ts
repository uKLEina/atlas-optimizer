import { expect, it } from "vitest";
import { decodeUrl, encodeUrl } from "../src/export/poeplanner";
import { mulberry32, sample } from "./helpers/prng";

// セッション中にPoE Plannerで実際に開けることを確認したURL(スタート+隣接2ノード)
const KNOWN_URL =
  "https://poeplanner.com/atlas-tree/BQAcAAADAHVxT_fEphQAH4sIAAAAAAAC_wMAAAAAAAAAAAA=";

it("roundtrip", () => {
  const rng = mulberry32(0);
  const all = Array.from({ length: 65535 }, (_, i) => i + 1);
  const ids = sample(rng, all, 140);
  const url = encodeUrl(ids);
  const d = decodeUrl(url);
  expect(d.nodeIds).toEqual([...ids].sort((a, b) => a - b));
  expect(d.serializationVersion).toBe(5);
  expect(d.treeVersion).toBe(28);
  expect(d.isPoe2).toBe(false);
  expect(d.notes).toBe("");
});

it("実地検証済みURLが正しく読める(形式の理解が壊れたら即検知)", () => {
  const d = decodeUrl(KNOWN_URL);
  expect(d.serializationVersion).toBe(5);
  expect(d.treeVersion).toBe(28);
  expect(d.isPoe2).toBe(false);
  expect([...d.nodeIds].sort((a, b) => a - b)).toEqual([29045, 42692, 63311]);
  expect(d.notes).toBe("");
  // 同じ集合を再エンコードしても意味的に同一(IDはソートされる)
  expect(decodeUrl(encodeUrl(d.nodeIds)).nodeIds).toEqual(
    [...d.nodeIds].sort((a, b) => a - b),
  );
});

it("notes roundtrip", () => {
  const url = encodeUrl([29045], undefined, "hello Atlas");
  expect(decodeUrl(url).notes).toBe("hello Atlas");
});

it("u16 範囲外の id は拒否する", () => {
  expect(() => encodeUrl([65536])).toThrow(/u16/);
  expect(() => encodeUrl([-1])).toThrow(/u16/);
});
