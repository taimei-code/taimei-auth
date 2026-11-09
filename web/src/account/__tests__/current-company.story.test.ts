import { describe, expect, test } from "bun:test";
import { Option } from "effect";

import { init, Message, refresh, update } from "../current-company";

const COMPANY_A = {
  companyId: "company-a",
  companyName: "事業所A",
  orgCode: "CORPORATE",
  role: "OWNER",
} as const;

const COMPANY_B = { ...COMPANY_A, companyId: "company-b", companyName: "事業所B" } as const;

const STATE = {
  maybeCurrentCompanyId: Option.some(COMPANY_A.companyId),
  memberships: [COMPANY_A, COMPANY_B],
};

describe("現在の事業所の切り替えの状態", () => {
  test("切り替えの送信中に別の操作の読み直しが届いても、切り替えの送信が返るまで切り替え中のままにする", () => {
    const switching = update(init(STATE), Message.SelectedCompany({ companyId: "company-b" }));
    const refreshing = refresh(switching.model, {
      maybeDoneText: Option.none(),
      actionText: "事業所情報を更新しました",
    });
    const refreshed = update(
      refreshing.model,
      Message.SucceededRefreshCompanyState({
        refreshNumber: refreshing.model.refreshNumber,
        state: STATE,
        maybeDoneText: Option.none(),
      }),
    ).model;
    expect(refreshed.switching._tag).toBe("Switching");
    expect(update(refreshed, Message.SucceededSwitchCompany()).model.switching._tag).toBe("Idle");
  });
});
