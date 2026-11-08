import { describe, expect, test } from "bun:test";
import {
  Command,
  expectNoOutMessage,
  expectOutMessage,
  given,
  message,
  model,
  story,
} from "foldkit/story";

import { MFA_FAILURE_MESSAGES } from "../mfa-failure-messages";
import {
  init,
  LoadChallengeState,
  Message,
  type Model,
  OutMessage,
  update,
  VerifyCode,
} from "../pages/MfaChallenge";

const VISIT = 5;
const SIGN_IN_HREF = "/auth?service_name=accounts&redirect_url=x";

const observing = (): Model => init({ visit: VISIT, signInHref: SIGN_IN_HREF }).model;

const entering = (code = ""): Model => ({
  ...observing(),
  phase: { _tag: "Entering", kind: "totp", code, submission: { _tag: "Idle" } },
});

describe("MFA チャレンジの状態の読み込み", () => {
  test("開くと状態を読みに行く", () => {
    expect(init({ visit: VISIT, signInHref: SIGN_IN_HREF }).commands).toMatchObject([
      { name: LoadChallengeState.name, args: { visit: VISIT } },
    ]);
  });

  test.each([
    [true, "Entering"],
    [false, "Expired"],
  ] as const)("保留中が %s なら %s になる", (isPending, phase) => {
    story(
      update,
      given(observing()),
      message(Message.SucceededLoadChallengeState({ visit: VISIT, isPending })),
      model((next) => {
        expect(next.phase._tag).toBe(phase);
      }),
    );
  });

  test("読み込みに失敗しても入力を許す", () => {
    story(
      update,
      given(observing()),
      message(Message.FailedLoadChallengeState({ visit: VISIT })),
      model((next) => {
        expect(next.phase._tag).toBe("Entering");
      }),
    );
  });

  test("古い画面の読み込みの結果は、今の画面を変えない", () => {
    story(
      update,
      given(observing()),
      message(Message.SucceededLoadChallengeState({ visit: VISIT - 1, isPending: false })),
      model((next) => {
        expect(next.phase._tag).toBe("Observing");
      }),
    );
  });
});

describe("MFA チャレンジのコードの送信", () => {
  test("全角と空白を詰めたコードを送り、成功で戻り先を application に渡す", () => {
    story(
      update,
      given(entering("１２ ３４５６")),
      message(Message.SubmittedCode()),
      Command.expectExact(VerifyCode({ visit: VISIT, code: "123456", kind: "totp" })),
      Command.resolve(
        VerifyCode,
        Message.SucceededVerifyCode({ visit: VISIT, redirectUrl: "https://app.example.com/" }),
      ),
      model((next) => {
        expect(next.phase._tag).toBe("Leaving");
      }),
      expectOutMessage(OutMessage.PassedChallenge({ redirectUrl: "https://app.example.com/" })),
    );
  });

  test("空のコードは送らない", () => {
    story(update, given(entering("  ")), message(Message.SubmittedCode()), Command.expectNone());
  });

  test("送信中の二重の送信は、もう一度は送らない", () => {
    story(
      update,
      given({
        ...observing(),
        phase: {
          _tag: "Entering",
          kind: "totp",
          code: "123456",
          submission: { _tag: "Submitting" },
        },
      }),
      message(Message.SubmittedCode()),
      Command.expectNone(),
      message(Message.ClickedToggleCodeKind()),
      model((next) => {
        expect(next.phase).toMatchObject({ kind: "totp", code: "123456" });
      }),
    );
  });

  test("古い画面の送信の成功は、戻り先へ移さない", () => {
    story(
      update,
      given(entering("123456")),
      message(Message.SubmittedCode()),
      Command.resolve(
        VerifyCode,
        Message.SucceededVerifyCode({ visit: VISIT - 1, redirectUrl: "https://app.example.com/" }),
      ),
      expectNoOutMessage(),
      model((next) => {
        expect(next.phase).toMatchObject({ _tag: "Entering", submission: { _tag: "Submitting" } });
      }),
    );
  });

  test("期限切れの失敗では期限切れの案内になる", () => {
    story(
      update,
      given(entering("123456")),
      message(Message.SubmittedCode()),
      Command.resolve(
        VerifyCode,
        Message.FailedVerifyCode({ visit: VISIT, failure: "ChallengeExpired" }),
      ),
      model((next) => {
        expect(next.phase._tag).toBe("Expired");
      }),
    );
  });

  test.each([
    "InvalidCode",
    "Locked",
    "RateLimited",
  ] as const)("%s の失敗は表の文言を出し、入力を続けられる", (failure) => {
    story(
      update,
      given(entering("123456")),
      message(Message.SubmittedCode()),
      Command.resolve(VerifyCode, Message.FailedVerifyCode({ visit: VISIT, failure })),
      model((next) => {
        expect(next.phase).toMatchObject({
          _tag: "Entering",
          submission: { _tag: "Rejected", message: MFA_FAILURE_MESSAGES[failure] },
        });
      }),
    );
  });

  test("想定外の失敗は既定の文言を出す", () => {
    story(
      update,
      given(entering("123456")),
      message(Message.SubmittedCode()),
      Command.resolve(
        VerifyCode,
        Message.FailedVerifyCode({ visit: VISIT, failure: "Unexpected" }),
      ),
      model((next) => {
        expect(next.phase).toMatchObject({
          submission: {
            _tag: "Rejected",
            message: "処理に失敗しました。しばらく待ってからもう一度お試しください。",
          },
        });
      }),
    );
  });

  test("コードの種類を切り替えると、入力と失敗の文言を消す", () => {
    story(
      update,
      given({
        ...observing(),
        phase: {
          _tag: "Entering",
          kind: "totp",
          code: "999999",
          submission: { _tag: "Rejected", message: "誤り" },
        },
      }),
      message(Message.ClickedToggleCodeKind()),
      model((next) => {
        expect(next.phase).toEqual({
          _tag: "Entering",
          kind: "recovery_code",
          code: "",
          submission: { _tag: "Idle" },
        });
      }),
    );
  });
});
