import highsLoader from "highs";

export type Highs = Awaited<ReturnType<typeof highsLoader>>;
export type HighsSolution = ReturnType<Highs["solve"]>;

let instance: Promise<Highs> | undefined;

/**
 * highs-js を初期化する。初回呼び出しでロードし、以後は同一インスタンスを返す。
 *
 * WASM の解決はブラウザと Node で異なる:
 * - Node(Vitest): パッケージ内の build/highs.wasm が自動で見つかるため引数不要
 * - ブラウザ(Vite): `import wasmUrl from "highs/runtime?url"` した URL を
 *   locateFile で渡す(src/main.ts 参照)
 */
export function loadSolver(
  locateFile?: (file: string) => string,
): Promise<Highs> {
  instance ??= highsLoader(locateFile ? { locateFile } : undefined);
  return instance;
}
