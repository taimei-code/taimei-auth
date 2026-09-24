import { describe, expect, test } from "bun:test";
import { Code, ConnectError } from "@connectrpc/connect";
import { Effect, Layer } from "effect";
import { partial } from "../../__tests__/live-runner";
import { recordSentryExceptions } from "../../__tests__/sentry-recorder";
import { AuthApi } from "../../auth-service";
import { AuthApiError } from "../../errors";
import { sendMagicLinkProgram } from "../auth-handler";
import { runRpc } from "../run-rpc";

describe("sendMagicLinkProgram", () => {
  const captured = recordSentryExceptions();
  const req = { email: "a@example.com", callbackUrl: "https://app.example/cb" };

  const run = (signInMagicLink: AuthApi["Service"]["signInMagicLink"]) =>
    runRpc(
      sendMagicLinkProgram(req).pipe(
        Effect.provide(Layer.succeed(AuthApi, partial<AuthApi["Service"]>({ signInMagicLink }))),
      ),
    );

  test("better-auth の失敗は handler で変換せず、runRpc が boundary error として応答し Sentry に記録する", async () => {
    const cause = new Error("ttl down");
    const before = captured.length;
    const e = (await run(() => Effect.fail(new AuthApiError({ cause }))).catch(
      (e: unknown) => e,
    )) as ConnectError;
    expect(e).toBeInstanceOf(ConnectError);
    expect([e.code, e.rawMessage]).toEqual([Code.Unknown, "ttl down"]);
    expect(captured.length).toBe(before + 1);
    expect(captured.at(-1)?.[0]).toBe(cause);
    expect(captured.at(-1)?.[1]).toMatchObject({ level: "warning", tags: { handler: "runRpc" } });
  });

  test("成功時は email と callbackURL を渡して success を返し、Sentry に記録しない", async () => {
    const calls: unknown[] = [];
    const before = captured.length;
    const result = await run((input) =>
      Effect.sync(() => {
        calls.push(input);
      }),
    );
    expect(result).toEqual({ success: true });
    expect(calls).toEqual([{ email: req.email, callbackURL: req.callbackUrl }]);
    expect(captured.length).toBe(before);
  });
});
