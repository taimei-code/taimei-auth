import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { expectConsumerSeesAnActiveCompanyAndItsRole } from "../../src/__tests__/consumer-company-view";
import { dbTest } from "../../src/__tests__/live-runner";
import { grepFiles } from "../../src/__tests__/source-scan";
import { getTrustedOrigins } from "../../src/env";
import { DEV_ACCOUNTS, seedDevAccounts } from "../../db/testing/dev-accounts";
import { createSignedInUser } from "../create-signed-in-user";

const P = "tdcc-test-";
const { run } = dbTest(P);

describe("試験 API が作る利用者も、VerifySession と GetSession で ACTIVE な所属のどれかを現在の事業所として見せる", () => {
  test("試験の module で現在の事業所を書き換えるのは、試験の利用者を作る use-case と現在の事業所を切り替える use-case だけ", () => {
    expect(
      grepFiles(
        "\\b(applyJoin|applyRemoval|applyCompanyRemoval|switchCurrentCompany)\\(|\\.updateUserLastUsedCompany\\(",
        "testing",
        { tests: "exclude" },
      ),
    ).toEqual(["testing/create-signed-in-user.ts", "testing/set-current-company.ts"]);
  });

  test("試験 API が OWNER と ADMIN の所属を持つ利用者を作る", () =>
    run(
      Effect.gen(function* () {
        const created = yield* createSignedInUser({
          companies: [{ role: "OWNER" }, { role: "ADMIN" }],
          returnTo: `${getTrustedOrigins()[0]}/after-sign-in`,
        });
        yield* expectConsumerSeesAnActiveCompanyAndItsRole(P, created.userId);
      }),
    ));

  test("開発用アカウントのそれぞれも、ACTIVE な所属のどれかを現在の事業所とその role として見せる", () =>
    run(
      Effect.gen(function* () {
        yield* Effect.promise(seedDevAccounts);
        for (const devUser of DEV_ACCOUNTS.users) {
          yield* expectConsumerSeesAnActiveCompanyAndItsRole(P, devUser.id);
        }
      }),
    ));
});
