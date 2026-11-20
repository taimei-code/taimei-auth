import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REPO_ROOT = join(__dirname, "..", "..");

export const BUILT_WEB_ENV = "ACCEPTANCE_BUILT_WEB_DIR";

export default function buildWeb() {
  const outDir = mkdtempSync(join(tmpdir(), "acceptance-built-web-"));
  const { NODE_ENV: _runnerNodeEnv, ...env } = process.env;
  const build = spawnSync(
    join(REPO_ROOT, "node_modules/.bin/vite"),
    [
      "build",
      "--configLoader",
      "runner",
      "--config",
      "web/vite.config.ts",
      "--outDir",
      outDir,
      "--emptyOutDir",
      "--logLevel",
      "error",
    ],
    { cwd: REPO_ROOT, env, encoding: "utf8" },
  );
  if (build.status !== 0) {
    throw new Error(`本番の web を build できない:\n${build.stdout}\n${build.stderr}`);
  }
  process.env[BUILT_WEB_ENV] = outDir;
  return () => rmSync(outDir, { recursive: true, force: true });
}
