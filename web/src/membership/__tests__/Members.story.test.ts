import { describe, expect, test } from "bun:test";
import { Animation } from "@foldkit/ui";
import { Option } from "effect";
import {
  Command,
  expectNoOutMessage,
  expectOutMessage,
  given,
  message,
  story,
} from "foldkit/story";

import * as MemberInvitations from "../../invitation/member-invitations";
import { FIRST_DIALOG_CLOSING_MESSAGES } from "../../shared/__tests__/dialog-resolvers";
import {
  ChangeRole,
  init,
  LoadMembers,
  Message,
  type Model,
  OutMessage,
  ReadSelfUserId,
  RemoveMember,
  update,
} from "../pages/Members";

const VISIT = 3;
const SELF = "user-self";
const NO_REDIRECT = {};

const membershipOf = (role: "OWNER" | "ADMIN" | "MEMBER") => ({
  companyId: "company-a",
  companyName: "事業所A",
  orgCode: "CORPORATE" as const,
  role,
});

const ME = { userId: SELF, label: "自分", email: "self@example.com", role: "OWNER" } as const;
const MATE = {
  userId: "user-mate",
  label: "仲間",
  email: "mate@example.com",
  role: "MEMBER",
} as const;

const CHANGED_ROLE_TEXTS = {
  doneText: "仲間 の役割を管理者に変更しました。",
  actionText: "役割を変更しました",
};

const opened = (role: "OWNER" | "ADMIN" | "MEMBER" = "OWNER") =>
  init(VISIT, Option.some(membershipOf(role)), NO_REDIRECT);

const listed = (role: "OWNER" | "ADMIN" | "MEMBER" = "OWNER"): Model => {
  const signedIn = update(
    opened(role).model,
    Message.CompletedReadSelfUserId({ visit: VISIT, maybeUserId: Option.some(SELF) }),
  ).model;
  return update(
    signedIn,
    Message.SucceededLoadMembers({
      visit: VISIT,
      members: [ME, MATE],
      reload: { _tag: "Opened" },
    }),
  ).model;
};

const listing = (model: Model) => {
  if (model.page._tag !== "Listing") {
    throw new Error("一覧の画面でない");
  }
  return model.page;
};

const [DIALOG_PAINTED_CLOSING, DIALOG_ENDED_CLOSING] = FIRST_DIALOG_CLOSING_MESSAGES;

const afterDialogClosed = (closing: Model) =>
  update(
    update(closing, Message.GotDialogMessage({ message: DIALOG_PAINTED_CLOSING })).model,
    Message.GotDialogMessage({ message: DIALOG_ENDED_CLOSING }),
  );

const removing = (): Model => {
  const asked = update(listed(), Message.ClickedRemove({ member: MATE })).model;
  return update(asked, Message.ClickedConfirmRemoval()).model;
};

describe("メンバーの画面を開く", () => {
  test("OWNER で開くと、利用者の id と一覧と招待中の一覧を読む", () => {
    expect(opened().commands).toMatchObject([
      { name: ReadSelfUserId.name },
      { name: LoadMembers.name, args: { companyId: "company-a" } },
      { name: MemberInvitations.LoadInvitations.name },
    ]);
  });

  test("MEMBER で開くと、招待中の一覧を読まない", () => {
    expect(opened("MEMBER").commands).toMatchObject([
      { name: ReadSelfUserId.name },
      { name: LoadMembers.name },
    ]);
    expect(listing(opened("MEMBER").model).maybeInvitations).toEqual(Option.none());
  });

  test("現在の事業所が無いと、何も読まない", () => {
    const noCompany = init(VISIT, Option.none(), NO_REDIRECT);
    expect(noCompany.model.page._tag).toBe("NoCompany");
    expect(noCompany.commands ?? []).toEqual([]);
  });

  test("初回の取得が失敗すると一覧を失敗にし、通知は出さない", () => {
    story(
      update,
      given(opened().model),
      message(
        Message.FailedLoadMembers({
          visit: VISIT,
          failure: "Unexpected",
          reload: { _tag: "Opened" },
        }),
      ),
      expectNoOutMessage(),
    );
    expect(
      listing(
        update(
          opened().model,
          Message.FailedLoadMembers({
            visit: VISIT,
            failure: "Unexpected",
            reload: { _tag: "Opened" },
          }),
        ).model,
      ).members._tag,
    ).toBe("Failed");
  });

  test("一覧の取得が Unauthorized を受けると、ログイン画面への移動を頼む", () => {
    story(
      update,
      given(opened().model),
      message(
        Message.FailedLoadMembers({
          visit: VISIT,
          failure: "Unauthorized",
          reload: { _tag: "Opened" },
        }),
      ),
      expectOutMessage(OutMessage.RequiredSignIn()),
    );
  });

  test("前の訪問の古い一覧の結果は、今の画面を変えない", () => {
    const stale = update(
      opened().model,
      Message.SucceededLoadMembers({
        visit: VISIT - 1,
        members: [MATE],
        reload: { _tag: "Opened" },
      }),
    ).model;
    expect(listing(stale).members._tag).toBe("Loading");
  });
});

describe("役割の変更", () => {
  test("役割の select の二重の変更では、変更を 1 回だけ送る", () => {
    const first = update(listed(), Message.SelectedRole({ member: MATE, value: "ADMIN" }));
    const second = update(first.model, Message.SelectedRole({ member: MATE, value: "OWNER" }));
    expect(first.commands).toMatchObject([
      { name: ChangeRole.name, args: { role: "ADMIN", member: { userId: MATE.userId } } },
    ]);
    expect(second.commands ?? []).toEqual([]);
  });

  test("割り当てられない役割は送らない", () => {
    expect(
      update(listed("ADMIN"), Message.SelectedRole({ member: MATE, value: "OWNER" })).commands ??
        [],
    ).toEqual([]);
  });

  test("変更の成功の後は一覧を取り直し、取り直しが終わるまで通知せず処理中のまま", () => {
    const changing = update(listed(), Message.SelectedRole({ member: MATE, value: "ADMIN" })).model;
    const succeeded = update(
      changing,
      Message.SucceededChangeRole({ visit: VISIT, texts: CHANGED_ROLE_TEXTS }),
    );
    expect(succeeded.commands).toMatchObject([{ name: LoadMembers.name }]);
    expect(succeeded.outMessage).toBeUndefined();
    expect(listing(succeeded.model).busy._tag).toBe("ChangingRole");
  });

  test("取り直しが終わると、新しい行と成功の文言を出す", () => {
    story(
      update,
      given(listed()),
      message(Message.SelectedRole({ member: MATE, value: "ADMIN" })),
      Command.resolve(
        ChangeRole,
        Message.SucceededChangeRole({ visit: VISIT, texts: CHANGED_ROLE_TEXTS }),
      ),
      Command.resolve(
        LoadMembers,
        Message.SucceededLoadMembers({
          visit: VISIT,
          members: [ME, { ...MATE, role: "ADMIN" }],
          reload: { _tag: "ChangedRole", texts: CHANGED_ROLE_TEXTS },
        }),
      ),
      expectOutMessage(
        OutMessage.Notified({ tone: "Success", text: "仲間 の役割を管理者に変更しました。" }),
      ),
    );
  });

  test("取り直しが失敗すると、古い行を残し、表示の更新の失敗を通知する", () => {
    const changing = update(listed(), Message.SelectedRole({ member: MATE, value: "ADMIN" })).model;
    const failed = update(
      changing,
      Message.FailedLoadMembers({
        visit: VISIT,
        failure: "Unexpected",
        reload: { _tag: "ChangedRole", texts: CHANGED_ROLE_TEXTS },
      }),
    );
    expect(listing(failed.model).members).toMatchObject({ _tag: "Loaded", members: [ME, MATE] });
    expect(listing(failed.model).busy._tag).toBe("Idle");
    expect(failed.outMessage).toEqual(
      OutMessage.Notified({
        tone: "Error",
        text: "役割を変更しましたが、表示の更新に失敗しました。ページを再読み込みしてください。",
      }),
    );
  });

  test.each([
    ["LastOwner", "最後のオーナーを降格することはできません。"],
    ["Forbidden", "この役割変更を行う権限がありません。"],
    ["NotFound", "役割の変更に失敗しました。"],
    ["Unexpected", "役割の変更に失敗しました。"],
  ] as const)("変更の %s の失敗はその失敗の文言を通知する", (failure, text) => {
    const changing = update(listed(), Message.SelectedRole({ member: MATE, value: "ADMIN" })).model;
    const failed = update(changing, Message.FailedChangeRole({ visit: VISIT, failure }));
    expect(failed.outMessage).toEqual(OutMessage.Notified({ tone: "Error", text }));
    expect(listing(failed.model).busy._tag).toBe("Idle");
  });

  test("変更が Unauthorized を受けると、文言を出さずログイン画面への移動を頼む", () => {
    const changing = update(listed(), Message.SelectedRole({ member: MATE, value: "ADMIN" })).model;
    expect(
      update(changing, Message.FailedChangeRole({ visit: VISIT, failure: "Unauthorized" }))
        .outMessage,
    ).toEqual(OutMessage.RequiredSignIn());
  });
});

describe("メンバーの削除", () => {
  test("削除の確定の二重の click では、削除を 1 回だけ送る", () => {
    const asked = update(listed(), Message.ClickedRemove({ member: MATE })).model;
    const first = update(asked, Message.ClickedConfirmRemoval());
    const second = update(first.model, Message.ClickedConfirmRemoval());
    expect(first.commands).toMatchObject([
      { name: RemoveMember.name, args: { member: { userId: MATE.userId } } },
    ]);
    expect(second.commands ?? []).toEqual([]);
  });

  test("削除の処理中は、dialog を閉じる操作を受けない", () => {
    const blocked = update(removing(), Message.ClickedCancelRemoval()).model;
    expect(listing(blocked).dialog).toEqual(listing(removing()).dialog);
    const requestedClose = update(
      removing(),
      Message.GotDialogMessage({ message: { _tag: "RequestedClose" } }),
    ).model;
    expect(listing(requestedClose).dialog).toEqual(listing(removing()).dialog);
  });

  test("削除の成功の後は取り直し、取り直しが終わると dialog を閉じて成功の文言を出す", () => {
    const texts = textsOf(false);
    const succeeded = update(removing(), Message.SucceededRemoveMember({ visit: VISIT, texts }));
    expect(succeeded.commands).toMatchObject([{ name: LoadMembers.name }]);
    expect(succeeded.outMessage).toBeUndefined();
    const reloaded = update(
      succeeded.model,
      Message.SucceededLoadMembers({
        visit: VISIT,
        members: [ME],
        reload: { _tag: "Removed", texts },
      }),
    );
    expect(reloaded.outMessage).toBeUndefined();
    expect(reloaded.commands).toMatchObject([{ name: Animation.WaitForPaint.name }]);
    expect(listing(reloaded.model).dialog.isOpen).toBe(false);
    expect(update(reloaded.model, Message.ClickedConfirmRemoval()).commands ?? []).toEqual([]);
    const closed = afterDialogClosed(reloaded.model);
    expect(closed.outMessage).toEqual(
      OutMessage.Notified({ tone: "Success", text: "メンバーを削除しました。" }),
    );
    expect(listing(closed.model).busy._tag).toBe("Idle");
  });

  test("削除の成功の後の取り直しが失敗しても、dialog を閉じて表示の更新の失敗を通知する", () => {
    const texts = textsOf(true);
    const reloaded = update(
      update(removing(), Message.SucceededRemoveMember({ visit: VISIT, texts })).model,
      Message.FailedLoadMembers({
        visit: VISIT,
        failure: "Unexpected",
        reload: { _tag: "Removed", texts },
      }),
    );
    expect(afterDialogClosed(reloaded.model).outMessage).toEqual(
      OutMessage.Notified({
        tone: "Error",
        text: "メンバーとアカウントを削除しましたが、表示の更新に失敗しました。ページを再読み込みしてください。",
      }),
    );
    expect(reloaded.commands).toMatchObject([{ name: Animation.WaitForPaint.name }]);
    expect(listing(reloaded.model).dialog.isOpen).toBe(false);
    expect(listing(reloaded.model).members).toMatchObject({ _tag: "Loaded", members: [ME, MATE] });
  });

  test.each([
    ["LastOwner", "最後のオーナーは削除できません。"],
    ["Forbidden", "メンバーの削除に失敗しました。"],
    ["NotFound", "メンバーの削除に失敗しました。"],
    ["Unexpected", "メンバーの削除に失敗しました。"],
  ] as const)("削除の %s の失敗は dialog を閉じてその失敗の文言を通知する", (failure, text) => {
    const failed = update(removing(), Message.FailedRemoveMember({ visit: VISIT, failure }));
    expect(failed.outMessage).toBeUndefined();
    expect(failed.commands).toMatchObject([{ name: Animation.WaitForPaint.name }]);
    expect(listing(failed.model).dialog.isOpen).toBe(false);
    const closed = afterDialogClosed(failed.model);
    expect(closed.outMessage).toEqual(OutMessage.Notified({ tone: "Error", text }));
    expect(listing(closed.model).busy._tag).toBe("Idle");
  });

  test("古い訪問の削除の結果は、今の画面を変えない", () => {
    const stale = update(
      removing(),
      Message.SucceededRemoveMember({ visit: VISIT - 1, texts: textsOf(false) }),
    );
    expect(stale.commands ?? []).toEqual([]);
    expect(listing(stale.model).busy._tag).toBe("Removing");
  });

  test("役割の変更の処理中は、削除の dialog を開かない", () => {
    const changing = update(listed(), Message.SelectedRole({ member: MATE, value: "ADMIN" })).model;
    expect(update(changing, Message.ClickedRemove({ member: MATE })).commands ?? []).toEqual([]);
  });
});

function textsOf(accountDeleted: boolean) {
  return accountDeleted
    ? {
        doneText: "メンバーを削除しました。他に所属が無いためアカウントも削除されました。",
        actionText: "メンバーとアカウントを削除しました",
      }
    : { doneText: "メンバーを削除しました。", actionText: "メンバーを削除しました" };
}
