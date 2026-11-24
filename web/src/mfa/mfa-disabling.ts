import { Effect, Schema, String } from "effect";
import { Command, Submodel, Update } from "foldkit";
import type { Html, HtmlBuilder } from "foldkit/html";
import { defineMessageUnion } from "foldkit/message";
import { modifyFields } from "foldkit/struct";
import { ShieldOff } from "lucide";

import {
  isCurrentPageRequest,
  type PageRequest,
  PageRequestFields,
  firstPageRequest,
  pageRequestOf,
  withNextPageRequest,
} from "../shared/page-request";
import { SpaHttpClient } from "../shared/spa-http-client";
import { contractFailure, messageOnFailure } from "../shared/spa-contract-failure";
import { maybeRejectedMessage, Submission, withoutRejection } from "../shared/submission";
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
import { formView } from "../shared/ui/form-view";
import { focusField, requiredErrorText } from "../shared/required-field";
import {
  MFA_CODE_PASTE_TOLERANT_MAX_LENGTH,
  MFA_CODE_TEXTS,
  normalizeMfaCode,
  MfaCodeKindSchema,
  otherMfaCodeKind,
} from "./mfa-code";
import { mfaFailureText } from "./mfa-failure-messages";

export const OutMessage = defineMessageUnion({
  Disabled: {},
  RequiredSignIn: {},
});
export type OutMessage = typeof OutMessage.Type;

export const Model = Schema.Struct({
  dialog: ReportingDialog.Model(OutMessage),
  kind: MfaCodeKindSchema,
  code: Schema.String,
  submission: Submission,
  ...PageRequestFields,
});
export type Model = typeof Model.Type;

const DisableFailure = contractFailure([
  "InvalidCode",
  "Locked",
  "NotEnabled",
  "RateLimited",
  "Unauthorized",
]);
type DisableFailure = typeof DisableFailure.Type;

export const Message = defineMessageUnion({
  ClickedDisable: {},
  ClickedCancel: {},
  GotDialogMessage: { message: Dialog.Message },
  UpdatedCode: { value: Schema.String },
  ClickedToggleCodeKind: {},
  SubmittedCode: {},
  SucceededDisableMfa: PageRequestFields,
  FailedDisableMfa: { ...PageRequestFields, failure: DisableFailure },
  CompletedFocusField: {},
});
export type Message = typeof Message.Type;

const CODE_INPUT_ID = "mfa-disable-code";

const FocusDisablingCode = Command.define("FocusDisablingCode", {
  messages: [Message.CompletedFocusField],
  execute: focusField(CODE_INPUT_ID).pipe(Effect.as(Message.CompletedFocusField())),
});
const DIALOG_ID = "mfa-disabling-dialog";

export const DisableMfa = Command.define("DisableMfa", {
  args: { ...PageRequestFields, code: Schema.String, kind: MfaCodeKindSchema },
  messages: [Message.SucceededDisableMfa, Message.FailedDisableMfa],
  execute: ({ code, kind, ...request }) =>
    Effect.gen(function* () {
      const client = yield* SpaHttpClient;
      yield* client.mfa.disable({ payload: { code, kind } });
      return Message.SucceededDisableMfa(request);
    }).pipe(
      messageOnFailure({
        failure: DisableFailure,
        asUnexpected: [],
        toMessage: (failure) => Message.FailedDisableMfa({ ...request, failure }),
      }),
    ),
});

export const init = (visit: number): Model => ({
  dialog: ReportingDialog.init({ id: DIALOG_ID }),
  kind: "totp",
  code: "",
  submission: Submission.Idle(),
  ...firstPageRequest(visit),
});

type UpdateReturn = Update.ReturnWithOutMessage<Model, Message, OutMessage, SpaHttpClient>;

const isSubmitting = (model: Model) => Submission.guards.Submitting(model.submission);

const clearedEntry = (model: Model): Model =>
  modifyFields(model, {
    kind: () => "totp" as const,
    code: () => "",
    submission: () => Submission.Idle(),
  });

const toDialogMessage = (message: DialogMessage) => Message.GotDialogMessage({ message });

const dialogFolds = reportingDialogFoldsOf<OutMessage>()({
  isClosingBlocked: isSubmitting,
  toParentMessage: toDialogMessage,
  whenClosed: clearedEntry,
});

const whileEditable = (model: Model, next: () => UpdateReturn): UpdateReturn =>
  isSubmitting(model) ? { model } : next();

const submitCode = (model: Model): UpdateReturn =>
  whileEditable(model, () => {
    const code = normalizeMfaCode(model.code, model.kind);
    if (String.isEmpty(code)) {
      return {
        model: modifyFields(model, {
          submission: () =>
            Submission.Rejected({ message: requiredErrorText(MFA_CODE_TEXTS[model.kind].label) }),
        }),
        commands: [FocusDisablingCode()],
      };
    }
    const requested = withNextPageRequest(
      modifyFields(model, { submission: () => Submission.Submitting() }),
    );
    return {
      model: requested,
      commands: [DisableMfa({ ...pageRequestOf(requested), code, kind: requested.kind })],
    };
  });

const forThisRequest = (model: Model, response: PageRequest, next: () => UpdateReturn) =>
  isCurrentPageRequest(model, response) && isSubmitting(model) ? next() : { model };

export const update = (model: Model, message: Message) =>
  Message.match<UpdateReturn>(message, {
    ClickedDisable: () => (model.dialog.isOpen ? { model } : dialogFolds.open(model)),
    ClickedCancel: () => whileEditable(model, () => dialogFolds.close(model)),
    GotDialogMessage: ({ message: dialogMessage }) => dialogFolds.fold(model, dialogMessage),
    UpdatedCode: ({ value }) =>
      whileEditable(model, () => ({
        model: modifyFields(model, { code: () => value, submission: withoutRejection }),
      })),
    ClickedToggleCodeKind: () =>
      whileEditable(model, () => ({
        model: modifyFields(model, {
          kind: otherMfaCodeKind,
          code: () => "",
          submission: () => Submission.Idle(),
        }),
      })),
    SubmittedCode: () => submitCode(model),
    SucceededDisableMfa: (response) =>
      forThisRequest(model, response, () => dialogFolds.closeThen(model, OutMessage.Disabled())),
    FailedDisableMfa: ({ failure, ...response }) =>
      forThisRequest(model, response, () =>
        failure === "Unauthorized"
          ? {
              model: modifyFields(model, { submission: () => Submission.Idle() }),
              outMessage: OutMessage.RequiredSignIn(),
            }
          : {
              model: modifyFields(model, {
                submission: () => Submission.Rejected({ message: mfaFailureText(failure) }),
              }),
              commands: [FocusDisablingCode()],
            },
      ),
    CompletedFocusField: () => ({ model }),
  });

const codeFormView = (model: Model, h: HtmlBuilder<Message>): Html => {
  const texts = MFA_CODE_TEXTS[model.kind];
  const maybeErrorMessage = maybeRejectedMessage(model.submission);
  return formView(
    {
      onSubmit: Message.SubmittedCode(),
      attributes: [h.Class("space-y-4")],
      children: [
        inputView(
          {
            id: CODE_INPUT_ID,
            label: texts.label,
            type: "text",
            value: model.code,
            onInput: (value) => Message.UpdatedCode({ value }),
            submission: model.submission,
            placeholder: texts.placeholder,
            autocomplete: "one-time-code",
            inputMode: texts.inputMode,
            maxLength: MFA_CODE_PASTE_TOLERANT_MAX_LENGTH,
            isAutoCorrectionOff: true,
            hint: texts.hint,
            maybeErrorMessage,
            enterKeyHint: "go",
          },
          h,
        ),
        buttonView(
          {
            label: texts.toggleLabel,
            type: "button",
            look: "subtleLink",
            submission: Submission.Idle(),
            isBlocked: isSubmitting(model),
            onClick: Message.ClickedToggleCodeKind(),
          },
          h,
        ),
        dialogFooterView(
          [
            buttonView(
              {
                label: "キャンセル",
                type: "button",
                look: "outlineInline",
                submission: Submission.Idle(),
                isBlocked: isSubmitting(model),
                onClick: Message.ClickedCancel(),
              },
              h,
            ),
            buttonView(
              {
                label: "無効にする",
                type: "submit",
                look: "destructive",
                submission: model.submission,
                isBlocked: false,
                icon: ShieldOff,
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
};

export const view = Submodel.defineView<Model, Message>((model, h) =>
  h.div(
    [],
    [
      buttonView(
        {
          label: "無効にする",
          type: "button",
          look: "outlineSmall",
          submission: Submission.Idle(),
          isBlocked: false,
          onClick: Message.ClickedDisable(),
        },
        h,
      ),
      dialogView(
        model.dialog,
        toDialogMessage,
        {
          title: "多要素認証 (MFA) を無効にする",
          description:
            "無効にすると、ログイン時の確認コードの入力が不要になります。本人確認のため、現在の確認コードまたはリカバリーコードを入力してください。",
          body: [codeFormView(model, h)],
          isClosingBlocked: isSubmitting(model),
        },
        h,
      ),
    ],
  ),
);
