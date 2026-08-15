/**
 * Mastery の「同名つながり」の索引。
 *
 * 同じ Mastery(例: Abyss)はツリー上の複数クラスタに分かれて存在する。
 * mastery クリックの一括指定と hover 強調は「同名 mastery 全体の Notable」を対象にする
 * (ユーザ要望による仕様。グループ単位ではない)。
 */

import type { AtlasData } from "../data/graph";

export interface MasteryIndex {
  /** mastery ノードid → 同名 mastery 全クラスタの Notable id(ツリー全域) */
  readonly notables: ReadonlyMap<string, readonly string[]>;
  /** mastery ノードid → 同名の他 mastery ノードid */
  readonly siblings: ReadonlyMap<string, readonly string[]>;
}

export function buildMasteryIndex(data: AtlasData): MasteryIndex {
  const byName = new Map<string, string[]>();
  const notablesByGroup = new Map<number, string[]>();
  for (const [nid, nd] of Object.entries(data.nodes)) {
    if (nid === "root") continue;
    if (nd.isMastery) {
      const name = nd.name ?? "";
      let ids = byName.get(name);
      if (!ids) {
        ids = [];
        byName.set(name, ids);
      }
      ids.push(nid);
    } else if (nd.isNotable && nd.group !== undefined) {
      let ids = notablesByGroup.get(nd.group);
      if (!ids) {
        ids = [];
        notablesByGroup.set(nd.group, ids);
      }
      ids.push(nid);
    }
  }

  const notables = new Map<string, readonly string[]>();
  const siblings = new Map<string, readonly string[]>();
  for (const ids of byName.values()) {
    const union: string[] = [];
    for (const id of ids) {
      const group = data.nodes[id]?.group;
      if (group !== undefined) union.push(...(notablesByGroup.get(group) ?? []));
    }
    for (const id of ids) {
      notables.set(id, union);
      siblings.set(
        id,
        ids.filter((o) => o !== id),
      );
    }
  }
  return { notables, siblings };
}
