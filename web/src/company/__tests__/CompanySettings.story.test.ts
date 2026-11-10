import { describe, expect, test } from "bun:test";
import { Option } from "effect";
import {
  Command,
  expectNoOutMessage,
  expectOutMessage,
  given,
  message,
  model,
  story,
} from "foldkit/story";

import {
  DIALOG_RESOURCES_RELEASED,
  FIRST_DIALOG_CLOSING,
  FIRST_DIALOG_OPENING,
} from "../../shared/__tests__/dialog-resolvers";

import * as CompanyDeletion from "../company-deletion";
import {
  init,
  Message,
  type Model,
  OutMessage,
  update,
  UpdateCompany,
} from "../pages/CompanySettings";

const VISIT = 4;

const OWNER = {
  companyId: "company-a",
  companyName: "事業所A",
  orgCode: "CORPORATE",
  role: "OWNER",
} as const;

const editing = (): Model => init(VISIT, Option.some(OWNER));

const saving = (): Model => update(editing(), Message.SubmittedCompanyForm()).model;

const deletionMessage = (message: CompanyDeletion.Message) =>
  Message.GotCompanyDeletionMessage({ message });

describe("事業所の設定を開く", () => {
  test("現在の事業所の OWNER でなければ編集できない", () => {
    expect(init(VISIT, Option.some({ ...OWNER, role: "ADMIN" })).settings._tag).toBe("NotOwner");
    expect(init(VISIT, Option.none()).settings._tag).toBe("NotOwner");
  });
});

describe("事業所の名前と事業形態の保存", () => {
  test("保存の二重の submit は更新を 1 回だけ送り、名前の前後の空白を除く", () => {
    const named = update(editing(), Message.UpdatedName({ value: "  事業所A2 " })).model;
    const first = update(named, Message.SubmittedCompanyForm());
    const second = update(first.model, Message.SubmittedCompanyForm());
    expect(first.commands).toMatchObject([
      { name: UpdateCompany.name, args: { companyId: OWNER.companyId, name: "事業所A2" } },
    ]);
    expect(second.commands ?? []).toEqual([]);
  });

  test("空白だけの名前は送らない", () => {
    const blank = update(editing(), Message.UpdatedName({ value: "   " })).model;
    expect(update(blank, Message.SubmittedCompanyForm()).commands ?? []).toEqual([]);
  });

  test("保存の成功で事業所の状態の読み直しを頼む", () => {
    story(
      update,
      given(saving()),
      message(Message.SucceededUpdateCompany({ visit: VISIT })),
      expectOutMessage(
        OutMessage.UpdatedCompanyState({
          texts: {
            maybeDoneText: Option.some("事業所情報を更新しました。"),
            actionText: "事業所情報を更新しました",
          },
        }),
      ),
    );
  });

  test("権限が無いと拒まれたら、その文言を通知する", () => {
    story(
      update,
      given(saving()),
      message(Message.FailedUpdateCompany({ visit: VISIT, failure: "Forbidden" })),
      expectOutMessage(OutMessage.Notified({ tone: "Error", text: "編集する権限がありません。" })),
    );
  });

  test("古い画面の保存の結果は通知しない", () => {
    story(
      update,
      given(saving()),
      message(Message.SucceededUpdateCompany({ visit: VISIT - 1 })),
      expectNoOutMessage(),
    );
  });
});

describe("事業所の削除", () => {
  test("削除の二重の確定は削除を 1 回だけ送り、成功で削除した事業所の名前を知らせる", () => {
    const opened = update(
      editing(),
      deletionMessage(CompanyDeletion.Message.ClickedDeleteCompany()),
    ).model;
    const confirm = deletionMessage(
      CompanyDeletion.Message.ClickedConfirmDeletion({ companyName: OWNER.companyName }),
    );
    const first = update(opened, confirm);
    const second = update(first.model, confirm);
    expect(first.commands).toMatchObject([{ name: CompanyDeletion.DeleteCompany.name }]);
    expect(second.commands ?? []).toEqual([]);
    story(
      update,
      given(first.model),
      message(
        deletionMessage(
          CompanyDeletion.Message.SucceededDeleteCompany({
            visit: VISIT,
            companyName: OWNER.companyName,
          }),
        ),
      ),
      expectNoOutMessage(),
      ...FIRST_DIALOG_CLOSING,
      expectOutMessage(OutMessage.DeletedCompany({ companyName: OWNER.companyName })),
      DIALOG_RESOURCES_RELEASED,
    );
  });

  test("削除が拒まれたら、権限の文言を通知する", () => {
    const deleting = update(
      update(editing(), deletionMessage(CompanyDeletion.Message.ClickedDeleteCompany())).model,
      deletionMessage(
        CompanyDeletion.Message.ClickedConfirmDeletion({ companyName: OWNER.companyName }),
      ),
    ).model;
    story(
      update,
      given(deleting),
      message(
        deletionMessage(
          CompanyDeletion.Message.FailedDeleteCompany({ visit: VISIT, failure: "Forbidden" }),
        ),
      ),
      ...FIRST_DIALOG_CLOSING,
      expectOutMessage(
        OutMessage.Notified({
          tone: "Error",
          text: "この事業所を削除する権限がないか、既に削除されています。",
        }),
      ),
      DIALOG_RESOURCES_RELEASED,
    );
  });
});

describe("session の切れた操作", () => {
  test("保存と削除が Unauthorized を受けると、ログインを求める", () => {
    expect(
      update(saving(), Message.FailedUpdateCompany({ visit: VISIT, failure: "Unauthorized" }))
        .outMessage,
    ).toEqual(OutMessage.RequiredSignIn());
    const deleting = update(
      update(editing(), deletionMessage(CompanyDeletion.Message.ClickedDeleteCompany())).model,
      deletionMessage(
        CompanyDeletion.Message.ClickedConfirmDeletion({ companyName: OWNER.companyName }),
      ),
    ).model;
    expect(
      update(
        deleting,
        deletionMessage(
          CompanyDeletion.Message.FailedDeleteCompany({ visit: VISIT, failure: "Unauthorized" }),
        ),
      ).outMessage,
    ).toEqual(OutMessage.RequiredSignIn());
  });
});

describe("保存と削除の想定外の失敗", () => {
  test.each([
    ["NotFound"],
    ["Unexpected"],
  ] as const)("保存が %s で失敗すると、更新に失敗した旨を通知する", (failure) => {
    story(
      update,
      given(saving()),
      message(Message.FailedUpdateCompany({ visit: VISIT, failure })),
      expectOutMessage(OutMessage.Notified({ tone: "Error", text: "更新に失敗しました。" })),
    );
  });

  test.each([
    ["LastOwner"],
    ["Unexpected"],
  ] as const)("削除が %s で失敗すると、dialog を閉じて削除に失敗した旨を通知する", (failure) => {
    story(
      update,
      given(editing()),
      message(deletionMessage(CompanyDeletion.Message.ClickedDeleteCompany())),
      ...FIRST_DIALOG_OPENING,
      message(
        deletionMessage(
          CompanyDeletion.Message.ClickedConfirmDeletion({ companyName: OWNER.companyName }),
        ),
      ),
      Command.resolve(
        CompanyDeletion.DeleteCompany,
        CompanyDeletion.Message.FailedDeleteCompany({ visit: VISIT, failure }),
      ),
      ...FIRST_DIALOG_CLOSING,
      expectOutMessage(
        OutMessage.Notified({ tone: "Error", text: "事業所の削除に失敗しました。" }),
      ),
      DIALOG_RESOURCES_RELEASED,
    );
  });

  test("最後の事業所を削除した後は、削除の途中のまま画面を変えない", () => {
    const deleting = update(
      update(editing(), deletionMessage(CompanyDeletion.Message.ClickedDeleteCompany())).model,
      deletionMessage(
        CompanyDeletion.Message.ClickedConfirmDeletion({ companyName: OWNER.companyName }),
      ),
    ).model;
    story(
      update,
      given(deleting),
      message(deletionMessage(CompanyDeletion.Message.SucceededDeleteLastCompany())),
      model((next) => {
        expect(next.settings._tag === "Editing" && next.settings.deletion.deletion._tag).toBe(
          "Submitting",
        );
      }),
      expectNoOutMessage(),
    );
  });
});
