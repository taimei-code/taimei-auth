import { Effect } from "effect";
import { type ParseBody, requireActor, requireMembershipOf, requireTargetMembership } from "./core";
import { AlreadyOwner, InvalidArgument } from "./errors";

// 判定順: 401 → 400 (parseBody + self) → 403 (OWNER) → 404 (target) → 400 (already_owner)。
// self 委譲は zod pass 後の意味エラーだが handler 側と同じ 400 に倒す。

export const requireTransferOwnership = (opts: {
  headers: Headers;
  companyId: string;
  parseBody: ParseBody<{ toUserId: string }>;
}) =>
  Effect.gen(function* () {
    const actor = yield* requireActor(opts.headers);
    const parsed = yield* opts.parseBody;
    // self 委譲は actor を無意味に降格し audit も誤解を生むため 400 で弾く (現行 handler と同義)。
    if (parsed.toUserId === actor.id) return yield* new InvalidArgument({});
    yield* requireMembershipOf(actor, opts.companyId, "OWNER");
    const target = yield* requireTargetMembership(parsed.toUserId, opts.companyId);
    if (target.role === "OWNER") return yield* new AlreadyOwner();
    return { actor, toUserId: parsed.toUserId };
  });
