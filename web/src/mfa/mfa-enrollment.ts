import { Effect, Number, Option, Redacted, Schema, String, pipe } from "effect";
import { Command, Submodel, Update } from "foldkit";
import type { Html, HtmlBuilder } from "foldkit/html";
import { defineMessageUnion } from "foldkit/message";
import { defineTaggedUnion } from "foldkit/schema";
import { modifyFields } from "foldkit/struct";
import { ShieldCheck } from "lucide";

import { SpaHttpClient } from "../shared/spa-http-client";
import { maybeRejectedMessage, Submission } from "../shared/submission";
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
import { inputView, maybeInputErrorView } from "../shared/ui/input-view";
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
  requestNumber: Schema.Int,
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
  SucceededEnrollMfa: { requestNumber: Schema.Int, enrollment: Enrollment },
  FailedEnrollMfa: { requestNumber: Schema.Int, failure: EnrollFailure },
  SucceededDrawQrCode: { enrollmentId: Schema.String, dataUrl: Schema.Redacted(Schema.String) },
  FailedDrawQrCode: { enrollmentId: Schema.String },
  ClickedNext: {},
  ClickedBack: {},
  UpdatedCode: { value: Schema.String },
  SubmittedCode: {},
  SucceededActivateMfa: { requestNumber: Schema.Int },
  FailedActivateMfa: { requestNumber: Schema.Int, failure: ActivateFailure },
  ClickedCloseAfterSavingCodes: {},
  GotCopyResultMessage: { message: CopyResult.Message },
});
export type Message = typeof Message.Type;

const QR_CODE_WIDTH = 192;
const TOTP_TEXTS = MFA_CODE_TEXTS.totp;
const CODE_INPUT_ID = "mfa-enroll-code";
const DIALOG_ID = "mfa-enrollment-dialog";
const ENROLL_DESCRIPTION = "認証アプリを登録すると、ログイン時に確認コードの入力を求めます。";

const failedEnroll = (requestNumber: number, failure: EnrollFailure) => () =>
  Effect.succeed(Message.FailedEnrollMfa({ requestNumber, failure }));

export const EnrollMfa = Command.define("EnrollMfa", {
  args: { requestNumber: Schema.Int },
  messages: [Message.SucceededEnrollMfa, Message.FailedEnrollMfa],
  execute: ({ requestNumber }) =>
    Effect.gen(function* () {
      const client = yield* SpaHttpClient;
      const enrollment = yield* client.mfa.enroll();
      return Message.SucceededEnrollMfa({
        requestNumber,
        enrollment: {
          enrollmentId: enrollment.enrollment_id,
          totpUri: Redacted.make(enrollment.totp_uri),
          recoveryCodes: Redacted.make(enrollment.recovery_codes),
        },
      });
    }).pipe(
      Effect.catchTags({
        AlreadyEnabled: failedEnroll(requestNumber, "AlreadyEnabled"),
        ChallengeExpired: failedEnroll(requestNumber, "ChallengeExpired"),
        RateLimited: failedEnroll(requestNumber, "RateLimited"),
        Unauthorized: failedEnroll(requestNumber, "Unauthorized"),
        HttpClientError: failedEnroll(requestNumber, "Unexpected"),
        SchemaError: failedEnroll(requestNumber, "Unexpected"),
      }),
    ),
});

const failedActivate = (requestNumber: number, failure: ActivateFailure) => () =>
  Effect.succeed(Message.FailedActivateMfa({ requestNumber, failure }));

export const ActivateMfa = Command.define("ActivateMfa", {
  args: { requestNumber: Schema.Int, code: Schema.String, enrollmentId: Schema.String },
  messages: [Message.SucceededActivateMfa, Message.FailedActivateMfa],
  execute: ({ requestNumber, code, enrollmentId }) =>
    Effect.gen(function* () {
      const client = yield* SpaHttpClient;
      yield* client.mfa.activate({ payload: { code, enrollment_id: enrollmentId } });
      return Message.SucceededActivateMfa({ requestNumber });
    }).pipe(
      Effect.catchTags({
        InvalidCode: failedActivate(requestNumber, "InvalidCode"),
        Locked: failedActivate(requestNumber, "Locked"),
        EnrollmentChanged: failedActivate(requestNumber, "EnrollmentChanged"),
        AlreadyEnabled: failedActivate(requestNumber, "AlreadyEnabled"),
        MfaNotFound: failedActivate(requestNumber, "MfaNotFound"),
        RateLimited: failedActivate(requestNumber, "RateLimited"),
        Unauthorized: failedActivate(requestNumber, "Unauthorized"),
        HttpClientError: failedActivate(requestNumber, "Unexpected"),
        SchemaError: failedActivate(requestNumber, "Unexpected"),
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

export const init = (): Model => ({
  dialog: ReportingDialog.init({ id: DIALOG_ID }),
  step: Step.Starting(),
  maybeResumableEnrollment: Option.none(),
  qrCode: QrCode.Drawing(),
  requestNumber: 0,
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
      const requested = modifyFields(model, {
        step: () => Step.Starting(),
        qrCode: () => QrCode.Drawing(),
        requestNumber: Number.increment,
      });
      const opened = dialogFolds.open(requested);
      const enrolling: Update.Return<Model, Message, SpaHttpClient> = {
        model: opened.model,
        commands: [
          ...(opened.commands ?? []),
          EnrollMfa({ requestNumber: requested.requestNumber }),
        ],
      };
      return pipe(enrolling, Update.withOutMessage(opened.outMessage));
    },
  });

const forThisRequest = (model: Model, requestNumber: number, next: () => UpdateReturn) =>
  requestNumber === model.requestNumber ? next() : { model };

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
      return { model };
    }
    const requested = modifyFields(
      withStep(
        model,
        Step.Verify(modifyFields(verifying, { submission: () => Submission.Submitting() })),
      ),
      { requestNumber: Number.increment },
    );
    return {
      model: requested,
      commands: [
        ActivateMfa({
          requestNumber: requested.requestNumber,
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
      }));

export const update = (model: Model, message: Message) =>
  Message.match<UpdateReturn>(message, {
    ClickedEnable: () => (model.dialog.isOpen ? { model } : openDialog(model)),
    GotDialogMessage: ({ message: dialogMessage }) => dialogFolds.fold(model, dialogMessage),
    SucceededEnrollMfa: ({ requestNumber, enrollment }) =>
      forThisRequest(model, requestNumber, () =>
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
    FailedEnrollMfa: ({ requestNumber, failure }) =>
      forThisRequest(model, requestNumber, () =>
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
        model: withStep(model, Step.Verify(modifyFields(verifying, { code: () => value }))),
      })),
    SubmittedCode: () => submitCode(model),
    SucceededActivateMfa: ({ requestNumber }) =>
      forThisRequest(model, requestNumber, () =>
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
    FailedActivateMfa: ({ requestNumber, failure }) =>
      forThisRequest(model, requestNumber, () => failActivate(model, failure)),
    ClickedCloseAfterSavingCodes: () => dialogFolds.close(model),
    GotCopyResultMessage: ({ message: copyMessage }) => foldCopyResult(model, copyMessage),
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
  return h.form(
    [h.Class("space-y-4"), h.OnSubmit(Message.SubmittedCode())],
    [
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
          ariaLabel: TOTP_TEXTS.label,
          maxLength: MFA_CODE_PASTE_TOLERANT_MAX_LENGTH,
          isAutoCorrectionOff: true,
          hint: { text: TOTP_TEXTS.hint, maybeErrorMessage },
        },
        h,
      ),
      ...maybeInputErrorView(CODE_INPUT_ID, maybeErrorMessage, h),
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
              isBlocked: String.isEmpty(normalizeMfaCode(verifying.code, "totp")),
              icon: ShieldCheck,
            },
            h,
          ),
        ],
        h,
      ),
    ],
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
        [h.Class("grid grid-cols-2 gap-2 rounded-md bg-muted p-3"), h.Translate("no")],
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
    Failed: ({ message: failureMessage }) =>
      h.p([h.Class("py-2 text-sm text-destructive")], [failureMessage]),
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
