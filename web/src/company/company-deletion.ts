import { Effect, Option, Schema } from "effect";
import { Command, Submodel, Update } from "foldkit";
import type { Html, HtmlBuilder } from "foldkit/html";
import { defineMessageUnion } from "foldkit/message";
import { modifyFields } from "foldkit/struct";

import type { FailureMessages } from "../shared/failure-message";
import { type DeclaredFailure, SpaHttpClient } from "../shared/spa-http-client";
import { Submission } from "../shared/submission";
import { buttonView } from "../shared/ui/button-view";
import {
  Dialog,
  type DialogMessage,
  ReportingDialog,
  reportingDialogFoldsOf,
  dialogFooterView,
  dialogView,
} from "../shared/ui/dialog-view";
import { NoticeTone } from "../shared/ui/toast-view";

const DeleteCompanyFailure = Schema.Literals([
  "Forbidden",
  "LastOwner",
  "Unauthorized",
  "Unexpected",
]);
type DeleteCompanyFailure = typeof DeleteCompanyFailure.Type;

export const OutMessage = defineMessageUnion({
  DeletedCompany: { companyName: Schema.String },
  Notified: { tone: NoticeTone, text: Schema.String },
  RequiredSignIn: {},
});
export type OutMessage = typeof OutMessage.Type;

export const Model = Schema.Struct({
  visit: Schema.Int,
  companyId: Schema.String,
  dialog: ReportingDialog.Model(OutMessage),
  deletion: Submission,
});
export type Model = typeof Model.Type;

export const Message = defineMessageUnion({
  ClickedDeleteCompany: {},
  ClickedCancelDeletion: {},
  ClickedConfirmDeletion: { companyName: Schema.String },
  GotDialogMessage: { message: Dialog.Message },
  SucceededDeleteCompany: { visit: Schema.Int, companyName: Schema.String },
  SucceededDeleteLastCompany: {},
  FailedDeleteCompany: { visit: Schema.Int, failure: DeleteCompanyFailure },
});
export type Message = typeof Message.Type;

const isDeletedCompany = Schema.is(Message.SucceededDeleteCompany);

export const visitOfCompanyChange = (message: Message): Option.Option<number> =>
  isDeletedCompany(message) ? Option.some(message.visit) : Option.none();

type ViewInputs = Readonly<{
  companyName: string;
  isLastCompany: boolean;
  isBlocked: boolean;
}>;

const DELETE_FAILED = "事業所の削除に失敗しました。";

const DECLARED_FAILURE_MESSAGES: FailureMessages<DeclaredFailure<"company", "delete">> = {
  Forbidden: "この事業所を削除する権限がないか、既に削除されています。",
  LastOwner: DELETE_FAILED,
};

const FAILURE_MESSAGES = { ...DECLARED_FAILURE_MESSAGES, Unexpected: DELETE_FAILED };

const failedDeleteCompany = (visit: number, failure: DeleteCompanyFailure) => () =>
  Effect.succeed(Message.FailedDeleteCompany({ visit, failure }));

export const DeleteCompany = Command.define("DeleteCompany", {
  args: { visit: Schema.Int, companyId: Schema.String, companyName: Schema.String },
  messages: [
    Message.SucceededDeleteCompany,
    Message.SucceededDeleteLastCompany,
    Message.FailedDeleteCompany,
  ],
  execute: ({ visit, companyId, companyName }) =>
    Effect.gen(function* () {
      const client = yield* SpaHttpClient;
      const { account_deleted } = yield* client.company.delete({ params: { companyId } });
      return account_deleted
        ? Message.SucceededDeleteLastCompany()
        : Message.SucceededDeleteCompany({ visit, companyName });
    }).pipe(
      Effect.catchTags({
        Forbidden: failedDeleteCompany(visit, "Forbidden"),
        LastOwner: failedDeleteCompany(visit, "LastOwner"),
        Unauthorized: failedDeleteCompany(visit, "Unauthorized"),
        HttpClientError: failedDeleteCompany(visit, "Unexpected"),
        SchemaError: failedDeleteCompany(visit, "Unexpected"),
      }),
    ),
});

const DIALOG_ID = "company-deletion-dialog";

export const init = (start: Readonly<{ visit: number; companyId: string }>): Model => ({
  ...start,
  dialog: ReportingDialog.init({ id: DIALOG_ID }),
  deletion: Submission.Idle(),
});

type UpdateReturn = Update.ReturnWithOutMessage<Model, Message, OutMessage, SpaHttpClient>;

export const isDeleting = (model: Model) => Submission.guards.Submitting(model.deletion);

const toDialogMessage = (message: DialogMessage) => Message.GotDialogMessage({ message });

const dialogFolds = reportingDialogFoldsOf<OutMessage>()({
  isClosingBlocked: isDeleting,
  toParentMessage: toDialogMessage,
  whenClosed: (model) => modifyFields(model, { deletion: () => Submission.Idle() }),
});

const forThisVisit = (model: Model, visit: number, next: () => UpdateReturn): UpdateReturn =>
  visit === model.visit && isDeleting(model) ? next() : { model };

const failDeletion = (model: Model, failure: DeleteCompanyFailure): UpdateReturn =>
  failure === "Unauthorized"
    ? { model, outMessage: OutMessage.RequiredSignIn() }
    : dialogFolds.closeThen(
        model,
        OutMessage.Notified({ tone: "Error", text: FAILURE_MESSAGES[failure] }),
      );

export const update = (model: Model, message: Message) =>
  Message.match<UpdateReturn>(message, {
    ClickedDeleteCompany: () => (isDeleting(model) ? { model } : dialogFolds.open(model)),
    ClickedCancelDeletion: () => (isDeleting(model) ? { model } : dialogFolds.close(model)),
    ClickedConfirmDeletion: ({ companyName }) =>
      isDeleting(model)
        ? { model }
        : {
            model: modifyFields(model, { deletion: () => Submission.Submitting() }),
            commands: [
              DeleteCompany({ visit: model.visit, companyId: model.companyId, companyName }),
            ],
          },
    GotDialogMessage: ({ message: dialogMessage }) => dialogFolds.fold(model, dialogMessage),
    SucceededDeleteCompany: ({ visit, companyName }) =>
      forThisVisit(model, visit, () =>
        dialogFolds.closeThen(model, OutMessage.DeletedCompany({ companyName })),
      ),
    SucceededDeleteLastCompany: () => ({ model }),
    FailedDeleteCompany: ({ visit, failure }) =>
      forThisVisit(model, visit, () => failDeletion(model, failure)),
  });

const dialogBodyView = (
  model: Model,
  { companyName, isLastCompany }: ViewInputs,
  h: HtmlBuilder<Message>,
): ReadonlyArray<Html> => [
  ...(isLastCompany
    ? [
        h.p(
          [h.Class("text-sm font-medium text-destructive")],
          ["これは最後の所属事業所です。削除するとアカウントも閉じられ、ログアウトされます。"],
        ),
      ]
    : []),
  dialogFooterView(
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
          label: "削除する",
          type: "button",
          look: "destructive",
          submission: model.deletion,
          isBlocked: false,
          onClick: Message.ClickedConfirmDeletion({ companyName }),
        },
        h,
      ),
    ],
    h,
  ),
];

export const view = Submodel.defineView<Model, Message, ViewInputs>((model, viewInputs, h) =>
  h.section(
    [h.Class("rounded-md border border-destructive/40")],
    [
      h.header(
        [h.Class("border-b border-destructive/40 bg-destructive/10 px-6 py-4")],
        [h.h2([h.Class("font-semibold text-destructive")], ["事業所を削除"])],
      ),
      h.div(
        [h.Class("flex items-center justify-between gap-4 p-6")],
        [
          h.p(
            [h.Class("text-sm text-muted-foreground")],
            ["削除すると、この事業所はメンバーの一覧から外れます。"],
          ),
          buttonView(
            {
              label: "削除する",
              type: "button",
              look: "destructive",
              submission: Submission.Idle(),
              isBlocked: viewInputs.isBlocked,
              onClick: Message.ClickedDeleteCompany(),
            },
            h,
          ),
          dialogView(
            model.dialog,
            toDialogMessage,
            {
              title: "事業所削除の確認",
              description: `「${viewInputs.companyName}」を削除します。この操作は元に戻せません。`,
              body: dialogBodyView(model, viewInputs, h),
              isClosingBlocked: isDeleting(model),
            },
            h,
          ),
        ],
      ),
    ],
  ),
);
