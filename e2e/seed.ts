import { consumableFixtures, resetAllFixtures } from "./fixtures";

// e2e fixture 再生成の entrypoint。
// - 引数なし: 全 fixture の冪等再作成 (サーバ起動前に start-server.sh が実行)
// - 引数あり: 消費型 fixture (spec 実行が消費する) 1 種だけを作り直す。消費型 spec が retry 耐性の
//   ために test ごと子プロセスで呼ぶ (helpers.ts の reseedFixture。test ごとに使う fixture が違う
//   spec は beforeEach でなく各 test の冒頭で呼ぶ)。指定できる名前の正本は fixtures.ts の
//   consumableFixtures
const fixtureName = process.argv[2];
if (fixtureName === undefined) {
  await resetAllFixtures();
} else {
  const ensure = consumableFixtures.get(fixtureName);
  if (ensure === undefined) {
    // silent no-op や全体 seed への fallback にすると、typo した spec が fixture 不在のまま
    // 走って無関係な文言で落ちる — 本 entrypoint が消したい症状を再生産するため即 fail する
    console.error(
      `[e2e-seed] unknown fixture "${fixtureName}"。有効: ${[...consumableFixtures.keys()].join(" / ")}`,
    );
    process.exit(1);
  }
  await ensure();
}

console.log(`[e2e-seed] done${fixtureName === undefined ? "" : ` (${fixtureName})`}`);
// pg Pool が開いたままだと process が終了しないため明示 exit する
process.exit(0);
