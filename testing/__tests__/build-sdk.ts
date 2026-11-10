import { spawnSync } from "node:child_process";
import { join } from "node:path";

const REPO_ROOT = join(import.meta.dir, "..", "..");
const TREE_WITH_FRESH_SDK = "TAIMEI_AUTH_TREE_WITH_FRESH_SDK";

if (process.env[TREE_WITH_FRESH_SDK] !== REPO_ROOT) {
  const build = spawnSync(
    "bun",
    ["run", "--cwd", join(REPO_ROOT, "packages/auth-client"), "build"],
    {
      encoding: "utf8",
    },
  );
  if (build.status !== 0) {
    throw new Error(
      `SDK (packages/auth-client) の build に失敗した\n${build.stdout}${build.stderr}`,
    );
  }
  process.env[TREE_WITH_FRESH_SDK] = REPO_ROOT;
}
