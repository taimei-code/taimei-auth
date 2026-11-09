import { describe, expect, test } from "bun:test";
import { Option } from "effect";
import { expect as expectScene, given as givenScene, scene, text } from "foldkit/scene";
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
import * as CurrentCompany from "../../account/current-company";
import * as Companies from "../../company/pages/Companies";
import * as CompanySettings from "../../company/pages/CompanySettings";
import * as Members from "../../membership/pages/Members";
import { Toast } from "@foldkit/ui";

import { Dialog } from "../../shared/ui/dialog-view";
import {
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

  test("古い読み直しの結果は、新しい読み直しの後の状態を戻さない", () => {
    const switched = update(
      ready(),
      currentCompanyMessage(CurrentCompany.Message.SucceededSwitchCompany()),
    ).model;
    const second = update(
      switched,
      currentCompanyMessage(CurrentCompany.Message.SucceededSwitchCompany()),
    ).model;
    const stale = update(
      second,
      currentCompanyMessage(
        CurrentCompany.Message.SucceededRefreshCompanyState({
          refreshNumber: 1,
          state: stateWithCurrent(COMPANY_B.companyId),
          maybeDoneText: Option.none(),
        }),
      ),
    ).model;
    expect(currentCompanyOf(stale)?.state.maybeCurrentCompanyId).toEqual(
      Option.some(COMPANY_A.companyId),
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
      Command.expectHas(PushUrl, CurrentCompany.RefreshCompanyState),
      Command.resolve(Dialog.CloseDialog, Dialog.Message.CompletedCloseDialog()),
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
