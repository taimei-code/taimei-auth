import { describe, expect, test } from "bun:test";
import { given, message, model, story } from "foldkit/story";

import { init, LoadLinkedAccounts, Message, type Model, update } from "../pages/Connections";

const VISIT = 2;

const ACCOUNT = { id: "a1", providerId: "github", accountId: "12345" };

const listTagOf = (current: Model) => current.list._tag;

describe("連携アカウントの一覧を読む", () => {
  test("開くと better-auth の一覧を読み、読めたら一覧を出す", () => {
    expect(init(VISIT).commands).toMatchObject([{ name: LoadLinkedAccounts.name }]);
    story(
      update,
      given(init(VISIT).model),
      message(Message.SucceededLoadLinkedAccounts({ visit: VISIT, accounts: [ACCOUNT] })),
      model((next) => {
        expect(next.list).toEqual({ _tag: "Loaded", accounts: [ACCOUNT] });
      }),
    );
  });

  test("結果が二重に届いても、最初の結果を保つ", () => {
    story(
      update,
      given(init(VISIT).model),
      message(Message.FailedLoadLinkedAccounts({ visit: VISIT })),
      message(Message.SucceededLoadLinkedAccounts({ visit: VISIT, accounts: [ACCOUNT] })),
      model((next) => {
        expect(listTagOf(next)).toBe("Failed");
      }),
    );
  });

  test("古い画面の結果は、今の画面を変えない", () => {
    story(
      update,
      given(init(VISIT).model),
      message(Message.SucceededLoadLinkedAccounts({ visit: VISIT - 1, accounts: [ACCOUNT] })),
      model((next) => {
        expect(listTagOf(next)).toBe("Loading");
      }),
    );
  });
});
