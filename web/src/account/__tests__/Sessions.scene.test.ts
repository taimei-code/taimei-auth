import { describe, test } from "bun:test";
import { expect, given, role, scene, text } from "foldkit/scene";

import { init, type Model, update, view } from "../pages/Sessions";

const withList = (list: Model["list"]): Model => ({ ...init(1).model, list });

describe("セッションの画面", () => {
  test("読み込み中は status を出す", () => {
    scene(
      { update, view },
      given(init(1).model),
      expect(role("heading", { name: "セッション" })).toExist(),
      expect(role("status")).toExist(),
    );
  });

  test("better-auth が失敗を返すと失敗の文言を alert で出し、セッションが無いとは出さない", () => {
    scene(
      { update, view },
      given(withList({ _tag: "Failed" })),
      expect(role("alert")).toHaveText("セッションの取得に失敗しました"),
      expect(text("アクティブなセッションはありません。")).toBeAbsent(),
    );
  });

  test("空の一覧ならセッションが無いと出す", () => {
    scene(
      { update, view },
      given(withList({ _tag: "Loaded", sessions: [] })),
      expect(text("アクティブなセッションはありません。")).toExist(),
    );
  });

  test("一覧の session の user agent を出す", () => {
    scene(
      { update, view },
      given(
        withList({
          _tag: "Loaded",
          sessions: [
            {
              id: "s1",
              userAgent: "Firefox on Linux",
              ipAddress: "127.0.0.1",
              expiresAtLabel: "2026/11/09 9:00",
            },
          ],
        }),
      ),
      expect(text("Firefox on Linux")).toExist(),
    );
  });
});
