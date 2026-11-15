import { describe, test } from "bun:test";
import { Option } from "effect";
import { expect as expectScene, given as givenScene, role, scene, text } from "foldkit/scene";
import { fromString } from "foldkit/url";

import * as CurrentCompany from "../web/src/account/current-company";
import { init, Message, type Model, update, view } from "../web/src/app/account/main";

const ORIGIN = "https://auth.taimei-code.com";
const NOT_OWNER_TEXT = "事業所設定の編集はオーナーのみ可能です。";

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

type Membership = CurrentCompany.Membership;

const stateOf = (current: Membership, memberships: ReadonlyArray<Membership>) => ({
  maybeCurrentCompanyId: Option.some(current.companyId),
  memberships,
});

const currentCompanyMessage = (message: CurrentCompany.Message) =>
  Message.GotCurrentCompanyMessage({ message });

const after = (start: Model, messages: ReadonlyArray<Message>): Model =>
  messages.reduce((current, each) => update(current, each).model, start);

const ready = (path: string, current: Membership, memberships: ReadonlyArray<Membership>) =>
  update(
    init(urlOf(`${ORIGIN}${path}`)).model,
    Message.SucceededLoadCompanyState({ state: stateOf(current, memberships) }),
  ).model;

const refreshedTo = (start: Model, current: Membership, memberships: ReadonlyArray<Membership>) =>
  after(start, [
    currentCompanyMessage(CurrentCompany.Message.SucceededSwitchCompany()),
    currentCompanyMessage(
      CurrentCompany.Message.SucceededRefreshCompanyState({
        refreshNumber: 1,
        state: stateOf(current, memberships),
        maybeDoneText: Option.none(),
      }),
    ),
  ]);

describe("事業所の状態の読み直しで役割だけが変わる (#458)", () => {
  test("AC-001: 事業所設定の page で、現在の事業所が同じまま役割だけが OWNER から ADMIN になる読み直しが届くと、オーナーのみの案内が出て事業所名の入力欄が無くなる", () => {
    const owner = ready("/account/company-settings", COMPANY_A, [COMPANY_A, COMPANY_B]);
    scene({ update, view }, givenScene(owner), expectScene(role("textbox", { name: "事業所名" })).toExist());

    const demotedA = { ...COMPANY_A, role: "ADMIN" } as const;
    scene(
      { update, view },
      givenScene(refreshedTo(owner, demotedA, [demotedA, COMPANY_B])),
      expectScene(text(NOT_OWNER_TEXT)).toExist(),
      expectScene(role("textbox", { name: "事業所名" })).not.toExist(),
    );
  });

  test("AC-002: メンバーの page で、現在の事業所が同じまま役割だけが ADMIN から MEMBER になる読み直しが届くと、「メンバーを招待」が無くなる", () => {
    const admin = ready("/account/members", COMPANY_B, [COMPANY_A, COMPANY_B]);
    scene(
      { update, view },
      givenScene(admin),
      expectScene(role("region", { name: "メンバーを招待" })).toExist(),
    );

    const demotedB = { ...COMPANY_B, role: "MEMBER" } as const;
    scene(
      { update, view },
      givenScene(refreshedTo(admin, demotedB, [COMPANY_A, demotedB])),
      expectScene(role("region", { name: "メンバーを招待" })).not.toExist(),
    );
  });
});
