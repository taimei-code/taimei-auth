import { Effect } from "effect";
import { UserRepo } from "../src/account/ports";
import { switchCompany } from "../src/account/switch-company";
import { InvalidArgument, NotFound } from "../src/failures";

export const setCurrentCompany = Effect.fnUntraced(function* (input: {
  userId: string;
  companyId: string;
}) {
  const user = yield* UserRepo.use((users) => users.findUserById(input.userId));
  if (!user) return yield* new NotFound();
  yield* switchCompany({
    actorUserId: user.id,
    fromCompanyId: user.lastUsedCompanyId,
    targetCompanyId: input.companyId,
  }).pipe(Effect.catchTag("Forbidden", () => new InvalidArgument({})));
  return { ok: true as const };
});
