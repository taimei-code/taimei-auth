import { describe, expect, test } from "bun:test";
import { given, message, model, story } from "foldkit/story";

import { init, LoadSessions, Message, type Model, update } from "../pages/Sessions";

const VISIT = 4;

const SESSION = {
  id: "s1",
  userAgent: "Firefox on Linux",
  ipAddress: "127.0.0.1",
  expiresAtLabel: "2026/11/09 9:00",
};

const listTagOf = (current: Model) => current.list._tag;

describe("セッションの一覧を読む", () => {
  test("開くと better-auth の一覧を読みに行く", () => {
    expect(init(VISIT).commands).toMatchObject([
      { name: LoadSessions.name, args: { visit: VISIT } },
    ]);
  });

  test("読めたら一覧を出し、失敗したら失敗にする", () => {
    story(
      update,
      given(init(VISIT).model),
      message(Message.SucceededLoadSessions({ visit: VISIT, sessions: [SESSION] })),
      model((next) => {
        expect(next.list).toEqual({ _tag: "Loaded", sessions: [SESSION] });
      }),
    );
    story(
      update,
      given(init(VISIT).model),
      message(Message.FailedLoadSessions({ visit: VISIT })),
      model((next) => {
        expect(listTagOf(next)).toBe("Failed");
      }),
    );
  });

  test("結果が二重に届いても、最初の結果を保つ", () => {
    story(
      update,
      given(init(VISIT).model),
      message(Message.SucceededLoadSessions({ visit: VISIT, sessions: [SESSION] })),
      message(Message.FailedLoadSessions({ visit: VISIT })),
      model((next) => {
        expect(listTagOf(next)).toBe("Loaded");
      }),
    );
  });

  test("古い画面の結果は、今の画面を変えない", () => {
    story(
      update,
      given(init(VISIT).model),
      message(Message.FailedLoadSessions({ visit: VISIT - 1 })),
      model((next) => {
        expect(listTagOf(next)).toBe("Loading");
      }),
    );
  });
});
