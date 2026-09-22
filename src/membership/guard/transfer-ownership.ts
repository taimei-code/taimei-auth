import { Effect } from "effect";
import { type ParseBody, requireActor, requireMembershipOf, requireTargetMembership } from "./core";
import { AlreadyOwner, InvalidArgument } from "./errors";

export const requireTransferOwnership = Effect.fn("membership.requireTransferOwnership")(
  function* (opts: {
    headers: Headers;
    companyId: string;
    parseBody: ParseBody<{ toUserId: string }>;
  }) {
    const actor = yield* requireActor(opts.headers);
    const parsed = yield* opts.parseBody;
    // 自分自身への委譲は actor を無意味に降格させ audit も誤解を生むため、400 で拒否する (現行の handler と同じ扱い)。
    if (parsed.toUserId === actor.id) return yield* new InvalidArgument({});
    yield* requireMembershipOf(actor, opts.companyId, "OWNER");
    const target = yield* requireTargetMembership(parsed.toUserId, opts.companyId);
    if (target.role === "OWNER") return yield* new AlreadyOwner();
    return { actor, toUserId: parsed.toUserId };
  },
);
