import { findMembership } from "@/db/repositories/membership";
import {
  type Actor,
  type Forbidden,
  guard,
  type InvalidArgument,
  type NotFound,
  type ParseBodyCallback,
  resolveParseBody,
  type Unauthorized,
} from "./core";

// 判定順: 401 → 400 (parseBody + self) → 403 (OWNER) → 404 (target) → 400 (already_owner)。
// self 委譲は zod pass 後の意味エラーだが handler 側と同じ 400 に倒す。

export type ParsedTransferBody = { toUserId: string };

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
  | { ok: false; error: "already_owner"; status: 400 };

export function makeRequireTransferOwnership(deps = { guard, findMembership }) {
  return async (opts: {
    headers: Headers;
    companyId: string;
    parseBody: ParseBodyCallback<ParsedTransferBody>;
  }): Promise<TransferOwnershipGuardResult> => {
    const actorResult = await deps.guard.requireActor(opts.headers);
    if (!actorResult.ok) return actorResult;

    const parsed = await resolveParseBody(opts.parseBody);
    if (!parsed.ok) return parsed;
    // self 委譲は actor を無意味に降格し audit も誤解を生むため 400 で弾く (現行 handler と同義)。
    if (parsed.data.toUserId === actorResult.actor.id) {
      return { ok: false, error: "invalid_argument", status: 400 };
    }

    const membershipResult = await deps.guard.requireMembershipOf(
      actorResult.actor,
      opts.companyId,
      "OWNER",
    );
    if (!membershipResult.ok) return membershipResult;

    const targetMembership = await deps.findMembership(parsed.data.toUserId, opts.companyId);
    if (!targetMembership) return { ok: false, error: "not_found", status: 404 };
    if (targetMembership.role === "OWNER") {
      return { ok: false, error: "already_owner", status: 400 };
    }

    return { ok: true, actor: actorResult.actor, toUserId: parsed.data.toUserId };
  };
}

export const requireTransferOwnership = makeRequireTransferOwnership();
