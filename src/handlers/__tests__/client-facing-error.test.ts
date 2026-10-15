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
import { Cause, Schema } from "effect";
import * as companyErrors from "../../company/errors";
import * as invitationErrors from "../../invitation/errors";
import * as membershipErrors from "../../membership/errors";
import * as guardErrors from "../../membership/guard/errors";
import * as mfaErrors from "../../mfa/errors";
import * as serviceKey from "../../service-key";
import { recordSentry } from "../../__tests__/sentry-recorder";
import { DbError } from "../../errors";
import { consoleSentryBackend, setSentryBackend } from "../../sentry";
import { InvalidCode, Locked, MfaNotFound } from "../../mfa/errors";
import { AlreadyExists } from "../../company/errors";
import { NotFoundOrNotPending } from "../../invitation/errors";
import { LastOwner } from "../../membership/errors";
import {
  ExpiredOrUsed,
  Forbidden,
  InvalidArgument,
  NotFound,
  RateLimited,
  Unauthorized,
} from "../../membership/guard/errors";
import { ServiceKeyMisconfigured, ServiceKeyRejected } from "../../service-key";
import {
  captureThrown,
  internalErrorResponse,
  parseClientFacingError,
  settleCause,
  clientFacingErrorResponse,
} from "../client-facing-error";

const responseOf = (failure: unknown) => {
  const clientFacing = parseClientFacingError(failure);
  if (!clientFacing) throw new Error("not client-facing");
  return clientFacingErrorResponse(clientFacing);
};

describe("clientFacingErrorResponse", () => {
  test("失敗の class の encode を JSON にし、content-type は charset 無しの application/json", async () => {
    const res = responseOf(new Forbidden());
    expect(res.status).toBe(403);
    expect(res.headers.get("content-type")).toBe("application/json");
    expect(await res.text()).toBe('{"_tag":"Forbidden"}');
  });

  test("details 無しの InvalidArgument は details key を持たない", async () => {
    const body = await responseOf(new InvalidArgument({})).json();
    expect("details" in (body as object)).toBe(false);
  });

  test("details 有りの InvalidArgument は同じ値を details に持つ", async () => {
    const details = { formErrors: [], fieldErrors: { email: ["x"] } };
    const body = await responseOf(new InvalidArgument({ details })).json();
    expect(body).toEqual({ _tag: "InvalidArgument", details });
  });
});

describe("parseClientFacingError", () => {
  test("httpApiStatus を持つ失敗の class は、annotation の status とその instance を返す", () => {
    const forbidden = new Forbidden();
    const parsed = parseClientFacingError(forbidden);
    expect(parsed?.status).toBe(403);
    expect(parsed?.failure).toBe(forbidden);
  });

  test("error と status の field を持つだけの値は client-facing ではない", () => {
    expect(parseClientFacingError({ error: "x", status: 400 })).toBeUndefined();
  });

  test("境界の失敗は client-facing ではない", () => {
    expect(parseClientFacingError(new DbError({ cause: "x" }))).toBeUndefined();
  });

  test("Schema の class でない値は undefined", () => {
    const notClientFacing: unknown[] = [
      { _tag: "Forbidden" },
      null,
      undefined,
      "x",
      new Error("x"),
    ];
    expect(notClientFacing.filter((e) => parseClientFacingError(e) !== undefined)).toEqual([]);
  });
});

describe("失敗の宣言", () => {
  test("失敗の module が export する Schema の class は、どれも次の httpApiStatus を持つ", () => {
    const classes = [
      guardErrors,
      membershipErrors,
      companyErrors,
      invitationErrors,
      mfaErrors,
      serviceKey,
    ]
      .flatMap((module) => Object.values(module))
      .filter(Schema.isSchema);
    const statusByTag = Object.fromEntries(
      classes.map((cls) => [cls.ast.annotations?.identifier, cls.ast.annotations?.httpApiStatus]),
    );
    expect(statusByTag).toStrictEqual({
      AlreadyOwner: 400,
      EmailMismatch: 403,
      ExpiredOrUsed: 410,
      Forbidden: 403,
      InvalidArgument: 400,
      NotFound: 404,
      RateLimited: 429,
      Unauthorized: 401,
      LastOwner: 409,
      AlreadyExists: 409,
      NotFoundOrNotPending: 404,
      AlreadyEnabled: 409,
      ChallengeExpired: 401,
      EnrollmentChanged: 409,
      InvalidCode: 400,
      Locked: 429,
      MfaNotFound: 404,
      NotEnabled: 409,
      ServiceKeyMisconfigured: 503,
      ServiceKeyRejected: 401,
    });
  });
});

describe("internalErrorResponse", () => {
  test("Hono 既定と同じ text の 500", async () => {
    const res = internalErrorResponse();
    expect([res.status, await res.text()]).toEqual([500, "Internal Server Error"]);
  });
});

describe("失敗の class の応答への直列化", () => {
  const table: Array<[unknown, number, string]> = [
    [new Unauthorized(), 401, '{"_tag":"Unauthorized"}'],
    [new Forbidden(), 403, '{"_tag":"Forbidden"}'],
    [new NotFound(), 404, '{"_tag":"NotFound"}'],
    [new LastOwner(), 409, '{"_tag":"LastOwner"}'],
    [new AlreadyExists(), 409, '{"_tag":"AlreadyExists"}'],
    [new NotFoundOrNotPending(), 404, '{"_tag":"NotFoundOrNotPending"}'],
    [new RateLimited(), 429, '{"_tag":"RateLimited"}'],
    [new ExpiredOrUsed(), 410, '{"_tag":"ExpiredOrUsed"}'],
    [new InvalidCode(), 400, '{"_tag":"InvalidCode"}'],
    [new Locked(), 429, '{"_tag":"Locked"}'],
    [new MfaNotFound(), 404, '{"_tag":"MfaNotFound"}'],
    [new ServiceKeyRejected(), 401, '{"_tag":"ServiceKeyRejected"}'],
    [new ServiceKeyMisconfigured(), 503, '{"_tag":"ServiceKeyMisconfigured"}'],
  ];
  for (const [failure, status, body] of table) {
    test(`${body} → ${status}`, async () => {
      const res = responseOf(failure);
      expect([res.status, await res.text()]).toEqual([status, body]);
    });
  }
});

describe("settleCause", () => {
  const { exceptions: captured } = recordSentry();
  const report = { label: "[t]", tags: { handler: "t" } };
  let spy: ReturnType<typeof spyOn>;
  beforeEach(() => {
    captured.length = 0;
    spy = spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => spy.mockRestore());

  test("boundary failure と client-facing failure が同居すると client-facing を返し boundary の cause を warning で送る", () => {
    const cause = new Error("pg down");
    const forbidden = new Forbidden();
    const settled = settleCause(
      Cause.combine(Cause.fail(new DbError({ cause })), Cause.fail(forbidden)),
      parseClientFacingError,
      report,
    );
    expect(settled.failure?.tag).toBe("Forbidden");
    expect(settled.reported).toEqual([cause]);
    expect(captured).toEqual([[cause, { tags: report.tags, level: "warning" }]]);
  });

  test("client-facing 形でない failure は failure 無しで error として送る", () => {
    const rogue = { _tag: "Rogue" };
    const settled = settleCause(Cause.fail(rogue), parseClientFacingError, report);
    expect(settled.failure).toBeUndefined();
    expect(settled.reported).toEqual([rogue]);
    expect(captured[0]?.[1]?.level).toBe("error");
  });

  test("client-facing failure は Sentry に送らない (2 つあっても最初の 1 つを返すだけ)", () => {
    const first = new Forbidden();
    const settled = settleCause(
      Cause.combine(Cause.fail(first), Cause.fail(new NotFound())),
      parseClientFacingError,
      report,
    );
    expect(settled.failure?.tag).toBe("Forbidden");
    expect(settled.reported).toEqual([]);
  });

  test("interrupt だけの Cause は Cause.pretty の Error を 1 件送る", () => {
    const settled = settleCause(Cause.interrupt(), parseClientFacingError, report);
    expect(settled.failure).toBeUndefined();
    expect(settled.reported.length).toBe(1);
    expect(settled.reported[0]).toBeInstanceOf(Error);
    expect((settled.reported[0] as Error).message).toMatch(/interrupt/i);
  });
});

describe("captureThrown", () => {
  const { exceptions: captured } = recordSentry();
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

  test("client-facing 形 な値も痕跡ゼロにせず error で送る", () => {
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
