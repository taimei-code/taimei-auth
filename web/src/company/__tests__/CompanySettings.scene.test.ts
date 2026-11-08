import { describe, test } from "bun:test";
import { Option } from "effect";
import {
  click,
  Command,
  expect,
  expectOutMessage,
  given,
  label,
  role,
  scene,
  text,
  type,
  withViewInputs,
} from "foldkit/scene";

import * as CurrentCompany from "../../account/current-company";
import { init, Message, OutMessage, update, UpdateCompany, view } from "../pages/CompanySettings";

const OWNER = {
  companyId: "company-a",
  companyName: "事業所A",
  orgCode: "CORPORATE",
  role: "OWNER",
} as const;

const onlyCompany = CurrentCompany.init({
  maybeCurrentCompanyId: Option.some(OWNER.companyId),
  memberships: [OWNER],
});

const settingsView = withViewInputs(view, { currentCompany: onlyCompany });

describe("事業所の設定の画面", () => {
  test("OWNER には名前と事業形態の form、保存、削除のボタンを出す", () => {
    scene(
      { update, view: settingsView() },
      given(init(1, Option.some(OWNER))),
      expect(role("heading", { name: "事業所設定" })).toExist(),
      expect(label("事業所名")).toHaveValue("事業所A"),
      expect(role("radio", { name: "法人" })).toBeChecked(),
      expect(role("button", { name: "保存" })).toBeEnabled(),
      expect(role("button", { name: "削除する" })).toExist(),
    );
  });

  test("OWNER でなければ、編集できない旨だけを出す", () => {
    scene(
      { update, view: settingsView() },
      given(init(1, Option.some({ ...OWNER, role: "MEMBER" }))),
      expect(text("事業所設定の編集はオーナーのみ可能です。")).toExist(),
      expect(role("button", { name: "保存" })).toBeAbsent(),
    );
  });
});

describe("事業所の設定の操作", () => {
  test("名前を変えて保存すると更新を送り、成功で事業所の状態の読み直しを頼む", () => {
    scene(
      { update, view: settingsView() },
      given(init(1, Option.some(OWNER))),
      type(label("事業所名"), "事業所A2"),
      click(role("button", { name: "保存" })),
      expect(role("button", { name: "保存" })).toBeDisabled(),
      Command.resolve(UpdateCompany, Message.SucceededUpdateCompany({ visit: 1 })),
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
});
