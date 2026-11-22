import { describe, expect, test } from "bun:test";
import { DateTime, Effect, Option } from "effect";

import { RateLimited } from "@core/failures";
import type { PasskeyListResponse } from "@core/passkey/passkey-contract";
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

const listedBy = (list: Effect.Effect<PasskeyListResponse, RateLimited>) =>
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
        passkeys: [
          {
            id: "p1",
            created_at: DateTime.makeUnsafe("2026-01-02T03:04:05.000Z"),
            last_used_at: null,
            provider_name: null,
          },
        ],
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
  createdAt: DateTime.makeUnsafe("2026-03-04T03:00:00.000Z"),
  maybeLastUsedAt: Option.none(),
  providerName: "パスキー",
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

const enteringTotp = (): Model => update(init(VISIT), Message.ClickedRegisterWithTotp()).model;

const submittedTotp = (raw: string) =>
  update(
    send(enteringTotp(), Message.UpdatedTotpCode({ value: raw })),
    Message.SubmittedTotpCode(),
  );

const registeringWithTotp = (): Model => submittedTotp("123456").model;

const maybeTotpRejection = (model: Model) =>
  Option.flatMap(model.maybeDialogSubject, (subject) =>
    subject._tag === "TotpEntry" ? subject.maybeRejection : Option.none(),
  );

describe("MFA が有効な user がパスキーを登録する", () => {
  test("押すと確認コードの入力の dialog を開き、コードを送るまで登録を始めない", () => {
    const opened = update(init(VISIT), Message.ClickedRegisterWithTotp());
    expect(opened.model.dialog.isOpen).toBe(true);
    expect(opened.commands ?? []).not.toContainEqual(
      expect.objectContaining({ name: RegisterPasskey.name }),
    );
  });

  test("空のまま送ると登録を始めず、確認コードの入力を求める", () => {
    const submitted = submittedTotp("  ");
    expect(submitted.commands).not.toContainEqual(
      expect.objectContaining({ name: RegisterPasskey.name }),
    );
    expect(maybeTotpRejection(submitted.model)).toEqual(
      Option.some("確認コードを入力してください。"),
    );
  });

  test("送ると、全角や空白を整えたコードを載せて登録を 1 回だけ始め、待つ間の送信と閉じる要求は無視する", () => {
    const first = submittedTotp("１２３ ４５６");
    expect(first.commands).toMatchObject([
      { name: RegisterPasskey.name, args: { maybeTotpCode: Option.some("123456") } },
    ]);
    expect(update(first.model, Message.SubmittedTotpCode()).commands ?? []).toEqual([]);
    expect(
      update(first.model, Message.GotDialogMessage({ message: { _tag: "RequestedClose" } })).model
        .dialog.isOpen,
    ).toBe(true);
  });

  test("コードが誤っていると dialog に残って誤りを示し、入力欄へ focus を戻す", () => {
    const failed = update(
      registeringWithTotp(),
      Message.FailedRegisterPasskey({ ...CURRENT, failure: "InvalidCode" }),
    );
    expect(failed.model.dialog.isOpen).toBe(true);
    expect(failed.model.busy._tag).toBe("Idle");
    expect(failed.outMessage).toBeUndefined();
    expect(maybeTotpRejection(failed.model)).toEqual(
      Option.some("入力されたコードが正しくありません。"),
    );
    expect(failed.commands).toMatchObject([{ name: "FocusTotpCode" }]);
  });

  test("コードを使った後に時間切れで拒まれると、dialog が閉じ切ってからやり直しを促す文言を error で知らせる", () => {
    const closing = update(
      registeringWithTotp(),
      Message.FailedRegisterPasskey({ ...CURRENT, failure: "PasskeyRejected" }),
    );
    expect(closing.model.dialog.isOpen).toBe(false);
    expect(closing.outMessage).toBeUndefined();
    expect(afterDialogClosed(closing.model).outMessage).toMatchObject({
      _tag: "Notified",
      tone: "Error",
      text: expect.stringContaining("もう一度登録してください"),
    });
  });

  test("browser の作成を取り消すと dialog を閉じ、閉じ切っても何も知らせない", () => {
    const closing = update(registeringWithTotp(), Message.CancelledRegisterPasskey(CURRENT));
    expect(closing.model.dialog.isOpen).toBe(false);
    expect(closing.model.busy._tag).toBe("Idle");
    expect(afterDialogClosed(closing.model).outMessage).toBeUndefined();
  });

  test("登録できると、dialog が閉じ切ってから親に読み直しを頼む", () => {
    const closing = update(registeringWithTotp(), Message.SucceededRegisterPasskey(CURRENT));
    expect(closing.outMessage).toBeUndefined();
    expect(afterDialogClosed(closing.model).outMessage).toEqual(OutMessage.Registered());
  });

  test("確認コードの誤りは打ち直せるので、ロックされた時も dialog に残って理由を示す", () => {
    const failed = update(
      registeringWithTotp(),
      Message.FailedRegisterPasskey({ ...CURRENT, failure: "Locked" }),
    );
    expect(failed.model.dialog.isOpen).toBe(true);
    expect(failed.outMessage).toBeUndefined();
    expect(maybeTotpRejection(failed.model)).toEqual(
      Option.some(
        "試行回数が上限に達したか、確認を一時的に受け付けられません。15 分ほど経ってからやり直してください。",
      ),
    );
  });

  test("確認コードの入力の途中で session が切れると、dialog が閉じ切ってからログインし直しを頼む", () => {
    const closing = update(
      registeringWithTotp(),
      Message.FailedRegisterPasskey({ ...CURRENT, failure: "Unauthorized" }),
    );
    expect(closing.model.dialog.isOpen).toBe(false);
    expect(afterDialogClosed(closing.model).outMessage).toEqual(OutMessage.RequiredSignIn());
  });

  test("閉じ切った後は、入力した確認コードと誤りを持たない", () => {
    const failed = update(
      registeringWithTotp(),
      Message.FailedRegisterPasskey({ ...CURRENT, failure: "InvalidCode" }),
    ).model;
    const closed = afterDialogClosed(update(failed, Message.ClickedCancelTotpEntry()).model);
    expect(closed.model.maybeDialogSubject).toEqual(Option.none());
  });

  test("閉じる途中で開き直しても、確認コードの入力の dialog が空の入力欄で開く", () => {
    const closing = update(
      registeringWithTotp(),
      Message.FailedRegisterPasskey({ ...CURRENT, failure: "PasskeyRejected" }),
    ).model;
    const reopened = update(closing, Message.ClickedRegisterWithTotp()).model;
    expect(reopened.dialog.isOpen).toBe(true);
    expect(reopened.maybeDialogSubject).toMatchObject(
      Option.some({ _tag: "TotpEntry", code: "", maybeRejection: Option.none() }),
    );
  });

  test("確認コードの入力の dialog が閉じる途中で「削除」を押すと、押した項目の確認の dialog が開く", () => {
    const closing = update(enteringTotp(), Message.ClickedCancelTotpEntry()).model;
    const deleting = update(closing, Message.ClickedDelete({ passkey: PASSKEY })).model;
    expect(deleting.dialog.isOpen).toBe(true);
    expect(deleting.maybeDialogSubject).toMatchObject(
      Option.some({ _tag: "Deletion", passkey: PASSKEY }),
    );
  });

  test("キャンセルすると登録を始めずに dialog を閉じる", () => {
    const cancelled = update(enteringTotp(), Message.ClickedCancelTotpEntry());
    expect(cancelled.model.dialog.isOpen).toBe(false);
    expect(cancelled.commands ?? []).not.toContainEqual(
      expect.objectContaining({ name: RegisterPasskey.name }),
    );
  });
});
