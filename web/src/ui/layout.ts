/**
 * ノードの世界座標とエッジ形状の計算。
 *
 * 座標式(PoE 標準、探索エージェントが実データで検算済み):
 *   θ = 2π · orbitIndex / skillsPerOrbit[orbit]   (12時方向から時計回り)
 *   x = group.x + orbitRadii[orbit] · sin θ
 *   y = group.y − orbitRadii[orbit] · cos θ
 *
 * 擬似ノード "root" は group 0(実在しない)を指すため捨てる。
 * 同グループ・同軌道(>0)のエッジは軌道弧、それ以外は直線として分類する。
 */

import type { AtlasData } from "../data/graph";

export interface LayoutNode {
  x: number;
  y: number;
  /** 弧の描画・角度計算用 */
  groupId: number;
  orbit: number;
  theta: number; // 12時から時計回りのラジアン
}

export interface LayoutEdge {
  u: string;
  v: string;
  kind: "line" | "arc";
  /** kind === "arc" のとき: 中心・半径・canvas角(+x軸基準)。a0→a1 を時計回り(canvas既定)に描くと短い方の弧になる */
  cx?: number;
  cy?: number;
  r?: number;
  a0?: number;
  a1?: number;
}

export interface TreeLayout {
  positions: Map<string, LayoutNode>;
  edges: LayoutEdge[];
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
}

const TAU = Math.PI * 2;

export function buildLayout(data: AtlasData): TreeLayout {
  const groups = data.groups;
  const constants = data.constants;
  if (!groups || !constants) {
    throw new Error("data.json lacks groups/constants — not a tree export?");
  }
  const { skillsPerOrbit, orbitRadii } = constants;

  const positions = new Map<string, LayoutNode>();
  for (const [nid, nd] of Object.entries(data.nodes)) {
    if (nid === "root") continue; // group 0 を指す擬似ノード。座標計算不能
    const group = groups[String(nd.group)];
    if (!group) throw new Error(`node ${nid}: group ${nd.group} not found`);
    const orbit = nd.orbit ?? 0;
    const perOrbit = skillsPerOrbit[orbit];
    const radius = orbitRadii[orbit];
    if (perOrbit === undefined || radius === undefined) {
      throw new Error(`node ${nid}: orbit ${orbit} out of range`);
    }
    const theta = (TAU * (nd.orbitIndex ?? 0)) / perOrbit;
    positions.set(nid, {
      x: group.x + radius * Math.sin(theta),
      y: group.y - radius * Math.cos(theta),
      groupId: nd.group ?? 0,
      orbit,
      theta,
    });
  }

  // エッジ収集(無向・重複排除)。mastery は装飾なので辺を張らない
  // (実データに in/out を持つ mastery が1個だけ存在する。グラフ層と同様に無視する)。
  // Wormhole 同士を結ぶ長距離辺も描画しない(ソルバーは使う。表示上の違和感対策)
  const edges: LayoutEdge[] = [];
  const seen = new Set<string>();
  for (const [nid, nd] of Object.entries(data.nodes)) {
    if (nid === "root" || nd.isMastery) continue;
    for (const other of [...(nd.out ?? []), ...(nd.in ?? [])]) {
      if (other === nid || other === "root") continue;
      const otherNode = data.nodes[other];
      if (otherNode?.isMastery) continue;
      if (nd.isWormhole && otherNode?.isWormhole) continue;
      if (!positions.has(other) || !positions.has(nid)) continue;
      const key = nid < other ? `${nid}|${other}` : `${other}|${nid}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push(classifyEdge(data, positions, nid, other));
    }
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of positions.values()) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }

  return { positions, edges, bounds: { minX, minY, maxX, maxY } };
}

function classifyEdge(
  data: AtlasData,
  positions: Map<string, LayoutNode>,
  u: string,
  v: string,
): LayoutEdge {
  const pu = positions.get(u)!;
  const pv = positions.get(v)!;
  if (pu.groupId !== pv.groupId || pu.orbit !== pv.orbit || pu.orbit === 0) {
    return { u, v, kind: "line" };
  }
  const group = data.groups![String(pu.groupId)]!;
  const r = data.constants!.orbitRadii[pu.orbit]!;
  // 12時基準のθ → canvas角(+x軸基準)は θ - π/2。
  // 短い方の角度経路を選び、a0→a1 を時計回り(canvas の anticlockwise=false)で描く
  let d = (pv.theta - pu.theta) % TAU;
  if (d < 0) d += TAU;
  const [t0, t1] = d <= Math.PI ? [pu.theta, pv.theta] : [pv.theta, pu.theta];
  return {
    u,
    v,
    kind: "arc",
    cx: group.x,
    cy: group.y,
    r,
    a0: t0 - Math.PI / 2,
    a1: t1 - Math.PI / 2,
  };
}
