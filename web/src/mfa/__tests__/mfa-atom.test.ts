import { describe, expect, test } from "bun:test";
import { Cause, Exit } from "effect";
import { HttpClientError, HttpClientRequest, HttpClientResponse } from "effect/http";

import { RateLimited, Unauthorized } from "@core/membership/guard/errors";
import { InvalidCode, Locked } from "@core/mfa/errors";

import { mfaChallengeObservationOf, mfaFailureMessage } from "../mfa-atom";

const GENERIC = "処理に失敗しました。しばらく待ってからもう一度お試しください。";

const statusError = (status: number) => {
  const request = HttpClientRequest.post("/api/account/mfa/disable");
  return new HttpClientError.HttpClientError({
    reason: new HttpClientError.StatusCodeError({
      request,
      response: HttpClientResponse.fromWeb(request, new Response(null, { status })),
    }),
  });
};

describe("mfaFailureMessage", () => {
  test("InvalidCode は入力の誤りを伝える", () => {
    expect(mfaFailureMessage(Cause.fail(new InvalidCode()))).toBe(
      "入力されたコードが正しくありません。",
    );
  });

  test("試行枠の RateLimited は回数の上限を伝え、ロックアウト (Locked) とは別の文言", () => {
    const rateLimited = mfaFailureMessage(Cause.fail(new RateLimited()));
    expect(rateLimited).toBe(
      "操作の回数が上限に達しました。しばらく待ってからもう一度お試しください。",
    );
    expect(mfaFailureMessage(Cause.fail(new Locked()))).not.toBe(rateLimited);
  });

  test("Unauthorized は表に無く、既定の文言を返す (ログイン画面へ移すのは SPA の API の client)", () => {
    expect(mfaFailureMessage(Cause.fail(new Unauthorized()))).toContain("処理に失敗しました");
  });

  test.each([
    ["契約の decode に落ちた 400 (body 無し)", Cause.die(statusError(400))],
    ["500 の HttpClientError", Cause.die(statusError(500))],
    ["通信の失敗", Cause.die(new Error("network"))],
  ] as const)("%s は既定の文言", (_name, cause) => {
    expect(mfaFailureMessage(cause)).toBe(GENERIC);
  });
});

describe("mfaChallengeObservationOf", () => {
  test("pending: true は present", () => {
    expect(mfaChallengeObservationOf(Exit.succeed({ pending: true }))).toEqual({ kind: "present" });
  });

  test("pending: false は absent", () => {
    expect(mfaChallengeObservationOf(Exit.succeed({ pending: false }))).toEqual({ kind: "absent" });
  });

  test("取得の失敗は absent と推測せず unavailable", () => {
    expect(mfaChallengeObservationOf(Exit.die(new Error("network")))).toEqual({
      kind: "unavailable",
    });
  });
});
