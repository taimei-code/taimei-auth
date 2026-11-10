import { describe, expect, test } from "bun:test";
import { Option } from "effect";
import { expect as expectScene, given as givenScene, role, scene, text } from "foldkit/scene";
import { Command, given, message, model, story } from "foldkit/story";
import { fromString } from "foldkit/url";

import {
  init,
  LeaveToCompanySignup,
  LoadCompanyState,
  Message,
  type Model,
  SignOut,
  update,
  view,
} from "../account/main";
import * as AccountDeletion from "../../account/account-deletion";
import * as CurrentCompany from "../../account/current-company";
import * as Profile from "../../account/pages/Profile";
import * as Companies from "../../company/pages/Companies";
import * as CompanySettings from "../../company/pages/CompanySettings";
import * as MemberInvitations from "../../invitation/member-invitations";
import * as Members from "../../membership/pages/Members";
import { Animation, Toast } from "@foldkit/ui";

import {
  DIALOG_RESOURCES_RELEASED,
  FIRST_DIALOG_CLOSING,
} from "../../shared/__tests__/dialog-resolvers";
import { Dialog } from "../../shared/ui/dialog-view";
import {
  LeaveAfterAccountDeleted,
  LeaveToSignIn,
  LoadDocument,
  Message as DocumentNavigationMessage,
  PushUrl,
  ReplaceDocument,
} from "../document-navigation";

const ORIGIN = "https://auth.taimei-code.com";

const urlOf = (href: string) =>
  Option.getOrThrowWith(fromString(href), () => new Error(`URL として読めない: ${href}`));

const opened = (path = "/account") => init(urlOf(`${ORIGIN}${path}`));

const COMPANY_A = {
  companyId: "company-a",
  companyName: "事業所A",
  orgCode: "CORPORATE",
  role: "OWNER",
} as const;

const COMPANY_B = {
  companyId: "company-b",
  companyName: "事業所B",
  orgCode: "PERSONAL",
  role: "OWNER",
} as const;

const stateWithCurrent = (companyId: string) => ({
  maybeCurrentCompanyId: Option.some(companyId),
  memberships: [COMPANY_A, COMPANY_B],
});

const ready = (path = "/account"): Model =>
  update(
    opened(path).model,
    Message.SucceededLoadCompanyState({ state: stateWithCurrent(COMPANY_A.companyId) }),
  ).model;

describe("アカウント管理画面の入口の確認", () => {
  test("開くと事業状態を 1 回だけ読む", () => {
    expect(opened().commands).toMatchObject([{ name: LoadCompanyState.name }]);
  });

  test("Unauthorized なら今の URL を戻り先にしてログイン画面へ移る", () => {
    expect(
      update(opened().model, Message.FailedLoadCompanyState({ failure: "Unauthorized" })).commands,
    ).toMatchObject([{ name: LeaveToSignIn.name }]);
  });

  test("所属が 0 件なら事業所の登録へ移る", () => {
    expect(
      update(
        opened().model,
        Message.SucceededLoadCompanyState({
          state: { maybeCurrentCompanyId: Option.none(), memberships: [] },
        }),
      ).commands,
    ).toMatchObject([{ name: LeaveToCompanySignup.name }]);
  });

  test("通信の失敗では移らずに画面を出す", () => {
    const next = update(
      opened("/account/sessions").model,
      Message.FailedLoadCompanyState({ failure: "Unexpected" }),
    ).model;
    expect(next.entry._tag).toBe("Ready");
    expect(Option.map(next.maybePage, (page) => page._tag)).toEqual(Option.some("Sessions"));
  });
});

describe("枠の遷移とログアウト", () => {
  test("アカウント管理画面の中の link は履歴に積み、知らない path は document を読み直す", () => {
    const clicked = (href: string) =>
      update(ready(), Message.ClickedLink({ request: { _tag: "Internal", url: urlOf(href) } }))
        .commands;
    expect(clicked(`${ORIGIN}/account/connections`)).toMatchObject([{ name: PushUrl.name }]);
    expect(clicked(`${ORIGIN}/auth/`)).toMatchObject([{ name: LoadDocument.name }]);
  });

  test("ログアウトに成功したら / へ document を置き換え、二重の click では 1 回だけ送る", () => {
    const first = update(ready(), Message.ClickedSignOut());
    const second = update(first.model, Message.ClickedSignOut());
    expect(first.commands).toMatchObject([{ name: SignOut.name }]);
    expect(second.commands ?? []).toEqual([]);
    expect(update(first.model, Message.SucceededSignOut()).commands).toMatchObject([
      { name: ReplaceDocument.name, args: { href: "/" } },
    ]);
  });

  test("ログアウトに失敗したら通知を出し、押し直せる", () => {
    const failed = update(update(ready(), Message.ClickedSignOut()).model, Message.FailedSignOut());
    expect(failed.model.signOut._tag).toBe("Idle");
    expect(failed.model.toast.entries.length).toBe(1);
  });
});

describe("アカウント管理画面の知らない path", () => {
  test("/account の下の知らない path は、既定のエラーの文言を出す", () => {
    scene(
      { update, view },
      givenScene(ready("/account/no-such-page")),
      expectScene(text("エラーが発生しました")).toExist(),
    );
  });
});

const currentCompanyMessage = (message: CurrentCompany.Message) =>
  Message.GotCurrentCompanyMessage({ message });

const currentCompanyOf = (current: Model) =>
  current.entry._tag === "Ready" ? current.entry.currentCompany : undefined;

describe("現在の事業所の切り替え", () => {
  test("枠で別の事業所を選ぶと切り替えを 1 回だけ送り、成功の後に事業所の状態を読み直す", () => {
    const selected = update(
      ready(),
      currentCompanyMessage(CurrentCompany.Message.SelectedCompany({ companyId: "company-b" })),
    );
    const twice = update(
      selected.model,
      currentCompanyMessage(CurrentCompany.Message.SelectedCompany({ companyId: "company-b" })),
    );
    expect(selected.commands).toMatchObject([{ name: CurrentCompany.SwitchCompany.name }]);
    expect(twice.commands ?? []).toEqual([]);
    expect(
      update(selected.model, currentCompanyMessage(CurrentCompany.Message.SucceededSwitchCompany()))
        .commands,
    ).toMatchObject([{ name: CurrentCompany.RefreshCompanyState.name }]);
  });

  test("今の事業所を選んでも切り替えを送らない", () => {
    expect(
      update(
        ready(),
        currentCompanyMessage(CurrentCompany.Message.SelectedCompany({ companyId: "company-a" })),
      ).commands ?? [],
    ).toEqual([]);
  });

  test("読み直しで現在の事業所が変わると、事業所設定の画面を新しい事業所の値で入れ直す", () => {
    const settings = ready("/account/company-settings");
    const refreshed = update(
      update(settings, currentCompanyMessage(CurrentCompany.Message.SucceededSwitchCompany()))
        .model,
      currentCompanyMessage(
        CurrentCompany.Message.SucceededRefreshCompanyState({
          refreshNumber: 1,
          state: stateWithCurrent(COMPANY_B.companyId),
          maybeDoneText: Option.none(),
        }),
      ),
    ).model;
    expect(refreshed.pageVisit).toBe(settings.pageVisit + 1);
    expect(
      Option.map(refreshed.maybePage, (page) =>
        page._tag === "CompanySettings" ? page.model.settings : undefined,
      ),
    ).toMatchObject(Option.some({ _tag: "Editing", companyId: COMPANY_B.companyId }));
  });

  test("メンバーの画面で URL の戻り先だけが変わると、画面を入れ直して新しい戻り先を招待に使う", () => {
    const withRedirect = ready(
      "/account/members?service_name=taimei&redirect_url=https%3A%2F%2Fexample.com%2Fx",
    );
    const sameUrl = update(
      withRedirect,
      Message.ChangedUrl({
        url: urlOf(
          `${ORIGIN}/account/members?service_name=taimei&redirect_url=https%3A%2F%2Fexample.com%2Fx`,
        ),
      }),
    ).model;
    const withoutRedirect = update(
      sameUrl,
      Message.ChangedUrl({ url: urlOf(`${ORIGIN}/account/members`) }),
    ).model;
    expect(sameUrl.pageVisit).toBe(withRedirect.pageVisit);
    expect(withoutRedirect.pageVisit).toBe(withRedirect.pageVisit + 1);
    expect(
      Option.flatMap(withoutRedirect.maybePage, (page) =>
        page._tag === "Members" && page.model.page._tag === "Listing"
          ? Option.map(
              page.model.page.maybeInvitations,
              (invitations) => invitations.redirectSearch,
            )
          : Option.none(),
      ),
    ).toEqual(Option.some({}));
  });

  test("メンバーの画面で現在の事業所が変わると、新しい事業所の一覧を読み、前の事業所の古い一覧の結果を描かない", () => {
    const members = ready("/account/members");
    const switched = update(
      update(members, currentCompanyMessage(CurrentCompany.Message.SucceededSwitchCompany())).model,
      currentCompanyMessage(
        CurrentCompany.Message.SucceededRefreshCompanyState({
          refreshNumber: 1,
          state: stateWithCurrent(COMPANY_B.companyId),
          maybeDoneText: Option.none(),
        }),
      ),
    );
    expect(switched.model.pageVisit).toBe(members.pageVisit + 1);
    expect(switched.commands).toContainEqual(
      expect.objectContaining({
        name: Members.LoadMembers.name,
        args: expect.objectContaining({ companyId: COMPANY_B.companyId }),
      }),
    );
    const afterStale = update(
      switched.model,
      Message.GotMembersMessage({
        message: Members.Message.SucceededLoadMembers({
          visit: members.pageVisit,
          members: [
            {
              userId: "user-a-mate",
              label: "前の事業所の人",
              email: "a@example.com",
              role: "MEMBER",
            },
          ],
          reload: { _tag: "Opened" },
        }),
      }),
    ).model;
    expect(
      Option.map(afterStale.maybePage, (page) =>
        page._tag === "Members" && page.model.page._tag === "Listing"
          ? page.model.page.members._tag
          : undefined,
      ),
    ).toEqual(Option.some("Loading"));
  });

  test("新しい読み直しの成功の後に届いた古い読み直しの成功は、状態を戻さない", () => {
    const second = [
      currentCompanyMessage(CurrentCompany.Message.SucceededSwitchCompany()),
      currentCompanyMessage(CurrentCompany.Message.SucceededSwitchCompany()),
      currentCompanyMessage(
        CurrentCompany.Message.SucceededRefreshCompanyState({
          refreshNumber: 2,
          state: stateWithCurrent(COMPANY_B.companyId),
          maybeDoneText: Option.none(),
        }),
      ),
    ].reduce((current, each) => update(current, each).model, ready());
    const stale = update(
      second,
      currentCompanyMessage(
        CurrentCompany.Message.SucceededRefreshCompanyState({
          refreshNumber: 1,
          state: stateWithCurrent(COMPANY_A.companyId),
          maybeDoneText: Option.none(),
        }),
      ),
    ).model;
    expect(currentCompanyOf(stale)?.state.maybeCurrentCompanyId).toEqual(
      Option.some(COMPANY_B.companyId),
    );
  });

  test("読み直しが失敗すると、再読み込みの案内を出す", () => {
    const failed = update(
      ready(),
      currentCompanyMessage(
        CurrentCompany.Message.FailedRefreshCompanyState({
          refreshNumber: 0,
          failure: "Unexpected",
          actionText: "事業所情報を更新しました",
        }),
      ),
    ).model;
    expect(failed.toast.entries.map((entry) => entry.payload.text)).toEqual([
      "事業所情報を更新しましたが、表示の更新に失敗しました。ページを再読み込みしてください。",
    ]);
  });
});

describe("現在の事業所の session の切れた操作", () => {
  test("切り替えと読み直しが Unauthorized を受けると、今の URL を戻り先にしてログイン画面へ移る", () => {
    expect(
      update(
        ready(),
        currentCompanyMessage(
          CurrentCompany.Message.FailedSwitchCompany({ failure: "Unauthorized" }),
        ),
      ).commands,
    ).toMatchObject([{ name: LeaveToSignIn.name }]);
    expect(
      update(
        ready(),
        currentCompanyMessage(
          CurrentCompany.Message.FailedRefreshCompanyState({
            refreshNumber: 0,
            failure: "Unauthorized",
            actionText: "x",
          }),
        ),
      ).commands,
    ).toMatchObject([{ name: LeaveToSignIn.name }]);
  });
});

const companySettingsMessage = (message: CompanySettings.Message) =>
  Message.GotCompanySettingsMessage({ message });

type CompanyDeletionMessage = Parameters<
  typeof CompanySettings.Message.GotCompanyDeletionMessage
>[0]["message"];

const deletionMessage = (message: CompanyDeletionMessage) =>
  companySettingsMessage(CompanySettings.Message.GotCompanyDeletionMessage({ message }));

describe("page から頼まれる事業所の操作", () => {
  test("所属が残る事業所の削除の後は、一覧へ移り事業所の状態を読み直す", () => {
    const deleting = [
      deletionMessage({ _tag: "ClickedDeleteCompany" }),
      deletionMessage({ _tag: "ClickedConfirmDeletion", companyName: "事業所A" }),
    ].reduce((current, each) => update(current, each).model, ready("/account/company-settings"));
    const visit = Option.match(deleting.maybePage, {
      onNone: () => 0,
      onSome: (page) => (page._tag === "CompanySettings" ? page.model.visit : 0),
    });
    story(
      update,
      given(deleting),
      message(deletionMessage({ _tag: "SucceededDeleteCompany", visit, companyName: "事業所A" })),
      Command.expectExact(Animation.WaitForPaint),
      ...FIRST_DIALOG_CLOSING,
      Command.expectHas(PushUrl, CurrentCompany.RefreshCompanyState, Dialog.CloseDialog),
      DIALOG_RESOURCES_RELEASED,
      Command.resolve(PushUrl, DocumentNavigationMessage.CompletedPushUrl()),
      Command.resolve(
        CurrentCompany.RefreshCompanyState,
        CurrentCompany.Message.SucceededRefreshCompanyState({
          refreshNumber: 1,
          state: {
            maybeCurrentCompanyId: Option.some(COMPANY_B.companyId),
            memberships: [COMPANY_B],
          },
          maybeDoneText: Option.some("「事業所A」を削除しました。"),
        }),
      ),
      model((next) => {
        expect(next.toast.entries.map((entry) => entry.payload.text)).toEqual([
          "「事業所A」を削除しました。",
        ]);
      }),
      Toast.test.drainEntry({ entryId: "account-notices-entry-0" }),
    );
  });

  test("一覧の切替を押すと、現在の事業所の切り替えを送る", () => {
    const companies = update(
      ready("/account/companies"),
      Message.GotCompaniesMessage({
        message: Companies.Message.CompletedReadSignedInUserId({
          visit: 1,
          maybeUserId: Option.some("user-self"),
        }),
      }),
    ).model;
    story(
      update,
      given(companies),
      message(
        Message.GotCompaniesMessage({
          message: Companies.Message.ClickedSwitchCompany({ companyId: COMPANY_B.companyId }),
        }),
      ),
      Command.expectExact(CurrentCompany.SwitchCompany),
      Command.resolve(
        CurrentCompany.SwitchCompany,
        CurrentCompany.Message.SucceededSwitchCompany(),
      ),
      Command.expectExact(CurrentCompany.RefreshCompanyState),
      Command.resolve(
        CurrentCompany.RefreshCompanyState,
        CurrentCompany.Message.SucceededRefreshCompanyState({
          refreshNumber: 1,
          state: stateWithCurrent(COMPANY_B.companyId),
          maybeDoneText: Option.none(),
        }),
      ),
      model((next) => {
        expect(
          next.entry._tag === "Ready" && next.entry.currentCompany.state.maybeCurrentCompanyId,
        ).toEqual(Option.some(COMPANY_B.companyId));
      }),
    );
  });

  test("切り替えが拒まれると、切り替えられなかった旨を通知する", () => {
    story(
      update,
      given(ready()),
      message(
        currentCompanyMessage(CurrentCompany.Message.FailedSwitchCompany({ failure: "Forbidden" })),
      ),
      model((next) => {
        expect(next.toast.entries.map((entry) => entry.payload.text)).toEqual([
          "事業所を切り替えられませんでした。",
        ]);
      }),
      Toast.test.drainEntry({ entryId: "account-notices-entry-0" }),
    );
  });

  test("古い読み直しの結果でも、操作の完了は通知する", () => {
    const refreshedTwice = [
      currentCompanyMessage(CurrentCompany.Message.SucceededSwitchCompany()),
      currentCompanyMessage(CurrentCompany.Message.SucceededSwitchCompany()),
    ].reduce((current, each) => update(current, each).model, ready());
    story(
      update,
      given(refreshedTwice),
      message(
        currentCompanyMessage(
          CurrentCompany.Message.SucceededRefreshCompanyState({
            refreshNumber: 1,
            state: stateWithCurrent(COMPANY_A.companyId),
            maybeDoneText: Option.some("「事業所X」を作成し、現在の事業所に切り替えました。"),
          }),
        ),
      ),
      model((next) => {
        expect(next.toast.entries.map((entry) => entry.payload.text)).toEqual([
          "「事業所X」を作成し、現在の事業所に切り替えました。",
        ]);
      }),
      Toast.test.drainEntry({ entryId: "account-notices-entry-0" }),
    );
  });
});

const companiesWithSelf = (memberships: ReadonlyArray<typeof COMPANY_A | typeof COMPANY_B>) =>
  update(
    update(
      opened("/account/companies").model,
      Message.SucceededLoadCompanyState({
        state: { maybeCurrentCompanyId: Option.some(COMPANY_A.companyId), memberships },
      }),
    ).model,
    Message.GotCompaniesMessage({
      message: Companies.Message.CompletedReadSignedInUserId({
        visit: 1,
        maybeUserId: Option.some("user-self"),
      }),
    }),
  ).model;

const ANOTHER_PAGE_PATH = "/account/security";

describe("退会した後の遷移", () => {
  test.each([
    {
      label: "プロフィールで退会した",
      path: "/account",
      pageMessage: Message.GotProfileMessage({
        message: Profile.Message.GotAccountDeletionMessage({
          message: AccountDeletion.Message.SucceededDeleteAccount({ visit: 1 }),
        }),
      }),
    },
    {
      label: "最後の所属から抜けた",
      path: "/account/companies",
      pageMessage: Message.GotCompaniesMessage({
        message: Companies.Message.SucceededLeaveLastCompany(),
      }),
    },
    {
      label: "最後の事業所を削除した",
      path: "/account/company-settings",
      pageMessage: deletionMessage({ _tag: "SucceededDeleteLastCompany" }),
    },
  ])("$label 後は、その画面のままでも別の画面へ移った後でも、application が退会の後のログイン画面へ document を置き換える", ({
    path,
    pageMessage,
  }) => {
    for (const shownPath of [path, ANOTHER_PAGE_PATH]) {
      expect(update(ready(shownPath), pageMessage).commands).toMatchObject([
        { name: LeaveAfterAccountDeleted.name },
      ]);
    }
  });
});

describe("事業所から抜けた後の読み直しまで", () => {
  test("離脱が成功してから読み直しが済むまで「抜ける」を押せず、読み直しが失敗すると押せる", () => {
    const leaving = update(
      companiesWithSelf([COMPANY_B, COMPANY_A]),
      Message.GotCompaniesMessage({
        message: Companies.Message.ClickedLeaveCompany({ membership: COMPANY_B }),
      }),
    ).model;
    const left = update(
      leaving,
      Message.GotCompaniesMessage({
        message: Companies.Message.SucceededLeaveCompany({
          visit: 1,
          companyName: COMPANY_B.companyName,
        }),
      }),
    );
    expect(left.commands).toMatchObject([{ name: CurrentCompany.RefreshCompanyState.name }]);
    scene(
      { update, view },
      givenScene(left.model),
      expectScene(role("button", { name: "抜ける" })).toBeDisabled(),
    );
    scene(
      { update, view },
      givenScene(
        update(
          left.model,
          currentCompanyMessage(
            CurrentCompany.Message.FailedRefreshCompanyState({
              refreshNumber: 1,
              failure: "Unexpected",
              actionText: "事業所から抜けました",
            }),
          ),
        ).model,
      ),
      expectScene(role("button", { name: "抜ける" })).toBeEnabled(),
    );
  });
});

describe("事業所の設定の送信中の切り替え", () => {
  const saving = () =>
    update(
      ready("/account/company-settings"),
      companySettingsMessage(CompanySettings.Message.SubmittedCompanyForm()),
    ).model;

  test("保存の送信中は枠の select を止め、選ばれても切り替えを送らない", () => {
    scene(
      { update, view },
      givenScene(saving()),
      expectScene(role("combobox", { name: "事業所を切り替え" })).toBeDisabled(),
    );
    expect(
      update(
        saving(),
        currentCompanyMessage(
          CurrentCompany.Message.SelectedCompany({ companyId: COMPANY_B.companyId }),
        ),
      ).commands ?? [],
    ).toEqual([]);
  });

  test("枠の切り替えが済むまでは、保存と削除のボタンを押せない", () => {
    scene(
      { update, view },
      givenScene(
        update(
          ready("/account/company-settings"),
          currentCompanyMessage(
            CurrentCompany.Message.SelectedCompany({ companyId: COMPANY_B.companyId }),
          ),
        ).model,
      ),
      expectScene(role("button", { name: "保存" })).toBeDisabled(),
      expectScene(role("button", { name: "削除する" })).toBeDisabled(),
    );
  });

  test("削除の送信中は、枠で選ばれても切り替えを送らない", () => {
    const deleting = [
      deletionMessage({ _tag: "ClickedDeleteCompany" }),
      deletionMessage({ _tag: "ClickedConfirmDeletion", companyName: COMPANY_A.companyName }),
    ].reduce((current, each) => update(current, each).model, ready("/account/company-settings"));
    expect(
      update(
        deleting,
        currentCompanyMessage(
          CurrentCompany.Message.SelectedCompany({ companyId: COMPANY_B.companyId }),
        ),
      ).commands ?? [],
    ).toEqual([]);
  });
});

describe("メンバーの画面の送信中の切り替え", () => {
  const MEMBER = {
    userId: "user-member",
    label: "メンバー太郎",
    email: "member@example.com",
    role: "MEMBER",
  } as const;

  const membersMessage = (message: Members.Message) => Message.GotMembersMessage({ message });

  const invitationsMessage = (message: MemberInvitations.Message) =>
    membersMessage(Members.Message.GotMemberInvitationsMessage({ message }));

  const selectB = currentCompanyMessage(
    CurrentCompany.Message.SelectedCompany({ companyId: COMPANY_B.companyId }),
  );

  const membersShown = (): Model => {
    const opened = ready("/account/members");
    return [
      membersMessage(
        Members.Message.CompletedReadSelfUserId({
          visit: opened.pageVisit,
          maybeUserId: Option.some("user-owner"),
        }),
      ),
      membersMessage(
        Members.Message.SucceededLoadMembers({
          visit: opened.pageVisit,
          members: [MEMBER],
          reload: { _tag: "Opened" },
        }),
      ),
    ].reduce((current, each) => update(current, each).model, opened);
  };

  const after = (start: Model, messages: ReadonlyArray<Message>): Model =>
    messages.reduce((current, each) => update(current, each).model, start);

  const changingRole = () =>
    after(membersShown(), [
      membersMessage(Members.Message.SelectedRole({ member: MEMBER, value: "ADMIN" })),
    ]);

  test("役割の変更の送信中は枠の select を止め、選ばれても切り替えを送らない", () => {
    scene(
      { update, view },
      givenScene(changingRole()),
      expectScene(role("combobox", { name: "事業所を切り替え" })).toBeDisabled(),
    );
    expect(update(changingRole(), selectB).commands ?? []).toEqual([]);
  });

  test("削除・招待・招待の取り消しの送信中は、枠で選ばれても切り替えを送らない", () => {
    const sending = [
      [
        membersMessage(Members.Message.ClickedRemove({ member: MEMBER })),
        membersMessage(Members.Message.ClickedConfirmRemoval()),
      ],
      [
        invitationsMessage(MemberInvitations.Message.UpdatedEmail({ value: "new@example.com" })),
        invitationsMessage(MemberInvitations.Message.SubmittedInvitation()),
      ],
      [
        invitationsMessage(
          MemberInvitations.Message.ClickedRevoke({ invitationId: "invitation-1" }),
        ),
      ],
    ].map((messages) => after(membersShown(), messages));
    expect(sending.map((model) => update(model, selectB).commands ?? [])).toEqual([[], [], []]);
  });

  test("役割の変更の失敗が届いた後は、枠で選ぶと切り替えを送る", () => {
    const changing = changingRole();
    const failed = after(changing, [
      membersMessage(
        Members.Message.FailedChangeRole({ visit: changing.pageVisit, failure: "Forbidden" }),
      ),
    ]);
    expect(update(failed, selectB).commands).toContainEqual(
      expect.objectContaining({ name: CurrentCompany.SwitchCompany.name }),
    );
  });

  test("枠の切り替えが済むまでは、役割の select と削除と招待のボタンを押せない", () => {
    scene(
      { update, view },
      givenScene(
        after(membersShown(), [
          invitationsMessage(MemberInvitations.Message.UpdatedEmail({ value: "new@example.com" })),
          selectB,
        ]),
      ),
      expectScene(role("combobox", { name: "member@example.com の役割" })).toBeDisabled(),
      expectScene(role("button", { name: "削除" })).toBeDisabled(),
      expectScene(role("button", { name: "招待する" })).toBeDisabled(),
    );
  });
});
