import { describe, expect, test } from "bun:test";
import { TESTING_PATH } from "@taimei-code/auth-client/testing";
import { Effect, Record } from "effect";
import { FeatureFlags, type FlagContext } from "../../src/feature-flags";
import { buildApp } from "../../src/app";
import { FEATURE_FLAG_CATALOG } from "../feature-flag-catalog";
import { type FakeFlagship, fakeFlagship } from "../feature-flags";
import { featureFlagRoutes } from "../routes";

const FLAG = "example";

const CONTEXTS: readonly FlagContext[] = [{}, { companyId: "listed" }, { companyId: "other" }];

const REGISTERED_FLAGS = Record.keys(FEATURE_FLAG_CATALOG);

const UNREGISTERED_FLAG = "pass-key";

const evaluations = (flags: FakeFlagship, flag: string = FLAG) =>
  Effect.runPromise(
    Effect.forEach(CONTEXTS, (context) =>
      FeatureFlags.use((each) => each.isOn(flag, context)),
    ).pipe(Effect.provide(flags.layer)),
  );

describe("Flagship の偽物は、本番の評価を通して Flagship のルールの順で評価する (actor なし、リストの事業所、ほかの事業所)", () => {
  test("off にすると、事業所のリストがあっても全員 off", async () => {
    const flags = fakeFlagship();
    await flags.onlyFor(FLAG, ["listed"]);
    await flags.off(FLAG);
    expect(await evaluations(flags)).toEqual([false, false, false]);
  });

  test("onlyFor にすると、リストの事業所だけが on で、actor なしは off", async () => {
    const flags = fakeFlagship();
    await flags.onlyFor(FLAG, ["listed"]);
    expect(await evaluations(flags)).toEqual([false, true, false]);
  });

  test("on にすると、actor の有無に関係なく on", async () => {
    const flags = fakeFlagship();
    await flags.off(FLAG);
    await flags.on(FLAG);
    expect(await evaluations(flags)).toEqual([true, true, true]);
  });

  test("切り替えていない flag は、全体 on として評価する", async () => {
    expect(await evaluations(fakeFlagship())).toEqual([true, true, true]);
  });

  test("remove した flag と、binding が失敗する時は、全員 off", async () => {
    const removed = fakeFlagship();
    removed.remove(FLAG);
    const broken = fakeFlagship();
    broken.breakBinding();
    expect([await evaluations(removed), await evaluations(broken)]).toEqual([
      [false, false, false],
      [false, false, false],
    ]);
  });

  test("前の偽物で全体 off にした後に作り直した偽物は、全員 on と評価する", async () => {
    await fakeFlagship().off(FLAG);

    expect(await evaluations(fakeFlagship())).toEqual([true, true, true]);
  });

  test("待たずに続けて全体 off と事業所だけ on を送ると、後に送った事業所だけ on で評価する", async () => {
    const flags = fakeFlagship();

    await Promise.all([flags.off(FLAG), flags.onlyFor(FLAG, ["listed"])]);

    expect(await evaluations(flags)).toEqual([false, true, false]);
  });
});

describe("試験 API でフィーチャーフラグを切り替えると、server の評価が変わる (actor なし、リストの事業所、ほかの事業所)", () => {
  const appSwitching = (flags: FakeFlagship) =>
    buildApp({ mountStatic: (honoApp) => honoApp.route("/", featureFlagRoutes(flags)) });

  const statusOf = async (app: ReturnType<typeof buildApp>, body: unknown) =>
    (
      await app.request(`${TESTING_PATH}/feature-flags`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      })
    ).status;

  const statusesOf = (app: ReturnType<typeof buildApp>, bodies: readonly unknown[]) =>
    Promise.all(bodies.map((body) => statusOf(app, body)));

  const everyEvaluation = (flags: FakeFlagship, names: readonly string[]) =>
    Promise.all(names.map((name) => evaluations(flags, name)));

  test("一覧にあるどのフラグも、全体 off、事業所だけ on、全体 on の順に送ると、そのたびに 200 を返して評価が変わる", async () => {
    const results = [];
    for (const flag of REGISTERED_FLAGS) {
      const flags = fakeFlagship();
      const app = appSwitching(flags);
      for (const body of [
        { flag, state: "off" },
        { flag, state: "onlyFor", companyIds: ["listed"] },
        { flag, state: "on" },
      ]) {
        results.push([await statusOf(app, body), await evaluations(flags, flag)]);
      }
    }

    expect(results).toEqual(
      REGISTERED_FLAGS.flatMap(() => [
        [200, [false, false, false]],
        [200, [false, true, false]],
        [200, [true, true, true]],
      ]),
    );
  });

  test("登録していない名前は、全体 off、事業所だけ on、全体 on のどれで送っても 400 を返す", async () => {
    const app = appSwitching(fakeFlagship());

    const statuses = await statusesOf(app, [
      { flag: UNREGISTERED_FLAG, state: "off" },
      { flag: UNREGISTERED_FLAG, state: "onlyFor", companyIds: ["listed"] },
      { flag: UNREGISTERED_FLAG, state: "on" },
    ]);

    expect(statuses).toEqual([400, 400, 400]);
  });

  test("登録していない名前を送っても、その名前と一覧のフラグの評価は送る前と同じ", async () => {
    const flags = fakeFlagship();
    const app = appSwitching(flags);
    const names = [UNREGISTERED_FLAG, ...REGISTERED_FLAGS];
    const before = await everyEvaluation(flags, names);

    await statusesOf(app, [
      { flag: UNREGISTERED_FLAG, state: "off" },
      { flag: UNREGISTERED_FLAG, state: "onlyFor", companyIds: ["listed"] },
    ]);

    expect(await everyEvaluation(flags, names)).toEqual(before);
  });

  test("Object の prototype にある名前を送っても 400 を返す", async () => {
    const app = appSwitching(fakeFlagship());

    const statuses = await statusesOf(
      app,
      ["__proto__", "constructor", "toString"].map((flag) => ({ flag, state: "off" })),
    );

    expect(statuses).toEqual([400, 400, 400]);
  });

  test("名前が空か無い、state が未知、事業所だけ on に事業所の一覧が無い body は、400 を返して一覧のフラグの評価を変えない", async () => {
    const flags = fakeFlagship();
    const app = appSwitching(flags);
    const before = await everyEvaluation(flags, REGISTERED_FLAGS);
    const malformed = [
      { flag: "", state: "off" },
      { state: "off" },
      ...REGISTERED_FLAGS.flatMap((flag) => [
        { flag, state: "disable" },
        { flag, state: "onlyFor" },
      ]),
    ];

    const statuses = await statusesOf(app, malformed);

    expect([statuses, await everyEvaluation(flags, REGISTERED_FLAGS)]).toEqual([
      malformed.map(() => 400),
      before,
    ]);
  });
});
