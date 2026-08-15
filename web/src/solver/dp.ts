/**
 * 木分解上の辞書式 Steiner DP。pyref/atlasopt/dp.py の移植(あちらが仕様原本)。
 *
 * ルート付き・ノード重み Steiner 木を、静的な木分解の上で厳密に解く。
 * DP の値は (points, eps) の辞書式ペアで、ポイント最小化とタイブレークが
 * 1パスで両方とも大域厳密に決まる。計算量は terminal 数に依存しない。
 *
 * nice 化・状態表現・遷移・タイの先勝ちまで pyref と決定的に一致させているため、
 * 同一入力に対して pyref とノード集合単位で同じ解を返す(crosscheck で照合)。
 * 連結性の保証・各遷移の意味は pyref 側 docstring と DESIGN.md 設計メモを参照。
 */

import { reachableFrom, type AtlasGraph } from "../data/graph";
import { buildDecomposition, type TreeDecomposition } from "./decomposition";
import type { SolveResult } from "./result";

type Cost = readonly [points: number, eps: number];

interface NiceNode {
  kind: "leaf" | "intro" | "forget" | "join";
  bag: readonly string[]; // 昇順
  children: readonly number[];
  v?: string;
}

function buildNice(td: TreeDecomposition): { nice: NiceNode[]; rootIdx: number } {
  const children = new Map<number, number[]>();
  td.parent.forEach((p, i) => {
    if (p >= 0) {
      if (!children.has(p)) children.set(p, []);
      children.get(p)!.push(i);
    }
  });
  for (const lst of children.values()) lst.sort((a, b) => a - b);

  const nice: NiceNode[] = [];
  const add = (
    kind: NiceNode["kind"],
    bag: readonly string[],
    ch: readonly number[],
    v?: string,
  ): number => {
    nice.push({ kind, bag, children: ch, v });
    return nice.length - 1;
  };

  // 反復的 post-order(木の縦深さが900級なので再帰は使わない)
  const order: number[] = [];
  const stack = [td.rootBag];
  while (stack.length > 0) {
    const i = stack.pop()!;
    order.push(i);
    stack.push(...(children.get(i) ?? []));
  }
  order.reverse();

  const bagSets = td.bags.map((b) => new Set(b));
  const resultOf = new Map<number, number>();
  for (const i of order) {
    const target = [...td.bags[i]!];
    const parts: number[] = [];
    for (const c of children.get(i) ?? []) {
      let idx = resultOf.get(c)!;
      const cur = new Set(td.bags[c]!);
      for (const v of [...td.bags[c]!].filter((x) => !bagSets[i]!.has(x)).sort()) {
        cur.delete(v);
        idx = add("forget", [...cur].sort(), [idx], v);
      }
      for (const v of target.filter((x) => !bagSets[c]!.has(x)).sort()) {
        cur.add(v);
        idx = add("intro", [...cur].sort(), [idx], v);
      }
      parts.push(idx);
    }
    if (parts.length === 0) {
      let idx = add("leaf", [], []);
      const cur = new Set<string>();
      for (const v of target) {
        cur.add(v);
        idx = add("intro", [...cur].sort(), [idx], v);
      }
      parts.push(idx);
    }
    let acc = parts[0]!;
    for (const other of parts.slice(1)) {
      acc = add("join", target, [acc, other]);
    }
    resultOf.set(i, acc);
  }
  return { nice, rootIdx: resultOf.get(td.rootBag)! };
}

/** ブロックidを出現順 0,1,2,… に振り直す(-1 は非選択のまま)。 */
function normalize(labels: readonly number[]): number[] {
  const mapping = new Map<number, number>();
  const out: number[] = [];
  for (const x of labels) {
    if (x < 0) out.push(-1);
    else {
      if (!mapping.has(x)) mapping.set(x, mapping.size);
      out.push(mapping.get(x)!);
    }
  }
  return out;
}

interface Entry {
  labels: readonly number[];
  cost: Cost;
  // intro → [childKey, selected] / forget → childKey / join → [lKey, rKey]
  back: unknown;
}

export interface DpOptions {
  excluded?: Iterable<string>;
  nodeWeights?: ReadonlyMap<string, number>;
  td?: TreeDecomposition;
}

export function solve(
  g: AtlasGraph,
  terminals: Iterable<string>,
  options: DpOptions = {},
): SolveResult {
  const { excluded = [], nodeWeights } = options;
  if (nodeWeights) {
    for (const w of nodeWeights.values()) {
      if (w < 0) throw new Error("nodeWeights must be non-negative");
    }
  }
  const wt = (v: string): number => nodeWeights?.get(v) ?? 0;
  const excludedSet = new Set(excluded);
  if (excludedSet.has(g.root)) throw new Error("start node cannot be excluded");
  const termList = [...terminals];
  const unknown = [...new Set([...termList, ...excludedSet])].filter((n) => !g.adj.has(n));
  if (unknown.length > 0) {
    throw new Error(`unknown or non-allocatable node ids: ${unknown.sort().join(", ")}`);
  }

  const reachable = reachableFrom(g.adj, g.root, excludedSet);
  const wanted = new Set(termList);
  wanted.delete(g.root);
  const ignored = [...wanted].filter((t) => excludedSet.has(t) || !reachable.has(t)).sort();
  const ignoredSet = new Set(ignored);
  const terms = new Set([...wanted].filter((t) => !ignoredSet.has(t)));
  if (terms.size === 0) {
    return {
      points: 0,
      nodes: new Set([g.root]),
      status: "optimal",
      dualBound: 0,
      ignoredTerminals: ignored,
      solveTime: 0,
    };
  }

  const t0 = performance.now();
  const td = options.td ?? buildDecomposition(g.adj, g.root);
  const { nice, rootIdx } = buildNice(td);
  const forced = new Set([...terms, g.root]);

  const vpts = (v: string): number => (v === g.root ? 0 : 1);
  const veps = (v: string): number => (v === g.root ? 0 : wt(v));
  const keyOf = (labels: readonly number[]): string => labels.join(",");

  const tables: Map<string, Entry>[] = nice.map(() => new Map());
  const put = (table: Map<string, Entry>, labels: number[], cost: Cost, back: unknown): void => {
    const key = keyOf(labels);
    const prev = table.get(key);
    if (
      prev === undefined ||
      cost[0] < prev.cost[0] ||
      (cost[0] === prev.cost[0] && cost[1] < prev.cost[1])
    ) {
      table.set(key, { labels, cost, back });
    }
  };

  for (let i = 0; i < nice.length; i++) {
    const node = nice[i]!;
    const table = tables[i]!;

    if (node.kind === "leaf") {
      table.set("", { labels: [], cost: [0, 0], back: null });
      continue;
    }

    if (node.kind === "intro") {
      const v = node.v!;
      const ci = node.children[0]!;
      const pv = node.bag.indexOf(v);
      const nbrPos: number[] = [];
      node.bag.forEach((u, p) => {
        if (u !== v && g.adj.get(v)!.has(u)) nbrPos.push(p);
      });
      const selectable = !excludedSet.has(v) && reachable.has(v);
      const isForced = forced.has(v);
      for (const [ck, entry] of tables[ci]!) {
        const cc = entry.cost;
        const base = [...entry.labels.slice(0, pv), -2, ...entry.labels.slice(pv)];
        if (!isForced) {
          const ns = [...base];
          ns[pv] = -1;
          put(table, normalize(ns), cc, [ck, false]);
        }
        if (selectable) {
          const lab = [...base];
          let newId = -1;
          for (const x of lab) if (x >= 0 && x > newId) newId = x;
          newId += 1;
          lab[pv] = newId;
          // v と隣接する選択済み頂点のブロックを併合(辺コストは無いので常に併合してよい)
          const merge = new Set<number>();
          for (const p of nbrPos) if (lab[p]! >= 0 && p !== pv) merge.add(lab[p]!);
          if (merge.size > 0) {
            merge.add(newId);
            const tgt = Math.min(...merge);
            for (let p = 0; p < lab.length; p++) {
              if (merge.has(lab[p]!)) lab[p] = tgt;
            }
          }
          put(table, normalize(lab), [cc[0] + vpts(v), cc[1] + veps(v)], [ck, true]);
        }
      }
      continue;
    }

    if (node.kind === "forget") {
      const v = node.v!;
      const ci = node.children[0]!;
      const pv = nice[ci]!.bag.indexOf(v);
      for (const [ck, entry] of tables[ci]!) {
        const lbl = entry.labels[pv]!;
        if (lbl >= 0 && entry.labels.filter((x) => x === lbl).length === 1) {
          continue; // ブロック唯一の頂点を忘れる = その成分は root に繋がれない
        }
        const rest = entry.labels.filter((_, p) => p !== pv);
        put(table, normalize(rest), entry.cost, ck);
      }
      continue;
    }

    // join
    const [li, ri] = node.children as [number, number];
    const bag = node.bag;
    const byMask = new Map<string, [string, Entry][]>();
    for (const [rk, entry] of tables[ri]!) {
      const mask = entry.labels.map((x) => (x >= 0 ? "1" : "0")).join("");
      if (!byMask.has(mask)) byMask.set(mask, []);
      byMask.get(mask)!.push([rk, entry]);
    }
    for (const [lk, lentry] of tables[li]!) {
      const mask = lentry.labels.map((x) => (x >= 0 ? "1" : "0")).join("");
      const partners = byMask.get(mask);
      if (!partners) continue;
      let dpPts = 0;
      let dpEps = 0;
      bag.forEach((u, p) => {
        if (lentry.labels[p]! >= 0) {
          dpPts += vpts(u);
          dpEps += veps(u);
        }
      });
      for (const [rk, rentry] of partners) {
        // 位置 union-find でブロック併合
        const parent = bag.map((_, p) => p);
        const find = (x: number): number => {
          while (parent[x]! !== x) {
            parent[x] = parent[parent[x]!]!;
            x = parent[x]!;
          }
          return x;
        };
        for (const key2 of [lentry.labels, rentry.labels]) {
          const first = new Map<number, number>();
          key2.forEach((x, p) => {
            if (x >= 0) {
              if (first.has(x)) {
                const ra = find(first.get(x)!);
                const rb = find(p);
                if (ra !== rb) parent[rb] = ra;
              } else {
                first.set(x, p);
              }
            }
          });
        }
        const lab = bag.map((_, p) => (lentry.labels[p]! >= 0 ? find(p) : -1));
        put(
          table,
          normalize(lab),
          [lentry.cost[0] + rentry.cost[0] - dpPts, lentry.cost[1] + rentry.cost[1] - dpEps],
          [lk, rk],
        );
      }
    }
  }

  // 根 bag: ブロックがちょうど1個の状態が連結解。root は forced なので必ずそのブロックに居る
  const rootTable = tables[rootIdx]!;
  let bestKey: string | null = null;
  let bestCost: Cost | null = null;
  for (const [key, entry] of rootTable) {
    const blocks = new Set(entry.labels.filter((x) => x >= 0));
    if (blocks.size !== 1) continue;
    if (
      bestCost === null ||
      entry.cost[0] < bestCost[0] ||
      (entry.cost[0] === bestCost[0] && entry.cost[1] < bestCost[1])
    ) {
      bestCost = entry.cost;
      bestKey = key;
    }
  }
  if (bestKey === null) {
    // terminal が到達不能なら ignored 済みのため、ここには来ないはず
    return {
      points: -1,
      nodes: new Set(),
      status: "infeasible",
      ignoredTerminals: ignored,
      solveTime: (performance.now() - t0) / 1000,
    };
  }

  // バックポインタを辿って選択ノードを復元
  const nodes = new Set<string>();
  const stack2: [number, string][] = [[rootIdx, bestKey]];
  while (stack2.length > 0) {
    const [i, key] = stack2.pop()!;
    const node = nice[i]!;
    const back = tables[i]!.get(key)!.back;
    if (node.kind === "leaf") continue;
    if (node.kind === "intro") {
      const [ck, selected] = back as [string, boolean];
      if (selected) nodes.add(node.v!);
      stack2.push([node.children[0]!, ck]);
    } else if (node.kind === "forget") {
      stack2.push([node.children[0]!, back as string]);
    } else {
      const [lk, rk] = back as [string, string];
      stack2.push([node.children[0]!, lk]);
      stack2.push([node.children[1]!, rk]);
    }
  }

  return {
    points: nodes.size - 1,
    nodes,
    status: "optimal",
    dualBound: nodes.size - 1,
    ignoredTerminals: ignored,
    solveTime: (performance.now() - t0) / 1000,
  };
}
