/**
 * 前処理縮約と解の展開(pyref/atlasopt/reduction.py の移植)。
 *
 * 手順(DESIGN.md の通り):
 * 1. 除外ノードをグラフから削除
 * 2. root から到達不能になった terminal を無視リストへ(PoP踏襲。エラーにしない)
 * 3. 非terminalの葉を再帰的に刈り込み
 * 4. 非terminalの次数2ノードをチェーンごと重み付き辺に縮約(内部ノード数 = 辺重み)
 * 5. 平行辺は最小コストのみ残す(コスト = w + タイブレーク微小重み eps の和。
 *    同一 w の平行チェーンの選択はここで決まるため、eps 込みで比較する)
 *
 * 縮約辺は内部ノード列を保持し、ソルバーが使った辺を元のノード集合に展開できる。
 * pyref の networkx.MultiGraph は「辺レコード配列 + ノード→辺ID集合」で代替する。
 */

import { reachableFrom, type AtlasGraph } from "../data/graph";

export interface ReducedEdge {
  u: string; // u < v(辞書順)に正規化済み
  v: string;
  w: number; // 内部ノード数
  eps: number; // 内部ノードのタイブレーク重み和
  path: readonly string[]; // 内部ノード列(順序は幾何学的経路順とは限らない。集合として使う)
}

export interface ReducedGraph {
  readonly root: string;
  readonly terminals: readonly string[]; // rootを除く、到達可能なterminalのみ(辞書順)
  readonly ignoredTerminals: readonly string[]; // 除外/到達不能で無視されたterminal(辞書順)
  readonly nodes: ReadonlySet<string>;
  readonly edges: ReadonlyMap<string, ReducedEdge>; // キーは edgeKey(u, v)
}

export function edgeKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

interface MultiEdge {
  u: string;
  v: string;
  w: number;
  eps: number;
  path: string[];
  alive: boolean;
}

export function build(
  g: AtlasGraph,
  terminals: Iterable<string>,
  excluded: Iterable<string> = [],
  nodeWeights?: ReadonlyMap<string, number>,
): ReducedGraph {
  const wt = (n: string): number => nodeWeights?.get(n) ?? 0;
  const excludedSet = new Set(excluded);
  if (excludedSet.has(g.root)) {
    throw new Error("start node cannot be excluded");
  }
  const termList = [...terminals];
  const unknown = [...new Set([...termList, ...excludedSet])].filter((n) => !g.adj.has(n));
  if (unknown.length > 0) {
    throw new Error(`unknown or non-allocatable node ids: ${unknown.sort().join(", ")}`);
  }

  const reachable = reachableFrom(g.adj, g.root, excludedSet);
  const wanted = new Set(termList);
  wanted.delete(g.root);
  const ignored = [...wanted]
    .filter((t) => excludedSet.has(t) || !reachable.has(t))
    .sort();
  const ignoredSet = new Set(ignored);
  const terms = [...wanted].filter((t) => !ignoredSet.has(t)).sort();
  const keep = new Set([...terms, g.root]);

  // 到達可能部分だけで MultiGraph を作る(平行辺は縮約中に発生しうる)
  const edges: MultiEdge[] = [];
  const incident = new Map<string, Set<number>>();
  const aliveNodes = new Set<string>(reachable);
  for (const n of reachable) incident.set(n, new Set());

  const addEdge = (u: string, v: string, w: number, eps: number, path: string[]): void => {
    const id = edges.length;
    edges.push({ u, v, w, eps, path, alive: true });
    incident.get(u)!.add(id);
    incident.get(v)!.add(id);
  };
  const removeNode = (n: string): void => {
    for (const id of incident.get(n)!) {
      const e = edges[id]!;
      e.alive = false;
      incident.get(e.u === n ? e.v : e.u)!.delete(id);
    }
    incident.delete(n);
    aliveNodes.delete(n);
  };

  for (const u of reachable) {
    for (const v of g.adj.get(u)!) {
      if (reachable.has(v) && u < v) addEdge(u, v, 0, 0, []);
    }
  }

  let changed = true;
  while (changed) {
    changed = false;
    // 非terminalの葉(次数0含む)を刈る
    for (const n of [...aliveNodes]) {
      if (!keep.has(n) && incident.get(n)!.size <= 1) {
        removeNode(n);
        changed = true;
      }
    }
    // 非terminalの次数2ノードを縮約
    for (const n of [...aliveNodes]) {
      if (keep.has(n) || !aliveNodes.has(n) || incident.get(n)!.size !== 2) continue;
      const [id1, id2] = [...incident.get(n)!] as [number, number];
      const e1 = edges[id1]!;
      const e2 = edges[id2]!;
      const a = e1.u === n ? e1.v : e1.u;
      const b = e2.u === n ? e2.v : e2.u;
      removeNode(n);
      changed = true;
      if (a === b) continue; // チェーンが輪に潰れた。輪を経由する意味はないので捨てる
      addEdge(a, b, e1.w + e2.w + 1, e1.eps + e2.eps + wt(n), [...e1.path, n, ...e2.path]);
    }
  }

  // 平行辺は最小コスト(w + eps)のみ残して単純グラフ化(同値は先勝ち = pyref と同じ)
  const simple = new Map<string, ReducedEdge>();
  for (const e of edges) {
    if (!e.alive || e.u === e.v) continue;
    const key = edgeKey(e.u, e.v);
    const prev = simple.get(key);
    if (!prev || e.w + e.eps < prev.w + prev.eps) {
      const [u, v] = e.u < e.v ? [e.u, e.v] : [e.v, e.u];
      simple.set(key, { u, v, w: e.w, eps: e.eps, path: e.path });
    }
  }

  return {
    root: g.root,
    terminals: terms,
    ignoredTerminals: ignored,
    nodes: new Set(aliveNodes),
    edges: simple,
  };
}

/** 縮約グラフ上の解(コアノード集合+使用辺)を元グラフのノード集合へ展開する。 */
export function expand(
  reduced: ReducedGraph,
  coreNodes: Iterable<string>,
  usedEdges: Iterable<readonly [string, string]>,
): Set<string> {
  const sel = new Set(coreNodes);
  for (const [u, v] of usedEdges) {
    const e = reduced.edges.get(edgeKey(u, v));
    if (!e) throw new Error(`used edge not in reduced graph: ${u} - ${v}`);
    for (const p of e.path) sel.add(p);
  }
  return sel;
}
