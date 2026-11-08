import { describe, test } from "bun:test";
import {
  change,
  click,
  Command,
  expect,
  expectOutMessage,
  given,
  label,
  role,
  scene,
  submit,
  text,
  type,
} from "foldkit/scene";

import { Submission } from "../../shared/submission";
import {
  CreateCompany,
  init,
  Message,
  type Model,
  OutMessage,
  SignOut,
  update,
  view,
} from "../pages/SignUpCompany";

const VISIT = 1;
const REDIRECT_URL = "https://app.taimei-code.com/dashboard";

const checking = (): Model => init({ visit: VISIT, redirectUrl: REDIRECT_URL }).model;

const editing = (): Model => ({
  ...checking(),
  phase: {
    _tag: "Editing",
    name: "",
    orgCode: "PERSONAL",
    creation: Submission.Idle(),
    signOut: Submission.Idle(),
  },
});

const nameInput = label("事業所名");
const createButton = role("button", { name: "事業所を作成" });
const companyForm = role("form", { name: "事業所登録フォーム" });

describe("事業所の登録の画面", () => {
  test("確認の間は status だけを出す", () => {
    scene(
      { update, view },
      given(checking()),
      expect(role("status")).toExist(),
      expect(text("読み込み中…")).toExist(),
      expect(nameInput).toBeAbsent(),
      expect(createButton).toBeAbsent(),
    );
  });

  test("form は見出し、説明、事業所名、事業形態、作成のボタン、URL の注意、別のアカウントの button を出す", () => {
    scene(
      { update, view },
      given(editing()),
      expect(text("事業所を登録してください")).toExist(),
      expect(text("taimei では事業所単位で課金 / メンバー管理を行います。")).toExist(),
      expect(nameInput).toHaveAttr("placeholder", "例: 株式会社サンプル / 山田太郎"),
      expect(nameInput).toHaveAttr("aria-describedby", "company-name-hint"),
      expect(text("法人なら正式社名、個人事業主なら屋号 (なければご自身のお名前)")).toExist(),
      expect(role("group", { name: "事業形態" })).toExist(),
      expect(role("radio", { name: "個人事業主" })).toBeChecked(),
      expect(role("radio", { name: "法人" })).not.toBeChecked(),
      expect(createButton).toBeDisabled(),
      expect(text("URL が auth.taimei-code.com であることを確認してください")).toExist(),
      expect(role("button", { name: "別のアカウントでログインする" })).toBeEnabled(),
    );
  });

  test("事業所名を入れて送ると、選んだ事業形態で作成し、成功で戻り先を application に渡す", () => {
    scene(
      { update, view },
      given(editing()),
      type(nameInput, "株式会社サンプル"),
      expect(createButton).toBeEnabled(),
      change(role("radio", { name: "法人" }), "CORPORATE"),
      expect(role("radio", { name: "法人" })).toBeChecked(),
      submit(companyForm),
      expect(nameInput).toBeDisabled(),
      expect(role("radio", { name: "個人事業主" })).toBeDisabled(),
      expect(createButton).toBeDisabled(),
      Command.expectExact(
        CreateCompany({ visit: VISIT, name: "株式会社サンプル", orgCode: "CORPORATE" }),
      ),
      Command.resolve(CreateCompany, Message.SucceededCreateCompany({ visit: VISIT })),
      expectOutMessage(OutMessage.ConfirmedCompanyMembership({ redirectUrl: REDIRECT_URL })),
    );
  });

  test("作成の失敗で固定の文言を alert で出し、入力を戻す", () => {
    scene(
      { update, view },
      given(editing()),
      type(nameInput, "株式会社サンプル"),
      submit(companyForm),
      Command.resolve(
        CreateCompany,
        Message.FailedCreateCompany({ visit: VISIT, failure: "Unexpected" }),
      ),
      expect(role("alert")).toHaveText("事業所登録に失敗しました"),
      expect(nameInput).toBeEnabled(),
      expect(createButton).toBeEnabled(),
    );
  });

  test("ログアウトに失敗すると失敗の文言を出す", () => {
    scene(
      { update, view },
      given(editing()),
      click(role("button", { name: "別のアカウントでログインする" })),
      Command.resolve(SignOut, Message.FailedSignOut({ visit: VISIT })),
      expect(role("alert")).toHaveText(
        "ログアウトに失敗しました。しばらくしてから再度お試しください。",
      ),
    );
  });
});
