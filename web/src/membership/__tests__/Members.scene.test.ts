import { describe, test } from "bun:test";
import { Option } from "effect";
import {
  change,
  Command,
  expect,
  given,
  label,
  role,
  scene,
  text,
  withViewInputs,
} from "foldkit/scene";

import * as CurrentCompany from "../../account/current-company";
import { ChangeRole, init, LoadMembers, Message, type Model, update, view } from "../pages/Members";

const VISIT = 1;

const idleCompany = CurrentCompany.init({
  maybeCurrentCompanyId: Option.some("company-a"),
  memberships: [],
});

const membersView = withViewInputs(view, { currentCompany: idleCompany });
const SELF = "user-self";

const ME = { userId: SELF, label: "自分", email: "self@example.com", role: "ADMIN" } as const;
const OWNER = {
  userId: "user-owner",
  label: "オーナー",
  email: "owner@example.com",
  role: "OWNER",
} as const;
const MATE = {
  userId: "user-mate",
  label: "仲間",
  email: "mate@example.com",
  role: "MEMBER",
} as const;

const membershipOf = (role: "OWNER" | "ADMIN" | "MEMBER") => ({
  companyId: "company-a",
  companyName: "事業所A",
  orgCode: "CORPORATE" as const,
  role,
});

const opened = (role: "OWNER" | "ADMIN" | "MEMBER"): Model =>
  update(
    init(VISIT, Option.some(membershipOf(role)), {}).model,
    Message.CompletedReadSelfUserId({ visit: VISIT, maybeUserId: Option.some(SELF) }),
  ).model;

const listed = (role: "OWNER" | "ADMIN" | "MEMBER"): Model =>
  update(
    opened(role),
    Message.SucceededLoadMembers({
      visit: VISIT,
      members: [{ ...ME, role }, OWNER, MATE],
      reload: { _tag: "Opened" },
    }),
  ).model;

describe("メンバーの画面", () => {
  test("読み込み中は見出しと読み込み中の印を出し、一覧の section を出さない", () => {
    scene(
      { update, view: membersView() },
      given(opened("ADMIN")),
      expect(role("heading", { name: "メンバー" })).toExist(),
      expect(role("status")).toExist(),
      expect(role("region", { name: "メンバー一覧" })).toBeAbsent(),
    );
  });

  test("ADMIN には、自分の行に (自分) を出し、OWNER と自分の行に操作を出さず、MEMBER の行に操作と招待の form を出す", () => {
    scene(
      { update, view: membersView() },
      given(listed("ADMIN")),
      expect(text("(自分)")).toExist(),
      expect(label("mate@example.com の役割")).toHaveValue("MEMBER"),
      expect(label("owner@example.com の役割")).toBeAbsent(),
      expect(label("self@example.com の役割")).toBeAbsent(),
      expect(role("option", { name: "オーナー" })).toBeAbsent(),
      expect(role("region", { name: "メンバーを招待" })).toExist(),
    );
  });

  test("MEMBER には、役割の select・削除・招待の form を出さない", () => {
    scene(
      { update, view: membersView() },
      given(listed("MEMBER")),
      expect(text("(自分)")).toExist(),
      expect(role("combobox")).toBeAbsent(),
      expect(role("button", { name: "削除" })).toBeAbsent(),
      expect(role("region", { name: "メンバーを招待" })).toBeAbsent(),
    );
  });

  test("利用者の id が分からない間は、どの行にも操作を出さない", () => {
    scene(
      { update, view: membersView() },
      given(
        update(
          init(VISIT, Option.some(membershipOf("OWNER")), {}).model,
          Message.SucceededLoadMembers({
            visit: VISIT,
            members: [ME, MATE],
            reload: { _tag: "Opened" },
          }),
        ).model,
      ),
      expect(text("仲間")).toExist(),
      expect(label("mate@example.com の役割")).toBeAbsent(),
      expect(role("button", { name: "削除" })).toBeAbsent(),
    );
  });

  test("初回の取得が失敗すると、一覧の section に取得できなかった旨を出す", () => {
    scene(
      { update, view: membersView() },
      given(
        update(
          opened("OWNER"),
          Message.FailedLoadMembers({
            visit: VISIT,
            failure: "Unexpected",
            reload: { _tag: "Opened" },
          }),
        ).model,
      ),
      expect(role("alert")).toHaveText("メンバーの一覧を取得できませんでした。"),
      expect(role("listitem")).toBeAbsent(),
    );
  });

  test("役割を選ぶと変更を送って操作を止め、取り直しの後に新しい役割を出す", () => {
    scene(
      { update, view: membersView() },
      given(listed("OWNER")),
      change(label("mate@example.com の役割"), "ADMIN"),
      expect(label("mate@example.com の役割")).toBeDisabled(),
      expect(role("button", { name: "削除" })).toBeDisabled(),
      Command.resolve(
        ChangeRole,
        Message.SucceededChangeRole({
          visit: VISIT,
          texts: {
            doneText: "仲間 の役割を管理者に変更しました。",
            actionText: "役割を変更しました",
          },
        }),
      ),
      expect(label("mate@example.com の役割")).toBeDisabled(),
      Command.resolve(
        LoadMembers,
        Message.SucceededLoadMembers({
          visit: VISIT,
          members: [{ ...ME, role: "OWNER" }, OWNER, { ...MATE, role: "ADMIN" }],
          reload: {
            _tag: "ChangedRole",
            texts: {
              doneText: "仲間 の役割を管理者に変更しました。",
              actionText: "役割を変更しました",
            },
          },
        }),
      ),
      expect(label("mate@example.com の役割")).toHaveValue("ADMIN"),
      expect(label("mate@example.com の役割")).toBeEnabled(),
    );
  });

  test("役割の変更が拒まれると、行の select に元の役割を出して操作を戻す", () => {
    scene(
      { update, view: membersView() },
      given(listed("OWNER")),
      change(label("mate@example.com の役割"), "ADMIN"),
      Command.resolve(ChangeRole, Message.FailedChangeRole({ visit: VISIT, failure: "Forbidden" })),
      expect(label("mate@example.com の役割")).toHaveValue("MEMBER"),
      expect(label("mate@example.com の役割")).toBeEnabled(),
    );
  });

  test("現在の事業所が無いと、事業所が見つからない旨を出す", () => {
    scene(
      { update, view: membersView() },
      given(init(VISIT, Option.none(), {}).model),
      expect(text("事業所が見つかりません。")).toExist(),
    );
  });
});
