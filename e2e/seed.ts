import { consumableFixtures, resetAllFixtures } from "./fixtures";

// e2e fixture を再生成する entrypoint。
// - 引数なしの場合は、全 fixture を冪等に作り直す (サーバ起動前に start-server.sh が実行する)
// - 引数ありの場合は、消費型 fixture (spec の実行が消費する) 1 種類だけを作り直す。消費型の spec が retry に
//   耐えるため、テストごとに子プロセスで呼ぶ (helpers.ts の reseedFixture。テストごとに使う fixture が違う
//   spec は beforeEach ではなく各テストの冒頭で呼ぶ)。指定できる名前は fixtures.ts の
//   consumableFixtures で定義する
const fixtureName = process.argv[2];
if (fixtureName === undefined) {
  await resetAllFixtures();
} else {
  const ensure = consumableFixtures.get(fixtureName);
  if (ensure === undefined) {
    // 何もせずに終えたり全体 seed へ fallback したりすると、typo した spec が fixture の無いまま
    // 走って無関係な文言で落ちる。この entrypoint が無くしたい症状を再現してしまうため、即座に失敗させる
    console.error(
      `[e2e-seed] unknown fixture "${fixtureName}"。有効: ${[...consumableFixtures.keys()].join(" / ")}`,
    );
    process.exit(1);
  }
  await ensure();
}

console.log(`[e2e-seed] done${fixtureName === undefined ? "" : ` (${fixtureName})`}`);
// pg の Pool が開いたままだと process が終了しないため、明示的に exit する
process.exit(0);
