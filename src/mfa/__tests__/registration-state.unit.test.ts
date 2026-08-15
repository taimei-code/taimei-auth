import { describe, expect, test } from "bun:test";
import type { Actor } from "../../membership/guard/core";
import {
  actorFromSnapshot,
  ensureCanActivate,
  ensureCanEnroll,
  ensureDisableCanProceed,
} from "../registration/state";
import type { RegistrationSnapshot } from "../registration/ports";

const actor: Actor = {
  id: "user-1",
  email: "user@example.com",
  lastUsedCompanyId: null,
  twoFactorEnabled: false,
};

describe("MFA registration snapshot policy", () => {
  test("uses snapshot identity and disables MFA when the snapshot has no user", () => {
    const principal = {
      userId: actor.id,
      email: "principal@example.com",
      twoFactorEnabled: true,
    };

    expect(
      actorFromSnapshot(principal, {
        user: "present",
        email: "snapshot@example.com",
        twoFactorEnabled: false,
        enrollment: undefined,
      }),
    ).toMatchObject({ email: "snapshot@example.com", twoFactorEnabled: false });
    expect(actorFromSnapshot(principal, { user: "absent" })).toMatchObject({
      email: "principal@example.com",
      twoFactorEnabled: false,
    });
  });

  test("uses the snapshot captured with the guard instead of querying a later state", () => {
    const snapshot: RegistrationSnapshot = {
      user: "present",
      email: actor.email,
      twoFactorEnabled: true,
      enrollment: { id: "enrollment-1", verified: false },
    };

    expect(ensureCanEnroll(snapshot)).toMatchObject({ error: "already_enabled" });
    expect(ensureCanActivate(snapshot)).toMatchObject({ error: "already_enabled" });
    expect(ensureDisableCanProceed(snapshot)).toBeUndefined();
  });
});
