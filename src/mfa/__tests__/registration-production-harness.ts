import type { Actor } from "../../membership/guard/core";
import type { MfaCodeKind } from "../wire-contracts";
import { createRegistrationApplication } from "../registration/application";
import {
  guardedGateway,
  productionRegistrationOperations,
  registrationGuard,
} from "../registration/wiring";

export const productionRegistrationNotifications: string[] = [];

const productionBackedRegistrationFacade = createRegistrationApplication({
  guard: registrationGuard,
  reportUnknownTransition: () => undefined,
  guardedGateway,
  operations: productionRegistrationOperations,
  notifyEnabled: (email) => {
    productionRegistrationNotifications.push(`enabled:${email}`);
  },
  notifyDisabled: (email) => {
    productionRegistrationNotifications.push(`disabled:${email}`);
  },
});

export function resetProductionRegistrationNotifications(): void {
  productionRegistrationNotifications.length = 0;
}

// status だけは公開 façade (index.ts) の bind ごと観測する。enroll / activate / disable は通知を
// 捕捉するため harness 専用 application を通す (reportUnknownTransition は明示 no-op — 観測系の検証は
// production wiring 側のテストが担う)。この非対称は意図的で、対称化すると実通知アダプタが結線される。
export { getStatus as readStatus } from "../registration";

export function enroll(actor: Actor, headers: Headers) {
  return productionBackedRegistrationFacade.enroll({ actor, headers });
}

export function activate(input: {
  actor: Actor;
  headers: Headers;
  enrollmentId?: string;
  code: string;
}) {
  const { enrollmentId, ...command } = input;
  return enrollmentId === undefined
    ? productionBackedRegistrationFacade.activateLegacy(command)
    : productionBackedRegistrationFacade.activate({ ...command, enrollmentId });
}

export function disable(input: {
  actor: Actor;
  headers: Headers;
  code: string;
  kind: MfaCodeKind;
}) {
  return productionBackedRegistrationFacade.disable({
    actor: input.actor,
    headers: input.headers,
    code: input.code,
    kind: input.kind,
  });
}
