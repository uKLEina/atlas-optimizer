import { createReadStream, existsSync } from "node:fs";
import { cp, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { configDefaults, defineConfig, type Plugin } from "vitest/config";

const here = path.dirname(fileURLToPath(import.meta.url));
const vendorDir = path.resolve(here, "../vendor/atlastree-export");

/**
 * vendor/atlastree-export の data.json と assets/ を `/atlas/` 以下で配信する。
 * dev: ミドルウェアで直接配信 / build: dist/atlas/ へコピー(dist は自己完結 ~13MB)
 */
function vendorAtlas(): Plugin {
  return {
    name: "vendor-atlas",
    configureServer(server) {
      server.middlewares.use("/atlas", (req, res, next) => {
        const rel = decodeURIComponent((req.url ?? "").split("?")[0] ?? "");
        const file = path.join(vendorDir, rel);
        if (!file.startsWith(vendorDir) || !existsSync(file)) {
          next();
          return;
        }
        const type = file.endsWith(".json")
          ? "application/json"
          : file.endsWith(".png")
            ? "image/png"
            : file.endsWith(".jpg")
              ? "image/jpeg"
              : "application/octet-stream";
        res.setHeader("Content-Type", type);
        createReadStream(file).pipe(res);
      });
    },
    async closeBundle() {
      const out = path.resolve(here, "dist/atlas");
      await mkdir(out, { recursive: true });
      await cp(path.join(vendorDir, "data.json"), path.join(out, "data.json"));
      await cp(path.join(vendorDir, "assets"), path.join(out, "assets"), {
        recursive: true,
      });
    },
  };
}

export default defineConfig({
  base: "./",
  plugins: [vendorAtlas()],
  test: {
    // 初回は WASM のロードが入るため既定の 5s では足りないことがある
    testTimeout: 20_000,
    // pyref 照合は時間がかかるため通常の npm test から外す(npm run crosscheck で実行)
    exclude: [...configDefaults.exclude, "tests/crosscheck.test.ts"],
  },
});
