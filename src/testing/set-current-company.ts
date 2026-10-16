import { Effect } from "effect";
import { UserRepo } from "../account/ports";
import { switchCompany } from "../account/switch-company";
import { NotFound } from "../membership/guard/errors";

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
