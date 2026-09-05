import { Context, Layer } from "effect";
import { generateCompanyId } from "@/db/repositories/company";
import { generateInvitationId, generateInvitationToken } from "@/db/repositories/invitation";
import { generateMembershipId } from "@/db/repositories/membership";
import { generateEnrollmentId, generateRecoveryCodeId } from "@/db/repositories/mfa-totp";

// ID / token 生成 (ADR-0017 Decision の依存注入項)。use-case が直接 nanoid を呼ばず service を yield* することで、テストが
// 決定的な ID を注入できる。書式の正本は db/repositories の generate* (db の test も同じ関数を使う)。
export class IdGenerator extends Context.Service<
  IdGenerator,
  {
    membershipId(): string;
    companyId(): string;
    invitationId(): string;
    invitationToken(): string;
    enrollmentId(): string;
    recoveryCodeId(index: number): string;
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
  }),
);
