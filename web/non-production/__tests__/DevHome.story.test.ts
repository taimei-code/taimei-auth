import { describe, expect, test } from "bun:test";
import { Option } from "effect";
import { given, message, model, story } from "foldkit/story";

import { init, Message, update } from "../DevHome";

const opened = () =>
  init(
    Option.some({
      _tag: "DevHome",
      devAccounts: [],
      browserAccounts: [],
      viewer: { _tag: "SignedOut", notice: "None" },
      destination: { _tag: "AccountPage" },
      signInAction: "/dev-home/sign-in",
      signOutAction: "/dev-home/sign-out",
    }),
  );

describe("開発者ホームの絞り込み", () => {
  test("開いた直後は絞り込みの文字が空で、通信しない", () => {
    const opening = opened();
    expect(opening.model.query).toBe("");
    expect(opening.commands).toBeUndefined();
  });

  test("絞り込み欄に入れた文字を、最後の入力のとおりに持つ", () => {
    story(
      update,
      given(opened().model),
      message(Message.UpdatedQuery({ query: "dev" })),
      message(Message.UpdatedQuery({ query: "dev-owner" })),
      model((next) => {
        expect(next.query).toBe("dev-owner");
      }),
    );
  });
});
