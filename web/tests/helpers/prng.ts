/**
 * テスト用の決定的PRNG(mulberry32)。
 * Python の random.Random(seed) は JS で再現できないため、乱数を使うテストは
 * 不変量の検証のみに使い、具体値の検証は pyref 実行結果の埋め込みで行う。
 */

export type Rng = () => number;

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** lo..hi の一様整数(両端含む) */
export function randInt(rng: Rng, lo: number, hi: number): number {
  return lo + Math.floor(rng() * (hi - lo + 1));
}

/** 非復元抽出で k 個サンプリング(部分 Fisher–Yates) */
export function sample<T>(rng: Rng, arr: readonly T[], k: number): T[] {
  if (k > arr.length) throw new Error(`sample size ${k} > population ${arr.length}`);
  const pool = [...arr];
  for (let i = 0; i < k; i++) {
    const j = i + Math.floor(rng() * (pool.length - i));
    const tmp = pool[i]!;
    pool[i] = pool[j]!;
    pool[j] = tmp;
  }
  return pool.slice(0, k);
}

/** 1要素選ぶ */
export function choice<T>(rng: Rng, arr: readonly T[]): T {
  if (arr.length === 0) throw new Error("choice from empty array");
  return arr[Math.floor(rng() * arr.length)]!;
}
