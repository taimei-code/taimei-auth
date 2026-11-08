import { describe, test } from "bun:test";
import { Option } from "effect";
import {
  click,
  Command,
  expect,
  expectOutMessage,
  given,
  role,
  scene,
  text,
  withViewInputs,
} from "foldkit/scene";

import * as CurrentCompany from "../../account/current-company";
import {
  init,
  LeaveCompany,
  Message,
  type Model,
  OutMessage,
  update,
  view,
} from "../pages/Companies";

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

const currentCompany = CurrentCompany.init({
  maybeCurrentCompanyId: Option.some(COMPANY_A.companyId),
  memberships: [COMPANY_A, COMPANY_B],
});

const companiesView = withViewInputs(view, { currentCompany });

const signedIn = (): Model =>
  update(
    init(1).model,
    Message.CompletedReadSignedInUserId({ visit: 1, maybeUserId: Option.some("user-self") }),
  ).model;

describe("事業所の一覧の画面", () => {
  test("見出し、追加のボタン、所属ごとの行と、現在の事業所の選択中の印を出す", () => {
    scene(
      { update, view: companiesView() },
      given(signedIn()),
      expect(role("heading", { name: "所属事業所" })).toExist(),
      expect(role("button", { name: "事業所を追加" })).toExist(),
      expect(text("事業所A")).toExist(),
      expect(text("事業所B")).toExist(),
      expect(text("選択中")).toExist(),
      expect(text("管理者 ・ 個人事業主")).toExist(),
      expect(role("button", { name: "切替" })).toBeEnabled(),
    );
  });

  test("切り替えの間は、一覧の切替のボタンも押せない", () => {
    scene(
      {
        update,
        view: companiesView({
          currentCompany: {
            ...currentCompany,
            switching: CurrentCompany.Switching.Switching({ companyId: COMPANY_B.companyId }),
          },
        }),
      },
      given(signedIn()),
      expect(role("button", { name: "切替" })).toBeDisabled(),
    );
  });

  test("唯一の OWNER の離脱を止めた行は、委譲のボタンと理由の alert を出す", () => {
    scene(
      { update, view: companiesView() },
      given({ ...signedIn(), maybeSoleOwnerCompanyId: Option.some(COMPANY_A.companyId) }),
      expect(role("button", { name: "オーナーを委譲" })).toExist(),
      expect(role("alert")).toHaveText(
        "唯一のオーナーは事業所から抜けられません。先にオーナーを委譲してください。",
      ),
    );
  });

  test("ログイン中の利用者の id が分かるまでは、抜けるのボタンを押せない", () => {
    scene(
      { update, view: companiesView() },
      given(init(1).model),
      expect(role("button", { name: "抜ける" })).toBeDisabled(),
    );
  });
});

describe("事業所の一覧の操作", () => {
  const onlyCompanyView = withViewInputs(view, {
    currentCompany: CurrentCompany.init({
      maybeCurrentCompanyId: Option.some(COMPANY_A.companyId),
      memberships: [COMPANY_A],
    }),
  });

  test("唯一の OWNER が抜けるを押して拒まれると、委譲のボタンと理由を出す", () => {
    scene(
      { update, view: onlyCompanyView() },
      given(signedIn()),
      click(role("button", { name: "抜ける" })),
      Command.resolve(
        LeaveCompany,
        Message.FailedLeaveCompany({
          visit: 1,
          companyId: COMPANY_A.companyId,
          failure: "LastOwner",
        }),
      ),
      expect(role("button", { name: "オーナーを委譲" })).toExist(),
      expect(role("alert")).toHaveText(
        "唯一のオーナーは事業所から抜けられません。先にオーナーを委譲してください。",
      ),
    );
  });

  test("切替を押すと、現在の事業所の切り替えを頼む", () => {
    scene(
      { update, view: companiesView() },
      given(signedIn()),
      click(role("button", { name: "切替" })),
      expectOutMessage(OutMessage.SelectedCompany({ companyId: COMPANY_B.companyId })),
    );
  });
});
