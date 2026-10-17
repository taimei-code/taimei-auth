import type { SignedInUser } from "@taimei-code/auth-client/testing";
import { Effect } from "effect";
import { switchCompany } from "../src/account/switch-company";
import { AuthApi } from "../src/auth-service";
import { addCompany } from "../src/company/create";
import { IdGenerator } from "../src/id-generator";
import { applyJoin } from "../src/membership/apply-change";
import type { Role } from "../src/membership/policy";
import { Transaction } from "../src/transaction";
import { MagicLinkOutbox } from "./magic-link-outbox";

const TEST_COMPANY_ORG_CODE = "CORPORATE";

const testEmail = (purpose: string) => `test-${purpose}-${crypto.randomUUID()}@example.com`;

const companyWithRole = Effect.fnUntraced(function* (
  userId: string,
  company: { name?: string; role: Role },
) {
  const authApi = yield* AuthApi;
  const name = company.name ?? "Test Company";
  if (company.role === "OWNER") {
    const created = yield* addCompany(userId, { name, orgCode: TEST_COMPANY_ORG_CODE });
    return created.company.id;
  }
  const owner = yield* authApi.createUser({ email: testEmail("owner"), name: "Test Owner" });
  const created = yield* addCompany(owner.id, { name, orgCode: TEST_COMPANY_ORG_CODE });
  const ids = yield* IdGenerator;
  const tx = yield* Transaction;
  yield* tx.run((t) =>
    applyJoin(t, {
      id: ids.membershipId(),
      userId,
      companyId: created.company.id,
      role: company.role,
    }),
  );
  return created.company.id;
});

export const createSignedInUser = Effect.fnUntraced(function* (input: {
  name?: string;
  companies: readonly { name?: string; role: Role }[];
  returnTo: string;
}) {
  const authApi = yield* AuthApi;
  const outbox = yield* MagicLinkOutbox;
  const email = testEmail("user");
  const user = yield* authApi.createUser({ email, name: input.name ?? "Test User" });

  const companyIds: string[] = [];
  for (const company of input.companies) {
    companyIds.push(yield* companyWithRole(user.id, company));
  }
  const [current] = companyIds;
  if (current !== undefined) {
    yield* switchCompany({
      actorUserId: user.id,
      fromCompanyId: null,
      targetCompanyId: current,
    }).pipe(Effect.catchTag("Forbidden", (forbidden) => Effect.die(forbidden)));
  }

  yield* authApi.signInMagicLink({ email, callbackURL: input.returnTo });
  const loginUrl = yield* outbox.take(email);
  if (loginUrl === undefined) {
    return yield* Effect.die(new Error("the magic link for the test user was not recorded"));
  }
  return { userId: user.id, email, companyIds, loginUrl } satisfies SignedInUser;
});
