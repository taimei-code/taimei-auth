import { consumableFixtures, resetAllFixtures } from "./fixtures";

const fixtureName = process.argv[2];
if (fixtureName === undefined) {
  await resetAllFixtures();
} else {
  const ensure = consumableFixtures.get(fixtureName);
  if (ensure === undefined) {
    console.error(
      `[e2e-seed] unknown fixture "${fixtureName}"。有効: ${[...consumableFixtures.keys()].join(" / ")}`,
    );
    process.exit(1);
  }
  await ensure();
}

console.log(`[e2e-seed] done${fixtureName === undefined ? "" : ` (${fixtureName})`}`);
// pg の Pool が開いたままだと process が終了しない
process.exit(0);
