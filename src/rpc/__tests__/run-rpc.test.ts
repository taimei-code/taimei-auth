import { describe, expect, test } from "bun:test";
import { Code, ConnectError } from "@connectrpc/connect";
import { Effect } from "effect";
import { recordSentryExceptions } from "../../__tests__/sentry-recorder";
import { DbError } from "../../errors";
import { Forbidden, NotFound } from "../../membership/guard/errors";
import { RateLimited } from "../../invitation/errors";
import { RpcError, runRpc, statusToCode } from "../run-rpc";

// design §3.2 / AC-016 / AC-017: runRpc は failure を ConnectError に写像する唯一の点。
const captured = recordSentryExceptions();

const rejectsWith = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return e as ConnectError;
  }
  throw new Error("expected rejection");
};

describe("statusToCode", () => {
  test("wire status → Connect Code の対応表", () => {
    expect([400, 401, 403, 404, 409, 410, 429, 500].map(statusToCode)).toEqual([
      Code.InvalidArgument,
      Code.Unauthenticated,
      Code.PermissionDenied,
      Code.NotFound,
      Code.FailedPrecondition,
      Code.FailedPrecondition,
      Code.ResourceExhausted,
      Code.Internal,
    ]);
  });
});

describe("runRpc", () => {
  test("成功値をそのまま resolve する", async () => {
    expect(await runRpc(Effect.succeed({ success: true }))).toEqual({ success: true });
  });

  test("RpcError は message と Code を保った ConnectError", async () => {
    const e = await rejectsWith(
      runRpc(
        Effect.fail(new RpcError({ code: Code.InvalidArgument, message: "No fields to update" })),
      ),
    );
    expect(e).toBeInstanceOf(ConnectError);
    expect([e.code, e.rawMessage]).toEqual([Code.InvalidArgument, "No fields to update"]);
  });

  test("guard failure は status → Code と error code を message に", async () => {
    const e = await rejectsWith(runRpc(Effect.fail(new NotFound())));
    expect([e.code, e.rawMessage]).toEqual([Code.NotFound, "not_found"]);
    const f = await rejectsWith(runRpc(Effect.fail(new Forbidden())));
    expect(f.code).toBe(Code.PermissionDenied);
  });

  test("domain failure も同じ表で写像される", async () => {
    const e = await rejectsWith(runRpc(Effect.fail(new RateLimited())));
    expect(e.code).toBe(Code.ResourceExhausted);
  });

  test("boundary error は Sentry(cause) + Code.Unknown で元 message を保つ (旧 ConnectRPC adapter と同契約)", async () => {
    captured.length = 0;
    const cause = new Error("db down");
    const e = await rejectsWith(runRpc(Effect.fail(new DbError({ cause }))));
    expect([e.code, e.rawMessage]).toEqual([Code.Unknown, "db down"]);
    expect(captured.map(([e]) => e)).toEqual([cause]);
  });

  test("defect は Sentry(原 Error) + Code.Unknown で元 message を保つ", async () => {
    captured.length = 0;
    const boom = new Error("boom");
    const e = await rejectsWith(runRpc(Effect.die(boom)));
    expect([e.code, e.rawMessage]).toEqual([Code.Unknown, "boom"]);
    expect(captured.map(([e]) => e)).toEqual([boom]);
  });
});
