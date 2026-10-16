import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const PLACEHOLDER = "__TAIMEI_AUTH_TESTING_IMAGE__";
const PINNED_IMAGE = /^ghcr\.io\/taimei-code\/taimei-auth-testing@sha256:[0-9a-f]{64}$/;

const image = process.argv[2] ?? "";
if (!PINNED_IMAGE.test(image)) {
  console.error(
    `stamp-testing-fragment: expected ghcr.io/taimei-code/taimei-auth-testing@sha256:<digest>, got "${image}"`,
  );
  process.exit(1);
}

const dir = join(import.meta.dir, "..", "packages", "auth-client", "testing");
const template = readFileSync(join(dir, "compose.template.yml"), "utf8");
writeFileSync(join(dir, "compose.yml"), template.replace(PLACEHOLDER, image));
console.log(`stamp-testing-fragment: ${image}`);
