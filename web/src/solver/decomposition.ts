/**
 * 木分解(min-fill ヒューリスティック)と妥当性検証。
 * pyref/atlasopt/decomposition.py の移植(あちらが仕様原本)。
 *
 * 消去順・親の決め方・根の付け替えまで pyref と決定的に一致させている
 * (タイは (fill, degree, id) の辞書式。id 比較は ASCII なので Python と同順)。
 * 分解はグラフ構造のみに依存するため worker 初期化時に一度計算すればよい。
 */

export interface TreeDecomposition {
  /** 各 bag の頂点(昇順) */
  readonly bags: readonly (readonly string[])[];
  /** 各 bag の親 index(根は -1) */
  readonly parent: readonly number[];
  /** root ノードを含む bag(分解木の根) */
  readonly rootBag: number;
  readonly width: number;
}

type Adj = ReadonlyMap<string, ReadonlySet<string>>;

export function buildDecomposition(adj: Adj, root: string): TreeDecomposition {
  if (!adj.has(root)) throw new Error(`root ${root} not in graph`);
  const nbrs = new Map<string, Set<string>>();
  for (const [v, ns] of adj) nbrs.set(v, new Set(ns));

  const fillCount = (v: string): number => {
    const ns = nbrs.get(v)!;
    let cnt = 0;
    for (const a of ns) {
      const an = nbrs.get(a)!;
      let missing = 0;
      for (const b of ns) if (b !== a && !an.has(b)) missing++;
      cnt += missing;
    }
    return cnt / 2;
  };

  const fills = new Map<string, number>();
  for (const v of nbrs.keys()) fills.set(v, fillCount(v));

  const order: string[] = [];
  const bags: string[][] = [];
  const bagNbrs: Set<string>[] = [];
  const remaining = new Set(nbrs.keys());
  while (remaining.size > 0) {
    // (fill, degree, id) の辞書式最小(id で全順序なので一意)
    let v: string | null = null;
    for (const x of remaining) {
      if (v === null) {
        v = x;
        continue;
      }
      const fx = fills.get(x)!;
      const fv = fills.get(v)!;
      const dx = nbrs.get(x)!.size;
      const dv = nbrs.get(v)!.size;
      if (fx < fv || (fx === fv && (dx < dv || (dx === dv && x < v)))) v = x;
    }
    const ns = new Set(nbrs.get(v!)!);
    order.push(v!);
    bags.push([v!, ...ns].sort());
    bagNbrs.push(ns);
    for (const a of ns) {
      const an = nbrs.get(a)!;
      for (const b of ns) if (b !== a) an.add(b);
      an.delete(v!);
    }
    nbrs.delete(v!);
    remaining.delete(v!);
    // fill 値が変わりうるのは近傍とその近傍だけ
    const dirty = new Set(ns);
    for (const a of ns) for (const b of nbrs.get(a)!) dirty.add(b);
    for (const a of dirty) if (remaining.has(a)) fills.set(a, fillCount(a));
  }

  // 消去順による木(forest)を作り、root ノードを含む bag へ根を付け替える
  const pos = new Map(order.map((v, i) => [v, i] as const));
  const treeAdj: Set<number>[] = bags.map(() => new Set());
  bagNbrs.forEach((ns, i) => {
    if (ns.size > 0) {
      let p = -1;
      for (const a of ns) {
        const pa = pos.get(a)!;
        if (p === -1 || pa < p) p = pa;
      }
      treeAdj[i]!.add(p);
      treeAdj[p]!.add(i);
    }
  });

  let rootBag = -1;
  for (let i = 0; i < bags.length; i++) {
    if (bags[i]!.includes(root)) {
      rootBag = i;
      break;
    }
  }
  const parent = new Array<number>(bags.length).fill(-1);
  const seen = new Set([rootBag]);
  const stack = [rootBag];
  while (stack.length > 0) {
    const i = stack.pop()!;
    for (const j of treeAdj[i]!) {
      if (!seen.has(j)) {
        seen.add(j);
        parent[j] = i;
        stack.push(j);
      }
    }
  }
  if (seen.size !== bags.length) {
    throw new Error("decomposition tree is not connected"); // 連結グラフでは起きない
  }

  const width = Math.max(...bags.map((b) => b.length)) - 1;
  return { bags, parent, rootBag, width };
}

/** 木分解の3条件を検証し、問題点のリストを返す(空なら妥当)。 */
export function verify(adj: Adj, td: TreeDecomposition, root?: string): string[] {
  const problems: string[] = [];
  const nBags = td.bags.length;
  const bagSets = td.bags.map((b) => new Set(b));

  if (!(td.rootBag >= 0 && td.rootBag < nBags)) problems.push("rootBag out of range");
  else if (td.parent[td.rootBag] !== -1) problems.push("rootBag has a parent");
  if (td.parent.filter((p) => p === -1).length !== 1) {
    problems.push("parent array has multiple roots");
  }
  if (root !== undefined && !bagSets[td.rootBag]!.has(root)) {
    problems.push("root node not in rootBag");
  }

  // (1) 全頂点被覆
  const covered = new Set<string>();
  for (const b of td.bags) for (const v of b) covered.add(v);
  for (const v of adj.keys()) {
    if (!covered.has(v)) problems.push(`vertex not covered: ${v}`);
  }

  // (2) 全辺被覆
  for (const [u, ns] of adj) {
    for (const v of ns) {
      if (u < v && !bagSets.some((b) => b.has(u) && b.has(v))) {
        problems.push(`edge not covered: ${u}-${v}`);
      }
    }
  }

  // (3) running intersection: 連結 ⇔ (bag数) - (親子とも含む木辺数) == 1
  const bagsOf = new Map<string, number[]>();
  bagSets.forEach((b, i) => {
    for (const v of b) {
      if (!bagsOf.has(v)) bagsOf.set(v, []);
      bagsOf.get(v)!.push(i);
    }
  });
  for (const [v, idxs] of bagsOf) {
    const edges = idxs.filter(
      (i) => td.parent[i]! !== -1 && bagSets[td.parent[i]!]!.has(v),
    ).length;
    if (idxs.length - edges !== 1) problems.push(`running intersection violated for ${v}`);
  }

  if (td.width !== Math.max(...td.bags.map((b) => b.length)) - 1) {
    problems.push("width mismatch");
  }
  return problems;
}
