import { describe, test } from "bun:test";
import { expect, given, role, scene, text } from "foldkit/scene";

import { init, type Model, update, view } from "../pages/Connections";

const withList = (list: Model["list"]): Model => ({ ...init(1).model, list });

describe("連携アカウントの画面", () => {
  test("better-auth が失敗を返すと失敗の文言を alert で出し、連携アカウントが無いとは出さない", () => {
    scene(
      { update, view },
      given(withList({ _tag: "Failed" })),
      expect(role("heading", { name: "連携アカウント" })).toExist(),
      expect(role("alert")).toHaveText("連携アカウントの取得に失敗しました"),
      expect(text("連携アカウントはありません。")).toBeAbsent(),
    );
  });

  test("空の一覧なら連携アカウントが無いと出す", () => {
    scene(
      { update, view },
      given(withList({ _tag: "Loaded", accounts: [] })),
      expect(text("連携アカウントはありません。")).toExist(),
    );
  });

  test("一覧の連携先と account id を出す", () => {
    scene(
      { update, view },
      given(
        withList({
          _tag: "Loaded",
          accounts: [{ id: "a1", providerId: "github", accountId: "12345" }],
        }),
      ),
      expect(text("GitHub")).toExist(),
      expect(text("12345")).toExist(),
    );
  });
});
