/**
 * data.json からのグラフ構築(pyref/atlasopt/graph.py の移植)。
 *
 * - mastery ノード(グループ中央の飾り、辺なし)は除外する
 * - データ上の擬似ノード "root" は捨て、スタートノード 29045 を root として扱う
 * - root のコストは 0、他は全ノード 1(Atlas Tree の仕様)
 * - 辺は in/out を統合して無向として扱う
 *
 * pyref と違いファイルI/Oは持たない。パース済み JSON を受け取る純関数のみ
 * (Node のテストは tests/helpers/data.ts、ブラウザは fetch(M4)がI/Oを担当)。
 */

export const ROOT_ID = "29045"; // スタートノード(名前空)。ポイントを消費しない

const PSEUDO_ROOT = "root";

export interface AtlasNode {
  skill?: number;
  name?: string;
  icon?: string;
  stats?: string[];
  reminderText?: string[];
  flavourText?: string[];
  group?: number;
  orbit?: number;
  orbitIndex?: number;
  isMastery?: boolean;
  isNotable?: boolean;
  isKeystone?: boolean;
  isWormhole?: boolean;
  grantedPassivePoints?: number;
  in?: string[];
  out?: string[];
  [key: string]: unknown;
}

export interface AtlasGroup {
  x: number;
  y: number;
  orbits: number[]; // 信頼できない(実ノードと食い違うグループがある)。描画ヒント程度
  nodes: string[];
  background?: { image: string; offsetX?: number; offsetY?: number };
}

export interface SpriteCoord {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface SpriteSheet {
  filename: string; // CDN URL。basename がローカル assets/ のファイル名
  coords: Record<string, SpriteCoord>;
}

export interface AtlasData {
  nodes: Record<string, AtlasNode>;
  groups?: Record<string, AtlasGroup>;
  constants?: {
    skillsPerOrbit: number[];
    orbitRadii: number[];
    [key: string]: unknown;
  };
  /** カテゴリ名 → ズームキー(文字列) → シート。ズームキーは imageZoomLevels でなくここから導出する */
  sprites?: Record<string, Record<string, SpriteSheet>>;
  points?: { totalPoints?: number };
  [key: string]: unknown;
}

export interface AtlasGraph {
  readonly adj: ReadonlyMap<string, ReadonlySet<string>>;
  readonly info: ReadonlyMap<string, AtlasNode>; // 生のノード情報(mastery・擬似rootを除く)
  readonly masteryNotables: ReadonlyMap<string, readonly string[]>; // masteryノードid -> 同グループのNotable id
  readonly root: string;
}

export function cost(g: AtlasGraph, node: string): number {
  return node === g.root ? 0 : 1;
}

export function buildGraph(data: AtlasData): AtlasGraph {
  const nodes = data.nodes;

  const isGraphNode = (nid: string): boolean =>
    nid !== PSEUDO_ROOT && !nodes[nid]?.isMastery;

  const adj = new Map<string, Set<string>>();
  for (const nid of Object.keys(nodes)) {
    if (isGraphNode(nid)) adj.set(nid, new Set());
  }
  for (const [nid, nd] of Object.entries(nodes)) {
    if (!isGraphNode(nid)) continue;
    for (const other of [...(nd.out ?? []), ...(nd.in ?? [])]) {
      if (other !== nid && adj.has(other)) {
        adj.get(nid)!.add(other);
        adj.get(other)!.add(nid);
      }
    }
  }

  if (!adj.has(ROOT_ID)) {
    throw new Error(`start node ${ROOT_ID} not found in data`);
  }

  const notablesByGroup = new Map<number, string[]>();
  for (const [nid, nd] of Object.entries(nodes)) {
    if (nid !== PSEUDO_ROOT && nd.isNotable && nd.group !== undefined) {
      let bucket = notablesByGroup.get(nd.group);
      if (!bucket) {
        bucket = [];
        notablesByGroup.set(nd.group, bucket);
      }
      bucket.push(nid);
    }
  }
  const masteryNotables = new Map<string, readonly string[]>();
  for (const [nid, nd] of Object.entries(nodes)) {
    if (nid !== PSEUDO_ROOT && nd.isMastery) {
      masteryNotables.set(
        nid,
        nd.group !== undefined ? (notablesByGroup.get(nd.group) ?? []) : [],
      );
    }
  }

  const info = new Map<string, AtlasNode>();
  for (const nid of adj.keys()) info.set(nid, nodes[nid]!);

  return { adj, info, masteryNotables, root: ROOT_ID };
}

/** banned を通らずに start から到達できるノード集合(start含む)。反復DFS。 */
export function reachableFrom(
  adj: ReadonlyMap<string, ReadonlySet<string>>,
  start: string,
  banned: ReadonlySet<string> = new Set(),
): Set<string> {
  if (banned.has(start) || !adj.has(start)) return new Set();
  const seen = new Set([start]);
  const stack = [start];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    for (const nxt of adj.get(cur)!) {
      if (!seen.has(nxt) && !banned.has(nxt)) {
        seen.add(nxt);
        stack.push(nxt);
      }
    }
  }
  return seen;
}
