import { Effect } from "effect";
import { UserRepo } from "../src/account/ports";
import { switchCompany } from "../src/account/switch-company";
import { NotFound } from "../src/membership/guard/errors";

export const setCurrentCompany = Effect.fnUntraced(function* (input: {
  userId: string;
  companyId: string;
}) {
  const users = yield* UserRepo;
  const user = yield* users.findUserById(input.userId);
  if (!user) return yield* new NotFound();
  return yield* switchCompany({
    actorUserId: user.id,
    fromCompanyId: user.lastUsedCompanyId,
    targetCompanyId: input.companyId,
  });
});
