import { describe, expect, test } from "bun:test";
import { Code, ConnectError } from "@connectrpc/connect";
import { Effect, Schema } from "effect";
import { recordSentry } from "../../__tests__/sentry-recorder";
import { DbError } from "../../errors";
import { WIRE_STATUSES } from "../../failure";
import { InvalidArgument, NotFound } from "../../failures";
import { runRpc, statusToCode } from "../run-rpc";

const { exceptions: captured } = recordSentry();

const rejectsWith = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return e as ConnectError;
  }
  throw new Error("expected rejection");
};

describe("statusToCode", () => {
  test("HTTP status → Connect Code の対応表", () => {
    expect(WIRE_STATUSES.map(statusToCode)).toEqual([
      Code.InvalidArgument,
      Code.Unauthenticated,
      Code.PermissionDenied,
      Code.NotFound,
      Code.FailedPrecondition,
      Code.FailedPrecondition,
      Code.ResourceExhausted,
      Code.Unavailable,
    ]);
  });
});

describe("runRpc", () => {
  test("成功値をそのまま resolve する", async () => {
    expect(await runRpc(Effect.succeed({ success: true }))).toEqual({ success: true });
  });

  test("宣言した失敗は status を Code に、_tag を message にする", async () => {
    const e = await rejectsWith(runRpc(Effect.fail(new InvalidArgument({}))));
    expect([e.code, e.rawMessage]).toEqual([Code.InvalidArgument, "InvalidArgument"]);
    const f = await rejectsWith(runRpc(Effect.fail(new NotFound())));
    expect([f.code, f.rawMessage]).toEqual([Code.NotFound, "NotFound"]);
  });

  test("表に無い status を宣言した失敗は宣言した失敗として扱わず、Sentry に送って Code.Unknown を返す", async () => {
    class InternalOnly extends Schema.TaggedError<InternalOnly>()(
      "InternalOnly",
      {},
      { httpApiStatus: 500 },
    ) {}
    captured.length = 0;
    const internalOnly = new InternalOnly();
    const e = await rejectsWith(runRpc(Effect.fail(internalOnly) as Effect.Effect<never>));
    expect(e.code).toBe(Code.Unknown);
    expect(captured.map(([e]) => e)).toEqual([internalOnly]);
  });

  test("boundary error は Sentry(cause) + Code.Unknown で元 message を保つ (旧 ConnectRPC adapter と同契約)", async () => {
    captured.length = 0;
    const cause = new Error("db down");
    const e = await rejectsWith(runRpc(Effect.fail(new DbError({ cause }))));
    expect([e.code, e.rawMessage]).toEqual([Code.Unknown, "db down"]);
    expect(captured.map(([e]) => e)).toEqual([cause]);
    expect(captured[0]?.[1]).toMatchObject({ level: "warning", tags: { handler: "runRpc" } });
  });

  test("defect は Sentry(原 Error) + Code.Unknown で元 message を保つ", async () => {
    captured.length = 0;
    const boom = new Error("boom");
    const e = await rejectsWith(runRpc(Effect.die(boom)));
    expect([e.code, e.rawMessage]).toEqual([Code.Unknown, "boom"]);
    expect(captured.map(([e]) => e)).toEqual([boom]);
  });

  test("effect は Die と同じ Cause にある Fail も defect に変えるので、宣言した失敗と finalizer の defect が同じ Cause に入ると宣言した失敗の Code にせず Code.Unknown を返し、2 つとも Sentry に送る", async () => {
    captured.length = 0;
    const boom = new Error("boom");
    const e = await rejectsWith(
      runRpc(
        Effect.fail(new NotFound()).pipe(
          Effect.ensuring(
            Effect.sync(() => {
              throw boom;
            }),
          ),
        ),
      ),
    );
    expect(e.code).toBe(Code.Unknown);
    expect(captured.map(([e]) => e)).toEqual([new NotFound(), boom]);
  });
});
