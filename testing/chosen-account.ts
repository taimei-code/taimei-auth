import { Effect, Schema } from "effect";
import type { Context } from "hono";
import { findChoosableAccount, type listChoosableAccounts } from "../db/testing/dev-accounts";
import { NotFound } from "../src/failures";
import type { PageAccount } from "../web/non-production/page-props";
import { browserKeyOf } from "./browser-key";
import { decodeFormBody } from "./decode-body";

const ChosenUser = Schema.Struct({ userId: Schema.String });

type Account = Awaited<ReturnType<typeof listChoosableAccounts>>[number];

export const chosenAccountOf = Effect.fnUntraced(function* (c: Context) {
  const { userId } = yield* decodeFormBody(c, ChosenUser);
  const account = yield* Effect.promise(() => findChoosableAccount(browserKeyOf(c), userId));
  if (!account) return yield* new NotFound();
  return account;
});

export const pageAccountOf = ({
  id,
  name,
  email,
  lastUsedCompanyId,
  memberships,
}: Account): PageAccount => ({
  id,
  name,
  email,
  companies: memberships
    .filter(({ company }) => company.activationStatus === "ACTIVE")
    .map(({ company, role }) => ({
      id: company.id,
      name: company.name,
      role,
      isCurrent: company.id === lastUsedCompanyId,
    })),
});
