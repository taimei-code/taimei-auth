import { describe, test } from "bun:test";
import { Option } from "effect";
import { expect, given, label, role, scene, text } from "foldkit/scene";

import { Submission } from "../../shared/submission";
import { init, type Model, update, view } from "../pages/Profile";

const present = (overrides: Partial<Model> = {}): Model => ({
  ...init({ visit: 1, maybeCurrentCompany: Option.none() }).model,
  profile: {
    _tag: "Present",
    loadedName: "山田",
    nameDraft: "山田",
    email: "yamada@example.com",
    maybeImageUrl: Option.none(),
    save: Submission.Idle(),
    avatar: Submission.Idle(),
  },
  ...overrides,
});

describe("プロフィールの画面", () => {
  test("見出し、メールアドレス (変えられない)、名前、保存、写真、退会のボタンを出す", () => {
    scene(
      { update, view },
      given(present()),
      expect(role("heading", { name: "プロフィール" })).toExist(),
      expect(label("メールアドレス")).toBeDisabled(),
      expect(label("名前")).toHaveValue("山田"),
      expect(role("button", { name: "保存" })).toBeEnabled(),
      expect(text("プロフィール写真")).toExist(),
      expect(role("button", { name: "退会する" })).toExist(),
    );
  });

  test("現在の事業所があれば、名前と role を出す", () => {
    scene(
      { update, view },
      given(
        present({
          maybeCurrentCompany: Option.some({
            companyName: "株式会社サンプル",
            role: "OWNER",
            orgCode: "CORPORATE",
          }),
        }),
      ),
      expect(text("現在の事業所")).toExist(),
    );
  });

  test("session の user が無い間は、見出しを出さない", () => {
    scene(
      { update, view },
      given(init({ visit: 1, maybeCurrentCompany: Option.none() }).model),
      expect(role("heading", { name: "プロフィール" })).toBeAbsent(),
    );
  });

  test("退会が拒まれた時は、その文言を alert で出す", () => {
    const base = present();
    scene(
      { update, view },
      given({
        ...base,
        deletion: {
          ...base.deletion,
          deletion: Submission.Rejected({
            message: "所有者として残っている事業所があります。先に委譲または削除してください。",
          }),
        },
      }),
      expect(role("alert")).toHaveText(
        "所有者として残っている事業所があります。先に委譲または削除してください。",
      ),
    );
  });
});
