import type { Actor } from "../../membership/guard/core";
import type { MfaCodeKind } from "../wire-contracts";
import { createRegistrationApplication } from "../registration/application";
import { productionRegistrationOperations, registrationGuard } from "../registration/wiring";

export const productionRegistrationNotifications: string[] = [];

const productionBackedRegistrationFacade = createRegistrationApplication({
  guard: registrationGuard,
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

const registrationPrincipalFor = (actor: Actor) => ({
  userId: actor.id,
  email: actor.email,
  twoFactorEnabled: actor.twoFactorEnabled,
});

export function readStatus(actor: Actor) {
  return productionBackedRegistrationFacade.getStatus(registrationPrincipalFor(actor));
}

export function enroll(actor: Actor, headers: Headers) {
  return productionBackedRegistrationFacade.enroll({
    principal: registrationPrincipalFor(actor),
    headers,
  });
}

export function activate(input: {
  actor: Actor;
  headers: Headers;
  enrollmentId?: string;
  code: string;
}) {
  const command = {
    principal: registrationPrincipalFor(input.actor),
    headers: input.headers,
    code: input.code,
  };
  return input.enrollmentId === undefined
    ? productionBackedRegistrationFacade.activateLegacy(command)
    : productionBackedRegistrationFacade.activate({
        ...command,
        enrollmentId: input.enrollmentId,
      });
}

export function disable(input: {
  actor: Actor;
  headers: Headers;
  code: string;
  kind: MfaCodeKind;
}) {
  return productionBackedRegistrationFacade.disable({
    principal: registrationPrincipalFor(input.actor),
    headers: input.headers,
    code: input.code,
    kind: input.kind,
  });
}
