/**
 * 同点最適解のタイブレーク方針(ユーザ要望 2026-08-15)。
 *
 * 経路(travel node)の選好。優先度の高い順:
 *   0. ユーザが指定したノードが属する Mastery グループのノード(「ただし」ルール)
 *   1. Mastery グループに属さない: increased effect of Explicit Modifiers
 *   2. 同: increased Rarity of Items
 *   3. 同: increased Quantity of Items
 *   4. 同: increased Scarabs found
 *   5. 同: increased Maps found
 *   6. 同: その他
 *   7. 指定と無関係な Mastery グループのノード(なるべく通らない)
 *
 * 重みは整数ティア(0〜7)そのもの。2フェーズ辞書式(ilpReduced 参照)なので
 * 重みは主目的に混ざらず、スケールは相対比較にしか使われない。
 * 整数にするのはフェーズ2の目的関数の整数性(=ソルバーの枝刈り)のため。
 * 複数 stat を持つノードは最も優先度の高い(小さい)tier を採用する。
 */

import type { AtlasData, AtlasGraph } from "../data/graph";

const TRAVEL_TIERS: readonly (readonly [RegExp, number])[] = [
  [/increased effect of Explicit Modifiers on your Maps/i, 1],
  [/increased Rarity of Items found in your Maps/i, 2],
  [/increased Quantity of Items found in your Maps/i, 3],
  [/increased Scarabs found in your Maps/i, 4],
  [/increased Maps found in your Maps/i, 5],
];
const TIER_OTHER = 6;
const TIER_INACTIVE_MASTERY = 7;

export class TiebreakIndex {
  /** ノード → 属する Mastery グループ id(Mastery を持つグループのみ) */
  private readonly masteryGroupOf = new Map<string, number>();
  /** Mastery グループに属さないノード → tier(1〜6) */
  private readonly travelTier = new Map<string, number>();

  constructor(data: AtlasData, g: AtlasGraph) {
    const masteryGroups = new Set<number>();
    for (const [nid, nd] of Object.entries(data.nodes)) {
      if (nid !== "root" && nd.isMastery && nd.group !== undefined) {
        masteryGroups.add(nd.group);
      }
    }
    for (const nid of g.adj.keys()) {
      if (nid === g.root) continue;
      const nd = data.nodes[nid];
      if (!nd) continue;
      if (nd.group !== undefined && masteryGroups.has(nd.group)) {
        this.masteryGroupOf.set(nid, nd.group);
        continue;
      }
      let tier = TIER_OTHER;
      for (const [re, t] of TRAVEL_TIERS) {
        if (nd.stats?.some((s) => re.test(s))) {
          tier = t;
          break; // TRAVEL_TIERS は優先度順なので最初の一致が最小 tier
        }
      }
      this.travelTier.set(nid, tier);
    }
  }

  /**
   * 現在の指定(terminals)に応じた eps マップを返す。
   * terminal が属する Mastery グループは「アクティブ」となり最優先(eps 0)。
   */
  weightsFor(terminals: Iterable<string>): Map<string, number> {
    const activeGroups = new Set<number>();
    for (const t of terminals) {
      const grp = this.masteryGroupOf.get(t);
      if (grp !== undefined) activeGroups.add(grp);
    }
    const weights = new Map<string, number>();
    for (const [nid, grp] of this.masteryGroupOf) {
      if (!activeGroups.has(grp)) weights.set(nid, TIER_INACTIVE_MASTERY);
      // アクティブグループは tier 0 = 重みなし(マップに入れない)
    }
    for (const [nid, tier] of this.travelTier) {
      weights.set(nid, tier);
    }
    return weights;
  }
}
