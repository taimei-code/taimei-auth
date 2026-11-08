import { describe, expect, test } from "bun:test";
import { Option, Redacted } from "effect";
import { Command, expectOutMessage, given, message, model, story } from "foldkit/story";

import * as MfaDisabling from "../../mfa/mfa-disabling";
import * as MfaEnrollment from "../../mfa/mfa-enrollment";
import { Dialog } from "../../shared/ui/dialog-view";
import { init, LoadMfaStatus, Message, type Model, OutMessage, update } from "../pages/Security";

const VISIT = 5;

const ENROLLMENT = {
  enrollmentId: "enrollment-1",
  totpUri: Redacted.make("otpauth://totp/taimei:me?secret=JBSWY3DPEHPK3PXP"),
  recoveryCodes: Redacted.make(["aaaaa-11111", "bbbbb-22222"]),
};

const enrollmentMessage = (message: MfaEnrollment.Message) =>
  Message.GotMfaEnrollmentMessage({ message });

const disablingMessage = (message: MfaDisabling.Message) =>
  Message.GotMfaDisablingMessage({ message });

const disabled = (): Model =>
  update(
    init(VISIT).model,
    Message.SucceededLoadMfaStatus({
      visit: VISIT,
      refreshNumber: 0,
      mfa: { _tag: "Disabled" },
      maybeTexts: Option.none(),
    }),
  ).model;

const send = (current: Model, ...messages: ReadonlyArray<Message>): Model =>
  messages.reduce((next, each) => update(next, each).model, current);

const verifying = (): Model =>
  send(
    disabled(),
    enrollmentMessage(MfaEnrollment.Message.ClickedEnable()),
    enrollmentMessage(
      MfaEnrollment.Message.SucceededEnrollMfa({ requestNumber: 1, enrollment: ENROLLMENT }),
    ),
    enrollmentMessage(MfaEnrollment.Message.ClickedNext()),
    enrollmentMessage(MfaEnrollment.Message.UpdatedCode({ value: "123 456" })),
  );

const showingRecoveryCodes = (): Model =>
  send(
    verifying(),
    enrollmentMessage(MfaEnrollment.Message.SubmittedCode()),
    enrollmentMessage(MfaEnrollment.Message.SucceededActivateMfa({ requestNumber: 2 })),
  );

const loadsStatus = (current: Model, next: Message) =>
  (update(current, next).commands ?? []).some((command) => command.name === LoadMfaStatus.name);

describe("セキュリティの画面を開く", () => {
  test("開くと MFA の状態を読み、失敗すると取得できなかった状態にする", () => {
    expect(init(VISIT).commands).toMatchObject([{ name: LoadMfaStatus.name }]);
    expect(
      update(
        init(VISIT).model,
        Message.FailedLoadMfaStatus({
          visit: VISIT,
          refreshNumber: 0,
          failure: "Unexpected",
          maybeTexts: Option.none(),
        }),
      ).model.mfa._tag,
    ).toBe("Failed");
  });
});

describe("MFA の有効化", () => {
  test("有効化の二重の submit は有効化を 1 回だけ送り、空白を除いたコードを送る", () => {
    const submit = enrollmentMessage(MfaEnrollment.Message.SubmittedCode());
    const first = update(verifying(), submit);
    const second = update(first.model, submit);
    expect(first.commands).toMatchObject([
      { name: MfaEnrollment.ActivateMfa.name, args: { code: "123456" } },
    ]);
    expect(second.commands ?? []).toEqual([]);
  });

  test("開く操作の二重の click では登録を 1 回だけ送る", () => {
    const click = enrollmentMessage(MfaEnrollment.Message.ClickedEnable());
    const first = update(disabled(), click);
    const second = update(first.model, click);
    expect(
      (first.commands ?? []).filter((command) => command.name === MfaEnrollment.EnrollMfa.name),
    ).toHaveLength(1);
    expect(
      (second.commands ?? []).filter((command) => command.name === MfaEnrollment.EnrollMfa.name),
    ).toHaveLength(0);
  });

  test("古い有効化の応答は、今の段を変えない", () => {
    const submitted = send(verifying(), enrollmentMessage(MfaEnrollment.Message.SubmittedCode()));
    const stale = send(
      submitted,
      enrollmentMessage(MfaEnrollment.Message.SucceededActivateMfa({ requestNumber: 1 })),
    );
    expect(stale.enrollment.step._tag).toBe("Verify");
  });

  test("リカバリーコードを出している間は状態を読み直さず、閉じると読み直して有効にした旨を知らせる", () => {
    const codes = showingRecoveryCodes();
    expect(codes.enrollment.step._tag).toBe("RecoveryCodes");
    expect(
      loadsStatus(codes, enrollmentMessage(MfaEnrollment.Message.UpdatedCode({ value: "1" }))),
    ).toBe(false);
    const closed = update(
      codes,
      enrollmentMessage(MfaEnrollment.Message.ClickedCloseAfterSavingCodes()),
    );
    expect((closed.commands ?? []).some((command) => command.name === LoadMfaStatus.name)).toBe(
      true,
    );
    story(
      update,
      given(closed.model),
      message(
        Message.SucceededLoadMfaStatus({
          visit: VISIT,
          refreshNumber: 1,
          mfa: { _tag: "Enabled", recoveryCodesRemaining: 2 },
          maybeTexts: Option.some({
            doneText: "多要素認証 (MFA) を有効にしました。",
            actionText: "多要素認証 (MFA) を有効にしました",
          }),
        }),
      ),
      expectOutMessage(
        OutMessage.Notified({ tone: "Success", text: "多要素認証 (MFA) を有効にしました。" }),
      ),
    );
  });

  test("リカバリーコードは Model の中で伏せたまま持つ", () => {
    const codes = showingRecoveryCodes();
    expect(JSON.stringify(codes)).not.toContain("aaaaa-11111");
    expect(String(codes.enrollment.maybeResumableEnrollment)).not.toContain("JBSWY3DPEHPK3PXP");
  });

  test("閉じて開き直すと、同じ登録で再開し登録を送り直さない", () => {
    const scanned = send(
      disabled(),
      enrollmentMessage(MfaEnrollment.Message.ClickedEnable()),
      enrollmentMessage(
        MfaEnrollment.Message.SucceededEnrollMfa({ requestNumber: 1, enrollment: ENROLLMENT }),
      ),
      enrollmentMessage(
        MfaEnrollment.Message.GotDialogMessage({
          message: { _tag: "RequestedClose" },
        }),
      ),
    );
    const reopened = update(scanned, enrollmentMessage(MfaEnrollment.Message.ClickedEnable()));
    expect(reopened.model.enrollment.step._tag).toBe("Scan");
    expect(
      (reopened.commands ?? []).filter((command) => command.name === MfaEnrollment.EnrollMfa.name),
    ).toHaveLength(0);
  });

  test("登録が入れ替わって失敗した後に開き直すと、登録をやり直す", () => {
    const changed = send(
      verifying(),
      enrollmentMessage(MfaEnrollment.Message.SubmittedCode()),
      enrollmentMessage(
        MfaEnrollment.Message.FailedActivateMfa({ requestNumber: 2, failure: "EnrollmentChanged" }),
      ),
    );
    expect(Option.isNone(changed.enrollment.maybeResumableEnrollment)).toBe(true);
  });
});

describe("MFA の無効化", () => {
  test("無効化の二重の submit は 1 回だけ送り、成功で状態を読み直す", () => {
    const entered = send(
      disabled(),
      disablingMessage(MfaDisabling.Message.ClickedDisable()),
      disablingMessage(MfaDisabling.Message.UpdatedCode({ value: "654321" })),
    );
    const submit = disablingMessage(MfaDisabling.Message.SubmittedCode());
    const first = update(entered, submit);
    const second = update(first.model, submit);
    expect(first.commands).toMatchObject([{ name: MfaDisabling.DisableMfa.name }]);
    expect(second.commands ?? []).toEqual([]);
    expect(
      loadsStatus(
        first.model,
        disablingMessage(MfaDisabling.Message.SucceededDisableMfa({ requestNumber: 1 })),
      ),
    ).toBe(true);
  });

  test("古い状態の読み直しの結果は、新しい読み直しの後の状態を戻さない", () => {
    const enabled = update(
      disabled(),
      Message.SucceededLoadMfaStatus({
        visit: VISIT,
        refreshNumber: 0,
        mfa: { _tag: "Enabled", recoveryCodesRemaining: 10 },
        maybeTexts: Option.none(),
      }),
    ).model;
    const reloaded = send(
      enabled,
      disablingMessage(MfaDisabling.Message.ClickedDisable()),
      disablingMessage(MfaDisabling.Message.UpdatedCode({ value: "654321" })),
      disablingMessage(MfaDisabling.Message.SubmittedCode()),
      disablingMessage(MfaDisabling.Message.SucceededDisableMfa({ requestNumber: 1 })),
    );
    const stale = update(
      reloaded,
      Message.SucceededLoadMfaStatus({
        visit: VISIT,
        refreshNumber: 0,
        mfa: { _tag: "Enabled", recoveryCodesRemaining: 10 },
        maybeTexts: Option.none(),
      }),
    ).model;
    expect(stale.refreshNumber).toBe(1);
    expect(stale.mfa).toEqual(enabled.mfa);
  });

  test("無効化の失敗は MFA の画面どうしで同じ文言を出す", () => {
    const failed = send(
      disabled(),
      disablingMessage(MfaDisabling.Message.ClickedDisable()),
      disablingMessage(MfaDisabling.Message.UpdatedCode({ value: "000000" })),
      disablingMessage(MfaDisabling.Message.SubmittedCode()),
      disablingMessage(
        MfaDisabling.Message.FailedDisableMfa({ requestNumber: 1, failure: "InvalidCode" }),
      ),
    );
    expect(failed.disabling.submission).toEqual({
      _tag: "Rejected",
      message: "入力されたコードが正しくありません。",
    });
  });
});

describe("session の切れた操作", () => {
  test("状態の取得・有効化・無効化が Unauthorized を受けると、ログインを求める", () => {
    expect(
      update(
        init(VISIT).model,
        Message.FailedLoadMfaStatus({
          visit: VISIT,
          refreshNumber: 0,
          failure: "Unauthorized",
          maybeTexts: Option.none(),
        }),
      ).outMessage,
    ).toEqual(OutMessage.RequiredSignIn());
    const submitted = send(verifying(), enrollmentMessage(MfaEnrollment.Message.SubmittedCode()));
    expect(
      update(
        submitted,
        enrollmentMessage(
          MfaEnrollment.Message.FailedActivateMfa({ requestNumber: 2, failure: "Unauthorized" }),
        ),
      ).outMessage,
    ).toEqual(OutMessage.RequiredSignIn());
    const disabling = send(
      disabled(),
      disablingMessage(MfaDisabling.Message.ClickedDisable()),
      disablingMessage(MfaDisabling.Message.UpdatedCode({ value: "654321" })),
      disablingMessage(MfaDisabling.Message.SubmittedCode()),
    );
    expect(
      update(
        disabling,
        disablingMessage(
          MfaDisabling.Message.FailedDisableMfa({ requestNumber: 1, failure: "Unauthorized" }),
        ),
      ).outMessage,
    ).toEqual(OutMessage.RequiredSignIn());
  });

  test("リカバリーコードを出している間に閉じる要求が来ても、有効化の処理中は捨てる", () => {
    const submitted = send(verifying(), enrollmentMessage(MfaEnrollment.Message.SubmittedCode()));
    const closeRequested = update(
      submitted,
      enrollmentMessage(
        MfaEnrollment.Message.GotDialogMessage({ message: { _tag: "RequestedClose" } }),
      ),
    ).model;
    expect(closeRequested.enrollment.dialog).toEqual(submitted.enrollment.dialog);
  });
});

describe("登録と状態の取得の失敗", () => {
  test("登録が拒まれると、MFA の画面どうしで同じ文言を dialog に出す", () => {
    story(
      update,
      given(disabled()),
      message(enrollmentMessage(MfaEnrollment.Message.ClickedEnable())),
      Command.resolve(Dialog.ShowDialog, Dialog.Message.SucceededShowDialog()),
      Command.resolve(
        MfaEnrollment.EnrollMfa,
        MfaEnrollment.Message.FailedEnrollMfa({ requestNumber: 1, failure: "AlreadyEnabled" }),
      ),
      model((next) => {
        expect(next.enrollment.step).toEqual({
          _tag: "Failed",
          message: "多要素認証 (MFA) はすでに有効です。ページを再読み込みしてください。",
        });
      }),
    );
  });

  test("登録の後に QR を描き、描けなければ描けなかった状態にする", () => {
    story(
      update,
      given(disabled()),
      message(enrollmentMessage(MfaEnrollment.Message.ClickedEnable())),
      Command.resolve(Dialog.ShowDialog, Dialog.Message.SucceededShowDialog()),
      Command.resolve(
        MfaEnrollment.EnrollMfa,
        MfaEnrollment.Message.SucceededEnrollMfa({ requestNumber: 1, enrollment: ENROLLMENT }),
      ),
      Command.resolve(
        MfaEnrollment.DrawQrCode,
        MfaEnrollment.Message.FailedDrawQrCode({ enrollmentId: ENROLLMENT.enrollmentId }),
      ),
      model((next) => {
        expect(next.enrollment.step._tag).toBe("Scan");
        expect(next.enrollment.qrCode._tag).toBe("Unavailable");
      }),
    );
  });

  test("QR を描けたら、その画像を伏せたまま持つ", () => {
    story(
      update,
      given(disabled()),
      message(enrollmentMessage(MfaEnrollment.Message.ClickedEnable())),
      Command.resolve(Dialog.ShowDialog, Dialog.Message.SucceededShowDialog()),
      Command.resolve(
        MfaEnrollment.EnrollMfa,
        MfaEnrollment.Message.SucceededEnrollMfa({ requestNumber: 1, enrollment: ENROLLMENT }),
      ),
      Command.resolve(
        MfaEnrollment.DrawQrCode,
        MfaEnrollment.Message.SucceededDrawQrCode({
          enrollmentId: ENROLLMENT.enrollmentId,
          dataUrl: Redacted.make("data:image/png;base64,AAAA"),
        }),
      ),
      model((next) => {
        expect(next.enrollment.qrCode._tag).toBe("Drawn");
        expect(JSON.stringify(next.enrollment.qrCode)).not.toContain("base64");
      }),
    );
  });

  test("読み直しが失敗すると状態を残し、再読み込みの案内を出す", () => {
    story(
      update,
      given({ ...disabled(), refreshNumber: 1 }),
      message(
        Message.FailedLoadMfaStatus({
          visit: VISIT,
          refreshNumber: 1,
          failure: "Unexpected",
          maybeTexts: Option.some({
            doneText: "多要素認証 (MFA) を無効にしました。",
            actionText: "多要素認証 (MFA) を無効にしました",
          }),
        }),
      ),
      model((next) => {
        expect(next.mfa._tag).toBe("Disabled");
      }),
      expectOutMessage(
        OutMessage.Notified({
          tone: "Error",
          text: "多要素認証 (MFA) を無効にしましたが、表示の更新に失敗しました。ページを再読み込みしてください。",
        }),
      ),
    );
  });

  test("古い画面の状態の応答は、今の画面を変えない", () => {
    story(
      update,
      given(init(VISIT).model),
      message(
        Message.SucceededLoadMfaStatus({
          visit: VISIT - 1,
          refreshNumber: 0,
          mfa: { _tag: "Disabled" },
          maybeTexts: Option.none(),
        }),
      ),
      model((next) => {
        expect(next.mfa._tag).toBe("Loading");
      }),
    );
  });
});
