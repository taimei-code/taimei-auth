import { describe, expect, test } from "bun:test";
import type { Actor } from "../../membership/guard/core";
import { ensureCanActivate, ensureCanEnroll, ensureDisableCanProceed } from "../registration/state";
import type { RegistrationSnapshot } from "../registration/ports";

const actor: Actor = {
  id: "user-1",
  email: "user@example.com",
  lastUsedCompanyId: null,
  twoFactorEnabled: false,
};

describe("MFA registration snapshot policy", () => {
  test("uses the snapshot captured with the guard instead of querying a later state", async () => {
    const snapshot: RegistrationSnapshot = {
      user: "present",
      email: actor.email,
      twoFactorEnabled: true,
      enrollment: { id: "enrollment-1", verified: false },
    };

    expect(await ensureCanEnroll(actor, snapshot)).toMatchObject({ error: "already_enabled" });
    expect(await ensureCanActivate(actor, snapshot)).toMatchObject({ error: "already_enabled" });
    expect(await ensureDisableCanProceed(actor, snapshot)).toBeUndefined();
  });
});
