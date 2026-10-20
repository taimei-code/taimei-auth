import { describe, expect, test } from "bun:test";
import { Code, ConnectError } from "@connectrpc/connect";
import { Effect } from "effect";
import { recordSentry } from "../../__tests__/sentry-recorder";
import { DbError } from "../../errors";
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

  test("宣言した失敗は status を Code に、_tag を message にする", async () => {
    const e = await rejectsWith(runRpc(Effect.fail(new InvalidArgument({}))));
    expect([e.code, e.rawMessage]).toEqual([Code.InvalidArgument, "InvalidArgument"]);
    const f = await rejectsWith(runRpc(Effect.fail(new NotFound())));
    expect([f.code, f.rawMessage]).toEqual([Code.NotFound, "NotFound"]);
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
});
