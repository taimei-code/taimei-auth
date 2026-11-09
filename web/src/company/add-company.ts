import { Effect, Number, Option, Schema, String, pipe } from "effect";
import { Command, Submodel, Update } from "foldkit";
import type { Html, HtmlBuilder } from "foldkit/html";
import { defineMessageUnion } from "foldkit/message";
import { modifyFields } from "foldkit/struct";
import { Plus } from "lucide";

import { OrgCodeSchema } from "@core/company/company-contract";
import type { OrgCode } from "@core/company/org-code";

import { SpaHttpClient } from "../shared/spa-http-client";
import { maybeRejectedMessage, Submission } from "../shared/submission";
import { buttonView } from "../shared/ui/button-view";
import {
  Dialog,
  type DialogMessage,
  type DialogModel,
  dialogFoldsOf,
  dialogFooterView,
  dialogView,
} from "../shared/ui/dialog-view";
import { inputView } from "../shared/ui/input-view";
import { radioFieldsetView } from "../shared/ui/radio-fieldset-view";
import { orgCodeOptionsIn } from "./org-code-options";

export const Model = Schema.Struct({
  dialog: Dialog.Model,
  nameDraft: Schema.String,
  orgCode: OrgCodeSchema,
  submission: Submission,
  requestNumber: Schema.Int,
});
export type Model = typeof Model.Type;

const AddCompanyFailure = Schema.Literals(["Unauthorized", "Unexpected"]);

export const Message = defineMessageUnion({
  ClickedAddCompany: {},
  GotDialogMessage: { message: Dialog.Message },
  UpdatedName: { value: Schema.String },
  SelectedOrgCode: { orgCode: OrgCodeSchema },
  SubmittedAddCompanyForm: {},
  SucceededAddCompany: { requestNumber: Schema.Int, companyName: Schema.String },
  FailedAddCompany: { requestNumber: Schema.Int, failure: AddCompanyFailure },
});
export type Message = typeof Message.Type;

export const OutMessage = defineMessageUnion({
  AddedCompany: { companyName: Schema.String },
  RequiredSignIn: {},
});
export type OutMessage = typeof OutMessage.Type;

const ADD_FAILED = "事業所の作成に失敗しました。";

const DEFAULT_ORG_CODE: OrgCode = "CORPORATE";

const ORG_CODE_OPTIONS = orgCodeOptionsIn(["CORPORATE", "PERSONAL"]);

const failedAddCompany = (requestNumber: number, failure: typeof AddCompanyFailure.Type) => () =>
  Effect.succeed(Message.FailedAddCompany({ requestNumber, failure }));

export const AddCompany = Command.define("AddCompany", {
  args: { requestNumber: Schema.Int, name: Schema.String, orgCode: OrgCodeSchema },
  messages: [Message.SucceededAddCompany, Message.FailedAddCompany],
  execute: ({ requestNumber, name, orgCode }) =>
    Effect.gen(function* () {
      const client = yield* SpaHttpClient;
      yield* client.company.add({ payload: { name, org_code: orgCode } });
      return Message.SucceededAddCompany({ requestNumber, companyName: name });
    }).pipe(
      Effect.catchTags({
        Unauthorized: failedAddCompany(requestNumber, "Unauthorized"),
        HttpClientError: failedAddCompany(requestNumber, "Unexpected"),
        SchemaError: failedAddCompany(requestNumber, "Unexpected"),
      }),
    ),
});

const DIALOG_ID = "add-company-dialog";

export const init = (): Model => ({
  dialog: Dialog.init({ id: DIALOG_ID }),
  nameDraft: "",
  orgCode: DEFAULT_ORG_CODE,
  submission: Submission.Idle(),
  requestNumber: 0,
});

type UpdateReturn = Update.ReturnWithOutMessage<Model, Message, OutMessage, SpaHttpClient>;

const isSubmitting = (model: Model) => Submission.guards.Submitting(model.submission);

const clearedForm = (model: Model): Model =>
  modifyFields(model, {
    nameDraft: () => "",
    orgCode: () => DEFAULT_ORG_CODE,
    submission: () => Submission.Idle(),
  });

const toDialogMessage = (message: DialogMessage) => Message.GotDialogMessage({ message });

const dialogFolds = dialogFoldsOf({
  isClosingBlocked: isSubmitting,
  toParentMessage: toDialogMessage,
  write: (model: Model, nextDialog: DialogModel) =>
    modifyFields(model, { dialog: () => nextDialog }),
  whenClosed: (model) => ({ model: clearedForm(model) }),
});

const submitForm = (model: Model): UpdateReturn => {
  const name = String.trim(model.nameDraft);
  if (isSubmitting(model) || String.isEmpty(name)) {
    return { model };
  }
  const requested = modifyFields(model, {
    submission: () => Submission.Submitting(),
    requestNumber: Number.increment,
  });
  return {
    model: requested,
    commands: [
      AddCompany({ requestNumber: requested.requestNumber, name, orgCode: requested.orgCode }),
    ],
  };
};

const forThisRequest = (model: Model, requestNumber: number, next: () => UpdateReturn) =>
  requestNumber === model.requestNumber && isSubmitting(model) ? next() : { model };

export const update = (model: Model, message: Message) =>
  Message.match<UpdateReturn>(message, {
    ClickedAddCompany: () => (model.dialog.isOpen ? { model } : dialogFolds.open(model)),
    GotDialogMessage: ({ message: dialogMessage }) => dialogFolds.fold(model, dialogMessage),
    UpdatedName: ({ value }) =>
      isSubmitting(model) ? { model } : { model: modifyFields(model, { nameDraft: () => value }) },
    SelectedOrgCode: ({ orgCode }) =>
      isSubmitting(model) ? { model } : { model: modifyFields(model, { orgCode: () => orgCode }) },
    SubmittedAddCompanyForm: () => submitForm(model),
    SucceededAddCompany: ({ requestNumber, companyName }) =>
      forThisRequest(model, requestNumber, () =>
        pipe(
          dialogFolds.close(clearedForm(model)),
          Update.withOutMessage(OutMessage.AddedCompany({ companyName })),
        ),
      ),
    FailedAddCompany: ({ requestNumber, failure }) =>
      forThisRequest(model, requestNumber, () =>
        failure === "Unauthorized"
          ? { model, outMessage: OutMessage.RequiredSignIn() }
          : {
              model: modifyFields(model, {
                submission: () => Submission.Rejected({ message: ADD_FAILED }),
              }),
            },
      ),
  });

const formView = (model: Model, h: HtmlBuilder<Message>): Html =>
  h.form(
    [
      h.Class("space-y-4"),
      h.AriaLabel("事業所追加フォーム"),
      h.OnSubmit(Message.SubmittedAddCompanyForm()),
    ],
    [
      inputView(
        {
          id: "add-company-name",
          label: "事業所名",
          type: "text",
          value: model.nameDraft,
          onInput: (value) => Message.UpdatedName({ value }),
          submission: model.submission,
          placeholder: "例: 株式会社サンプル / 山田太郎",
          maxLength: 100,
          hint: {
            text: "法人なら正式社名、個人事業主なら屋号 (なければご自身のお名前)",
            maybeErrorMessage: Option.none(),
          },
        },
        h,
      ),
      radioFieldsetView(
        {
          id: "add-org-code",
          legend: "事業形態",
          name: "add-org-code",
          options: ORG_CODE_OPTIONS,
          selected: model.orgCode,
          onSelect: (orgCode) => Message.SelectedOrgCode({ orgCode }),
          isDisabled: isSubmitting(model),
        },
        h,
      ),
      ...Option.match(maybeRejectedMessage(model.submission), {
        onNone: () => [],
        onSome: (failureMessage) => [h.p([h.Class("text-sm text-destructive")], [failureMessage])],
      }),
      dialogFooterView(
        [
          buttonView(
            {
              label: "作成する",
              type: "submit",
              look: "primaryInline",
              submission: model.submission,
              isBlocked: String.isEmpty(String.trim(model.nameDraft)),
            },
            h,
          ),
        ],
        h,
      ),
    ],
  );

export const view = Submodel.defineView<Model, Message>((model, h) =>
  h.div(
    [h.Class("shrink-0")],
    [
      buttonView(
        {
          label: "事業所を追加",
          type: "button",
          look: "primarySmall",
          submission: Submission.Idle(),
          isBlocked: false,
          onClick: Message.ClickedAddCompany(),
          icon: Plus,
        },
        h,
      ),
      dialogView(
        model.dialog,
        toDialogMessage,
        {
          title: "事業所を追加",
          description:
            "新しい事業所を作成します。作成後は自動でこの事業所に切り替わり、あなたがオーナーになります。",
          body: [formView(model, h)],
          isClosingBlocked: isSubmitting(model),
        },
        h,
      ),
    ],
  ),
);
