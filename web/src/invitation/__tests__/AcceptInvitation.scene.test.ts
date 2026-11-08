import { describe, test } from "bun:test";
import { expect, given, role, scene, text } from "foldkit/scene";

import { init, type Model, update, view } from "../pages/AcceptInvitation";

const failedWith = (message: string): Model => ({
  ...init({ visit: 1, redirectUrl: "/account", invitationToken: "token" }).model,
  phase: { _tag: "Failed", message },
});

describe("招待の受諾の画面", () => {
  test("確かめと受諾の間は status だけを出す", () => {
    scene(
      { update, view },
      given(init({ visit: 1, redirectUrl: "/account", invitationToken: "token" }).model),
      expect(role("status")).toExist(),
      expect(text("招待を受諾できませんでした")).toBeAbsent(),
    );
  });

  test("受諾できなかった時は、文言と /account へ戻る link を出す", () => {
    scene(
      { update, view },
      given(failedWith("この招待は期限切れか、既に使用されています。")),
      expect(text("招待を受諾できませんでした")).toExist(),
      expect(text("この招待は期限切れか、既に使用されています。")).toExist(),
      expect(role("link", { name: "アカウントに戻る" })).toHaveAttr("href", "/account"),
      expect(role("status")).toBeAbsent(),
    );
  });
});
