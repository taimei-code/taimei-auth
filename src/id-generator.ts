import { Context, Layer } from "effect";
import { generateCompanyId } from "@/db/repositories/company";
import { generateInvitationId, generateInvitationToken } from "@/db/repositories/invitation";
import { generateMembershipId } from "@/db/repositories/membership";
import { generateEnrollmentId, generateRecoveryCodeId } from "@/db/repositories/mfa-totp";

export class IdGenerator extends Context.Service<
  IdGenerator,
  {
    membershipId(): string;
    companyId(): string;
    invitationId(): string;
    invitationToken(): string;
    enrollmentId(): string;
    recoveryCodeId(index: number): string;
    loginChallengeId(): string;
  }
>()("taimei/IdGenerator") {}

export const IdGeneratorLive = Layer.succeed(
  IdGenerator,
  IdGenerator.of({
    membershipId: generateMembershipId,
    companyId: generateCompanyId,
    invitationId: generateInvitationId,
    invitationToken: generateInvitationToken,
    enrollmentId: generateEnrollmentId,
    recoveryCodeId: generateRecoveryCodeId,
    loginChallengeId: () => `mfa-lc-${crypto.randomUUID()}`,
  }),
);
