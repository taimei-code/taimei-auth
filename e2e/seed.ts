import { CONSUMABLE_FIXTURES, isConsumableFixture } from "./fixture-names";
import { consumableFixtures, resetAllFixtures } from "./fixtures";

const fixtureName = process.argv[2];
if (fixtureName === undefined) {
  await resetAllFixtures();
} else if (isConsumableFixture(fixtureName)) {
  await consumableFixtures[fixtureName]();
} else {
  console.error(
    `[e2e-seed] unknown fixture "${fixtureName}"。有効: ${CONSUMABLE_FIXTURES.join(" / ")}`,
  );
  process.exit(1);
}

console.log(`[e2e-seed] done${fixtureName === undefined ? "" : ` (${fixtureName})`}`);
process.exit(0);
