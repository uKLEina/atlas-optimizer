/**
 * ファーム定番セットのワンクリック選択(ユーザ要望による3種+勢力2色)。
 *
 * ノード集合は id 直書きではなく stat テキストのパターンで抽出する
 * (リーグ更新で id が変わっても追従させるため)。
 * 勢力セット(Exarch/Eater)はユーザ指定により以下を除外する:
 *   - Implicit Modifier ドロップ率の minor(Item Chance)
 *   - 遭遇 double progress の Notable(Baptised by Fire / Etched by Acid)
 */

import type { AtlasData, AtlasGraph, AtlasNode } from "../data/graph";

export interface QuickSet {
  key: string;
  label: string;
  /** ボタンの色アクセント(勢力色)。無ければ既定の見た目 */
  accent?: string;
  ids: readonly string[];
}

const isMinor = (nd: AtlasNode): boolean =>
  !nd.isKeystone && !nd.isNotable && !nd.isWormhole && !nd.isMastery;

interface SetRule {
  key: string;
  label: string;
  accent?: string;
  include: (nd: AtlasNode, stats: readonly string[]) => boolean;
}

const influenceRule = (name: string) => {
  const exclude = /Implicit Modifier|double progress/;
  return (nd: AtlasNode, stats: readonly string[]): boolean =>
    stats.some((s) => s.includes(name)) && !stats.some((s) => exclude.test(s));
};

const RULES: readonly SetRule[] = [
  {
    key: "modEffect",
    label: "Map Mod Effect",
    include: (nd, stats) =>
      isMinor(nd) && stats.some((s) => /increased effect of Explicit Modifiers on your Maps/.test(s)),
  },
  {
    key: "quantity",
    label: "Item Quantity",
    include: (nd, stats) =>
      isMinor(nd) && stats.some((s) => /increased Quantity of Items found in your Maps/.test(s)),
  },
  {
    key: "exarch",
    label: "Searing Exarch",
    accent: "#e0563a",
    include: influenceRule("Searing Exarch"),
  },
  {
    key: "eater",
    label: "Eater of Worlds",
    accent: "#4a7fe0",
    include: influenceRule("Eater of Worlds"),
  },
];

export function buildQuickSets(data: AtlasData, g: AtlasGraph): QuickSet[] {
  return RULES.map((rule) => {
    const ids: string[] = [];
    for (const [nid, nd] of Object.entries(data.nodes)) {
      if (nid === "root" || !g.adj.has(nid)) continue; // mastery・擬似ノードは対象外
      if (rule.include(nd, nd.stats ?? [])) ids.push(nid);
    }
    ids.sort();
    return { key: rule.key, label: rule.label, accent: rule.accent, ids };
  });
}
