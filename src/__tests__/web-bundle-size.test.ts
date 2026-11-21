import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { REPO_ROOT } from "./source-scan";

const BASELINE_WEB_JS_BYTES = 855_000;

const BUILD_TIMEOUT_MS = 120_000;

const { NODE_ENV: _testRunnerNodeEnv, ...shellEnv } = process.env;

const jsBytesUnder = (directory: string): number =>
  readdirSync(directory, { recursive: true, encoding: "utf8" })
    .filter((path) => path.endsWith(".js"))
    .reduce((total, path) => total + statSync(join(directory, path)).size, 0);

test(
  "本番の web を build した JS の合計は 855,000 B を超えない (React を外した後の 832,129 B に、form の検証、フィーチャーフラグの契約、パスキーの登録と一覧と削除の画面の分を足した上限)",
  () => {
    const outDirectory = mkdtempSync(join(tmpdir(), "web-bundle-size-"));
    try {
      const build = spawnSync(
        join(REPO_ROOT, "node_modules/.bin/vite"),
        [
          "build",
          "--configLoader",
          "runner",
          "--config",
          "web/vite.config.ts",
          "--outDir",
          outDirectory,
          "--emptyOutDir",
          "--logLevel",
          "error",
        ],
        { cwd: REPO_ROOT, encoding: "utf8", env: shellEnv },
      );
      expect(build.status).toBe(0);
      expect(jsBytesUnder(join(outDirectory, "assets"))).toBeLessThanOrEqual(BASELINE_WEB_JS_BYTES);
    } finally {
      rmSync(outDirectory, { recursive: true, force: true });
    }
  },
  BUILD_TIMEOUT_MS,
);
