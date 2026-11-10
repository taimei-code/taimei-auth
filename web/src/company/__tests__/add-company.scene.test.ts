import { describe, test } from "bun:test";
import { click, Command, expect, given, Mount, role, scene, selector } from "foldkit/scene";

import {
  DIALOG_RESOURCES_RELEASED_RESOLVER,
  FIRST_DIALOG_CLOSING_RESOLVERS,
  pendingDialogTransitionResolvers,
} from "../../shared/__tests__/dialog-resolvers";
import { Dialog } from "../../shared/ui/dialog-view";
import { init, Message, update, view } from "../add-company";

const PANEL = selector("#add-company-dialog-panel");

describe("事業所の追加の dialog", () => {
  test("開いている間は操作でき、閉じる animation の間は中身を操作できない", () => {
    const opened = update(init(), Message.ClickedAddCompany()).model;
    scene(
      { update, view },
      given(opened),
      Mount.resolve(Dialog.AcquireResources, Dialog.Message.SucceededAcquireResources()),
      Command.resolveAll(...pendingDialogTransitionResolvers(opened.dialog)),
      expect(PANEL).not.toHaveAttr("inert"),
      click(role("button", { name: "Close" })),
      expect(PANEL).toHaveAttr("inert"),
      Command.resolveAll(...FIRST_DIALOG_CLOSING_RESOLVERS, DIALOG_RESOURCES_RELEASED_RESOLVER),
      Mount.expectEnded(Dialog.AcquireResources),
      expect(PANEL).toBeAbsent(),
    );
  });
});
