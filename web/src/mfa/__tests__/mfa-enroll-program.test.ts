import { describe, expect, test } from "bun:test";
import { Option } from "effect";
import { Command, given, message, model, story } from "foldkit/story";
import { Dialog } from "@foldkit/ui";

import {
  ActivateMfa,
  DrawQrCode,
  EnrollMfa,
  EnrollStep,
  init,
  Message,
  type Model,
  ReportEnabled,
  update,
  WaitBeforeHidingCopyResult,
} from "../mfa-enroll-program";

const enrollment = {
  totp_uri: "otpauth://totp/taimei:user?secret=JBSWY3DPEHPK3PXP&issuer=taimei",
  recovery_codes: ["aaaaa-11111", "bbbbb-22222"],
  enrollment_id: "enrollment-1",
};

const closed = init().model;

const scanning: Model = {
  ...closed,
  dialog: Dialog.boot({ id: closed.dialog.id }).model,
  step: EnrollStep.Scan({ enrollment }),
  resumableEnrollment: Option.some(enrollment),
};

const verifying: Model = { ...scanning, step: EnrollStep.Verify({ enrollment }), code: "123456" };

const showingRecoveryCodes: Model = {
  ...scanning,
  step: EnrollStep.RecoveryCodes({ recoveryCodes: enrollment.recovery_codes }),
  resumableEnrollment: Option.none(),
};

const dialogShown = Command.resolve(Dialog.ShowDialog, Dialog.Message.SucceededShowDialog());

const dialogClosed = Command.resolve(Dialog.CloseDialog, Dialog.Message.CompletedCloseDialog());

describe("MFA の有効化の画面", () => {
  test("開くと登録を 1 回要求し、登録できたら QR を描いて読み取りの段階に進む", () => {
    story(
      update,
      given(closed),
      message(Message.ClickedOpen()),
      dialogShown,
      Command.resolve(EnrollMfa, Message.SucceededEnroll({ enrollment })),
      model((current) => {
        expect(current.step).toEqual(EnrollStep.Scan({ enrollment }));
        expect(current.resumableEnrollment).toEqual(Option.some(enrollment));
      }),
      Command.resolve(
        DrawQrCode,
        Message.SucceededDrawQrCode({ dataUrl: "data:image/png;base64,x" }),
      ),
    );
  });

  test("閉じて開き直すと同じ登録と描いた QR を使い、登録も QR の描き直しも要求しない", () => {
    story(
      update,
      given({
        ...closed,
        resumableEnrollment: Option.some(enrollment),
        qrCode: { _tag: "Drawn", dataUrl: "data:image/png;base64,x" },
      }),
      message(Message.ClickedOpen()),
      Command.expectExact(Dialog.ShowDialog),
      dialogShown,
      model((current) => {
        expect(current.step).toEqual(EnrollStep.Scan({ enrollment }));
        expect(current.qrCode).toEqual({ _tag: "Drawn", dataUrl: "data:image/png;base64,x" });
      }),
    );
  });

  test("登録の応答を待つ間は、閉じる要求を受けても閉じない", () => {
    story(
      update,
      given({ ...scanning, step: EnrollStep.Starting() }),
      message(Message.GotDialogMessage({ message: Dialog.Message.RequestedClose() })),
      Command.expectNone(),
      model((current) => {
        expect(current.dialog.isOpen).toBe(true);
      }),
    );
  });

  test("有効化の送信中は、閉じる要求も 2 回目の送信も受けない", () => {
    story(
      update,
      given({ ...verifying, submitting: true }),
      message(Message.SubmittedCode()),
      Command.expectNone(),
      message(Message.GotDialogMessage({ message: Dialog.Message.RequestedClose() })),
      Command.expectNone(),
      model((current) => {
        expect(current.submitting).toBe(true);
        expect(current.dialog.isOpen).toBe(true);
      }),
    );
  });

  test("確認コードを送ると、有効化を 1 回要求する", () => {
    story(
      update,
      given(verifying),
      message(Message.SubmittedCode()),
      Command.expectExact(ActivateMfa({ code: "123456", enrollment })),
      Command.resolve(ActivateMfa, Message.SucceededActivate()),
    );
  });

  test("有効化できたらリカバリーコードを出し、閉じるまで host に知らせない", () => {
    story(
      update,
      given(verifying),
      message(Message.SubmittedCode()),
      Command.resolve(ActivateMfa, Message.SucceededActivate()),
      model((current) => {
        expect(current.step).toEqual(
          EnrollStep.RecoveryCodes({ recoveryCodes: enrollment.recovery_codes }),
        );
        expect(current.resumableEnrollment).toEqual(Option.none());
      }),
      Command.expectNone(),
    );
  });

  test("リカバリーコードを閉じると、host に有効化を知らせる", () => {
    story(
      update,
      given(showingRecoveryCodes),
      message(Message.ClickedCloseAfterSavingCodes()),
      dialogClosed,
      Command.resolve(ReportEnabled, Message.CompletedReportEnabled()),
    );
  });

  test("server の登録が置き換わったと失敗したら、次に開いたときに登録をやり直す", () => {
    story(
      update,
      given(verifying),
      message(Message.SubmittedCode()),
      Command.resolve(
        ActivateMfa,
        Message.FailedActivate({
          message: "登録情報が更新されました。もう一度登録を開始してください。",
          enrollmentOnServer: "replaced",
        }),
      ),
      model((current) => {
        expect(current.resumableEnrollment).toEqual(Option.none());
        expect(current.codeError).toEqual(
          Option.some("登録情報が更新されました。もう一度登録を開始してください。"),
        );
      }),
    );
  });

  test("コピーの結果を出し直すと、表示の時間切れを数え直す", () => {
    story(
      update,
      given({ ...scanning, copyResultShownCount: 1, copyResult: { _tag: "NotCopied" } }),
      message(Message.SucceededCopy()),
      Command.expectExact(WaitBeforeHidingCopyResult({ shownCount: 2 })),
      Command.resolve(
        WaitBeforeHidingCopyResult,
        Message.CompletedCopyResultDisplay({ shownCount: 2 }),
      ),
      model((current) => {
        expect(current.copyResult).toEqual({ _tag: "Idle" });
      }),
    );
  });

  test("前に出した表示の時間切れでは、出し直した表示を消さない", () => {
    story(
      update,
      given({ ...scanning, copyResultShownCount: 3, copyResult: { _tag: "Copied" } }),
      message(Message.CompletedCopyResultDisplay({ shownCount: 2 })),
      model((current) => {
        expect(current.copyResult).toEqual({ _tag: "Copied" });
      }),
    );
  });
});
