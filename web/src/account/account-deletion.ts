import { Effect, Option, Schema } from "effect";
import { Command, Submodel, Update } from "foldkit";
import type { Html, HtmlBuilder } from "foldkit/html";
import { defineMessageUnion } from "foldkit/message";
import { modifyFields } from "foldkit/struct";
import { Trash2 } from "lucide";

import { signOut } from "../auth/sign-out";
import type { FailureMessages } from "../shared/failure-message";
import { leaveSpaAfterAccountDeleted } from "../shared/leave-spa";
import { type DeclaredFailure, SpaHttpClient } from "../shared/spa-http-client";
import { maybeRejectedMessage, Submission } from "../shared/submission";
import { buttonView } from "../shared/ui/button-view";
import { dialogClassNames } from "../shared/ui/class-names";
import { Dialog, type DialogMessage, type DialogModel, dialogView } from "../shared/ui/dialog-view";

const DeleteAccountFailure = Schema.Literals([
  "LastOwner",
  "NotFound",
  "Unauthorized",
  "Unexpected",
]);
type DeleteAccountFailure = typeof DeleteAccountFailure.Type;

export const Model = Schema.Struct({
  visit: Schema.Int,
  dialog: Dialog.Model,
  deletion: Submission,
});
export type Model = typeof Model.Type;

export const Message = defineMessageUnion({
  ClickedDeleteAccount: {},
  ClickedCancelDeletion: {},
  ClickedConfirmDeletion: {},
  GotDialogMessage: { message: Dialog.Message },
  SucceededDeleteAccount: { visit: Schema.Int },
  FailedDeleteAccount: { visit: Schema.Int, failure: DeleteAccountFailure },
});
export type Message = typeof Message.Type;

export const OutMessage = defineMessageUnion({
  RequiredSignIn: {},
});
export type OutMessage = typeof OutMessage.Type;

const DELETE_FAILED = "退会処理に失敗しました";

const DECLARED_FAILURE_MESSAGES: FailureMessages<DeclaredFailure<"account", "deleteAccount">> = {
  LastOwner: "所有者として残っている事業所があります。先に委譲または削除してください。",
  NotFound: DELETE_FAILED,
};

const FAILURE_MESSAGES = { ...DECLARED_FAILURE_MESSAGES, Unexpected: DELETE_FAILED };

const failedDeleteAccount = (visit: number, failure: DeleteAccountFailure) => () =>
  Effect.succeed(Message.FailedDeleteAccount({ visit, failure }));

export const DeleteAccount = Command.define("DeleteAccount", {
  args: { visit: Schema.Int },
  messages: [Message.SucceededDeleteAccount, Message.FailedDeleteAccount],
  execute: ({ visit }) =>
    Effect.gen(function* () {
      const client = yield* SpaHttpClient;
      yield* client.account.deleteAccount();
      yield* Effect.promise(() => signOut());
      yield* Effect.sync(leaveSpaAfterAccountDeleted);
      return Message.SucceededDeleteAccount({ visit });
    }).pipe(
      Effect.catchTags({
        LastOwner: failedDeleteAccount(visit, "LastOwner"),
        NotFound: failedDeleteAccount(visit, "NotFound"),
        Unauthorized: failedDeleteAccount(visit, "Unauthorized"),
        HttpClientError: failedDeleteAccount(visit, "Unexpected"),
        SchemaError: failedDeleteAccount(visit, "Unexpected"),
      }),
    ),
});

const DIALOG_ID = "account-deletion-dialog";

export const init = (visit: number): Model => ({
  visit,
  dialog: Dialog.init({ id: DIALOG_ID }),
  deletion: Submission.Idle(),
});

type UpdateReturn = Update.ReturnWithOutMessage<Model, Message, OutMessage, SpaHttpClient>;

const isDeleting = (model: Model) => Submission.guards.Submitting(model.deletion);

const toDialogMessage = (message: DialogMessage) => Message.GotDialogMessage({ message });

const foldDialogOutMessage = Dialog.OutMessage.match<Update.Step<Model, Message>>({
  Opened: () => (model) => ({ model }),
  Closed: () => (model) => ({ model }),
});

const dialogChild = {
  read: (model: Model) => Option.some(model.dialog),
  write: (model: Model, nextDialog: DialogModel) =>
    modifyFields(model, { dialog: () => nextDialog }),
  toParentMessage: toDialogMessage,
  foldOutMessage: foldDialogOutMessage,
};

const foldDialog = Update.foldChild({ ...dialogChild, update: Dialog.update });

const foldDialogOpen = Update.foldChildStep({ ...dialogChild, update: Dialog.open });

const foldDialogClose = Update.foldChildStep({ ...dialogChild, update: Dialog.close });

const forThisVisit = (model: Model, visit: number, next: () => UpdateReturn): UpdateReturn =>
  visit === model.visit && isDeleting(model) ? next() : { model };

const failDeletion = (model: Model, failure: DeleteAccountFailure): UpdateReturn =>
  failure === "Unauthorized"
    ? { model, outMessage: OutMessage.RequiredSignIn() }
    : foldDialogClose(
        modifyFields(model, {
          deletion: () => Submission.Rejected({ message: FAILURE_MESSAGES[failure] }),
        }),
      );

export const update = (model: Model, message: Message) =>
  Message.match<UpdateReturn>(message, {
    ClickedDeleteAccount: () => (isDeleting(model) ? { model } : foldDialogOpen(model)),
    ClickedCancelDeletion: () => (isDeleting(model) ? { model } : foldDialogClose(model)),
    ClickedConfirmDeletion: () =>
      isDeleting(model)
        ? { model }
        : {
            model: modifyFields(model, { deletion: () => Submission.Submitting() }),
            commands: [DeleteAccount({ visit: model.visit })],
          },
    GotDialogMessage: ({ message: dialogMessage }) =>
      isDeleting(model) && dialogMessage._tag === "RequestedClose"
        ? { model }
        : foldDialog(model, dialogMessage),
    SucceededDeleteAccount: () => ({ model }),
    FailedDeleteAccount: ({ visit, failure }) =>
      forThisVisit(model, visit, () => failDeletion(model, failure)),
  });

const dialogFooterView = (model: Model, h: HtmlBuilder<Message>): Html =>
  h.div(
    [h.Class(dialogClassNames.footer)],
    [
      buttonView(
        {
          label: "キャンセル",
          type: "button",
          look: "outlineInline",
          submission: Submission.Idle(),
          isBlocked: isDeleting(model),
          onClick: Message.ClickedCancelDeletion(),
        },
        h,
      ),
      buttonView(
        {
          label: "退会を確定する",
          type: "button",
          look: "destructive",
          submission: model.deletion,
          isBlocked: false,
          onClick: Message.ClickedConfirmDeletion(),
        },
        h,
      ),
    ],
  );

export const view = Submodel.defineView<Model, Message>((model, h) =>
  h.section(
    [h.Class("rounded-md border border-destructive/40")],
    [
      h.header(
        [h.Class("border-b border-destructive/40 bg-destructive/10 px-6 py-4")],
        [h.h2([h.Class("font-semibold text-destructive")], ["危険な操作"])],
      ),
      h.div(
        [h.Class("flex items-center justify-between gap-4 p-6")],
        [
          h.div(
            [],
            [
              h.p([h.Class("font-medium")], ["アカウントを削除"]),
              h.p(
                [h.Class("mt-1 text-sm text-muted-foreground")],
                ["すべてのデータが削除され、復元できません。"],
              ),
              ...Option.match(maybeRejectedMessage(model.deletion), {
                onNone: () => [],
                onSome: (failureMessage) => [
                  h.p(
                    [h.Role("alert"), h.Class("mt-2 text-sm text-destructive")],
                    [failureMessage],
                  ),
                ],
              }),
            ],
          ),
          buttonView(
            {
              label: "退会する",
              type: "button",
              look: "destructive",
              submission: Submission.Idle(),
              isBlocked: false,
              onClick: Message.ClickedDeleteAccount(),
              icon: Trash2,
            },
            h,
          ),
          dialogView(
            model.dialog,
            toDialogMessage,
            {
              title: "退会の確認",
              description: "本当にアカウントを削除しますか? この操作は取り消せません。",
              body: [dialogFooterView(model, h)],
              isClosingBlocked: isDeleting(model),
            },
            h,
          ),
        ],
      ),
    ],
  ),
);
