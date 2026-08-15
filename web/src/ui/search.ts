/**
 * ノード検索: 名前+stat テキストへの部分一致(大文字小文字無視)。
 * 1文字目から発動する(2文字下限は「効いていないように感じる」とのレビューで撤廃)。
 */

import type { AtlasData } from "../data/graph";

export const MIN_QUERY_LENGTH = 1;

export type SearchIndex = ReadonlyMap<string, string>;

/** ノードid → 検索対象テキスト(小文字)。名前も stat も無いノードは含めない */
export function buildSearchIndex(data: AtlasData): SearchIndex {
  const index = new Map<string, string>();
  for (const [nid, nd] of Object.entries(data.nodes)) {
    if (nid === "root") continue;
    const text = [nd.name ?? "", ...(nd.stats ?? [])].join("\n").toLowerCase();
    if (text.trim()) index.set(nid, text);
  }
  return index;
}

export function searchNodes(index: SearchIndex, query: string): ReadonlySet<string> {
  const q = query.trim().toLowerCase();
  const hits = new Set<string>();
  if (q.length < MIN_QUERY_LENGTH) return hits;
  for (const [nid, text] of index) {
    if (text.includes(q)) hits.add(nid);
  }
  return hits;
}
