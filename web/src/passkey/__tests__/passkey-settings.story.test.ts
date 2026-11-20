import { describe, expect, test } from "bun:test";
import { Effect } from "effect";

import { RateLimited } from "@core/failures";
import {
  init,
  loadPasskeyList,
  Message,
  type Model,
  OutMessage,
  RegisterPasskey,
  update,
} from "../passkey-settings";

const VISIT = 3;

const clicked = () => update(init(VISIT), Message.ClickedRegister());

const registering = (): Model => clicked().model;

const CURRENT = { visit: VISIT, requestNumber: 1 };

type ListResponse = {
  passkeys: ReadonlyArray<{ id: string; created_at: string; last_used_at: string | null }>;
  can_register: boolean;
};

const listedBy = (list: Effect.Effect<ListResponse, RateLimited>) =>
  Effect.runPromise(loadPasskeyList({ list: () => list } as never));

describe("一覧を読む", () => {
  test("0 本で登録できない時は、行を出さない状態になる", async () => {
    expect((await listedBy(Effect.succeed({ passkeys: [], can_register: false })))._tag).toBe(
      "Hidden",
    );
  });

  test("1 本以上なら、登録できなくても一覧を出す状態になる", async () => {
    const list = await listedBy(
      Effect.succeed({
        passkeys: [{ id: "p1", created_at: "2026-01-02T03:04:05.000Z", last_used_at: null }],
        can_register: false,
      }),
    );
    expect(list).toMatchObject({ _tag: "Shown", registrable: false });
  });

  test("WebAuthn の無い browser では、server が登録できると言っても登録の操作を出さない状態になる", async () => {
    Reflect.deleteProperty(globalThis, "PublicKeyCredential");
    expect(await listedBy(Effect.succeed({ passkeys: [], can_register: true }))).toMatchObject({
      _tag: "Shown",
      registrable: false,
    });
  });

  test("試行枠を超えて読めない時は、取得できなかった状態になり、画面全体を失敗にしない", async () => {
    expect((await listedBy(Effect.fail(new RateLimited())))._tag).toBe("Failed");
  });
});

describe("パスキーを登録する", () => {
  test("押すと登録を 1 回だけ始め、終わるまでの 2 回目の click は無視する", () => {
    const first = clicked();
    expect(first.commands).toMatchObject([{ name: RegisterPasskey.name }]);
    expect(first.model.registration._tag).toBe("Submitting");
    expect(update(first.model, Message.ClickedRegister()).commands ?? []).toEqual([]);
  });

  test("登録できると、親に読み直しを頼む", () => {
    const done = update(registering(), Message.SucceededRegisterPasskey(CURRENT));
    expect(done.outMessage).toEqual(OutMessage.Registered());
    expect(done.model.registration._tag).toBe("Idle");
  });

  test("取り消すと、何も知らせずに押せる状態へ戻る", () => {
    const cancelled = update(registering(), Message.CancelledRegisterPasskey(CURRENT));
    expect(cancelled.outMessage).toBeUndefined();
    expect(cancelled.model.registration._tag).toBe("Idle");
  });

  test("時間切れで拒まれると、やり直しを促す文言を error で知らせる", () => {
    const failed = update(
      registering(),
      Message.FailedRegisterPasskey({ ...CURRENT, failure: "PasskeyRejected" }),
    );
    expect(failed.outMessage).toMatchObject({
      _tag: "Notified",
      tone: "Error",
      text: expect.stringContaining("もう一度登録してください"),
    });
  });

  test("session が切れていると、ログインし直しを頼む", () => {
    const failed = update(
      registering(),
      Message.FailedRegisterPasskey({ ...CURRENT, failure: "Unauthorized" }),
    );
    expect(failed.outMessage).toEqual(OutMessage.RequiredSignIn());
  });

  test("前の画面の登録の応答は、今の登録を終わらせない", () => {
    const stale = update(
      registering(),
      Message.SucceededRegisterPasskey({ visit: VISIT - 1, requestNumber: 1 }),
    );
    expect(stale.outMessage).toBeUndefined();
    expect(stale.model.registration._tag).toBe("Submitting");
  });
});
