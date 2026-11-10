import { Effect, Number, Schema, String, Option } from "effect";
import { Command, Submodel, Update } from "foldkit";
import type { Html, HtmlBuilder } from "foldkit/html";
import { defineMessageUnion } from "foldkit/message";
import { modifyFields } from "foldkit/struct";
import { ShieldOff } from "lucide";

import { SpaHttpClient } from "../shared/spa-http-client";
import { maybeRejectedMessage, Submission } from "../shared/submission";
import { buttonView } from "../shared/ui/button-view";
import {
  Dialog,
  type DialogMessage,
  dialogFoldsOf,
  dialogFooterView,
  dialogView,
} from "../shared/ui/dialog-view";
import { inputView, maybeInputErrorView } from "../shared/ui/input-view";
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
  dialog: Dialog.Model,
  maybeOutMessageAfterClose: Schema.Option(OutMessage),
  kind: MfaCodeKindSchema,
  code: Schema.String,
  submission: Submission,
  requestNumber: Schema.Int,
});
export type Model = typeof Model.Type;

const DisableFailure = Schema.Literals([
  "InvalidCode",
  "Locked",
  "NotEnabled",
  "RateLimited",
  "Unauthorized",
  "Unexpected",
]);
type DisableFailure = typeof DisableFailure.Type;

export const Message = defineMessageUnion({
  ClickedDisable: {},
  ClickedCancel: {},
  GotDialogMessage: { message: Dialog.Message },
  UpdatedCode: { value: Schema.String },
  ClickedToggleCodeKind: {},
  SubmittedCode: {},
  SucceededDisableMfa: { requestNumber: Schema.Int },
  FailedDisableMfa: { requestNumber: Schema.Int, failure: DisableFailure },
});
export type Message = typeof Message.Type;

const CODE_INPUT_ID = "mfa-disable-code";
const DIALOG_ID = "mfa-disabling-dialog";

const failedDisable = (requestNumber: number, failure: DisableFailure) => () =>
  Effect.succeed(Message.FailedDisableMfa({ requestNumber, failure }));

export const DisableMfa = Command.define("DisableMfa", {
  args: { requestNumber: Schema.Int, code: Schema.String, kind: MfaCodeKindSchema },
  messages: [Message.SucceededDisableMfa, Message.FailedDisableMfa],
  execute: ({ requestNumber, code, kind }) =>
    Effect.gen(function* () {
      const client = yield* SpaHttpClient;
      yield* client.mfa.disable({ payload: { code, kind } });
      return Message.SucceededDisableMfa({ requestNumber });
    }).pipe(
      Effect.catchTags({
        InvalidCode: failedDisable(requestNumber, "InvalidCode"),
        Locked: failedDisable(requestNumber, "Locked"),
        NotEnabled: failedDisable(requestNumber, "NotEnabled"),
        RateLimited: failedDisable(requestNumber, "RateLimited"),
        Unauthorized: failedDisable(requestNumber, "Unauthorized"),
        HttpClientError: failedDisable(requestNumber, "Unexpected"),
        SchemaError: failedDisable(requestNumber, "Unexpected"),
      }),
    ),
});

export const init = (): Model => ({
  dialog: Dialog.init({ id: DIALOG_ID }),
  maybeOutMessageAfterClose: Option.none(),
  kind: "totp",
  code: "",
  submission: Submission.Idle(),
  requestNumber: 0,
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

const dialogFolds = dialogFoldsOf<OutMessage>()({
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
      return { model };
    }
    const requested = modifyFields(model, {
      submission: () => Submission.Submitting(),
      requestNumber: Number.increment,
    });
    return {
      model: requested,
      commands: [
        DisableMfa({ requestNumber: requested.requestNumber, code, kind: requested.kind }),
      ],
    };
  });

const forThisRequest = (model: Model, requestNumber: number, next: () => UpdateReturn) =>
  requestNumber === model.requestNumber && isSubmitting(model) ? next() : { model };

export const update = (model: Model, message: Message) =>
  Message.match<UpdateReturn>(message, {
    ClickedDisable: () => (model.dialog.isOpen ? { model } : dialogFolds.open(model)),
    ClickedCancel: () => whileEditable(model, () => dialogFolds.close(model)),
    GotDialogMessage: ({ message: dialogMessage }) => dialogFolds.fold(model, dialogMessage),
    UpdatedCode: ({ value }) =>
      whileEditable(model, () => ({ model: modifyFields(model, { code: () => value }) })),
    ClickedToggleCodeKind: () =>
      whileEditable(model, () => ({
        model: modifyFields(model, {
          kind: otherMfaCodeKind,
          code: () => "",
          submission: () => Submission.Idle(),
        }),
      })),
    SubmittedCode: () => submitCode(model),
    SucceededDisableMfa: ({ requestNumber }) =>
      forThisRequest(model, requestNumber, () =>
        dialogFolds.closeThen(model, OutMessage.Disabled()),
      ),
    FailedDisableMfa: ({ requestNumber, failure }) =>
      forThisRequest(model, requestNumber, () =>
        failure === "Unauthorized"
          ? {
              model: modifyFields(model, { submission: () => Submission.Idle() }),
              outMessage: OutMessage.RequiredSignIn(),
            }
          : {
              model: modifyFields(model, {
                submission: () => Submission.Rejected({ message: mfaFailureText(failure) }),
              }),
            },
      ),
  });

const formView = (model: Model, h: HtmlBuilder<Message>): Html => {
  const texts = MFA_CODE_TEXTS[model.kind];
  const maybeErrorMessage = maybeRejectedMessage(model.submission);
  return h.form(
    [h.Class("space-y-4"), h.OnSubmit(Message.SubmittedCode())],
    [
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
          ariaLabel: texts.label,
          maxLength: MFA_CODE_PASTE_TOLERANT_MAX_LENGTH,
          isAutoCorrectionOff: true,
          hint: { text: texts.hint, maybeErrorMessage },
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
      ...maybeInputErrorView(CODE_INPUT_ID, maybeErrorMessage, h),
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
              isBlocked: String.isEmpty(normalizeMfaCode(model.code, model.kind)),
              icon: ShieldOff,
            },
            h,
          ),
        ],
        h,
      ),
    ],
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
          body: [formView(model, h)],
          isClosingBlocked: isSubmitting(model),
        },
        h,
      ),
    ],
  ),
);
