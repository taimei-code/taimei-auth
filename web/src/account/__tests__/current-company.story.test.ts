import { describe, expect, test } from "bun:test";
import { Option } from "effect";
import { given, message, model, story } from "foldkit/story";

import { init, isRefreshing, Message, refresh, update } from "../current-company";

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

const STATE_ON_B = { ...STATE, maybeCurrentCompanyId: Option.some(COMPANY_B.companyId) };

const TEXTS = { maybeDoneText: Option.none(), actionText: "事業所情報を更新しました" };

const twoRefreshesRequested = () => refresh(refresh(init(STATE), TEXTS).model, TEXTS).model;

describe("現在の事業所の読み直しの順序", () => {
  test("1 回目の成功の後に 2 回目の失敗が届くと、1 回目の結果を使う", () => {
    story(
      update,
      given(twoRefreshesRequested()),
      message(
        Message.SucceededRefreshCompanyState({
          refreshNumber: 1,
          state: STATE_ON_B,
          maybeDoneText: Option.none(),
        }),
      ),
      message(
        Message.FailedRefreshCompanyState({
          refreshNumber: 2,
          failure: "Unexpected",
          actionText: TEXTS.actionText,
        }),
      ),
      model((next) => {
        expect(next.state).toEqual(STATE_ON_B);
      }),
    );
  });

  test("2 回目の成功の後に 1 回目の成功が届いても、2 回目の結果のままにする", () => {
    story(
      update,
      given(twoRefreshesRequested()),
      message(
        Message.SucceededRefreshCompanyState({
          refreshNumber: 2,
          state: STATE_ON_B,
          maybeDoneText: Option.none(),
        }),
      ),
      message(
        Message.SucceededRefreshCompanyState({
          refreshNumber: 1,
          state: STATE,
          maybeDoneText: Option.none(),
        }),
      ),
      model((next) => {
        expect(next.state).toEqual(STATE_ON_B);
      }),
    );
  });

  test("2 回目の失敗が先に届いても、1 回目の応答が届くまで読み直し中のままにする", () => {
    story(
      update,
      given(twoRefreshesRequested()),
      message(
        Message.FailedRefreshCompanyState({
          refreshNumber: 2,
          failure: "Unexpected",
          actionText: TEXTS.actionText,
        }),
      ),
      model((next) => {
        expect(isRefreshing(next)).toBe(true);
      }),
      message(
        Message.SucceededRefreshCompanyState({
          refreshNumber: 1,
          state: STATE_ON_B,
          maybeDoneText: Option.none(),
        }),
      ),
      model((next) => {
        expect(isRefreshing(next)).toBe(false);
        expect(next.state).toEqual(STATE_ON_B);
      }),
    );
  });
});
