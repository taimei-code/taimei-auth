import { describe, expect, test } from "bun:test";
import { Option } from "effect";
import { fromString } from "foldkit/url";

import * as CurrentCompany from "../web/src/account/current-company";
import { init, Message, type Model, update } from "../web/src/app/account/main";
import * as Companies from "../web/src/company/pages/Companies";
import * as CompanySettings from "../web/src/company/pages/CompanySettings";

const ORIGIN = "https://auth.taimei-code.com";

const urlOf = (href: string) =>
  Option.getOrThrowWith(fromString(href), () => new Error(`URL として読めない: ${href}`));

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
  role: "ADMIN",
} as const;

const ready = (path: string): Model =>
  update(
    init(urlOf(`${ORIGIN}${path}`)).model,
    Message.SucceededLoadCompanyState({
      state: {
        maybeCurrentCompanyId: Option.some(COMPANY_A.companyId),
        memberships: [COMPANY_A, COMPANY_B],
      },
    }),
  ).model;

const pageVisitOf = (model: Model): number =>
  Option.match(model.maybePage, {
    onNone: () => -1,
    onSome: (page) => ("visit" in page.model ? (page.model.visit as number) : -1),
  });

const after = (start: Model, messages: ReadonlyArray<Message>): Model =>
  messages.reduce((current, each) => update(current, each).model, start);

const leaveToProfile = Message.ChangedUrl({ url: urlOf(`${ORIGIN}/account`) });

const refreshesIn = (model: Model, message: Message): number =>
  ((update(model, message).commands ?? []) as ReadonlyArray<{ name: string }>).filter(
    ({ name }) => name === CurrentCompany.RefreshCompanyState.name,
  ).length;

const settingsMessage = (message: CompanySettings.Message) =>
  Message.GotCompanySettingsMessage({ message });

const companiesMessage = (message: Companies.Message) => Message.GotCompaniesMessage({ message });

type CompanyDeletionMessage = Parameters<
  typeof CompanySettings.Message.GotCompanyDeletionMessage
>[0]["message"];

const deletionMessage = (message: CompanyDeletionMessage) =>
  settingsMessage(CompanySettings.Message.GotCompanyDeletionMessage({ message }));

describe("事業所を変える操作の応答が、page を離れた後に届く", () => {
  test("AC-007: 事業所設定の保存の成功が、別の page へ URL が替わった後に届くと、事業所の状態の読み直しを 1 つ出す", () => {
    const settings = ready("/account/company-settings");
    const visit = pageVisitOf(settings);
    const left = after(settings, [
      settingsMessage(CompanySettings.Message.SubmittedCompanyForm()),
      leaveToProfile,
    ]);

    expect(
      refreshesIn(left, settingsMessage(CompanySettings.Message.SucceededUpdateCompany({ visit }))),
    ).toBe(1);
  });

  test("AC-008: 事業所から抜けるの成功が、別の page へ URL が替わった後に届くと、事業所の状態の読み直しを 1 つ出す", () => {
    const companies = ready("/account/companies");
    const visit = pageVisitOf(companies);
    const left = after(companies, [
      companiesMessage(
        Companies.Message.CompletedReadSignedInUserId({
          visit,
          maybeUserId: Option.some("user-self"),
        }),
      ),
      companiesMessage(Companies.Message.ClickedLeaveCompany({ membership: COMPANY_B })),
      leaveToProfile,
    ]);

    expect(
      refreshesIn(
        left,
        companiesMessage(
          Companies.Message.SucceededLeaveCompany({ visit, companyName: COMPANY_B.companyName }),
        ),
      ),
    ).toBe(1);
  });

  test("AC-009: 事業所の削除の失敗が、別の page へ URL が替わった後に届いても、事業所の状態を読み直さない", () => {
    const settings = ready("/account/company-settings");
    const visit = pageVisitOf(settings);
    const left = after(settings, [
      deletionMessage({ _tag: "ClickedDeleteCompany" }),
      deletionMessage({ _tag: "ClickedConfirmDeletion", companyName: COMPANY_A.companyName }),
      leaveToProfile,
    ]);

    expect(
      refreshesIn(left, deletionMessage({ _tag: "FailedDeleteCompany", visit, failure: "Forbidden" })),
    ).toBe(0);
  });

  test("AC-010: 自分の user id の読み取りが、別の page へ URL が替わった後に届いても、事業所の状態を読み直さない", () => {
    const companies = ready("/account/companies");
    const visit = pageVisitOf(companies);
    const left = after(companies, [leaveToProfile]);

    expect(
      refreshesIn(
        left,
        companiesMessage(
          Companies.Message.CompletedReadSignedInUserId({
            visit,
            maybeUserId: Option.some("user-self"),
          }),
        ),
      ),
    ).toBe(0);
  });
});
