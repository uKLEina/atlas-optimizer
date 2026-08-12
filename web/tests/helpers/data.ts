/**
 * Node 環境(Vitest)での data.json 読み込み。パス解決順は pyref/atlasopt/graph.py と同じ:
 * vendor/atlastree-export/data.json → リポジトリ直下の data.json
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildGraph, type AtlasData, type AtlasGraph } from "../../src/data/graph";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const candidates = [
  path.join(repoRoot, "vendor", "atlastree-export", "data.json"),
  path.join(repoRoot, "data.json"),
];

export function loadRawData(): AtlasData {
  for (const p of candidates) {
    if (existsSync(p)) return JSON.parse(readFileSync(p, "utf-8")) as AtlasData;
  }
  throw new Error(
    `data.json not found — run \`git submodule update --init\` (searched: ${candidates.join(", ")})`,
  );
}

let cached: AtlasGraph | undefined;

export function loadGraph(): AtlasGraph {
  cached ??= buildGraph(loadRawData());
  return cached;
}
