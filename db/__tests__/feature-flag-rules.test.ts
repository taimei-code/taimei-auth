import { afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { sql } from "drizzle-orm";
import { fakeFlagship } from "../../testing/feature-flags";
import { db } from "../client";
import { postgresFlagRulesStore } from "../testing/feature-flag-rules";
import { requireLocalDatabase } from "../testing/local-database";
import { prepareNonProductionTables } from "../testing/non-production-tables";

const FLAG = "feature-flag-rules-test-example";
const database = requireLocalDatabase(process.env.DATABASE_URL);

const restarted = () => fakeFlagship(postgresFlagRulesStore(database));

beforeAll(() => prepareNonProductionTables(database));

const forget = async () => {
  await db.execute(sql`DELETE FROM testing_feature_flag_rules WHERE flag = ${FLAG}`);
};

beforeEach(forget);
afterEach(forget);

describe("開発環境のフィーチャーフラグは、worker を立ち上げ直しても切り替えた状態を auth の DB から読む", () => {
  test("切り替えていない flag は、立ち上げ直しても全体 on", async () => {
    expect(await restarted().stateOf(FLAG)).toEqual({ status: "On", companyIds: [] });
  });

  test("全体 off は、立ち上げ直した後も全体 off", async () => {
    await restarted().off(FLAG);

    expect(await restarted().stateOf(FLAG)).toEqual({ status: "Off", companyIds: [] });
  });

  test("事業所だけ on は、立ち上げ直した後も同じ事業所のリストで事業所だけ on", async () => {
    await restarted().onlyFor(FLAG, ["listed", "another"]);

    expect(await restarted().stateOf(FLAG)).toEqual({
      status: "OnlyFor",
      companyIds: ["listed", "another"],
    });
  });

  test("事業所だけ on の後の全体 off は、事業所のリストを残したまま全体 off", async () => {
    await restarted().onlyFor(FLAG, ["listed"]);
    await restarted().off(FLAG);

    expect(await restarted().stateOf(FLAG)).toEqual({ status: "Off", companyIds: ["listed"] });
  });

  test("事業所だけ on から全体 on に戻すと、立ち上げ直した後も全体 on で、事業所のリストは空", async () => {
    await restarted().onlyFor(FLAG, ["listed"]);
    await restarted().on(FLAG);

    expect(await restarted().stateOf(FLAG)).toEqual({ status: "On", companyIds: [] });
  });

  test("待たずに続けて送った切り替えは、送った順に DB へ反映される", async () => {
    const flags = restarted();

    await Promise.all([flags.off(FLAG), flags.onlyFor(FLAG, ["listed"])]);

    expect(await restarted().stateOf(FLAG)).toEqual({ status: "OnlyFor", companyIds: ["listed"] });
  });

  test("worker の立ち上げ直しの後も残る置き場だと、フラグのページに渡す", () => {
    expect(restarted().storedIn).toBe("Database");
  });
});
