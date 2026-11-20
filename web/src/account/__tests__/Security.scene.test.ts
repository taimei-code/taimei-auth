import { describe, test } from "bun:test";
import { Option } from "effect";
import { all, Command, expect, expectAll, given, Mount, role, scene, text } from "foldkit/scene";

import * as MfaEnrollment from "../../mfa/mfa-enrollment";
import { pendingDialogTransitionResolvers } from "../../shared/__tests__/dialog-resolvers";
import { Dialog } from "../../shared/ui/dialog-view";
import { init, Message, type Model, update, view } from "../pages/Security";

const loaded = (mfa: Model["mfa"], passkeyList: Model["passkeyList"] = { _tag: "Hidden" }): Model =>
  update(
    init(1).model,
    Message.SucceededLoadSecuritySettings({
      passkeyList,
      visit: 1,
      refreshNumber: 0,
      mfa,
      maybeTexts: Option.none(),
    }),
  ).model;

describe("セキュリティの画面", () => {
  test("「有効にする」を押すと MFA の有効化の dialog を開き、登録の応答を待つ間は読み込み中を出す", () => {
    const clicked = update(
      loaded({ _tag: "Disabled" }),
      Message.GotMfaEnrollmentMessage({ message: MfaEnrollment.Message.ClickedEnable() }),
    ).model;
    scene(
      { update, view },
      given(clicked),
      Mount.resolve(Dialog.AcquireResources, Dialog.Message.SucceededAcquireResources()),
      Command.resolveAll(...pendingDialogTransitionResolvers(clicked.enrollment.dialog)),
      expect(role("heading", { name: "多要素認証 (MFA) を有効にする" })).toExist(),
      expect(role("status")).toHaveText("読み込み中…"),
    );
  });

  test("状態を読む間は status を出す", () => {
    scene(
      { update, view },
      given(init(1).model),
      expect(role("heading", { name: "セキュリティ" })).toExist(),
      expect(role("status")).toExist(),
    );
  });

  test("状態の取得に失敗すると、取得できなかった旨を alert で出す", () => {
    scene(
      { update, view },
      given({ ...init(1).model, mfa: { _tag: "Failed" } }),
      expect(role("alert")).toHaveText("多要素認証 (MFA) の設定状態を取得できませんでした。"),
    );
  });

  test("無効なら「無効」と有効にするボタンを出し、残数を出さない", () => {
    scene(
      { update, view },
      given(loaded({ _tag: "Disabled" })),
      expect(text("無効")).toExist(),
      expect(role("button", { name: "有効にする" })).toExist(),
      expect(text("リカバリーコードの残り", { exact: false })).toBeAbsent(),
      expect(text("実装予定")).toBeAbsent(),
    );
  });

  test("有効なら「有効」と残数と無効にするボタンを出し、残りが少なければ注意を出す", () => {
    scene(
      { update, view },
      given(loaded({ _tag: "Enabled", recoveryCodesRemaining: 2 })),
      expect(text("有効")).toExist(),
      expect(text("リカバリーコードの残り: 2 個")).toExist(),
      expect(role("button", { name: "無効にする" })).toExist(),
      expect(
        text(
          "リカバリーコードの残りが少なくなっています。使い切ると、認証アプリを失った時にログインできなくなります (再発行の導線はありません)。",
        ),
      ).toExist(),
    );
  });

  describe("パスキーの行", () => {
    const USED = {
      id: "passkey-1",
      createdAt: "2026-03-04T03:00:00.000Z",
      maybeLastUsedAt: Option.some("2026-05-06T03:00:00.000Z"),
    };

    test("登録できない 0 本の時は行を出さず、一覧は MFA の行だけになる", () => {
      scene(
        { update, view },
        given(loaded({ _tag: "Disabled" }, { _tag: "Hidden" })),
        expect(text("パスキー", { exact: true })).toBeAbsent(),
        expectAll(all.role("listitem")).toHaveCount(1),
      );
    });

    test("登録できる 0 本の時は、無いことと「登録する」を出す", () => {
      scene(
        { update, view },
        given(loaded({ _tag: "Disabled" }, { _tag: "Shown", passkeys: [], registrable: true })),
        expect(text("登録したパスキーはありません")).toExist(),
        expect(role("button", { name: "登録する" })).toExist(),
      );
    });

    test("MFA が有効なら、登録できても「登録する」を出さない", () => {
      scene(
        { update, view },
        given(
          loaded(
            { _tag: "Enabled", recoveryCodesRemaining: 8 },
            { _tag: "Shown", passkeys: [USED], registrable: true },
          ),
        ),
        expect(text("未使用")).toBeAbsent(),
        expect(role("button", { name: "登録する" })).toBeAbsent(),
      );
    });

    test("使っていないパスキーは最後に使った日を「未使用」と出す", () => {
      scene(
        { update, view },
        given(
          loaded(
            { _tag: "Disabled" },
            {
              _tag: "Shown",
              passkeys: [{ ...USED, maybeLastUsedAt: Option.none() }],
              registrable: false,
            },
          ),
        ),
        expect(text("最後に使った日 未使用")).toExist(),
        expect(role("button", { name: "登録する" })).toBeAbsent(),
      );
    });

    test("一覧を読めない時は、パスキーの行に取得できなかった旨を alert で出し、MFA の行は残す", () => {
      scene(
        { update, view },
        given(loaded({ _tag: "Disabled" }, { _tag: "Failed" })),
        expect(role("alert")).toHaveText("パスキーの一覧を取得できませんでした。"),
        expect(role("button", { name: "有効にする" })).toExist(),
      );
    });
  });
});
