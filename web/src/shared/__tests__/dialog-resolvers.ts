import { Animation } from "@foldkit/ui";
import { Command } from "foldkit/story";

import { Dialog, type DialogModel } from "../ui/dialog-view";

const FIRST_OPENING_GENERATION = 1;
const FIRST_CLOSING_GENERATION = 2;

const transitionResolvers = (generation: number) =>
  [
    [
      Animation.WaitForPaint({ generation }),
      Animation.Message.CompletedWaitForPaint({ generation }),
    ],
    [Animation.WaitForAnimationSettled, Animation.Message.EndedAnimation({ generation })],
  ] as const;

export const pendingDialogTransitionResolvers = (dialog: DialogModel) =>
  transitionResolvers(dialog.animation.transitionGeneration);

export const FIRST_DIALOG_OPENING = [
  Command.expectHas(Dialog.ShowDialog),
  Command.resolveAll(
    [Dialog.ShowDialog, Dialog.Message.SucceededShowDialog()],
    ...transitionResolvers(FIRST_OPENING_GENERATION),
  ),
] as const;

export const FIRST_DIALOG_CLOSING_MESSAGES = [
  Dialog.Message.GotAnimationMessage({
    message: Animation.Message.CompletedWaitForPaint({ generation: FIRST_CLOSING_GENERATION }),
  }),
  Dialog.Message.GotAnimationMessage({
    message: Animation.Message.EndedAnimation({ generation: FIRST_CLOSING_GENERATION }),
  }),
] as const;

export const FIRST_DIALOG_CLOSING_RESOLVERS = transitionResolvers(FIRST_CLOSING_GENERATION);

export const DIALOG_RESOURCES_RELEASED_RESOLVER = [
  Dialog.CloseDialog,
  Dialog.Message.CompletedCloseDialog(),
] as const;

export const FIRST_DIALOG_CLOSING = [
  Command.expectHas(Animation.WaitForPaint({ generation: FIRST_CLOSING_GENERATION })),
  Command.resolveAll(...FIRST_DIALOG_CLOSING_RESOLVERS),
] as const;

export const DIALOG_RESOURCES_RELEASED = Command.resolve(...DIALOG_RESOURCES_RELEASED_RESOLVER);
