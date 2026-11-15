import { Effect, Option, Redacted, Schema, String, pipe } from "effect";
import { Command, Submodel, Update } from "foldkit";
import type { Html, HtmlBuilder } from "foldkit/html";
import { defineMessageUnion } from "foldkit/message";
import { defineTaggedUnion } from "foldkit/schema";
import { modifyFields } from "foldkit/struct";
import { ShieldCheck } from "lucide";

import {
  isCurrentPageRequest,
  type PageRequest,
  PageRequestFields,
  firstPageRequest,
  pageRequestOf,
  withNextPageRequest,
} from "../shared/page-request";
import { SpaHttpClient } from "../shared/spa-http-client";
import { maybeRejectedMessage, Submission, withoutRejection } from "../shared/submission";
import { alertTextView } from "../shared/ui/alert-text-view";
import { buttonView } from "../shared/ui/button-view";
import {
  Dialog,
  type DialogMessage,
  ReportingDialog,
  reportingDialogFoldsOf,
  dialogFooterView,
  dialogView,
} from "../shared/ui/dialog-view";
import { dialogLoadingStatusView, spinnerView } from "../shared/ui/icon-view";
import { inputView } from "../shared/ui/input-view";
import { formView } from "../shared/ui/form-view";
import { focusField, requiredErrorText } from "../shared/required-field";
import * as CopyResult from "./copy-result";
import { MFA_CODE_PASTE_TOLERANT_MAX_LENGTH, MFA_CODE_TEXTS, normalizeMfaCode } from "./mfa-code";
import { mfaFailureText } from "./mfa-failure-messages";

const Enrollment = Schema.Struct({
  enrollmentId: Schema.String,
  totpUri: Schema.Redacted(Schema.String),
  recoveryCodes: Schema.Redacted(Schema.Array(Schema.String)),
});
type Enrollment = typeof Enrollment.Type;

const Verifying = Schema.Struct({
  enrollment: Enrollment,
  code: Schema.String,
  submission: Submission,
});
type Verifying = typeof Verifying.Type;

const Step = defineTaggedUnion({
  Starting: {},
  Scan: { enrollment: Enrollment, copy: CopyResult.Model },
  Verify: Verifying.fields,
  RecoveryCodes: {
    recoveryCodes: Schema.Redacted(Schema.Array(Schema.String)),
    copy: CopyResult.Model,
  },
  Failed: { message: Schema.String },
});
type Step = typeof Step.Type;

const QrCode = defineTaggedUnion({
  Drawing: {},
  Drawn: { dataUrl: Schema.Redacted(Schema.String) },
  Unavailable: {},
});
type QrCode = typeof QrCode.Type;

export const OutMessage = defineMessageUnion({
  ClosedAfterEnabling: {},
  RequiredSignIn: {},
});
export type OutMessage = typeof OutMessage.Type;

export const Model = Schema.Struct({
  dialog: ReportingDialog.Model(OutMessage),
  step: Step,
  maybeResumableEnrollment: Schema.Option(Enrollment),
  qrCode: QrCode,
  ...PageRequestFields,
});
export type Model = typeof Model.Type;

const EnrollFailure = Schema.Literals([
  "AlreadyEnabled",
  "ChallengeExpired",
  "RateLimited",
  "Unauthorized",
  "Unexpected",
]);
type EnrollFailure = typeof EnrollFailure.Type;

const ActivateFailure = Schema.Literals([
  "InvalidCode",
  "Locked",
  "EnrollmentChanged",
  "AlreadyEnabled",
  "MfaNotFound",
  "RateLimited",
  "Unauthorized",
  "Unexpected",
]);
type ActivateFailure = typeof ActivateFailure.Type;

export const Message = defineMessageUnion({
  ClickedEnable: {},
  GotDialogMessage: { message: Dialog.Message },
  SucceededEnrollMfa: { ...PageRequestFields, enrollment: Enrollment },
  FailedEnrollMfa: { ...PageRequestFields, failure: EnrollFailure },
  SucceededDrawQrCode: { enrollmentId: Schema.String, dataUrl: Schema.Redacted(Schema.String) },
  FailedDrawQrCode: { enrollmentId: Schema.String },
  ClickedNext: {},
  ClickedBack: {},
  UpdatedCode: { value: Schema.String },
  SubmittedCode: {},
  SucceededActivateMfa: PageRequestFields,
  FailedActivateMfa: { ...PageRequestFields, failure: ActivateFailure },
  ClickedCloseAfterSavingCodes: {},
  GotCopyResultMessage: { message: CopyResult.Message },
  CompletedFocusField: {},
});
export type Message = typeof Message.Type;

const QR_CODE_WIDTH = 192;
const TOTP_TEXTS = MFA_CODE_TEXTS.totp;
const CODE_INPUT_ID = "mfa-enroll-code";

const FocusEnrollmentCode = Command.define("FocusEnrollmentCode", {
  messages: [Message.CompletedFocusField],
  execute: focusField(CODE_INPUT_ID).pipe(Effect.as(Message.CompletedFocusField())),
});
const DIALOG_ID = "mfa-enrollment-dialog";
const ENROLL_DESCRIPTION = "認証アプリを登録すると、ログイン時に確認コードの入力を求めます。";

const failedEnroll = (request: PageRequest, failure: EnrollFailure) => () =>
  Effect.succeed(Message.FailedEnrollMfa({ ...request, failure }));

export const EnrollMfa = Command.define("EnrollMfa", {
  args: PageRequestFields,
  messages: [Message.SucceededEnrollMfa, Message.FailedEnrollMfa],
  execute: (request) =>
    Effect.gen(function* () {
      const client = yield* SpaHttpClient;
      const enrollment = yield* client.mfa.enroll();
      return Message.SucceededEnrollMfa({
        ...request,
        enrollment: {
          enrollmentId: enrollment.enrollment_id,
          totpUri: Redacted.make(enrollment.totp_uri),
          recoveryCodes: Redacted.make(enrollment.recovery_codes),
        },
      });
    }).pipe(
      Effect.catchTags({
        AlreadyEnabled: failedEnroll(request, "AlreadyEnabled"),
        ChallengeExpired: failedEnroll(request, "ChallengeExpired"),
        RateLimited: failedEnroll(request, "RateLimited"),
        Unauthorized: failedEnroll(request, "Unauthorized"),
        HttpClientError: failedEnroll(request, "Unexpected"),
        SchemaError: failedEnroll(request, "Unexpected"),
      }),
    ),
});

const failedActivate = (request: PageRequest, failure: ActivateFailure) => () =>
  Effect.succeed(Message.FailedActivateMfa({ ...request, failure }));

export const ActivateMfa = Command.define("ActivateMfa", {
  args: { ...PageRequestFields, code: Schema.String, enrollmentId: Schema.String },
  messages: [Message.SucceededActivateMfa, Message.FailedActivateMfa],
  execute: ({ code, enrollmentId, ...request }) =>
    Effect.gen(function* () {
      const client = yield* SpaHttpClient;
      yield* client.mfa.activate({ payload: { code, enrollment_id: enrollmentId } });
      return Message.SucceededActivateMfa(request);
    }).pipe(
      Effect.catchTags({
        InvalidCode: failedActivate(request, "InvalidCode"),
        Locked: failedActivate(request, "Locked"),
        EnrollmentChanged: failedActivate(request, "EnrollmentChanged"),
        AlreadyEnabled: failedActivate(request, "AlreadyEnabled"),
        MfaNotFound: failedActivate(request, "MfaNotFound"),
        RateLimited: failedActivate(request, "RateLimited"),
        Unauthorized: failedActivate(request, "Unauthorized"),
        HttpClientError: failedActivate(request, "Unexpected"),
        SchemaError: failedActivate(request, "Unexpected"),
      }),
    ),
});

export const DrawQrCode = Command.define("DrawQrCode", {
  args: { enrollmentId: Schema.String, totpUri: Schema.Redacted(Schema.String) },
  messages: [Message.SucceededDrawQrCode, Message.FailedDrawQrCode],
  execute: ({ enrollmentId, totpUri }) =>
    Effect.tryPromise(() =>
      import("qrcode").then(({ toDataURL }) =>
        toDataURL(Redacted.value(totpUri), { width: QR_CODE_WIDTH, margin: 1 }),
      ),
    ).pipe(
      Effect.map((dataUrl) =>
        Message.SucceededDrawQrCode({ enrollmentId, dataUrl: Redacted.make(dataUrl) }),
      ),
      Effect.catchTag("UnknownError", () =>
        Effect.succeed(Message.FailedDrawQrCode({ enrollmentId })),
      ),
    ),
});

export const init = (visit: number): Model => ({
  dialog: ReportingDialog.init({ id: DIALOG_ID }),
  step: Step.Starting(),
  maybeResumableEnrollment: Option.none(),
  qrCode: QrCode.Drawing(),
  ...firstPageRequest(visit),
});

type UpdateReturn = Update.ReturnWithOutMessage<Model, Message, OutMessage, SpaHttpClient>;

const isSubmitting = (model: Model): boolean =>
  Step.matchOrElse(
    model.step,
    { Verify: ({ submission }) => Submission.guards.Submitting(submission) },
    () => false,
  );

const isClosingBlocked = (model: Model): boolean =>
  Step.guards.Starting(model.step) || isSubmitting(model);

const withStep = (model: Model, step: Step): Model => modifyFields(model, { step: () => step });

const toDialogMessage = (message: DialogMessage) => Message.GotDialogMessage({ message });

const withoutShownRecoveryCodes = (model: Model): Model =>
  Step.guards.RecoveryCodes(model.step) ? withStep(model, Step.Starting()) : model;

const dialogFolds = reportingDialogFoldsOf<OutMessage>()({
  isClosingBlocked,
  toParentMessage: toDialogMessage,
  whenClosed: withoutShownRecoveryCodes,
});

const hasCopyResult = Step.isAnyOf(["Scan", "RecoveryCodes"]);

const foldCopyResult = Update.foldChild({
  update: CopyResult.update,
  read: (model: Model) =>
    hasCopyResult(model.step) ? Option.some(model.step.copy) : Option.none(),
  write: (model: Model, nextCopy: CopyResult.Model) =>
    hasCopyResult(model.step)
      ? withStep(model, modifyFields(model.step, { copy: () => nextCopy }))
      : model,
  toParentMessage: (message: CopyResult.Message) => Message.GotCopyResultMessage({ message }),
});

const scanStep = (enrollment: Enrollment): Step =>
  Step.Scan({ enrollment, copy: CopyResult.init() });

const recoveryCodesStep = (enrollment: Enrollment): Step =>
  Step.RecoveryCodes({ recoveryCodes: enrollment.recoveryCodes, copy: CopyResult.init() });

const openDialog = (model: Model): UpdateReturn =>
  Option.match(model.maybeResumableEnrollment, {
    onSome: (enrollment) => dialogFolds.open(withStep(model, scanStep(enrollment))),
    onNone: () => {
      const requested = withNextPageRequest(
        modifyFields(model, {
          step: () => Step.Starting(),
          qrCode: () => QrCode.Drawing(),
        }),
      );
      const opened = dialogFolds.open(requested);
      const enrolling: Update.Return<Model, Message, SpaHttpClient> = {
        model: opened.model,
        commands: [...(opened.commands ?? []), EnrollMfa(pageRequestOf(requested))],
      };
      return pipe(enrolling, Update.withOutMessage(opened.outMessage));
    },
  });

const forThisRequest = (model: Model, response: PageRequest, next: () => UpdateReturn) =>
  isCurrentPageRequest(model, response) ? next() : { model };

const forResumable = (model: Model, enrollmentId: string, qrCode: QrCode): UpdateReturn =>
  Option.exists(
    model.maybeResumableEnrollment,
    (enrollment) => enrollment.enrollmentId === enrollmentId,
  )
    ? { model: modifyFields(model, { qrCode: () => qrCode }) }
    : { model };

const withVerifying = (model: Model, next: (verifying: Verifying) => UpdateReturn): UpdateReturn =>
  Step.matchOrElse(model.step, { Verify: next }, () => ({ model }));

const whileEditable = (model: Model, next: (verifying: Verifying) => UpdateReturn): UpdateReturn =>
  withVerifying(model, (verifying) =>
    Submission.guards.Submitting(verifying.submission) ? { model } : next(verifying),
  );

const submitCode = (model: Model): UpdateReturn =>
  whileEditable(model, (verifying) => {
    const code = normalizeMfaCode(verifying.code, "totp");
    if (String.isEmpty(code)) {
      return {
        model: withStep(
          model,
          Step.Verify(
            modifyFields(verifying, {
              submission: () =>
                Submission.Rejected({ message: requiredErrorText(TOTP_TEXTS.label) }),
            }),
          ),
        ),
        commands: [FocusEnrollmentCode()],
      };
    }
    const requested = withNextPageRequest(
      withStep(
        model,
        Step.Verify(modifyFields(verifying, { submission: () => Submission.Submitting() })),
      ),
    );
    return {
      model: requested,
      commands: [
        ActivateMfa({
          ...pageRequestOf(requested),
          code,
          enrollmentId: verifying.enrollment.enrollmentId,
        }),
      ],
    };
  });

const failActivate = (model: Model, failure: ActivateFailure): UpdateReturn =>
  failure === "Unauthorized"
    ? { model, outMessage: OutMessage.RequiredSignIn() }
    : withVerifying(model, (verifying) => ({
        model: modifyFields(
          withStep(
            model,
            Step.Verify(
              modifyFields(verifying, {
                submission: () => Submission.Rejected({ message: mfaFailureText(failure) }),
              }),
            ),
          ),
          {
            maybeResumableEnrollment: (current) =>
              failure === "EnrollmentChanged" ? Option.none() : current,
          },
        ),
        commands: [FocusEnrollmentCode()],
      }));

export const update = (model: Model, message: Message) =>
  Message.match<UpdateReturn>(message, {
    ClickedEnable: () => (model.dialog.isOpen ? { model } : openDialog(model)),
    GotDialogMessage: ({ message: dialogMessage }) => dialogFolds.fold(model, dialogMessage),
    SucceededEnrollMfa: ({ enrollment, ...response }) =>
      forThisRequest(model, response, () =>
        Step.guards.Starting(model.step)
          ? {
              model: modifyFields(withStep(model, scanStep(enrollment)), {
                maybeResumableEnrollment: () => Option.some(enrollment),
                qrCode: () => QrCode.Drawing(),
              }),
              commands: [
                DrawQrCode({ enrollmentId: enrollment.enrollmentId, totpUri: enrollment.totpUri }),
              ],
            }
          : { model },
      ),
    FailedEnrollMfa: ({ failure, ...response }) =>
      forThisRequest(model, response, () =>
        failure === "Unauthorized"
          ? { model, outMessage: OutMessage.RequiredSignIn() }
          : { model: withStep(model, Step.Failed({ message: mfaFailureText(failure) })) },
      ),
    SucceededDrawQrCode: ({ enrollmentId, dataUrl }) =>
      forResumable(model, enrollmentId, QrCode.Drawn({ dataUrl })),
    FailedDrawQrCode: ({ enrollmentId }) => forResumable(model, enrollmentId, QrCode.Unavailable()),
    ClickedNext: () =>
      Step.matchOrElse(
        model.step,
        {
          Scan: ({ enrollment }) => ({
            model: withStep(
              model,
              Step.Verify({ enrollment, code: "", submission: Submission.Idle() }),
            ),
          }),
        },
        () => ({ model }),
      ),
    ClickedBack: () =>
      whileEditable(model, ({ enrollment }) => ({
        model: withStep(model, scanStep(enrollment)),
      })),
    UpdatedCode: ({ value }) =>
      whileEditable(model, (verifying) => ({
        model: withStep(
          model,
          Step.Verify(modifyFields(verifying, { code: () => value, submission: withoutRejection })),
        ),
      })),
    SubmittedCode: () => submitCode(model),
    SucceededActivateMfa: (response) =>
      forThisRequest(model, response, () =>
        withVerifying(model, ({ enrollment }) =>
          dialogFolds.reportAfterClose(
            modifyFields(withStep(model, recoveryCodesStep(enrollment)), {
              maybeResumableEnrollment: () => Option.none(),
              qrCode: () => QrCode.Drawing(),
            }),
            OutMessage.ClosedAfterEnabling(),
          ),
        ),
      ),
    FailedActivateMfa: ({ failure, ...response }) =>
      forThisRequest(model, response, () => failActivate(model, failure)),
    ClickedCloseAfterSavingCodes: () => dialogFolds.close(model),
    GotCopyResultMessage: ({ message: copyMessage }) => foldCopyResult(model, copyMessage),
    CompletedFocusField: () => ({ model }),
  });

const readTotpSecret = (totpUri: Redacted.Redacted<string>): Option.Option<string> => {
  const uri = Redacted.value(totpUri);
  return URL.canParse(uri)
    ? Option.fromNullishOr(new URL(uri).searchParams.get("secret"))
    : Option.none();
};

const copyResultView = (
  copy: CopyResult.Model,
  text: Redacted.Redacted<string>,
  label: string,
  h: HtmlBuilder<Message>,
) =>
  h.submodel({
    slotId: "mfa-enrollment-copy",
    view: CopyResult.view,
    model: copy,
    viewInputs: { text, label },
    toParentMessage: (message) => Message.GotCopyResultMessage({ message }),
  });

const qrCodeView = (qrCode: QrCode, h: HtmlBuilder<Message>): Html =>
  QrCode.match(qrCode, {
    Drawing: () =>
      h.div(
        [h.Class("flex h-48 items-center justify-center text-muted-foreground [&_svg]:size-5")],
        [spinnerView(h)],
      ),
    Drawn: ({ dataUrl }) =>
      h.img([
        h.Src(Redacted.value(dataUrl)),
        h.Width(`${QR_CODE_WIDTH}`),
        h.Height(`${QR_CODE_WIDTH}`),
        h.Alt("認証アプリで読み取る QR コード"),
        h.Class("mx-auto rounded-md border border-border bg-white p-2"),
      ]),
    Unavailable: () =>
      h.p(
        [h.Class("text-sm text-muted-foreground")],
        ["QR コードを表示できませんでした。下の secret を認証アプリに手入力してください。"],
      ),
  });

const scanView = (
  model: Model,
  enrollment: Enrollment,
  copy: CopyResult.Model,
  h: HtmlBuilder<Message>,
): Html => {
  const maybeSecret = readTotpSecret(enrollment.totpUri);
  return h.div(
    [h.Class("space-y-4")],
    [
      qrCodeView(model.qrCode, h),
      h.div(
        [h.Class("space-y-2")],
        [
          h.p(
            [h.Class("text-sm text-muted-foreground")],
            [
              "認証アプリで QR コードを読み取ってください。読み取れない場合は、次の secret を手入力します。",
            ],
          ),
          h.p(
            [
              h.Class("break-all rounded-md bg-muted px-3 py-2 font-mono text-sm"),
              h.Translate("no"),
            ],
            [Option.getOrElse(maybeSecret, () => "—")],
          ),
          ...Option.match(maybeSecret, {
            onNone: () => [],
            onSome: (secret) => [copyResultView(copy, Redacted.make(secret), "secret をコピー", h)],
          }),
        ],
      ),
      dialogFooterView(
        [
          buttonView(
            {
              label: "次へ",
              type: "button",
              look: "primaryInline",
              submission: Submission.Idle(),
              isBlocked: false,
              onClick: Message.ClickedNext(),
            },
            h,
          ),
        ],
        h,
      ),
    ],
  );
};

const verifyView = (verifying: Verifying, h: HtmlBuilder<Message>): Html => {
  const maybeErrorMessage = maybeRejectedMessage(verifying.submission);
  return formView(
    {
      onSubmit: Message.SubmittedCode(),
      attributes: [h.Class("space-y-4")],
      children: [
        inputView(
          {
            id: CODE_INPUT_ID,
            label: TOTP_TEXTS.label,
            type: "text",
            value: verifying.code,
            onInput: (value) => Message.UpdatedCode({ value }),
            submission: verifying.submission,
            placeholder: TOTP_TEXTS.placeholder,
            autocomplete: "one-time-code",
            inputMode: TOTP_TEXTS.inputMode,
            maxLength: MFA_CODE_PASTE_TOLERANT_MAX_LENGTH,
            isAutoCorrectionOff: true,
            hint: TOTP_TEXTS.hint,
            maybeErrorMessage,
            enterKeyHint: "go",
          },
          h,
        ),
        dialogFooterView(
          [
            buttonView(
              {
                label: "戻る",
                type: "button",
                look: "outlineInline",
                submission: Submission.Idle(),
                isBlocked: Submission.guards.Submitting(verifying.submission),
                onClick: Message.ClickedBack(),
              },
              h,
            ),
            buttonView(
              {
                label: "有効にする",
                type: "submit",
                look: "primaryInline",
                submission: verifying.submission,
                isBlocked: false,
                icon: ShieldCheck,
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

const recoveryCodesView = (
  copy: CopyResult.Model,
  recoveryCodes: Redacted.Redacted<ReadonlyArray<string>>,
  h: HtmlBuilder<Message>,
): Html => {
  const codes = Redacted.value(recoveryCodes);
  return h.div(
    [h.Class("space-y-4")],
    [
      h.p(
        [h.Class("text-sm text-destructive")],
        [
          "このダイアログを閉じると再表示できません。認証アプリを使えなくなった時の唯一の ログイン手段なので、必ず控えてから閉じてください。",
        ],
      ),
      h.ul(
        [
          h.Role("list"),
          h.Class("grid grid-cols-2 gap-2 rounded-md bg-muted p-3"),
          h.Translate("no"),
        ],
        codes.map((code) => h.keyed("li")(code, [h.Class("font-mono text-sm")], [code])),
      ),
      copyResultView(copy, Redacted.make(codes.join("\n")), "リカバリーコードをコピー", h),
      dialogFooterView(
        [
          buttonView(
            {
              label: "控えたので閉じる",
              type: "button",
              look: "primaryInline",
              submission: Submission.Idle(),
              isBlocked: false,
              onClick: Message.ClickedCloseAfterSavingCodes(),
            },
            h,
          ),
        ],
        h,
      ),
    ],
  );
};

const stepView = (model: Model, h: HtmlBuilder<Message>): Html =>
  Step.match(model.step, {
    Starting: () => dialogLoadingStatusView("読み込み中…", h),
    Failed: ({ message: failureMessage }) => alertTextView(failureMessage, h),
    Scan: ({ enrollment, copy }) => scanView(model, enrollment, copy, h),
    Verify: (verifying) => verifyView(verifying, h),
    RecoveryCodes: ({ recoveryCodes, copy }) => recoveryCodesView(copy, recoveryCodes, h),
  });

export const view = Submodel.defineView<Model, Message>((model, h) =>
  h.div(
    [],
    [
      buttonView(
        {
          label: "有効にする",
          type: "button",
          look: "primarySmall",
          submission: Submission.Idle(),
          isBlocked: false,
          onClick: Message.ClickedEnable(),
        },
        h,
      ),
      dialogView(
        model.dialog,
        toDialogMessage,
        {
          title: "多要素認証 (MFA) を有効にする",
          description: Step.guards.RecoveryCodes(model.step)
            ? "リカバリーコードを安全な場所に保管してください。"
            : ENROLL_DESCRIPTION,
          body: [stepView(model, h)],
          isClosingBlocked: isClosingBlocked(model),
        },
        h,
      ),
    ],
  ),
);
