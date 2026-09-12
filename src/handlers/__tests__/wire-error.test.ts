import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  spyOn,
  test,
} from "bun:test";
import { Cause } from "effect";
import { recordSentryExceptions } from "../../__tests__/sentry-recorder";
import { DbError } from "../../errors";
import { consoleSentryBackend, setSentryBackend } from "../../sentry";
import { InvalidCode, Locked, MfaNotFound } from "../../mfa/error-mapping";
import { AlreadyExists, NotFoundOrAlreadyDeleted } from "../../company/errors";
import { NotFoundOrNotPending, RateLimited } from "../../invitation/errors";
import { LastOwner } from "../../membership/errors";
import {
  ExpiredOrUsed,
  Forbidden,
  InvalidArgument,
  NotFound,
  Unauthorized,
} from "../../membership/guard/errors";
import {
  captureThrown,
  internalErrorResponse,
  parseWireShaped,
  settleCause,
  type WireError,
  wireErrorResponse,
} from "../wire-error";

// 旧 respond.ts の byte-invariant を引き継ぐ。
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

describe("parseWireShaped", () => {
  test("wire 形の failure は同じ参照をそのまま返す", () => {
    const failure = new Forbidden();
    expect(parseWireShaped(failure)).toBe(failure);
  });

  test("catalog 外でも wire 形なら通し、details は検査しない", () => {
    const details = { fieldErrors: { email: ["x"] } };
    expect(parseWireShaped({ error: "invalid_argument", status: 400, details })?.details).toBe(
      details,
    );
  });

  test("error と status が揃わない値は undefined", () => {
    const notWire: unknown[] = [
      { error: "x" },
      { status: 400 },
      { error: 1, status: 400 },
      { error: "x", status: "400" },
      null,
      undefined,
      "x",
    ];
    expect(notWire.filter((e) => parseWireShaped(e) !== undefined)).toEqual([]);
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
    [new Unauthorized(), 401, '{"error":"unauthorized"}'],
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

describe("settleCause", () => {
  const captured = recordSentryExceptions();
  const report = { label: "[t]", tags: { handler: "t" } };
  let spy: ReturnType<typeof spyOn>;
  beforeEach(() => {
    captured.length = 0;
    spy = spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => spy.mockRestore());

  test("boundary failure と wire failure が同居すると wire を返し boundary の cause を warning で送る", () => {
    const cause = new Error("pg down");
    const forbidden = new Forbidden();
    const settled = settleCause(
      Cause.combine(Cause.fail(new DbError({ cause })), Cause.fail(forbidden)),
      parseWireShaped,
      report,
    );
    expect(settled.failure).toBe(forbidden);
    expect(settled.reported).toEqual([cause]);
    expect(captured).toEqual([[cause, { tags: report.tags, level: "warning" }]]);
  });

  test("wire 形でない failure は failure 無しで error として送る", () => {
    const rogue = { _tag: "Rogue" };
    const settled = settleCause(Cause.fail(rogue), parseWireShaped, report);
    expect(settled.failure).toBeUndefined();
    expect(settled.reported).toEqual([rogue]);
    expect(captured[0]?.[1]?.level).toBe("error");
  });

  test("wire failure は Sentry に送らない (2 つあっても最初の 1 つを返すだけ)", () => {
    const first = new Forbidden();
    const settled = settleCause(
      Cause.combine(Cause.fail(first), Cause.fail(new NotFound())),
      parseWireShaped,
      report,
    );
    expect(settled.failure).toBe(first);
    expect(settled.reported).toEqual([]);
  });

  test("interrupt だけの Cause は Cause.pretty の Error を 1 件送る", () => {
    const settled = settleCause(Cause.interrupt(), parseWireShaped, report);
    expect(settled.failure).toBeUndefined();
    expect(settled.reported.length).toBe(1);
    expect(settled.reported[0]).toBeInstanceOf(Error);
    expect((settled.reported[0] as Error).message).toMatch(/interrupt/i);
  });
});

// captureThrown: Effect の外 (better-auth の onAPIError.onError) で受けた thrown value を adapter と同じ
// settleCause の規則で Sentry に送る。
describe("captureThrown", () => {
  const captured = recordSentryExceptions();
  const tags = { component: "better-auth" };

  test("boundary error は cause そのものを warning で送る (grouping を保つ)", () => {
    const cause = new Error("pg down");
    const n = captured.length;
    captureThrown(new DbError({ cause }), "better-auth");
    expect(captured.length - n).toBe(1);
    expect(captured[n]?.[0]).toBe(cause);
    expect(captured[n]?.[1]).toEqual({ level: "warning", tags });
  });

  test("boundary でない Error は defect として error で送る", () => {
    const err = new Error("bug");
    const n = captured.length;
    captureThrown(err, "better-auth");
    expect(captured.length - n).toBe(1);
    expect(captured[n]?.[0]).toBe(err);
    expect(captured[n]?.[1]?.level).toBe("error");
  });

  // wire が無いので wire-shaped な failure も内部失敗として送る。
  test("wire-shaped な値も痕跡ゼロにせず error で送る", () => {
    const failure = new Forbidden();
    const n = captured.length;
    captureThrown(failure, "better-auth");
    expect(captured.length - n).toBe(1);
    expect(captured[n]?.[0]).toBe(failure);
    expect(captured[n]?.[1]?.level).toBe("error");
  });

  test("console.error を [component] 付きで 1 回残す", () => {
    const spy = spyOn(console, "error").mockImplementation(() => {});
    try {
      captureThrown(new Error("x"), "better-auth");
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy.mock.calls[0]?.[0]).toBe("[better-auth]");
    } finally {
      spy.mockRestore();
    }
  });

  test("戻り値は undefined で throw しない", () => {
    expect(captureThrown(new Error("x"), "better-auth")).toBeUndefined();
  });
});

// Sentry backend の throw を握る (better-call は onError の throw を auth.handler の reject にし、better-auth の
// 500 応答と Set-Cookie 合流を失わせる)。
describe("captureThrown は観測自体の失敗を握る", () => {
  const sentryFailure = new Error("sentry down");
  beforeAll(() =>
    setSentryBackend({
      captureException: () => {
        throw sentryFailure;
      },
      captureMessage: () => {},
    }),
  );
  afterAll(() => setSentryBackend(consoleSentryBackend));

  test("backend が throw しても captureThrown は throw せず、元の error と観測失敗を console.error に残す", () => {
    const spy = spyOn(console, "error").mockImplementation(() => {});
    try {
      const original = new Error("x");
      expect(() => captureThrown(original, "better-auth")).not.toThrow();
      expect(spy).toHaveBeenCalledTimes(2);
      expect(spy.mock.calls[0]).toEqual(["[better-auth]", original]);
      expect(spy.mock.calls[1]?.[1]).toBe(sentryFailure);
    } finally {
      spy.mockRestore();
    }
  });
});
