import { Effect } from "effect";
import { UserRepo } from "../src/account/ports";
import { switchCurrentCompany } from "../src/membership/current-company";
import { InvalidArgument, NotFound } from "../src/failures";

export const setCurrentCompany = Effect.fnUntraced(function* (input: {
  userId: string;
  companyId: string;
}) {
  const user = yield* UserRepo.use((users) => users.findUserById(input.userId));
  if (!user) return yield* new NotFound();
  yield* switchCurrentCompany({ userId: user.id, companyId: input.companyId }).pipe(
    Effect.catchTag("Forbidden", () => new InvalidArgument({})),
  );
  return { ok: true as const };
});
