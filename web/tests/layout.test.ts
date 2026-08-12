import { expect, it } from "vitest";
import { buildLayout } from "../src/ui/layout";
import { loadRawData } from "./helpers/data";

const data = loadRawData();
const layout = buildLayout(data);

it("座標式ゴールデン(探索エージェントが実データで検算した6ノード)", () => {
  const expected: Record<string, [number, number]> = {
    "29045": [-0.39, 0.23],
    "63311": [-889.53, -550.99],
    "42692": [-423.38, -732.42],
    "55117": [422.61, -732.42],
    "64048": [-1.66, -926.92],
    "44775": [886.44, -561.57],
  };
  for (const [id, [x, y]] of Object.entries(expected)) {
    const p = layout.positions.get(id);
    expect(p, id).toBeDefined();
    expect(p!.x).toBeCloseTo(x, 1);
    expect(p!.y).toBeCloseTo(y, 1);
  }
});

it("全実ノードに座標がある(擬似rootは無い)", () => {
  expect(layout.positions.size).toBe(Object.keys(data.nodes).length - 1);
  expect(layout.positions.has("root")).toBe(false);
});

it("エッジは1003本、重複なし、弧は諸元を持つ", () => {
  expect(layout.edges.length).toBe(1003);
  const seen = new Set<string>();
  let arcs = 0;
  for (const e of layout.edges) {
    const key = e.u < e.v ? `${e.u}|${e.v}` : `${e.v}|${e.u}`;
    expect(seen.has(key)).toBe(false);
    seen.add(key);
    if (e.kind === "arc") {
      arcs++;
      expect(e.r).toBeGreaterThan(0);
      expect(e.cx).toBeDefined();
      expect(e.a0).toBeDefined();
      expect(e.a1).toBeDefined();
      // 短い方の弧を選んでいる(a0→a1 の時計回り角度が π 以下)
      let d = (e.a1! - e.a0!) % (Math.PI * 2);
      if (d < 0) d += Math.PI * 2;
      expect(d).toBeLessThanOrEqual(Math.PI + 1e-9);
    }
  }
  // 同グループ・同軌道のエッジが過半数(探索実測 ~56%)
  expect(arcs).toBeGreaterThan(500);
  expect(arcs).toBeLessThan(700);
});

it("世界範囲が探索実測と整合", () => {
  const b = layout.bounds;
  expect(b.minX).toBeCloseTo(-5843.5, 0);
  expect(b.maxX).toBeCloseTo(5861.2, 0);
  expect(b.minY).toBeCloseTo(-10833.1, 0);
  expect(b.maxY).toBeCloseTo(0.23, 0);
});
