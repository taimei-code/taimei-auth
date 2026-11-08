import { describe, expect, test } from "bun:test";
import { expectNoOutMessage, expectOutMessage, given, message, model, story } from "foldkit/story";

import {
  AcceptInvitation,
  init,
  Message,
  type Model,
  OutMessage,
  update,
} from "../pages/AcceptInvitation";

const VISIT = 2;
const REDIRECT_URL = "https://app.taimei-code.com/members";
const TOKEN = "invitation-token";

const openedWith = (invitationToken: string | undefined) =>
  init({ visit: VISIT, redirectUrl: REDIRECT_URL, invitationToken });

const accepting = (): Model => openedWith(TOKEN).model;

const failedMessageOf = (current: Model) =>
  current.phase._tag === "Failed" ? current.phase.message : undefined;

describe("招待の受諾を開く", () => {
  test("招待のトークンがあれば、開いた時に受諾を 1 回送る", () => {
    expect(openedWith(TOKEN).commands).toMatchObject([
      { name: AcceptInvitation.name, args: { visit: VISIT, invitationToken: TOKEN } },
    ]);
  });

  test.each([
    undefined,
    "",
  ])("招待のトークンが %p なら、通信せずにトークンが見つからない文言を出す", (token) => {
    const opening = openedWith(token);
    expect(opening.commands).toBeUndefined();
    expect(failedMessageOf(opening.model)).toBe("招待トークンが見つかりません。");
  });
});

describe("受諾の結果", () => {
  test("受諾が成功したら、戻り先へ移る", () => {
    story(
      update,
      given(accepting()),
      message(Message.SucceededAcceptInvitation({ visit: VISIT })),
      expectOutMessage(OutMessage.AcceptedInvitation({ redirectUrl: REDIRECT_URL })),
    );
  });

  test.each([
    [
      "EmailMismatch",
      "この招待は別のメールアドレス宛です。招待されたアドレスでログインし直してください。",
    ],
    ["ExpiredOrUsed", "この招待は期限切れか、既に使用されています。"],
    ["NotFound", "招待が見つかりません。"],
    ["Unexpected", "招待の受諾に失敗しました。"],
  ] as const)("受諾が %s で失敗したら、その文言を出す", (failure, text) => {
    story(
      update,
      given(accepting()),
      message(Message.FailedAcceptInvitation({ visit: VISIT, failure })),
      model((next) => {
        expect(failedMessageOf(next)).toBe(text);
      }),
      expectNoOutMessage(),
    );
  });

  test("session が無いか受諾が Unauthorized なら、失敗の文言を出さずにログインを求める", () => {
    story(
      update,
      given(accepting()),
      message(Message.FailedAcceptInvitation({ visit: VISIT, failure: "Unauthorized" })),
      model((next) => {
        expect(failedMessageOf(next)).toBeUndefined();
      }),
      expectOutMessage(OutMessage.RequiredSignIn()),
    );
  });
});

describe("二重の結果と古い応答", () => {
  test("受諾の成功が二重に届いても、戻り先へ移るのは 1 回だけ", () => {
    const first = update(accepting(), Message.SucceededAcceptInvitation({ visit: VISIT }));
    const second = update(first.model, Message.SucceededAcceptInvitation({ visit: VISIT }));
    expect(first.outMessage).toEqual(OutMessage.AcceptedInvitation({ redirectUrl: REDIRECT_URL }));
    expect(second.outMessage).toBeUndefined();
  });

  test("古い画面の結果は、今の画面を変えない", () => {
    story(
      update,
      given(accepting()),
      message(Message.FailedAcceptInvitation({ visit: VISIT - 1, failure: "NotFound" })),
      message(Message.SucceededAcceptInvitation({ visit: VISIT - 1 })),
      model((next) => {
        expect(next.phase._tag).toBe("Accepting");
      }),
      expectNoOutMessage(),
    );
  });
});
