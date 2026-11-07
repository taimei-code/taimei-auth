import { describe, expect, test } from "bun:test";
import { Effect, Schema } from "effect";
import { Command } from "foldkit";
import { defineMessageUnion } from "foldkit/message";

import { authClient } from "../../auth/auth-client";
import { readAuthClient } from "../account-atom";

const Message = defineMessageUnion({
  SucceededLoadSessions: { count: Schema.Finite },
  FailedLoadSessions: { status: Schema.Finite },
});

type AuthClientResponse = {
  readonly data: readonly unknown[] | null;
  readonly error: { readonly status: number } | null;
};

const loadSessions = (read: () => Promise<AuthClientResponse>) =>
  readAuthClient(read).pipe(
    Effect.map((sessions) => Message.SucceededLoadSessions({ count: sessions.length })),
    Effect.catchTag("AuthClientReadFailed", ({ status }) =>
      Effect.succeed(Message.FailedLoadSessions({ status })),
    ),
  );

const LoadSessions = Command.define("LoadSessions", {
  messages: [Message.SucceededLoadSessions, Message.FailedLoadSessions],
  execute: loadSessions(() => authClient.listSessions()),
});

describe("better-auth の client の一覧の読み出しを Foldkit の Command で包む", () => {
  test("client が error を返すと、失敗の Message になる", async () => {
    const result = await Effect.runPromise(
      loadSessions(() => Promise.resolve({ data: null, error: { status: 401 } })),
    );
    expect(result).toEqual(Message.FailedLoadSessions({ status: 401 }));
  });

  test("client が data を返すと、成功の Message になる", async () => {
    const result = await Effect.runPromise(
      loadSessions(() => Promise.resolve({ data: [{}, {}], error: null })),
    );
    expect(result).toEqual(Message.SucceededLoadSessions({ count: 2 }));
  });

  test("Command として定義でき、update が出す値として名前を持つ", () => {
    expect(LoadSessions().name).toBe("LoadSessions");
  });
});
