import { describe, expect, test } from "bun:test";
import { identity, Option } from "effect";

import {
  Dialog,
  type DialogMessage,
  type DialogModel,
  dialogFoldsOf,
  releaseDialogsIn,
  ReportingDialog,
  reportingDialogFoldsOf,
} from "../ui/dialog-view";

type Holder = Readonly<{ dialog: DialogModel }>;

const folds = dialogFoldsOf<Holder, DialogMessage>({
  toParentMessage: identity,
  isClosingBlocked: () => false,
});

const closed = (id: string): Holder => ({ dialog: Dialog.init({ id }) });

const reportingFolds = reportingDialogFoldsOf<string>()({
  toParentMessage: identity<DialogMessage>,
  isClosingBlocked: () => false,
});

const opened = (id: string): Holder => folds.open(closed(id)).model;

const closing = (id: string): Holder => folds.close(opened(id)).model;

const releasedDialogIds = (discarded: unknown) =>
  releaseDialogsIn(discarded).map(({ name, args }) => ({ name, args }));

const release = (id: string) => ({ name: Dialog.ReleaseDialogResources.name, args: { id } });

describe("捨てる model の中の dialog の資源を放す", () => {
  test("Option と配列と入れ子の Submodel の中にある、開いた dialog を放す", () => {
    expect(
      releasedDialogIds(
        Option.some({
          _tag: "Members",
          model: { removal: opened("in-submodel"), transfers: [opened("in-array")] },
        }),
      ),
    ).toEqual([release("in-submodel"), release("in-array")]);
  });

  test("閉じる animation の途中の dialog も放す", () => {
    expect(releasedDialogIds({ deletion: closing("closing") })).toEqual([release("closing")]);
  });

  test("閉じた後の報告を持つ dialog も放す", () => {
    const reporting = reportingFolds.open({ dialog: ReportingDialog.init({ id: "reporting" }) });
    expect(releasedDialogIds({ removal: reporting.model })).toEqual([release("reporting")]);
  });

  test("閉じている dialog と、dialog を持たない値には何も出さない", () => {
    expect(releasedDialogIds({ deletion: closed("closed"), name: "x", count: 1 })).toEqual([]);
    expect(releasedDialogIds(Option.none())).toEqual([]);
  });
});
