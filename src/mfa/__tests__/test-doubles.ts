import type {
  GuardedGatewayFactory,
  GuardedMfaGateway,
  GuardHold,
  RegistrationOperationKind,
  RegistrationSnapshot,
} from "../registration/ports";

// brand の公認 cast をテスト側で 1 箇所に閉じる (production の生成点: db/repositories/mfa-registration.ts)。
export function makeGuardHold(hold: {
  userId: string;
  token: string;
  operation: RegistrationOperationKind;
  snapshot: RegistrationSnapshot;
}): GuardHold {
  return hold as GuardHold;
}

const notUsed = (name: string) => async (): Promise<never> => {
  throw new Error(`guarded gateway not used in this test: ${name}`);
};

// 遷移内窓口を使わないテスト用の型付き stub。`as never` で型検査を捨てない —
// GuardedMfaGateway にメソッドが増えたらここが typecheck で追随を要求する。
export const unusedGuardedGateway: GuardedMfaGateway = {
  enrollTotp: notUsed("enrollTotp"),
  readPendingTotpEnrollment: notUsed("readPendingTotpEnrollment"),
  verifyCode: notUsed("verifyCode"),
  activateTotp: notUsed("activateTotp"),
  disableTotp: notUsed("disableTotp"),
  revokeOtherSessions: notUsed("revokeOtherSessions"),
};

export const unusedGuardedGatewayFactory: GuardedGatewayFactory = () => unusedGuardedGateway;
