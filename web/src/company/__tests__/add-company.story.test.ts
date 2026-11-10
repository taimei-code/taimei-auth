import { describe, expect, test } from "bun:test";
import { Option } from "effect";
import { expectNoOutMessage, expectOutMessage, given, message, model, story } from "foldkit/story";

import {
  DIALOG_RESOURCES_RELEASED,
  FIRST_DIALOG_CLOSING,
} from "../../shared/__tests__/dialog-resolvers";
import { Dialog, isDialogVisible } from "../../shared/ui/dialog-view";
import { init, Message, type Model, OutMessage, update } from "../add-company";

const send = (current: Model, ...messages: ReadonlyArray<Message>): Model =>
  messages.reduce((next, each) => update(next, each).model, current);

const dialogMessage = (dialog: typeof Dialog.Message.Type) =>
  Message.GotDialogMessage({ message: dialog });

const submitting = (): Model =>
  send(
    init(),
    Message.ClickedAddCompany(),
    Message.UpdatedName({ value: "新事業所" }),
    Message.SubmittedAddCompanyForm(),
  );

const ADDED = Message.SucceededAddCompany({ requestNumber: 1, companyName: "新事業所" });

describe("dialog を閉じた結果の報告", () => {
  test("作成の成功は、dialog が閉じ終わるまで入力を残して報告せず、閉じ終わりに 1 回だけ報告して入力を消す", () => {
    story(
      update,
      given(submitting()),
      message(ADDED),
      expectNoOutMessage(),
      model((closing) => {
        expect(closing.nameDraft).toBe("新事業所");
        expect(isDialogVisible(closing.dialog)).toBe(true);
      }),
      ...FIRST_DIALOG_CLOSING,
      expectOutMessage(OutMessage.AddedCompany({ companyName: "新事業所" })),
      model((closed) => {
        expect(closed.nameDraft).toBe("");
        expect(isDialogVisible(closed.dialog)).toBe(false);
      }),
      DIALOG_RESOURCES_RELEASED,
      expectNoOutMessage(),
    );
  });

  test("閉じる animation の間に届いた submit は送らない", () => {
    const closing = send(submitting(), ADDED);
    expect(update(closing, Message.SubmittedAddCompanyForm()).commands ?? []).toEqual([]);
  });

  test("送信の途中で dialog の要素が無くなっても、作成の成功を捨てずにその場で報告する", () => {
    const unmounted = send(
      submitting(),
      dialogMessage(Dialog.Message.Unmounted()),
      dialogMessage(Dialog.Message.CompletedReleaseDialogResources()),
    );
    expect(unmounted.submission._tag).toBe("Submitting");
    const added = update(unmounted, ADDED);
    expect(added.outMessage).toEqual(OutMessage.AddedCompany({ companyName: "新事業所" }));
    expect(added.model.nameDraft).toBe("");
  });

  test.each([
    ["Unmounted", Dialog.Message.Unmounted()],
    ["FailedAcquireResources", Dialog.Message.FailedAcquireResources()],
    ["FailedShowDialog", Dialog.Message.FailedShowDialog()],
  ] as const)("閉じる途中の dialog が %s で閉じた状態へ戻ると、そこで報告する", (_name, reset) => {
    const closing = send(submitting(), ADDED);
    const closed = update(closing, dialogMessage(reset));
    expect(closed.outMessage).toEqual(OutMessage.AddedCompany({ companyName: "新事業所" }));
    expect(closed.model.submission._tag).toBe("Idle");
    expect(isDialogVisible(closed.model.dialog)).toBe(false);
  });

  test("開いている dialog の要素が無くなると、置いてあった報告をそこで出す", () => {
    const opened = send(init(), Message.ClickedAddCompany());
    const held = {
      ...opened,
      maybeOutMessageAfterClose: Option.some(OutMessage.AddedCompany({ companyName: "新事業所" })),
    };
    const unmounted = update(held, dialogMessage(Dialog.Message.Unmounted()));
    expect(unmounted.outMessage).toEqual(OutMessage.AddedCompany({ companyName: "新事業所" }));
    expect(unmounted.model.maybeOutMessageAfterClose._tag).toBe("None");
  });

  test("閉じる途中で開き直すと、前の結果を開く時に報告し、後の閉じ終わりで出し直さない", () => {
    const closing = send(submitting(), ADDED);
    const reopened = update(closing, Message.ClickedAddCompany());
    expect(reopened.outMessage).toEqual(OutMessage.AddedCompany({ companyName: "新事業所" }));
    expect(reopened.model.nameDraft).toBe("");
    expect(reopened.model.maybeOutMessageAfterClose._tag).toBe("None");
  });
});
