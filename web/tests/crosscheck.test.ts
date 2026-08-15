/**
 * pyref との乱数照合(fuzz ピラミッドの越境版)。
 *
 * pyref/crosscheck.py が生成したケース+期待値(検証済みオラクル)に対して、
 * TS ソルバーの points / ignoredTerminals / 最適性証明が全一致することを確認する。
 * ノード集合は同点最適が複数ありうるため比較しない(fuzz.py と同じ判断)。
 *
 * 加えて4ケースに1回、本番と同じタイブレーク重み付きでも解き、
 * ポイント最適性が保存されること(重みが厳密性を壊さないこと)を検証する。
 *
 * 実行: npm run crosscheck
 * 別ケースファイル: CROSSCHECK_CASES=/path/to/cases.json npm run crosscheck
 * (通常の npm test からは vite.config.ts の test.exclude で除外されている)
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { loadSolver } from "../src/solver/highs";
import { solve } from "../src/solver/ilpReduced";
import { TiebreakIndex } from "../src/solver/tiebreak";
import { validate } from "../src/solver/validate";
import { loadGraph, loadRawData } from "./helpers/data";

interface CrosscheckCase {
  id: number;
  terminals: string[];
  excluded: string[];
  expected: { points: number; ignored: string[] };
  pyrefSolveTime?: number;
}

interface CrosscheckFile {
  meta: { seed: number; emitted: number; dataNodes: number; dataEdges: number };
  cases: CrosscheckCase[];
}

const here = path.dirname(fileURLToPath(import.meta.url));
const casesFile =
  process.env["CROSSCHECK_CASES"] ?? path.join(here, "fixtures", "crosscheck.json");
const doc = JSON.parse(readFileSync(casesFile, "utf-8")) as CrosscheckFile;

const g = loadGraph();
const highs = await loadSolver();
const tiebreak = new TiebreakIndex(loadRawData(), g);

// fixture 生成時のグラフと今のグラフが同じであること(リーグ更新の検知)
if (doc.meta.dataNodes !== g.adj.size) {
  throw new Error(
    `crosscheck fixture was generated for a different data.json ` +
      `(fixture: ${doc.meta.dataNodes} nodes, current: ${g.adj.size}) — ` +
      `pyref/crosscheck.py で再生成すること`,
  );
}

let tsTotal = 0;
let pyrefTotal = 0;

describe(`crosscheck: ${path.basename(casesFile)}(${doc.cases.length}ケース、seed=${doc.meta.seed})`, () => {
  for (const c of doc.cases) {
    it(
      `case ${c.id}(K=${c.terminals.length}, excl=${c.excluded.length})`,
      { timeout: 120_000 },
      () => {
        const res = solve(highs, g, c.terminals, { excluded: c.excluded });
        tsTotal += res.solveTime;
        pyrefTotal += c.pyrefSolveTime ?? 0;
        expect(res.status).toBe("optimal");
        expect(res.points).toBe(c.expected.points);
        expect([...res.ignoredTerminals]).toEqual(c.expected.ignored);
        expect(validate(g, res, c.terminals, c.excluded)).toEqual([]);

        // タイブレーク重み付きでもポイント最適性が保存されること
        if (c.id % 4 === 0) {
          const weighted = solve(highs, g, c.terminals, {
            excluded: c.excluded,
            nodeWeights: tiebreak.weightsFor(c.terminals),
          });
          tsTotal += weighted.solveTime;
          expect(weighted.status).toBe("optimal");
          expect(weighted.points).toBe(c.expected.points);
          expect(validate(g, weighted, c.terminals, c.excluded)).toEqual([]);
        }
      },
    );
  }

  afterAll(() => {
    console.log(
      `crosscheck solve time: ts=${tsTotal.toFixed(1)}s / pyref=${pyrefTotal.toFixed(1)}s`,
    );
  });
});
