import { describe, expect, test } from "bun:test";
import { Exit, Layer } from "effect";
import { FetchHttpClient } from "effect/http";
import { AtomHttpApi, AtomRegistry } from "effect/reactivity";

import { SpaApi } from "@core/spa-contract";

import { runMutation } from "../../shared/atom-runtime";
import { leaveForSignInOnUnauthorized } from "../../shared/spa-api-client";
import { MFA_FAILURE_MESSAGES, mfaFailureMessage } from "../mfa-atom";
import { verificationOf } from "../use-mfa-challenge-flow";

const GENERIC_MESSAGE = "処理に失敗しました。しばらく待ってからもう一度お試しください。";

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

const verifyAtom = ReplyingSpaApiClient.mutation("mfaChallenge", "verify");
const disableAtom = ReplyingSpaApiClient.mutation("mfa", "disable");
const enrollAtom = ReplyingSpaApiClient.mutation("mfa", "enroll");

const verify = () =>
  runMutation(AtomRegistry.make(), verifyAtom, { payload: { code: "123456", kind: "totp" } });

describe("MFA の API の応答の status と body から、画面に出す結果を選ぶ", () => {
  test("verify が 401 の ChallengeExpired を返すと、入力を閉じる expired になる", async () => {
    answerWith(401, { _tag: "ChallengeExpired" });
    expect(verificationOf(await verify())).toEqual({ kind: "expired" });
  });

  test("verify が空の redirect_url を返すと、遷移せずに既定の文言の rejected になる", async () => {
    answerWith(200, { redirect_url: "" });
    expect(verificationOf(await verify())).toEqual({
      kind: "rejected",
      errorMessage: GENERIC_MESSAGE,
    });
  });

  test("verify が本文の無い 400 を返すと、既定の文言の rejected になる", async () => {
    answerWith(400);
    expect(verificationOf(await verify())).toEqual({
      kind: "rejected",
      errorMessage: GENERIC_MESSAGE,
    });
  });

  test("verify が試行枠の 429 (RateLimited) を返すと、回数の上限の文言の rejected になる", async () => {
    answerWith(429, { _tag: "RateLimited" });
    expect(verificationOf(await verify())).toEqual({
      kind: "rejected",
      errorMessage: MFA_FAILURE_MESSAGES.RateLimited,
    });
  });

  test("無効化が試行枠の 429 (RateLimited) を返すと、回数の上限の文言を出す", async () => {
    answerWith(429, { _tag: "RateLimited" });
    const exit = await runMutation(AtomRegistry.make(), disableAtom, {
      payload: { code: "123456", kind: "totp" },
    });
    if (Exit.isSuccess(exit)) throw new Error("disable unexpectedly succeeded");
    expect(mfaFailureMessage(exit.cause)).toBe(MFA_FAILURE_MESSAGES.RateLimited);
  });

  test("登録が 409 の AlreadyEnabled を返すと、再読み込みの案内の文言を出す", async () => {
    answerWith(409, { _tag: "AlreadyEnabled" });
    const exit = await runMutation(AtomRegistry.make(), enrollAtom, {});
    if (Exit.isSuccess(exit)) throw new Error("enroll unexpectedly succeeded");
    expect(mfaFailureMessage(exit.cause)).toBe(MFA_FAILURE_MESSAGES.AlreadyEnabled);
  });
});
