import { afterEach, describe, expect, test } from "bun:test";
import { Effect, Exit } from "effect";

import { Unauthorized } from "@core/membership/guard/errors";
import { ChallengeExpired } from "@core/mfa/errors";

import { leaveForSignInOnUnauthorized } from "../spa-api-client";

const ORIGIN = "http://auth.taimei-code.local:3100";
const originalWindow = globalThis.window;

afterEach(() => {
  globalThis.window = originalWindow;
});

const stubWindow = () => {
  const replaced: string[] = [];
  globalThis.window = {
    location: {
      origin: ORIGIN,
      pathname: "/account/members",
      search: "",
      hash: "",
      replace: (url: string) => {
        replaced.push(url);
      },
    },
  } as unknown as typeof globalThis.window;
  return replaced;
};

describe("SPA の API の応答が Unauthorized の時だけ共通ログイン画面へ移る", () => {
  test("Unauthorized を受けると、今の画面を戻り先にして /auth/ へ 1 回移り、失敗はそのまま返す", async () => {
    const replaced = stubWindow();

    const exit = await Effect.runPromiseExit(
      leaveForSignInOnUnauthorized(Effect.fail(new Unauthorized())),
    );

    expect(Exit.isFailure(exit)).toBe(true);
    expect(replaced).toHaveLength(1);
    const url = new URL(replaced[0] ?? "", ORIGIN);
    expect(url.pathname).toBe("/auth/");
    expect(url.searchParams.get("redirect_url")).toBe(`${ORIGIN}/account/members`);
  });

  test("同じ 401 でも ChallengeExpired では移らない (status ではなく _tag で判定する)", async () => {
    const replaced = stubWindow();

    await Effect.runPromiseExit(leaveForSignInOnUnauthorized(Effect.fail(new ChallengeExpired())));

    expect(replaced).toEqual([]);
  });

  test("成功の値はそのまま返し、移らない", async () => {
    const replaced = stubWindow();

    expect(await Effect.runPromise(leaveForSignInOnUnauthorized(Effect.succeed(42)))).toBe(42);
    expect(replaced).toEqual([]);
  });
});
