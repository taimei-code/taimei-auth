import { describe, test } from "bun:test";
import { click, Command, expect, given, Mount, role, scene } from "foldkit/scene";

import {
  DIALOG_RESOURCES_RELEASED_RESOLVER,
  FIRST_DIALOG_CLOSING_RESOLVERS,
  pendingDialogTransitionResolvers,
} from "../../shared/__tests__/dialog-resolvers";
import { Dialog } from "../../shared/ui/dialog-view";
import { DeleteAccount, init, Message, update, view } from "../account-deletion";

const VISIT = 1;

describe("退会の確認の dialog", () => {
  test("退会が拒まれた文言は、dialog が閉じ終わってから alert で出す", () => {
    const opened = update(init(VISIT), Message.ClickedDeleteAccount()).model;
    scene(
      { update, view },
      given(opened),
      Mount.resolve(Dialog.AcquireResources, Dialog.Message.SucceededAcquireResources()),
      Command.resolveAll(...pendingDialogTransitionResolvers(opened.dialog)),
      click(role("button", { name: "退会を確定する" })),
      Command.resolve(
        DeleteAccount,
        Message.FailedDeleteAccount({ visit: VISIT, failure: "LastOwner" }),
      ),
      expect(role("alert")).toBeAbsent(),
      Command.resolveAll(...FIRST_DIALOG_CLOSING_RESOLVERS, DIALOG_RESOURCES_RELEASED_RESOLVER),
      Mount.expectEnded(Dialog.AcquireResources),
      expect(role("alert")).toHaveText(
        "所有者として残っている事業所があります。先に委譲または削除してください。",
      ),
    );
  });
});
