import { describe, expect, test } from "bun:test";
import { identity, Option } from "effect";

import {
  Dialog,
  type DialogMessage,
  type DialogModel,
  dialogFoldsOf,
  releaseDialogsIn,
} from "../ui/dialog-view";

type Holder = Readonly<{
  dialog: DialogModel;
  maybeOutMessageAfterClose: Option.Option<never>;
}>;

const folds = dialogFoldsOf<never>()<Holder, DialogMessage>({
  toParentMessage: identity,
  isClosingBlocked: () => false,
});

const closed = (id: string): Holder => ({
  dialog: Dialog.init({ id }),
  maybeOutMessageAfterClose: Option.none(),
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

  test("閉じている dialog と、dialog を持たない値には何も出さない", () => {
    expect(releasedDialogIds({ deletion: closed("closed"), name: "x", count: 1 })).toEqual([]);
    expect(releasedDialogIds(Option.none())).toEqual([]);
  });
});
