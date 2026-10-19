import { expect } from "bun:test";
import { Effect } from "effect";
import type { Session } from "../auth";
import { Role as ProtoRole } from "../gen/auth/v1/auth_pb";
import { authLayer } from "../membership/__tests__/test-layers";
import { MembershipRepo } from "../membership/ports";
import { getSessionProgram, verifySessionProgram } from "../rpc/auth-handler";

const signedInAs = (prefix: string, userId: string) =>
  authLayer(
    () =>
      ({
        user: { id: userId },
        session: { id: `${prefix}s-${userId}`, expiresAt: new Date("2030-01-01") },
      }) as unknown as Session,
  );

export const companySeenByConsumer = (prefix: string, userId: string) =>
  Effect.gen(function* () {
    const verified = yield* verifySessionProgram({ sessionToken: "contract" });
    const got = yield* getSessionProgram({ sessionToken: "contract" });
    if (verified.outcome.case !== "ok") throw new Error(`VerifySession: ${verified.outcome.case}`);
    if (got.outcome.case !== "ok") throw new Error(`GetSession: ${got.outcome.case}`);
    return {
      verifySession: {
        companyId: verified.outcome.value.user?.defaultCompanyId,
        role: verified.outcome.value.currentRole,
      },
      getSession: {
        companyId: got.outcome.value.user?.defaultCompanyId,
        role: got.outcome.value.currentRole,
      },
    };
  }).pipe(Effect.provide(signedInAs(prefix, userId)));

export const expectConsumerSeesAnActiveCompanyAndItsRole = (prefix: string, userId: string) =>
  Effect.gen(function* () {
    const { verifySession, getSession: seen } = yield* companySeenByConsumer(prefix, userId);
    expect(seen).toEqual(verifySession);
    const memberships = yield* MembershipRepo.use((repo) => repo.findMembershipsByUserId(userId));
    const active = memberships
      .filter((m) => m.companyActivationStatus === "ACTIVE")
      .map((m) => m.companyId);
    if (active.length === 0) expect(seen.companyId).toBeUndefined();
    else expect(active).toContain(String(seen.companyId));
    const currentMembership = memberships.find((m) => m.companyId === seen.companyId);
    expect(seen.role).toBe(currentMembership ? ProtoRole[currentMembership.role] : undefined);
  });
