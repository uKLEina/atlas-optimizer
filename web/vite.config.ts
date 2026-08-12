/// <reference types="vitest/config" />
import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  test: {
    // 初回は WASM のロードが入るため既定の 5s では足りないことがある
    testTimeout: 20_000,
  },
});
