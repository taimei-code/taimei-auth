import { describe, test } from "bun:test";
import { Option } from "effect";
import { change, Command, expect, given, label, scene, text, withViewInputs } from "foldkit/scene";

import {
  init,
  Message,
  RefreshCompanyState,
  SwitchCompany,
  update,
  view,
} from "../current-company";

const switcherView = withViewInputs(view, { isBlocked: false });

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
  role: "MEMBER",
} as const;

describe("枠の現在の事業所の欄", () => {
  test("所属が 1 件なら、select でなく事業所名と事業形態・role を出す", () => {
    scene(
      { update, view: switcherView() },
      given(
        init({ maybeCurrentCompanyId: Option.some(COMPANY_A.companyId), memberships: [COMPANY_A] }),
      ),
      expect(text("現在の事業所")).toExist(),
      expect(text("事業所A")).toExist(),
      expect(text("法人 ・ オーナー")).toExist(),
      expect(label("事業所を切り替え")).toBeAbsent(),
    );
  });

  test("select で別の事業所を選ぶと切り替えを送り、読み直しの後に選んだ事業所を出す", () => {
    scene(
      { update, view: switcherView() },
      given(
        init({
          maybeCurrentCompanyId: Option.some(COMPANY_A.companyId),
          memberships: [COMPANY_A, COMPANY_B],
        }),
      ),
      expect(label("事業所を切り替え")).toHaveValue(COMPANY_A.companyId),
      change(label("事業所を切り替え"), COMPANY_B.companyId),
      expect(label("事業所を切り替え")).toBeDisabled(),
      Command.resolve(SwitchCompany, Message.SucceededSwitchCompany()),
      Command.resolve(
        RefreshCompanyState,
        Message.SucceededRefreshCompanyState({
          refreshNumber: 1,
          state: {
            maybeCurrentCompanyId: Option.some(COMPANY_B.companyId),
            memberships: [COMPANY_A, COMPANY_B],
          },
          maybeDoneText: Option.none(),
        }),
      ),
      expect(label("事業所を切り替え")).toHaveValue(COMPANY_B.companyId),
      expect(text("個人事業主 ・ メンバー")).toExist(),
    );
  });
});
