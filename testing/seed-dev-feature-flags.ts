import { FEATURE_FLAGS_BINDING } from "../src/feature-flags";
import { FEATURE_FLAG_CATALOG } from "./feature-flag-catalog";

const TESTING_DIRECTORY = import.meta.dirname;
const WRANGLER_CONFIG = "wrangler.jsonc";
const RELEASED_TO_EVERYONE = "serve=on";
const ALREADY_SEEDED = "already exists";

for (const flag of Object.keys(FEATURE_FLAG_CATALOG)) {
  const created = Bun.spawnSync(
    [
      "bunx",
      "wrangler",
      "flagship",
      "flags",
      "create",
      FEATURE_FLAGS_BINDING,
      flag,
      "--local",
      "--rule",
      RELEASED_TO_EVERYONE,
      "--cwd",
      TESTING_DIRECTORY,
      "--config",
      WRANGLER_CONFIG,
    ],
    { stdout: "pipe", stderr: "pipe" },
  );
  const output = `${created.stdout.toString()}${created.stderr.toString()}`;
  if (created.exitCode !== 0 && !output.includes(ALREADY_SEEDED)) {
    throw new Error(`フィーチャーフラグ ${flag} を手元の置き場に作れなかった: ${output}`);
  }
}
