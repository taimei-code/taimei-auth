import { describe, expect, test } from "bun:test";
import {
  AlreadyOwner,
  EmailMismatch,
  ExpiredOrUsed,
  Forbidden,
  type GuardError,
  InvalidArgument,
  NotFound,
  Unauthorized,
} from "../guard/errors";

// design §3.6 / AC-037: guard の failure class は _tag / error / status を own property に持ち、
// wire code と status を自身で運ぶ (catalog 分散、adapter は直列化のみ)。
describe("guard errors", () => {
  test("Unauthorized は error=unauthorized / status=401 を own property に持つ", () => {
    const e = new Unauthorized();
    expect(Object.hasOwn(e, "_tag")).toBe(true);
    expect(Object.hasOwn(e, "error")).toBe(true);
    expect(Object.hasOwn(e, "status")).toBe(true);
    expect(e).toMatchObject({ _tag: "Unauthorized", error: "unauthorized", status: 401 });
  });

  test("catalog の (error, status) 組が respond.ts と一致する", () => {
    const rows: Array<[GuardError, string, number]> = [
      [new Unauthorized(), "unauthorized", 401],
      [new Forbidden(), "forbidden", 403],
      [new NotFound(), "not_found", 404],
      [new InvalidArgument({}), "invalid_argument", 400],
      [new EmailMismatch(), "email_mismatch", 403],
      [new AlreadyOwner(), "already_owner", 400],
      [new ExpiredOrUsed(), "expired_or_used", 410],
    ];
    for (const [e, error, status] of rows) {
      expect([e.error as string, e.status as number]).toEqual([error, status]);
    }
  });

  test("InvalidArgument は details 未指定なら own property を持たず、指定時は同一 object を持つ", () => {
    const without = new InvalidArgument({});
    expect(Object.hasOwn(without, "details") && without.details !== undefined).toBe(false);
    const details = { formErrors: [], fieldErrors: { email: ["x"] } };
    const withDetails = new InvalidArgument({ details });
    expect(withDetails.details).toBe(details);
  });
});
