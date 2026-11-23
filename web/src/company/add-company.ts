import { Effect, Option, Schema, String } from "effect";
import { Command, Submodel, Update } from "foldkit";
import type { Html, HtmlBuilder } from "foldkit/html";
import { defineMessageUnion } from "foldkit/message";
import { modifyFields } from "foldkit/struct";
import { Plus } from "lucide";

import { OrgCodeSchema } from "@core/company/company-contract";
import type { OrgCode } from "@core/company/org-code";

import {
  isCurrentPageRequest,
  type PageRequest,
  PageRequestFields,
  firstPageRequest,
  pageRequestOf,
  withNextPageRequest,
} from "../shared/page-request";
import { focusField, isBlank, maybeFieldError } from "../shared/required-field";
import { contractFailure, messageOnFailure } from "../shared/spa-contract-failure";
import { SpaHttpClient } from "../shared/spa-http-client";
import { formView } from "../shared/ui/form-view";
import { maybeRejectedMessage, Submission } from "../shared/submission";
import { maybeAlertTextView } from "../shared/ui/alert-text-view";
import { buttonView } from "../shared/ui/button-view";
import {
  Dialog,
  type DialogMessage,
  ReportingDialog,
  reportingDialogFoldsOf,
  dialogFooterView,
  dialogView,
} from "../shared/ui/dialog-view";
import { inputView } from "../shared/ui/input-view";
import { radioFieldsetView } from "../shared/ui/radio-fieldset-view";
import { orgCodeOptionsIn } from "./org-code-options";

export const OutMessage = defineMessageUnion({
  AddedCompany: { companyName: Schema.String },
  RequiredSignIn: {},
});
export type OutMessage = typeof OutMessage.Type;

export const Model = Schema.Struct({
  dialog: ReportingDialog.Model(OutMessage),
  nameDraft: Schema.String,
  orgCode: OrgCodeSchema,
  submission: Submission,
  showsRequiredErrors: Schema.Boolean,
  ...PageRequestFields,
});
export type Model = typeof Model.Type;

const AddCompanyFailure = contractFailure(["Unauthorized"]);

export const Message = defineMessageUnion({
  ClickedAddCompany: {},
  GotDialogMessage: { message: Dialog.Message },
  UpdatedName: { value: Schema.String },
  SelectedOrgCode: { orgCode: OrgCodeSchema },
  SubmittedAddCompanyForm: {},
  SucceededAddCompany: { ...PageRequestFields, companyName: Schema.String },
  FailedAddCompany: { ...PageRequestFields, failure: AddCompanyFailure },
  CompletedFocusField: {},
});
export type Message = typeof Message.Type;

const NAME_FIELD = { id: "add-company-name", label: "事業所名" } as const;

const FocusAddCompanyName = Command.define("FocusAddCompanyName", {
  messages: [Message.CompletedFocusField],
  execute: focusField(NAME_FIELD.id).pipe(Effect.as(Message.CompletedFocusField())),
});

const isAddedCompany = Schema.is(Message.SucceededAddCompany);

export const visitOfCompanyChange = (message: Message): Option.Option<number> =>
  isAddedCompany(message) ? Option.some(message.visit) : Option.none();

const ADD_FAILED = "事業所の作成に失敗しました。";

const DEFAULT_ORG_CODE: OrgCode = "CORPORATE";

const ORG_CODE_OPTIONS = orgCodeOptionsIn(["CORPORATE", "PERSONAL"]);

export const AddCompany = Command.define("AddCompany", {
  args: { ...PageRequestFields, name: Schema.String, orgCode: OrgCodeSchema },
  messages: [Message.SucceededAddCompany, Message.FailedAddCompany],
  execute: ({ name, orgCode, ...request }) =>
    Effect.gen(function* () {
      const client = yield* SpaHttpClient;
      yield* client.company.add({ payload: { name, org_code: orgCode } });
      return Message.SucceededAddCompany({ ...request, companyName: name });
    }).pipe(
      messageOnFailure({
        failure: AddCompanyFailure,
        asUnexpected: [],
        toMessage: (failure) => Message.FailedAddCompany({ ...request, failure }),
      }),
    ),
});

const DIALOG_ID = "add-company-dialog";

export const init = (visit: number): Model => ({
  ...firstPageRequest(visit),
  dialog: ReportingDialog.init({ id: DIALOG_ID }),
  nameDraft: "",
  orgCode: DEFAULT_ORG_CODE,
  submission: Submission.Idle(),
  showsRequiredErrors: false,
});

type UpdateReturn = Update.ReturnWithOutMessage<Model, Message, OutMessage, SpaHttpClient>;

const isSubmitting = (model: Model) => Submission.guards.Submitting(model.submission);

const clearedForm = (model: Model): Model =>
  modifyFields(model, {
    nameDraft: () => "",
    orgCode: () => DEFAULT_ORG_CODE,
    submission: () => Submission.Idle(),
    showsRequiredErrors: () => false,
  });

const toDialogMessage = (message: DialogMessage) => Message.GotDialogMessage({ message });

const dialogFolds = reportingDialogFoldsOf<OutMessage>()({
  isClosingBlocked: isSubmitting,
  toParentMessage: toDialogMessage,
  whenClosed: clearedForm,
});

const submitForm = (model: Model): UpdateReturn => {
  const name = String.trim(model.nameDraft);
  if (isSubmitting(model)) {
    return { model };
  }
  if (isBlank(name)) {
    return {
      model: modifyFields(model, { showsRequiredErrors: () => true }),
      commands: [FocusAddCompanyName()],
    };
  }
  const requested = withNextPageRequest(
    modifyFields(model, { submission: () => Submission.Submitting() }),
  );
  return {
    model: requested,
    commands: [
      AddCompany({
        ...pageRequestOf(requested),
        name,
        orgCode: requested.orgCode,
      }),
    ],
  };
};

const forThisRequest = (model: Model, response: PageRequest, next: () => UpdateReturn) =>
  isCurrentPageRequest(model, response) && isSubmitting(model) ? next() : { model };

export const update = (model: Model, message: Message) =>
  Message.match<UpdateReturn>(message, {
    ClickedAddCompany: () => (model.dialog.isOpen ? { model } : dialogFolds.open(model)),
    GotDialogMessage: ({ message: dialogMessage }) => dialogFolds.fold(model, dialogMessage),
    UpdatedName: ({ value }) =>
      isSubmitting(model) ? { model } : { model: modifyFields(model, { nameDraft: () => value }) },
    SelectedOrgCode: ({ orgCode }) =>
      isSubmitting(model) ? { model } : { model: modifyFields(model, { orgCode: () => orgCode }) },
    SubmittedAddCompanyForm: () => submitForm(model),
    SucceededAddCompany: (added) =>
      forThisRequest(model, added, () =>
        dialogFolds.closeThen(model, OutMessage.AddedCompany({ companyName: added.companyName })),
      ),
    FailedAddCompany: (failed) =>
      forThisRequest(model, failed, () =>
        failed.failure === "Unauthorized"
          ? { model, outMessage: OutMessage.RequiredSignIn() }
          : {
              model: modifyFields(model, {
                submission: () => Submission.Rejected({ message: ADD_FAILED }),
              }),
            },
      ),
    CompletedFocusField: () => ({ model }),
  });

const addCompanyFormView = (model: Model, h: HtmlBuilder<Message>): Html =>
  formView(
    {
      onSubmit: Message.SubmittedAddCompanyForm(),
      attributes: [h.Class("space-y-4"), h.AriaLabel("事業所追加フォーム")],
      children: [
        inputView(
          {
            ...NAME_FIELD,
            type: "text",
            value: model.nameDraft,
            onInput: (value) => Message.UpdatedName({ value }),
            submission: model.submission,
            placeholder: "例: 株式会社サンプル / 山田太郎",
            autocomplete: "organization",
            maxLength: 100,
            hint: "法人なら正式社名、個人事業主なら屋号 (なければご自身のお名前)",
            maybeErrorMessage: maybeFieldError(model.showsRequiredErrors, {
              ...NAME_FIELD,
              value: model.nameDraft,
            }),
            enterKeyHint: "done",
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
        ...maybeAlertTextView(maybeRejectedMessage(model.submission), h),
        dialogFooterView(
          [
            buttonView(
              {
                label: "作成する",
                type: "submit",
                look: "primaryInline",
                submission: model.submission,
                isBlocked: false,
              },
              h,
            ),
          ],
          h,
        ),
      ],
    },
    h,
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
          body: [addCompanyFormView(model, h)],
          isClosingBlocked: isSubmitting(model),
        },
        h,
      ),
    ],
  ),
);
