import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseJsonc, REPO_ROOT } from "./config-invariant-helpers";

test("web/tsconfig.json の @core/* は ./src/* を先に、../src/* を後に置く (tsc は tsconfig の位置を基準に 2 つ目で、bun test は repo root を基準に 1 つ目で repo の src/ に当たる。../src/* を先に置くと、bun が repo の親 dir から兄弟 repo の src/ に解決し得る。vite は vite.config.ts の alias で解決する)", () => {
  expect(parseJsonc(readFileSync(join(REPO_ROOT, "web/tsconfig.json"), "utf8"))).toMatchObject({
    compilerOptions: { paths: { "@core/*": ["./src/*", "../src/*"] } },
  });
});
