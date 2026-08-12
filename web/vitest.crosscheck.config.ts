/**
 * crosscheck 専用の Vitest 設定。
 * 通常の vite.config.ts は crosscheck を exclude しているため、専用 config で実行する。
 * 実行: npm run crosscheck
 */

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/crosscheck.test.ts"],
    testTimeout: 120_000,
  },
});
