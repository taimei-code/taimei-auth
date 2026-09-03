import { Effect } from "effect";
import { findMembership } from "@/db/repositories/membership";
import {
  type Actor,
  type Forbidden,
  guard,
  type InvalidArgument,
  invalidArgument,
  type NotFound,
  type ParseBodyCallback,
  parseBody,
  requireTargetMembership,
  runGuard,
  type Unauthorized,
} from "./core";

// 判定順: 401 → 400 (parseBody + self) → 403 (OWNER) → 404 (target) → 400 (already_owner)。
// self 委譲は zod pass 後の意味エラーだが handler 側と同じ 400 に倒す。

export type ParsedTransferBody = { toUserId: string };

type AlreadyOwner = { ok: false; error: "already_owner"; status: 400 };

export type TransferOwnershipGuardResult =
  | {
      ok: true;
      actor: Actor;
      toUserId: string;
    }
  | Unauthorized
  | InvalidArgument
  | Forbidden
  | NotFound
  | AlreadyOwner;

type TransferOwnershipOptions = {
  headers: Headers;
  companyId: string;
  parseBody: ParseBodyCallback<ParsedTransferBody>;
};

const alreadyOwner = (): AlreadyOwner => ({ ok: false, error: "already_owner", status: 400 });

export function makeRequireTransferOwnership(deps = { guard, findMembership }) {
  const program = (opts: TransferOwnershipOptions) =>
    Effect.gen(function* () {
      const actor = yield* deps.guard.effect.requireActor(opts.headers);
      const body = yield* parseBody(opts.parseBody);
      // self 委譲は actor を無意味に降格し audit も誤解を生むため 400 で弾く (現行 handler と同義)。
      if (body.toUserId === actor.id) return yield* Effect.fail(invalidArgument());

      yield* deps.guard.effect.requireMembershipOf(actor, opts.companyId, "OWNER");

      const target = yield* requireTargetMembership(
        deps.findMembership,
        body.toUserId,
        opts.companyId,
      );
      if (target.role === "OWNER") return yield* Effect.fail(alreadyOwner());

      return { ok: true as const, actor, toUserId: body.toUserId };
    });

  return (opts: TransferOwnershipOptions): Promise<TransferOwnershipGuardResult> =>
    runGuard(program(opts));
}

export const requireTransferOwnership = makeRequireTransferOwnership();
