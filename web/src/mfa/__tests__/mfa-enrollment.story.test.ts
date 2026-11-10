import { describe, expect, test } from "bun:test";
import { Redacted } from "effect";
import { given, message, model, story } from "foldkit/story";

import * as CopyResult from "../copy-result";
import { Dialog } from "../../shared/ui/dialog-view";
import { init, Message, type Model, OutMessage, update } from "../mfa-enrollment";

const ENROLLMENT = {
  enrollmentId: "enrollment-1",
  totpUri: Redacted.make("otpauth://totp/taimei:me?secret=JBSWY3DPEHPK3PXP"),
  recoveryCodes: Redacted.make(["aaaaa-11111", "bbbbb-22222"]),
};

const FIRST_COPY_AT = 1000;
const SECOND_COPY_AT = 2000;

const copyMessage = (copy: CopyResult.Message) => Message.GotCopyResultMessage({ message: copy });

const send = (current: Model, ...messages: ReadonlyArray<Message>): Model =>
  messages.reduce((next, each) => update(next, each).model, current);

const copyResultOnScan = (current: Model): string =>
  current.step._tag === "Scan" ? current.step.copy._tag : `not on Scan: ${current.step._tag}`;

const copiedOnScan = (): Model =>
  send(
    init(),
    Message.ClickedEnable(),
    Message.SucceededEnrollMfa({ requestNumber: 1, enrollment: ENROLLMENT }),
    copyMessage(CopyResult.Message.ClickedCopy({ text: Redacted.make("JBSWY3DPEHPK3PXP") })),
    copyMessage(CopyResult.Message.SucceededCopyText({ shownAt: FIRST_COPY_AT })),
  );

describe("MFA の有効化の dialog のコピーの結果", () => {
  test("QR の段階でコピーした後に次へと戻るを押すと、コピーの結果は出ていない", () => {
    story(
      update,
      given(copiedOnScan()),
      model((current) => {
        expect(copyResultOnScan(current)).toBe("Copied");
      }),
      message(Message.ClickedNext()),
      message(Message.ClickedBack()),
      model((current) => {
        expect(copyResultOnScan(current)).toBe("Idle");
      }),
    );
  });

  test("戻った後にもう一度コピーすると、前のコピーの待ちは新しい結果を消さない", () => {
    story(
      update,
      given(
        send(
          copiedOnScan(),
          Message.ClickedNext(),
          Message.ClickedBack(),
          copyMessage(CopyResult.Message.SucceededCopyText({ shownAt: SECOND_COPY_AT })),
        ),
      ),
      message(
        copyMessage(
          CopyResult.Message.CompletedWaitBeforeHidingCopyResult({ shownAt: FIRST_COPY_AT }),
        ),
      ),
      model((current) => {
        expect(copyResultOnScan(current)).toBe("Copied");
      }),
      message(
        copyMessage(
          CopyResult.Message.CompletedWaitBeforeHidingCopyResult({ shownAt: SECOND_COPY_AT }),
        ),
      ),
      model((current) => {
        expect(copyResultOnScan(current)).toBe("Idle");
      }),
    );
  });
});

describe("MFA を有効にした後の報告", () => {
  const submitted = (): Model =>
    send(
      init(),
      Message.ClickedEnable(),
      Message.SucceededEnrollMfa({ requestNumber: 1, enrollment: ENROLLMENT }),
      Message.ClickedNext(),
      Message.UpdatedCode({ value: "123456" }),
      Message.SubmittedCode(),
    );

  test("dialog が見えている間に有効化が通ると、リカバリーコードを出し、閉じ終わるまで報告しない", () => {
    const activated = update(
      submitted(),
      Message.SucceededActivateMfa({ requestNumber: submitted().requestNumber }),
    );
    expect(activated.model.step._tag).toBe("RecoveryCodes");
    expect(activated.outMessage).toBeUndefined();
  });

  test("リカバリーコードを出している dialog の要素が無くなると、有効にしたことをそこで報告する", () => {
    const showingCodes = send(
      submitted(),
      Message.SucceededActivateMfa({ requestNumber: submitted().requestNumber }),
    );
    const unmounted = update(
      showingCodes,
      Message.GotDialogMessage({ message: Dialog.Message.Unmounted() }),
    );
    expect(unmounted.outMessage).toEqual(OutMessage.ClosedAfterEnabling());
    expect(unmounted.model.step._tag).toBe("Starting");
  });

  test("有効化の途中で dialog の要素が無くなっていた時は、有効にしたことをその場で報告する", () => {
    const unmounted = send(
      submitted(),
      Message.GotDialogMessage({ message: Dialog.Message.Unmounted() }),
    );
    const activated = update(
      unmounted,
      Message.SucceededActivateMfa({ requestNumber: unmounted.requestNumber }),
    );
    expect(activated.outMessage).toEqual(OutMessage.ClosedAfterEnabling());
    expect(activated.model.step._tag).toBe("Starting");
  });
});
