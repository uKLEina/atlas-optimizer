/**
 * 取得するとポイント予算が増えるノード(Unwavering Vision の +20 等)。
 * "Grants N Atlas Passive Skill Points" の stat テキストから抽出する
 * (id 直書きしない。リーグ更新・同種ノード追加に追従するため)。
 */

import type { AtlasData } from "../data/graph";

export function buildBonusPoints(data: AtlasData): ReadonlyMap<string, number> {
  const map = new Map<string, number>();
  for (const [nid, nd] of Object.entries(data.nodes)) {
    if (nid === "root") continue;
    for (const s of nd.stats ?? []) {
      const m = /Grants (\d+) Atlas Passive Skill Points/.exec(s);
      if (m) map.set(nid, (map.get(nid) ?? 0) + Number(m[1]));
    }
  }
  return map;
}

/** 解の予算 = 基本ポイント + 解に含まれるボーナスノード分 */
export function effectiveTotal(
  base: number,
  bonus: ReadonlyMap<string, number>,
  nodes: ReadonlySet<string> | undefined,
): number {
  let total = base;
  if (nodes) {
    for (const [nid, b] of bonus) if (nodes.has(nid)) total += b;
  }
  return total;
}
