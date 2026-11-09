import { describe, expect, test } from "bun:test";
import { Effect, Layer } from "effect";
import { FetchHttpClient } from "effect/http";

import { SpaHttpClient } from "../../shared/spa-http-client";
import * as MfaDisabling from "../mfa-disabling";
import * as MfaEnrollment from "../mfa-enrollment";
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

const VISIT = 1;

const replyingSpaHttpClient = SpaHttpClient.layer("http://localhost").pipe(
  Layer.provide(Layer.succeed(FetchHttpClient.Fetch, replyingFetch)),
);

const verify = () =>
  Effect.runPromise(
    VerifyCode({ visit: VISIT, code: "123456", kind: "totp" }).effect.pipe(
      Effect.provide(replyingSpaHttpClient),
    ),
  );

const REQUEST_NUMBER = 1;

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

  test("無効化が試行枠の 429 (RateLimited) を返すと、回数の上限の失敗になる", async () => {
    answerWith(429, { _tag: "RateLimited" });
    expect(
      await Effect.runPromise(
        MfaDisabling.DisableMfa({
          requestNumber: REQUEST_NUMBER,
          code: "123456",
          kind: "totp",
        }).effect.pipe(Effect.provide(replyingSpaHttpClient)),
      ),
    ).toEqual(
      MfaDisabling.Message.FailedDisableMfa({
        requestNumber: REQUEST_NUMBER,
        failure: "RateLimited",
      }),
    );
  });

  test("登録が 409 の AlreadyEnabled を返すと、再読み込みの案内の失敗になる", async () => {
    answerWith(409, { _tag: "AlreadyEnabled" });
    expect(
      await Effect.runPromise(
        MfaEnrollment.EnrollMfa({ requestNumber: REQUEST_NUMBER }).effect.pipe(
          Effect.provide(replyingSpaHttpClient),
        ),
      ),
    ).toEqual(
      MfaEnrollment.Message.FailedEnrollMfa({
        requestNumber: REQUEST_NUMBER,
        failure: "AlreadyEnabled",
      }),
    );
  });
});
