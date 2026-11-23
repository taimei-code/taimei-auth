import { describe, expect, test } from "bun:test";
import { TESTING_PATH } from "@taimei-code/auth-client/testing";
import { Effect } from "effect";
import { FeatureFlags, type FlagContext } from "../../src/feature-flags";
import { buildApp } from "../../src/app";
import {
  type FakeFlagship,
  type FlagRules,
  type FlagRulesStore,
  fakeFlagship,
} from "../feature-flags";
import { featureFlagRoutes } from "../routes";

const FLAG = "example";

const CONTEXTS: readonly FlagContext[] = [{}, { companyId: "listed" }, { companyId: "other" }];

const evaluations = (flags: FakeFlagship) =>
  Effect.runPromise(
    Effect.forEach(CONTEXTS, (context) =>
      FeatureFlags.use((each) => each.isOn(FLAG, context)),
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
});

const swappedStore = (): FlagRulesStore => {
  const rulesByFlag = new Map<string, FlagRules>();
  return {
    storedIn: "Memory",
    read: async (flag) => rulesByFlag.get(flag),
    update: async (flag, next) => {
      rulesByFlag.set(flag, next(rulesByFlag.get(flag)));
    },
  };
};

describe("Flagship の偽物は、渡された置き場の状態で評価とステータスを決める (actor なし、リストの事業所、ほかの事業所)", () => {
  test("置き場に全体 off が書かれていれば、全員 off で、ステータスは Off", async () => {
    const store = swappedStore();
    await store.update(FLAG, () => ({ enabled: false, everyone: true, companyIds: [] }));
    const flags = fakeFlagship(store);
    expect([await evaluations(flags), (await flags.stateOf(FLAG)).status]).toEqual([
      [false, false, false],
      "Off",
    ]);
  });

  test("置き場に事業所だけ on が書かれていれば、リストの事業所だけ on で、ステータスは OnlyFor とその事業所", async () => {
    const store = swappedStore();
    await store.update(FLAG, () => ({ enabled: true, everyone: false, companyIds: ["listed"] }));
    const flags = fakeFlagship(store);
    expect([await evaluations(flags), await flags.stateOf(FLAG)]).toEqual([
      [false, true, false],
      { status: "OnlyFor", companyIds: ["listed"] },
    ]);
  });

  test("同じ置き場を渡した偽物どうしでは、片方で切り替えた状態が、もう片方の評価とステータスに出る", async () => {
    const store = swappedStore();
    const switching = fakeFlagship(store);
    const reading = fakeFlagship(store);

    await switching.off(FLAG);
    const afterOff = [await evaluations(reading), (await reading.stateOf(FLAG)).status];
    await switching.onlyFor(FLAG, ["listed"]);
    const afterOnlyFor = [await evaluations(reading), (await reading.stateOf(FLAG)).status];
    await switching.on(FLAG);
    const afterOn = [await evaluations(reading), (await reading.stateOf(FLAG)).status];

    expect([afterOff, afterOnlyFor, afterOn]).toEqual([
      [[false, false, false], "Off"],
      [[false, true, false], "OnlyFor"],
      [[true, true, true], "On"],
    ]);
  });

  test("待たずに続けて送った切り替えは、送った順に置き場へ反映される", async () => {
    const flags = fakeFlagship();

    await Promise.all([flags.off(FLAG), flags.onlyFor(FLAG, ["listed"])]);

    expect(await flags.stateOf(FLAG)).toEqual({ status: "OnlyFor", companyIds: ["listed"] });
  });

  test("置き場を渡さずに作り直した偽物は、前の偽物で切り替えた後でも、全体 on から始まる", async () => {
    const before = fakeFlagship();
    await before.off(FLAG);

    const restarted = fakeFlagship();

    expect([await evaluations(restarted), (await restarted.stateOf(FLAG)).status]).toEqual([
      [true, true, true],
      "On",
    ]);
  });
});

describe("試験 API でフィーチャーフラグを切り替えると、server の評価が変わる (actor なし、リストの事業所、ほかの事業所)", () => {
  const switchedBy = async (
    app: ReturnType<typeof buildApp>,
    flags: FakeFlagship,
    body: Record<string, unknown>,
  ) => {
    const response = await app.request(`${TESTING_PATH}/feature-flags`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return [response.status, await evaluations(flags)];
  };

  test("全体 off、事業所だけ on、全体 on の順に送ると、そのたびに 200 を返して評価が変わる", async () => {
    const flags = fakeFlagship();
    const app = buildApp({
      mountStatic: (honoApp) => honoApp.route("/", featureFlagRoutes(flags)),
    });

    const results = [
      await switchedBy(app, flags, { flag: FLAG, state: "off" }),
      await switchedBy(app, flags, { flag: FLAG, state: "onlyFor", companyIds: ["listed"] }),
      await switchedBy(app, flags, { flag: FLAG, state: "on" }),
    ];

    expect(results).toEqual([
      [200, [false, false, false]],
      [200, [false, true, false]],
      [200, [true, true, true]],
    ]);
  });
});
