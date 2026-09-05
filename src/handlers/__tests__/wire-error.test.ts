import { describe, expect, test } from "bun:test";
import { InvalidCode, Locked, MfaNotFound } from "../../mfa/error-mapping";
import { AlreadyExists, NotFoundOrAlreadyDeleted } from "../../company/errors";
import { NotFoundOrNotPending, RateLimited } from "../../invitation/errors";
import { LastOwner } from "../../membership/errors";
import { ExpiredOrUsed, Forbidden, InvalidArgument, NotFound } from "../../membership/guard/errors";
import { internalErrorResponse, type WireError, wireErrorResponse } from "../wire-error";

// design §3.2 / AC-011 / AC-012 / AC-015 / AC-041。旧 respond.ts の byte-invariant を引き継ぐ。
describe("wireErrorResponse", () => {
  test("failure を { error } JSON にし、content-type は charset 無しの application/json", async () => {
    const res = wireErrorResponse(new Forbidden());
    expect(res.status).toBe(403);
    expect(res.headers.get("content-type")).toBe("application/json");
    expect(await res.text()).toBe('{"error":"forbidden"}');
  });

  test("details 無しの InvalidArgument は details key を持たない", async () => {
    const body = await wireErrorResponse(new InvalidArgument({})).json();
    expect("details" in (body as object)).toBe(false);
  });

  test("details 有りの InvalidArgument は同じ object を details に持つ", async () => {
    const details = { formErrors: [], fieldErrors: { email: ["x"] } };
    const body = await wireErrorResponse(new InvalidArgument({ details })).json();
    expect(body).toEqual({ error: "invalid_argument", details });
  });
});

describe("internalErrorResponse", () => {
  test("Hono 既定と同じ text の 500", async () => {
    const res = internalErrorResponse();
    expect([res.status, await res.text()]).toEqual([500, "Internal Server Error"]);
  });
});

describe("failure class の wire 直列化 (旧 REASON_TO_ERROR / 旧 respond.ts と同一の組)", () => {
  // guard / domain / MFA の failure はすべて wireErrorResponse の 1 経路を通る。
  const table: Array<[WireError, number, string]> = [
    [new Forbidden(), 403, '{"error":"forbidden"}'],
    [new NotFound(), 404, '{"error":"not_found"}'],
    [new LastOwner(), 409, '{"error":"last_owner"}'],
    [new AlreadyExists(), 409, '{"error":"already_exists"}'],
    [new NotFoundOrNotPending(), 404, '{"error":"not_found_or_not_pending"}'],
    [new NotFoundOrAlreadyDeleted(), 404, '{"error":"not_found_or_already_deleted"}'],
    [new RateLimited(), 429, '{"error":"rate_limited"}'],
    [new ExpiredOrUsed(), 410, '{"error":"expired_or_used"}'],
    [new InvalidCode(), 400, '{"error":"invalid_code"}'],
    [new Locked(), 429, '{"error":"locked"}'],
    [new MfaNotFound(), 404, '{"error":"not_found"}'],
  ];
  for (const [failure, status, body] of table) {
    test(`${failure._tag} → ${status} ${body}`, async () => {
      const res = wireErrorResponse(failure);
      expect([res.status, await res.text()]).toEqual([status, body]);
    });
  }
});
