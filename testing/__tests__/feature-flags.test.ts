import { describe, expect, test } from "bun:test";
import { TESTING_PATH } from "@taimei-code/auth-client/testing";
import { Effect } from "effect";
import { FeatureFlags, type FlagContext } from "../../src/feature-flags";
import { buildApp } from "../../src/app";
import { type FakeFlagship, fakeFlagship } from "../feature-flags";
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
    flags.onlyFor(FLAG, ["listed"]);
    flags.off(FLAG);
    expect(await evaluations(flags)).toEqual([false, false, false]);
  });

  test("onlyFor にすると、リストの事業所だけが on で、actor なしは off", async () => {
    const flags = fakeFlagship();
    flags.onlyFor(FLAG, ["listed"]);
    expect(await evaluations(flags)).toEqual([false, true, false]);
  });

  test("on にすると、actor の有無に関係なく on", async () => {
    const flags = fakeFlagship();
    flags.off(FLAG);
    flags.on(FLAG);
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
