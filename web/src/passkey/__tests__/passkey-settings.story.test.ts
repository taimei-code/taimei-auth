import { describe, expect, test } from "bun:test";
import { Effect, Option } from "effect";

import { RateLimited } from "@core/failures";
import { FIRST_DIALOG_CLOSING_MESSAGES } from "../../shared/__tests__/dialog-resolvers";
import {
  DeletePasskey,
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
    expect(first.model.busy._tag).toBe("Registering");
    expect(update(first.model, Message.ClickedRegister()).commands ?? []).toEqual([]);
  });

  test("登録できると、親に読み直しを頼む", () => {
    const done = update(registering(), Message.SucceededRegisterPasskey(CURRENT));
    expect(done.outMessage).toEqual(OutMessage.Registered());
    expect(done.model.busy._tag).toBe("Idle");
  });

  test("取り消すと、何も知らせずに押せる状態へ戻る", () => {
    const cancelled = update(registering(), Message.CancelledRegisterPasskey(CURRENT));
    expect(cancelled.outMessage).toBeUndefined();
    expect(cancelled.model.busy._tag).toBe("Idle");
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

  test("古い一覧から押して上限で拒まれると、再読み込みと削除を促す文言を error で知らせ、押せる状態へ戻る", () => {
    const failed = update(
      registering(),
      Message.FailedRegisterPasskey({ ...CURRENT, failure: "PasskeyLimitReached" }),
    );
    expect(failed.outMessage).toMatchObject({
      _tag: "Notified",
      tone: "Error",
      text: expect.stringMatching(/上限.*再読み込み.*削除/),
    });
    expect(failed.model.busy._tag).toBe("Idle");
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
    expect(stale.model.busy._tag).toBe("Registering");
  });
});

const PASSKEY = {
  id: "passkey-1",
  createdAt: "2026-03-04T03:00:00.000Z",
  maybeLastUsedAt: Option.none(),
};

const send = (current: Model, ...messages: ReadonlyArray<Message>): Model =>
  messages.reduce((next, each) => update(next, each).model, current);

const confirming = (): Model =>
  update(init(VISIT), Message.ClickedDelete({ passkey: PASSKEY })).model;

const confirmed = () => update(confirming(), Message.ClickedConfirmDeletion());

const deleting = (): Model => confirmed().model;

const [DIALOG_PAINTED_CLOSING, DIALOG_ENDED_CLOSING] = FIRST_DIALOG_CLOSING_MESSAGES;

const afterDialogClosed = (closing: Model) =>
  update(
    send(closing, Message.GotDialogMessage({ message: DIALOG_PAINTED_CLOSING })),
    Message.GotDialogMessage({ message: DIALOG_ENDED_CLOSING }),
  );

const requestsDeletion = (commands: ReadonlyArray<{ name: string }> | undefined): boolean =>
  (commands ?? []).some((command) => command.name === DeletePasskey.name);

describe("パスキーを削除する", () => {
  test("「削除」を押すと確認の dialog を開き、確定するまで削除を送らない", () => {
    const opened = update(init(VISIT), Message.ClickedDelete({ passkey: PASSKEY }));
    expect(opened.model.dialog.isOpen).toBe(true);
    expect(requestsDeletion(opened.commands)).toBe(false);
  });

  test("キャンセルすると削除を送らずに dialog を閉じ、閉じた後の確定も削除を送らない", () => {
    const cancelled = update(confirming(), Message.ClickedCancelDeletion());
    expect(cancelled.model.dialog.isOpen).toBe(false);
    expect(requestsDeletion(cancelled.commands)).toBe(false);
    expect(
      requestsDeletion(update(cancelled.model, Message.ClickedConfirmDeletion()).commands),
    ).toBe(false);
  });

  test("確定すると押した項目の削除を 1 回だけ送り、待つ間の 2 回目の確定とキャンセルと閉じる要求は無視する", () => {
    const first = confirmed();
    expect(first.commands).toMatchObject([
      { name: DeletePasskey.name, args: { passkeyId: PASSKEY.id } },
    ]);
    expect(update(first.model, Message.ClickedConfirmDeletion()).commands ?? []).toEqual([]);
    expect(update(first.model, Message.ClickedCancelDeletion()).model.dialog.isOpen).toBe(true);
    expect(
      update(first.model, Message.GotDialogMessage({ message: { _tag: "RequestedClose" } })).model
        .dialog.isOpen,
    ).toBe(true);
  });

  test("削除できると、dialog が閉じ切ってから親に読み直しを頼む", () => {
    const closing = update(deleting(), Message.SucceededDeletePasskey(CURRENT));
    expect(closing.outMessage).toBeUndefined();
    const closed = afterDialogClosed(closing.model);
    expect(closed.outMessage).toEqual(OutMessage.Deleted());
    expect(closed.model.busy._tag).toBe("Idle");
  });

  test("見つからずに失敗すると、dialog が閉じ切ってから再読み込みを促す文言を error で知らせる", () => {
    const closing = update(
      deleting(),
      Message.FailedDeletePasskey({ ...CURRENT, failure: "NotFound" }),
    );
    expect(closing.outMessage).toBeUndefined();
    expect(afterDialogClosed(closing.model).outMessage).toMatchObject({
      _tag: "Notified",
      tone: "Error",
      text: expect.stringContaining("ページを再読み込みしてください"),
    });
  });

  test("削除の途中で session が切れると、dialog が閉じ切ってからログインし直しを頼む", () => {
    const closing = update(
      deleting(),
      Message.FailedDeletePasskey({ ...CURRENT, failure: "Unauthorized" }),
    );
    expect(afterDialogClosed(closing.model).outMessage).toEqual(OutMessage.RequiredSignIn());
  });

  test("確認の dialog をキャンセルで閉じ切っても、その間に始まった登録の待ちは解けない", () => {
    const cancelled = update(confirming(), Message.ClickedCancelDeletion()).model;
    const registeringWhileClosing: Model = { ...cancelled, busy: { _tag: "Registering" } };
    expect(afterDialogClosed(registeringWhileClosing).model.busy._tag).toBe("Registering");
  });

  test("前の画面の削除の応答は、今の削除を終わらせない", () => {
    const stale = update(
      deleting(),
      Message.SucceededDeletePasskey({ visit: VISIT - 1, requestNumber: 1 }),
    );
    expect(stale.model.busy._tag).toBe("Deleting");
    expect(stale.model.dialog.isOpen).toBe(true);
    expect(afterDialogClosed(stale.model).outMessage).toBeUndefined();
  });

  test("登録の応答を待つ間は「削除」を押しても dialog を開かず、削除の応答を待つ間は「登録する」を押しても登録を送らない", () => {
    expect(
      update(registering(), Message.ClickedDelete({ passkey: PASSKEY })).model.dialog.isOpen,
    ).toBe(false);
    expect(update(deleting(), Message.ClickedRegister()).commands ?? []).toEqual([]);
  });
});
