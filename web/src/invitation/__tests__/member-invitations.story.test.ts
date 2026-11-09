import { describe, expect, test } from "bun:test";
import { Option } from "effect";
import { expectNoOutMessage, expectOutMessage, given, message, story } from "foldkit/story";

import {
  CreateInvitation,
  expiresAtTextOf,
  init,
  LoadInvitations,
  Message,
  type Model,
  OutMessage,
  RevokeInvitation,
  update,
} from "../member-invitations";

const VISIT = 2;
const PENDING = {
  id: "invitation-1",
  email: "invitee@example.com",
  role: "MEMBER",
  expiresAtText: "2026/11/10 9:00:00",
} as const;

const SENT_TEXTS = { doneText: "招待を送信しました。", actionText: "招待を送信しました" };
const REVOKED_TEXTS = { doneText: "招待を取り消しました。", actionText: "招待を取り消しました" };

const opened = (
  assignableRoles: ReadonlyArray<"MEMBER" | "ADMIN" | "OWNER"> = ["MEMBER", "ADMIN"],
) =>
  init({
    visit: VISIT,
    companyId: "company-a",
    assignableRoles,
    redirectSearch: { service_name: "taimei", redirect_url: "https://example.com/x" },
  });

const loaded = (): Model =>
  update(
    opened().model,
    Message.SucceededLoadInvitations({
      visit: VISIT,
      listNumber: 0,
      invitations: [PENDING],
      reload: { _tag: "Opened" },
    }),
  ).model;

const typed = (email: string): Model =>
  update(loaded(), Message.UpdatedEmail({ value: email })).model;

const sending = (): Model =>
  update(typed(" new@example.com "), Message.SubmittedInvitation()).model;

describe("招待中の一覧", () => {
  test("開くと招待中の一覧を読む", () => {
    expect(opened().commands).toMatchObject([
      { name: LoadInvitations.name, args: { companyId: "company-a", listNumber: 0 } },
    ]);
  });

  test("初回の取得の失敗は一覧を失敗にし、通知しない", () => {
    const failed = update(
      opened().model,
      Message.FailedLoadInvitations({
        visit: VISIT,
        listNumber: 0,
        failure: "Unexpected",
        reload: { _tag: "Opened" },
      }),
    );
    expect(failed.model.pending._tag).toBe("Failed");
    expect(failed.outMessage).toBeUndefined();
  });

  test("取得が Unauthorized を受けると、ログイン画面への移動を頼む", () => {
    story(
      update,
      given(opened().model),
      message(
        Message.FailedLoadInvitations({
          visit: VISIT,
          listNumber: 0,
          failure: "Unauthorized",
          reload: { _tag: "Opened" },
        }),
      ),
      expectOutMessage(OutMessage.RequiredSignIn()),
    );
  });
});

describe("招待の期限の表示", () => {
  test("期限が日時として読めない招待は、表示の文字列を作らない", () => {
    expect(expiresAtTextOf("not-a-date")).toEqual(Option.none());
    expect(Option.isSome(expiresAtTextOf("2026-11-10T00:00:00.000Z"))).toBe(true);
  });
});

describe("招待の送信", () => {
  test("送信は前後の空白を除いたメールと既定の役割と URL の search を送り、二重の submit では 1 回だけ送る", () => {
    const first = update(typed(" new@example.com "), Message.SubmittedInvitation());
    const second = update(first.model, Message.SubmittedInvitation());
    expect(first.commands).toMatchObject([
      {
        name: CreateInvitation.name,
        args: {
          email: "new@example.com",
          role: "MEMBER",
          redirectSearch: { service_name: "taimei", redirect_url: "https://example.com/x" },
        },
      },
    ]);
    expect(second.commands ?? []).toEqual([]);
  });

  test("メールが空白だけなら送らない", () => {
    expect(update(typed("   "), Message.SubmittedInvitation()).commands ?? []).toEqual([]);
  });

  test("割り当てられない役割は選べない", () => {
    expect(update(loaded(), Message.SelectedRole({ value: "OWNER" })).model.roleDraft).toBe(
      "MEMBER",
    );
    expect(update(loaded(), Message.SelectedRole({ value: "ADMIN" })).model.roleDraft).toBe(
      "ADMIN",
    );
  });

  test("送信の成功でメールを空にして一覧を取り直し、取り直しが終わるまで送信中のまま通知しない", () => {
    const succeeded = update(
      sending(),
      Message.SucceededCreateInvitation({ visit: VISIT, reused: false }),
    );
    expect(succeeded.model.emailDraft).toBe("");
    expect(succeeded.model.sending._tag).toBe("Submitting");
    expect(succeeded.outMessage).toBeUndefined();
    expect(succeeded.commands).toMatchObject([
      { name: LoadInvitations.name, args: { listNumber: 1, reload: { _tag: "Sent" } } },
    ]);
  });

  test("再利用された招待の後は、再送の文言を出す", () => {
    const succeeded = update(
      sending(),
      Message.SucceededCreateInvitation({ visit: VISIT, reused: true }),
    );
    const reloaded = update(
      succeeded.model,
      Message.SucceededLoadInvitations({
        visit: VISIT,
        listNumber: 1,
        invitations: [PENDING],
        reload: {
          _tag: "Sent",
          texts: { doneText: "既存の招待を再送しました。", actionText: "既存の招待を再送しました" },
        },
      }),
    );
    expect(reloaded.outMessage).toEqual(
      OutMessage.Notified({ tone: "Success", text: "既存の招待を再送しました。" }),
    );
    expect(reloaded.model.sending._tag).toBe("Idle");
  });

  test.each([
    ["RateLimited", "招待の送信回数が上限に達しました。時間をおいて再試行してください。"],
    ["Forbidden", "招待する権限がありません。"],
    ["Unexpected", "招待の送信に失敗しました。"],
  ] as const)("送信の %s の失敗はその失敗の文言を通知する", (failure, text) => {
    story(
      update,
      given(sending()),
      message(Message.FailedCreateInvitation({ visit: VISIT, failure })),
      expectOutMessage(OutMessage.Notified({ tone: "Error", text })),
    );
  });
});

describe("招待の取り消し", () => {
  test("取消の二重の click では、取り消しを 1 回だけ送る", () => {
    const first = update(loaded(), Message.ClickedRevoke({ invitationId: PENDING.id }));
    const second = update(first.model, Message.ClickedRevoke({ invitationId: PENDING.id }));
    expect(first.commands).toMatchObject([
      { name: RevokeInvitation.name, args: { invitationId: PENDING.id } },
    ]);
    expect(second.commands ?? []).toEqual([]);
  });

  test.each([
    ["Forbidden", "招待を取り消す権限がありません。"],
    ["NotFoundOrNotPending", "招待の取り消しに失敗しました。"],
    ["Unexpected", "招待の取り消しに失敗しました。"],
  ] as const)("取り消しの %s の失敗はその失敗の文言を通知する", (failure, text) => {
    story(
      update,
      given(update(loaded(), Message.ClickedRevoke({ invitationId: PENDING.id })).model),
      message(Message.FailedRevokeInvitation({ visit: VISIT, failure })),
      expectOutMessage(OutMessage.Notified({ tone: "Error", text })),
    );
  });

  test("取り直しの失敗では古い一覧を残し、表示の更新の失敗を通知する", () => {
    const revoked = update(
      update(loaded(), Message.ClickedRevoke({ invitationId: PENDING.id })).model,
      Message.SucceededRevokeInvitation({ visit: VISIT }),
    ).model;
    const failed = update(
      revoked,
      Message.FailedLoadInvitations({
        visit: VISIT,
        listNumber: 1,
        failure: "Unexpected",
        reload: { _tag: "Revoked", texts: REVOKED_TEXTS },
      }),
    );
    expect(failed.model.pending).toMatchObject({ _tag: "Loaded", invitations: [PENDING] });
    expect(failed.model.revoking._tag).toBe("Idle");
    expect(failed.outMessage).toEqual(
      OutMessage.Notified({
        tone: "Error",
        text: "招待を取り消しましたが、表示の更新に失敗しました。ページを再読み込みしてください。",
      }),
    );
  });
});

describe("送信と取り消しが重なる", () => {
  test("古い取り直しの結果は一覧を戻さないが、その操作の印を外して成功を通知する", () => {
    const afterSend = update(
      sending(),
      Message.SucceededCreateInvitation({ visit: VISIT, reused: false }),
    ).model;
    const revoking = update(afterSend, Message.ClickedRevoke({ invitationId: PENDING.id })).model;
    const afterRevoke = update(revoking, Message.SucceededRevokeInvitation({ visit: VISIT })).model;
    expect(afterRevoke.listNumber).toBe(2);
    const latest = update(
      afterRevoke,
      Message.SucceededLoadInvitations({
        visit: VISIT,
        listNumber: 2,
        invitations: [],
        reload: { _tag: "Revoked", texts: REVOKED_TEXTS },
      }),
    ).model;
    const stale = update(
      latest,
      Message.SucceededLoadInvitations({
        visit: VISIT,
        listNumber: 1,
        invitations: [PENDING],
        reload: { _tag: "Sent", texts: SENT_TEXTS },
      }),
    );
    expect(stale.model.pending).toMatchObject({ _tag: "Loaded", invitations: [] });
    expect(stale.model.sending._tag).toBe("Idle");
    expect(stale.outMessage).toEqual(
      OutMessage.Notified({ tone: "Success", text: "招待を送信しました。" }),
    );
  });

  test("古い訪問の送信の結果は今の画面を変えない", () => {
    story(
      update,
      given(sending()),
      message(Message.SucceededCreateInvitation({ visit: VISIT - 1, reused: false })),
      expectNoOutMessage(),
    );
  });
});
