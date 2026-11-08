import { describe, expect, test } from "bun:test";
import { Effect, Exit, Layer } from "effect";
import { FetchHttpClient } from "effect/http";
import { AtomHttpApi, AtomRegistry } from "effect/reactivity";

import { SpaApi } from "@core/spa-contract";

import { runMutation } from "../../shared/atom-runtime";
import { leaveForSignInOnUnauthorized } from "../../shared/spa-api-client";
import { SpaHttpClient } from "../../shared/spa-http-client";
import { mfaFailureMessage } from "../mfa-atom";
import { MFA_FAILURE_MESSAGES } from "../mfa-failure-messages";
import { Message, VerifyCode } from "../pages/MfaChallenge";

let reply: () => Response = () => new Response(null, { status: 500 });

const answerWith = (status: number, body?: unknown) => {
  reply = () =>
    new Response(body === undefined ? null : JSON.stringify(body), {
      status,
      headers: body === undefined ? {} : { "content-type": "application/json" },
    });
};

const replyingFetch = (() => Promise.resolve(reply())) as unknown as typeof globalThis.fetch;

class ReplyingSpaApiClient extends AtomHttpApi.Service<ReplyingSpaApiClient>()(
  "ReplyingSpaApiClient",
  {
    api: SpaApi,
    httpClient: FetchHttpClient.layer.pipe(
      Layer.provide(Layer.succeed(FetchHttpClient.Fetch, replyingFetch)),
    ),
    baseUrl: "http://localhost",
    transformResponse: leaveForSignInOnUnauthorized,
  },
) {}

const disableAtom = ReplyingSpaApiClient.mutation("mfa", "disable");
const enrollAtom = ReplyingSpaApiClient.mutation("mfa", "enroll");

const VISIT = 1;

const verify = () =>
  Effect.runPromise(
    VerifyCode({ visit: VISIT, code: "123456", kind: "totp" }).effect.pipe(
      Effect.provide(
        SpaHttpClient.layer("http://localhost").pipe(
          Layer.provide(Layer.succeed(FetchHttpClient.Fetch, replyingFetch)),
        ),
      ),
    ),
  );

describe("MFA の API の応答の status と body から、画面に出す結果を選ぶ", () => {
  test("MFA チャレンジの確かめが 401 の ChallengeExpired を返すと、期限切れの失敗になる", async () => {
    answerWith(401, { _tag: "ChallengeExpired" });
    expect(await verify()).toEqual(
      Message.FailedVerifyCode({ visit: VISIT, failure: "ChallengeExpired" }),
    );
  });

  test("MFA チャレンジの確かめが空の redirect_url を返すと、遷移せずに想定外の失敗になる", async () => {
    answerWith(200, { redirect_url: "" });
    expect(await verify()).toEqual(
      Message.FailedVerifyCode({ visit: VISIT, failure: "Unexpected" }),
    );
  });

  test("MFA チャレンジの確かめが本文の無い 400 を返すと、想定外の失敗になる", async () => {
    answerWith(400);
    expect(await verify()).toEqual(
      Message.FailedVerifyCode({ visit: VISIT, failure: "Unexpected" }),
    );
  });

  test("MFA チャレンジの確かめが試行枠の 429 (RateLimited) を返すと、回数の上限の失敗になる", async () => {
    answerWith(429, { _tag: "RateLimited" });
    expect(await verify()).toEqual(
      Message.FailedVerifyCode({ visit: VISIT, failure: "RateLimited" }),
    );
  });

  test("MFA チャレンジの確かめが redirect_url を返すと、その戻り先の成功になる", async () => {
    answerWith(200, { redirect_url: "https://app.example.com/" });
    expect(await verify()).toEqual(
      Message.SucceededVerifyCode({ visit: VISIT, redirectUrl: "https://app.example.com/" }),
    );
  });

  test("無効化が試行枠の 429 (RateLimited) を返すと、回数の上限の文言を出す", async () => {
    answerWith(429, { _tag: "RateLimited" });
    const exit = await runMutation(AtomRegistry.make(), disableAtom, {
      payload: { code: "123456", kind: "totp" },
    });
    if (Exit.isSuccess(exit)) {
      throw new Error("disable unexpectedly succeeded");
    }
    expect(mfaFailureMessage(exit.cause)).toBe(MFA_FAILURE_MESSAGES.RateLimited);
  });

  test("登録が 409 の AlreadyEnabled を返すと、再読み込みの案内の文言を出す", async () => {
    answerWith(409, { _tag: "AlreadyEnabled" });
    const exit = await runMutation(AtomRegistry.make(), enrollAtom, {});
    if (Exit.isSuccess(exit)) {
      throw new Error("enroll unexpectedly succeeded");
    }
    expect(mfaFailureMessage(exit.cause)).toBe(MFA_FAILURE_MESSAGES.AlreadyEnabled);
  });
});
