import { describe, expect, test } from "bun:test";
import {
  Command,
  expectNoOutMessage,
  expectOutMessage,
  given,
  message,
  model,
  story,
} from "foldkit/story";

import { SIGN_OUT_FAILED } from "../../auth/sign-out";
import { Submission } from "../../shared/submission";
import {
  CheckSession,
  CreateCompany,
  init,
  LoadMemberships,
  Message,
  type Model,
  OutMessage,
  SignOut,
  update,
} from "../pages/SignUpCompany";

const VISIT = 3;
const REDIRECT_URL = "https://app.taimei-code.com/dashboard";

const checking = (): Model => init({ visit: VISIT, redirectUrl: REDIRECT_URL }).model;

type EditingFields = Readonly<{
  name?: string;
  creation?: Submission;
  signOut?: Submission;
}>;

const editingWith = ({
  name = "",
  creation = Submission.Idle(),
  signOut = Submission.Idle(),
}: EditingFields): Model => ({
  ...checking(),
  phase: { _tag: "Editing", name, orgCode: "PERSONAL", creation, signOut },
});

const editing = (name = ""): Model => editingWith({ name });

const creating = (name: string): Model => editingWith({ name, creation: Submission.Submitting() });

const signingOut = (): Model => editingWith({ signOut: Submission.Submitting() });

const phaseTagOf = (current: Model) => current.phase._tag;

describe("事業所の登録を開く前の確認", () => {
  test("開くと session を確かめに行く", () => {
    expect(init({ visit: VISIT, redirectUrl: REDIRECT_URL }).commands).toMatchObject([
      { name: CheckSession.name, args: { visit: VISIT } },
    ]);
  });

  test("session が無ければ、事業状態を読まずにログインを求める", () => {
    story(
      update,
      given(checking()),
      message(Message.SucceededCheckSession({ visit: VISIT, isSignedIn: false })),
      Command.expectNone(),
      expectOutMessage(OutMessage.RequiredSignIn()),
    );
  });

  test("session の確認に失敗したら、form を出す", () => {
    story(
      update,
      given(checking()),
      message(Message.FailedCheckSession({ visit: VISIT })),
      model((next) => {
        expect(phaseTagOf(next)).toBe("Editing");
      }),
      expectNoOutMessage(),
    );
  });

  test("session があり所属が 1 件以上なら、戻り先へ移る", () => {
    story(
      update,
      given(checking()),
      message(Message.SucceededCheckSession({ visit: VISIT, isSignedIn: true })),
      Command.resolve(
        LoadMemberships,
        Message.SucceededLoadMemberships({ visit: VISIT, isCompanyMember: true }),
      ),
      expectOutMessage(OutMessage.ConfirmedCompanyMembership({ redirectUrl: REDIRECT_URL })),
    );
  });

  test("所属が 0 件なら form を出す", () => {
    story(
      update,
      given(checking()),
      message(Message.SucceededCheckSession({ visit: VISIT, isSignedIn: true })),
      Command.resolve(
        LoadMemberships,
        Message.SucceededLoadMemberships({ visit: VISIT, isCompanyMember: false }),
      ),
      model((next) => {
        expect(phaseTagOf(next)).toBe("Editing");
      }),
      expectNoOutMessage(),
    );
  });

  test("事業状態の取得が Unauthorized ならログインを求め、通信の失敗なら form を出す", () => {
    story(
      update,
      given(checking()),
      message(Message.FailedLoadMemberships({ visit: VISIT, failure: "Unauthorized" })),
      expectOutMessage(OutMessage.RequiredSignIn()),
    );
    story(
      update,
      given(checking()),
      message(Message.FailedLoadMemberships({ visit: VISIT, failure: "Unexpected" })),
      model((next) => {
        expect(phaseTagOf(next)).toBe("Editing");
      }),
    );
  });

  test("古い画面の確認の結果は、今の画面を変えない", () => {
    story(
      update,
      given(checking()),
      message(Message.SucceededCheckSession({ visit: VISIT - 1, isSignedIn: false })),
      message(Message.SucceededLoadMemberships({ visit: VISIT - 1, isCompanyMember: true })),
      model((next) => {
        expect(phaseTagOf(next)).toBe("Checking");
      }),
      expectNoOutMessage(),
    );
  });

  test("form を出した後に届いた確認の結果は捨てる", () => {
    story(
      update,
      given(editing()),
      message(Message.SucceededCheckSession({ visit: VISIT, isSignedIn: false })),
      model((next) => {
        expect(phaseTagOf(next)).toBe("Editing");
      }),
      expectNoOutMessage(),
    );
  });
});

describe("事業所の作成", () => {
  test("事業所名の前後の空白を除いて作成し、成功で戻り先へ移る", () => {
    story(
      update,
      given(editing("  株式会社サンプル  ")),
      message(Message.SelectedOrgCode({ orgCode: "CORPORATE" })),
      message(Message.SubmittedCompanyForm()),
      Command.expectExact(
        CreateCompany({ visit: VISIT, name: "株式会社サンプル", orgCode: "CORPORATE" }),
      ),
      Command.resolve(CreateCompany, Message.SucceededCreateCompany({ visit: VISIT })),
      expectOutMessage(OutMessage.ConfirmedCompanyMembership({ redirectUrl: REDIRECT_URL })),
    );
  });

  test("空白だけの事業所名では作成しない", () => {
    story(
      update,
      given(editing("   ")),
      message(Message.SubmittedCompanyForm()),
      Command.expectNone(),
    );
  });

  test("作成中の二重の送信では、もう一度は送らない", () => {
    story(
      update,
      given(creating("株式会社サンプル")),
      message(Message.SubmittedCompanyForm()),
      Command.expectNone(),
    );
  });

  test("作成中は事業所名と事業形態を変えられない", () => {
    story(
      update,
      given(creating("株式会社サンプル")),
      message(Message.UpdatedName({ value: "別の名前" })),
      message(Message.SelectedOrgCode({ orgCode: "CORPORATE" })),
      model((next) => {
        expect(next.phase).toMatchObject({ name: "株式会社サンプル", orgCode: "PERSONAL" });
      }),
    );
  });

  test("別のタブで作成済み (AlreadyExists) なら、失敗を出さずに戻り先へ移る", () => {
    story(
      update,
      given(editing("株式会社サンプル")),
      message(Message.SubmittedCompanyForm()),
      Command.resolve(
        CreateCompany,
        Message.FailedCreateCompany({ visit: VISIT, failure: "AlreadyExists" }),
      ),
      expectOutMessage(OutMessage.ConfirmedCompanyMembership({ redirectUrl: REDIRECT_URL })),
    );
  });

  test("作成が Unauthorized ならログインを求める", () => {
    story(
      update,
      given(editing("株式会社サンプル")),
      message(Message.SubmittedCompanyForm()),
      Command.resolve(
        CreateCompany,
        Message.FailedCreateCompany({ visit: VISIT, failure: "Unauthorized" }),
      ),
      expectOutMessage(OutMessage.RequiredSignIn()),
    );
  });

  test("作成のほかの失敗では固定の文言を出し、もう一度送れる", () => {
    story(
      update,
      given(editing("株式会社サンプル")),
      message(Message.SubmittedCompanyForm()),
      Command.resolve(
        CreateCompany,
        Message.FailedCreateCompany({ visit: VISIT, failure: "Unexpected" }),
      ),
      model((next) => {
        expect(next.phase).toMatchObject({
          creation: { _tag: "Rejected", message: "事業所登録に失敗しました" },
        });
      }),
      expectNoOutMessage(),
      message(Message.SubmittedCompanyForm()),
      Command.resolve(CreateCompany, Message.SucceededCreateCompany({ visit: VISIT })),
    );
  });

  test("古い画面の作成の結果は、今の画面を変えない", () => {
    story(
      update,
      given(editing("株式会社サンプル")),
      message(Message.SucceededCreateCompany({ visit: VISIT - 1 })),
      expectNoOutMessage(),
    );
  });
});

describe("別のアカウントでログインする", () => {
  test("作成に失敗した後にログアウトにも失敗すると、新しいログアウトの失敗の文言を出す", () => {
    story(
      update,
      given(
        editingWith({
          name: "株式会社サンプル",
          creation: Submission.Rejected({ message: "事業所登録に失敗しました" }),
        }),
      ),
      message(Message.ClickedSignOut()),
      Command.resolve(SignOut, Message.FailedSignOut({ visit: VISIT })),
      model((next) => {
        expect(next.phase).toMatchObject({
          creation: { _tag: "Idle" },
          signOut: { _tag: "Rejected", message: SIGN_OUT_FAILED },
        });
      }),
    );
  });

  test("ログアウト中に作成を送っても、ログアウトの二重の click を止める印を消さない", () => {
    story(
      update,
      given(editingWith({ name: "株式会社サンプル", signOut: Submission.Submitting() })),
      message(Message.SubmittedCompanyForm()),
      model((next) => {
        expect(next.phase).toMatchObject({ signOut: { _tag: "Submitting" } });
      }),
      Command.resolve(CreateCompany, Message.SucceededCreateCompany({ visit: VISIT })),
      message(Message.ClickedSignOut()),
      Command.expectNone(),
    );
  });

  test("ログアウトに成功すると、ログアウトしたことを application に渡す", () => {
    story(
      update,
      given(editing()),
      message(Message.ClickedSignOut()),
      Command.resolve(SignOut, Message.SucceededSignOut({ visit: VISIT })),
      expectOutMessage(OutMessage.SignedOut()),
    );
  });

  test("ログアウト中の二重の click では、もう一度は送らない", () => {
    story(update, given(signingOut()), message(Message.ClickedSignOut()), Command.expectNone());
  });

  test("ログアウトに失敗すると失敗の文言を出して留まり、作成を送るとその文言を消す", () => {
    story(
      update,
      given(editing("株式会社サンプル")),
      message(Message.ClickedSignOut()),
      Command.resolve(SignOut, Message.FailedSignOut({ visit: VISIT })),
      model((next) => {
        expect(next.phase).toMatchObject({
          signOut: { _tag: "Rejected", message: SIGN_OUT_FAILED },
        });
      }),
      expectNoOutMessage(),
      message(Message.SubmittedCompanyForm()),
      model((next) => {
        expect(next.phase).toMatchObject({ signOut: { _tag: "Idle" } });
      }),
      Command.resolve(CreateCompany, Message.SucceededCreateCompany({ visit: VISIT })),
    );
  });
});
