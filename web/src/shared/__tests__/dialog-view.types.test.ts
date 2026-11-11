import { expect, test } from "bun:test";

import { identity } from "effect";

import {
  Dialog,
  type DialogMessage,
  type DialogModel,
  dialogFoldsOf,
  type ReportingDialogModel,
} from "../ui/dialog-view";

// @ts-expect-error isAnimated は house の Dialog.init が固定し、呼び手は渡せない
const _unanimated = Dialog.init({ id: "dialog", isAnimated: false });

const _silentFoldsOverReportingDialog = dialogFoldsOf<
  // @ts-expect-error 閉じた後の報告を持つ dialog は reportingDialogFoldsOf で畳む (dialogFoldsOf は報告を出さない)
  Readonly<{ dialog: ReportingDialogModel<string> }>,
  DialogMessage
>({ toParentMessage: identity, isClosingBlocked: () => false });

const silentFolds = dialogFoldsOf<Readonly<{ dialog: DialogModel }>, DialogMessage>({
  toParentMessage: identity,
  isClosingBlocked: () => false,
});

const _reportFromSilentDialog = () =>
  // @ts-expect-error 閉じた後の報告を持たない dialog の fold は、報告を受け取れない
  silentFolds.closeThen({ dialog: Dialog.init({ id: "dialog" }) }, "report");

test("house の Dialog.init が作る dialog は、開閉の animation を持つ (渡せないことは typecheck で検査する)", () => {
  expect(Dialog.init({ id: "dialog" }).isAnimated).toBe(true);
});
