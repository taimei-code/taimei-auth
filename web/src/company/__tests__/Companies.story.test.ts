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

import * as OwnershipTransfer from "../../membership/ownership-transfer";
import {
  FIRST_DIALOG_CLOSING_MESSAGES,
  FIRST_DIALOG_OPENING,
} from "../../shared/__tests__/dialog-resolvers";
import * as AddCompany from "../add-company";
import {
  init,
  LeaveCompany,
  Message,
  type Model,
  OutMessage,
  ReadSignedInUserId,
  update,
} from "../pages/Companies";

const VISIT = 2;
const SELF = "user-self";

const COMPANY = {
  companyId: "company-a",
  companyName: "事業所A",
  orgCode: "CORPORATE",
  role: "OWNER",
} as const;

const opened = () => init(VISIT);

const signedIn = (): Model =>
  update(
    opened().model,
    Message.CompletedReadSignedInUserId({ visit: VISIT, maybeUserId: Option.some(SELF) }),
  ).model;

const leaving = (): Model =>
  update(signedIn(), Message.ClickedLeaveCompany({ membership: COMPANY })).model;

const [DIALOG_PAINTED_CLOSING, DIALOG_ENDED_CLOSING] = FIRST_DIALOG_CLOSING_MESSAGES;

const afterDialogClosed = (
  closing: Model,
  toMessage: (dialogMessage: typeof DIALOG_ENDED_CLOSING) => Message,
) =>
  update(update(closing, toMessage(DIALOG_PAINTED_CLOSING)).model, toMessage(DIALOG_ENDED_CLOSING));

describe("事業所の一覧を開く", () => {
  test("開くとログイン中の利用者の id を読む", () => {
    expect(opened().commands).toMatchObject([{ name: ReadSignedInUserId.name }]);
  });

  test("利用者の id が分かるまでは抜けられない", () => {
    expect(
      update(opened().model, Message.ClickedLeaveCompany({ membership: COMPANY })).commands ?? [],
    ).toEqual([]);
  });
});

describe("事業所から抜ける", () => {
  test("抜けるの二重の click では離脱を 1 回だけ送る", () => {
    const first = update(signedIn(), Message.ClickedLeaveCompany({ membership: COMPANY }));
    const second = update(first.model, Message.ClickedLeaveCompany({ membership: COMPANY }));
    expect(first.commands).toMatchObject([{ name: LeaveCompany.name, args: { selfUserId: SELF } }]);
    expect(second.commands ?? []).toEqual([]);
  });

  test("離脱の成功で事業所の状態の読み直しを頼み、抜けた事業所の名前で知らせる", () => {
    story(
      update,
      given(signedIn()),
      message(Message.ClickedLeaveCompany({ membership: COMPANY })),
      Command.resolve(
        LeaveCompany,
        Message.SucceededLeaveCompany({ visit: VISIT, companyName: COMPANY.companyName }),
      ),
      expectOutMessage(
        OutMessage.UpdatedCompanyState({
          texts: {
            maybeDoneText: Option.some("「事業所A」から抜けました。"),
            actionText: "事業所から抜けました",
          },
        }),
      ),
    );
  });

  test("唯一の OWNER の離脱が拒まれると、委譲を促す印を付け、通知は出さない", () => {
    story(
      update,
      given(leaving()),
      message(
        Message.FailedLeaveCompany({
          visit: VISIT,
          companyId: COMPANY.companyId,
          failure: "LastOwner",
        }),
      ),
      expectNoOutMessage(),
    );
    expect(
      update(
        leaving(),
        Message.FailedLeaveCompany({
          visit: VISIT,
          companyId: COMPANY.companyId,
          failure: "LastOwner",
        }),
      ).model.maybeSoleOwnerCompanyId,
    ).toEqual(Option.some(COMPANY.companyId));
  });

  test("離脱の想定外の失敗は、抜けられなかった旨を通知する", () => {
    story(
      update,
      given(leaving()),
      message(
        Message.FailedLeaveCompany({
          visit: VISIT,
          companyId: COMPANY.companyId,
          failure: "Unexpected",
        }),
      ),
      expectOutMessage(
        OutMessage.Notified({ tone: "Error", text: "事業所から抜けられませんでした。" }),
      ),
    );
  });

  test("古い画面の離脱の結果は今の画面を変えない", () => {
    story(
      update,
      given(leaving()),
      message(
        Message.SucceededLeaveCompany({ visit: VISIT - 1, companyName: COMPANY.companyName }),
      ),
      expectNoOutMessage(),
    );
  });

  test("離脱の間は一覧の切替を頼まない", () => {
    story(
      update,
      given(leaving()),
      message(Message.ClickedSwitchCompany({ companyId: "company-b" })),
      expectNoOutMessage(),
    );
  });
});

describe("事業所の追加とオーナーの委譲", () => {
  test("追加の二重の submit は作成を 1 回だけ送り、成功で作った事業所の名前で知らせる", () => {
    const named = update(
      update(
        signedIn(),
        Message.GotAddCompanyMessage({ message: AddCompany.Message.ClickedAddCompany() }),
      ).model,
      Message.GotAddCompanyMessage({
        message: AddCompany.Message.UpdatedName({ value: " 新事業所 " }),
      }),
    ).model;
    const submit = Message.GotAddCompanyMessage({
      message: AddCompany.Message.SubmittedAddCompanyForm(),
    });
    const first = update(named, submit);
    const second = update(first.model, submit);
    expect(first.commands).toMatchObject([
      { name: AddCompany.AddCompany.name, args: { name: "新事業所", orgCode: "CORPORATE" } },
    ]);
    expect(second.commands ?? []).toEqual([]);
    const closing = update(
      first.model,
      Message.GotAddCompanyMessage({
        message: AddCompany.Message.SucceededAddCompany({
          requestNumber: 1,
          companyName: "新事業所",
        }),
      }),
    );
    expect(closing.outMessage).toBeUndefined();
    expect(
      afterDialogClosed(closing.model, (message) =>
        Message.GotAddCompanyMessage({ message: AddCompany.Message.GotDialogMessage({ message }) }),
      ).outMessage,
    ).toEqual(
      OutMessage.UpdatedCompanyState({
        texts: {
          maybeDoneText: Option.some("「新事業所」を作成し、現在の事業所に切り替えました。"),
          actionText: "事業所を作成しました",
        },
      }),
    );
  });

  test("委譲の dialog を開き直した後に届いた古い一覧は描かない", () => {
    const openedTwice = update(
      update(signedIn(), Message.ClickedTransferOwnership({ membership: COMPANY })).model,
      Message.ClickedTransferOwnership({ membership: COMPANY }),
    ).model;
    const stale = update(
      openedTwice,
      Message.GotOwnershipTransferMessage({
        message: OwnershipTransfer.Message.SucceededLoadCandidates({
          requestNumber: 1,
          candidates: [{ userId: "user-old", label: "古い候補" }],
        }),
      }),
    ).model;
    expect(stale.ownershipTransfer.candidates._tag).toBe("Loading");
  });

  test("委譲の成功で離脱を止めた印を消し、委譲した相手の名前で知らせる", () => {
    const soleOwner = update(
      leaving(),
      Message.FailedLeaveCompany({
        visit: VISIT,
        companyId: COMPANY.companyId,
        failure: "LastOwner",
      }),
    ).model;
    const transferring = update(
      update(soleOwner, Message.ClickedTransferOwnership({ membership: COMPANY })).model,
      Message.GotOwnershipTransferMessage({
        message: OwnershipTransfer.Message.ClickedTransfer({
          candidate: { userId: "user-mate", label: "メイト" },
        }),
      }),
    ).model;
    const closing = update(
      transferring,
      Message.GotOwnershipTransferMessage({
        message: OwnershipTransfer.Message.SucceededTransferOwnership({
          requestNumber: transferring.ownershipTransfer.requestNumber,
          memberLabel: "メイト",
        }),
      }),
    );
    expect(closing.outMessage).toBeUndefined();
    expect(
      update(closing.model, Message.ClickedTransferOwnership({ membership: COMPANY })).outMessage,
    ).toEqual(
      OutMessage.UpdatedCompanyState({
        texts: {
          maybeDoneText: Option.some("メイト にオーナーを委譲しました。"),
          actionText: "オーナーを委譲しました",
        },
      }),
    );
    const transferred = afterDialogClosed(closing.model, (message) =>
      Message.GotOwnershipTransferMessage({
        message: OwnershipTransfer.Message.GotDialogMessage({ message }),
      }),
    );
    expect(transferred.model.maybeSoleOwnerCompanyId).toEqual(Option.none());
    expect(transferred.outMessage).toEqual(
      OutMessage.UpdatedCompanyState({
        texts: {
          maybeDoneText: Option.some("メイト にオーナーを委譲しました。"),
          actionText: "オーナーを委譲しました",
        },
      }),
    );
  });
});

describe("session の切れた操作", () => {
  test("離脱・追加・委譲の一覧が Unauthorized を受けると、ログインを求める", () => {
    expect(
      update(
        leaving(),
        Message.FailedLeaveCompany({
          visit: VISIT,
          companyId: COMPANY.companyId,
          failure: "Unauthorized",
        }),
      ).outMessage,
    ).toEqual(OutMessage.RequiredSignIn());
    const adding = update(
      update(
        update(
          signedIn(),
          Message.GotAddCompanyMessage({ message: AddCompany.Message.ClickedAddCompany() }),
        ).model,
        Message.GotAddCompanyMessage({ message: AddCompany.Message.UpdatedName({ value: "X" }) }),
      ).model,
      Message.GotAddCompanyMessage({ message: AddCompany.Message.SubmittedAddCompanyForm() }),
    ).model;
    expect(
      update(
        adding,
        Message.GotAddCompanyMessage({
          message: AddCompany.Message.FailedAddCompany({
            requestNumber: 1,
            failure: "Unauthorized",
          }),
        }),
      ).outMessage,
    ).toEqual(OutMessage.RequiredSignIn());
    const transferOpened = update(
      signedIn(),
      Message.ClickedTransferOwnership({ membership: COMPANY }),
    ).model;
    expect(
      update(
        transferOpened,
        Message.GotOwnershipTransferMessage({
          message: OwnershipTransfer.Message.FailedLoadCandidates({
            requestNumber: 1,
            failure: "Unauthorized",
          }),
        }),
      ).outMessage,
    ).toEqual(OutMessage.RequiredSignIn());
  });
});

describe("処理中の dialog", () => {
  test("追加の送信中は dialog を閉じる要求を捨て、送信の前なら閉じる", () => {
    const opened = update(
      signedIn(),
      Message.GotAddCompanyMessage({ message: AddCompany.Message.ClickedAddCompany() }),
    ).model;
    const close = Message.GotAddCompanyMessage({
      message: AddCompany.Message.GotDialogMessage({ message: { _tag: "RequestedClose" } }),
    });
    const submitting = update(
      update(
        opened,
        Message.GotAddCompanyMessage({ message: AddCompany.Message.UpdatedName({ value: "X" }) }),
      ).model,
      Message.GotAddCompanyMessage({ message: AddCompany.Message.SubmittedAddCompanyForm() }),
    ).model;
    expect(update(submitting, close).model.addCompany.dialog).toEqual(submitting.addCompany.dialog);
    expect(update(opened, close).model.addCompany.dialog).not.toEqual(opened.addCompany.dialog);
  });
});

const addCompanyMessage = (message: AddCompany.Message) =>
  Message.GotAddCompanyMessage({ message });

const transferMessage = (message: OwnershipTransfer.Message) =>
  Message.GotOwnershipTransferMessage({ message });

const soleOwner = (): Model =>
  update(
    leaving(),
    Message.FailedLeaveCompany({
      visit: VISIT,
      companyId: COMPANY.companyId,
      failure: "LastOwner",
    }),
  ).model;

describe("追加と委譲の失敗", () => {
  test("事業所の作成が想定外の失敗をすると、dialog の中に作成の失敗の文言を出す", () => {
    story(
      update,
      given(signedIn()),
      message(addCompanyMessage(AddCompany.Message.ClickedAddCompany())),
      ...FIRST_DIALOG_OPENING,
      message(addCompanyMessage(AddCompany.Message.UpdatedName({ value: "新事業所" }))),
      message(addCompanyMessage(AddCompany.Message.SubmittedAddCompanyForm())),
      Command.resolve(
        AddCompany.AddCompany,
        AddCompany.Message.FailedAddCompany({ requestNumber: 1, failure: "Unexpected" }),
      ),
      model((next) => {
        expect(next.addCompany.submission).toEqual({
          _tag: "Rejected",
          message: "事業所の作成に失敗しました。",
        });
      }),
      expectNoOutMessage(),
    );
  });

  test("委譲の候補を読み、委譲が失敗すると dialog の中に委譲の失敗の文言を出す", () => {
    story(
      update,
      given(soleOwner()),
      message(Message.ClickedTransferOwnership({ membership: COMPANY })),
      ...FIRST_DIALOG_OPENING,
      Command.resolve(
        OwnershipTransfer.LoadCandidates,
        OwnershipTransfer.Message.SucceededLoadCandidates({
          requestNumber: 1,
          candidates: [{ userId: "user-mate", label: "メイト" }],
        }),
      ),
      model((next) => {
        expect(next.ownershipTransfer.candidates._tag).toBe("Loaded");
      }),
      message(
        transferMessage(
          OwnershipTransfer.Message.ClickedTransfer({
            candidate: { userId: "user-mate", label: "メイト" },
          }),
        ),
      ),
      Command.resolve(
        OwnershipTransfer.TransferOwnership,
        OwnershipTransfer.Message.FailedTransferOwnership({
          requestNumber: 2,
          failure: "Unexpected",
        }),
      ),
      model((next) => {
        expect(next.ownershipTransfer.transferring._tag).toBe("Failed");
        expect(next.maybeSoleOwnerCompanyId).toEqual(Option.some(COMPANY.companyId));
      }),
      expectNoOutMessage(),
    );
  });

  test("委譲の候補の取得が想定外の失敗をすると、取得の失敗の状態にする", () => {
    story(
      update,
      given(soleOwner()),
      message(Message.ClickedTransferOwnership({ membership: COMPANY })),
      ...FIRST_DIALOG_OPENING,
      Command.resolve(
        OwnershipTransfer.LoadCandidates,
        OwnershipTransfer.Message.FailedLoadCandidates({ requestNumber: 1, failure: "Unexpected" }),
      ),
      model((next) => {
        expect(next.ownershipTransfer.candidates._tag).toBe("Failed");
      }),
    );
  });

  test("最後の所属から抜けた後は、離脱の途中のまま画面を変えない", () => {
    story(
      update,
      given(leaving()),
      message(Message.SucceededLeaveLastCompany()),
      model((next) => {
        expect(next.leaving._tag).toBe("Submitting");
      }),
      expectNoOutMessage(),
    );
  });
});
