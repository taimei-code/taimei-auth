import { Effect, Option, Schema } from "effect";
import { Command, Port, Runtime, Update } from "foldkit";
import type { Html, HtmlBuilder } from "foldkit/html";
import { defineMessageUnion } from "foldkit/message";
import { defineTaggedUnion } from "foldkit/schema";
import { modifyFields } from "foldkit/struct";
import { Dialog } from "@foldkit/ui";

import { MfaEnrollment } from "@core/mfa/mfa-contract";

import { failureOutcome } from "../shared/failure-message";
import { declaredFailuresOnly, SpaHttpClient } from "../shared/spa-http-client";
import {
  buttonVariants,
  dialogClassNames,
  inputClassName,
  labelVariants,
} from "../shared/ui/class-names";
import { mfaFailureMessage } from "./mfa-atom";
import {
  mfaCodeEntryIds,
  mfaCodeEntryText,
  normalizeMfaCode,
  PASTE_TOLERANT_MAX_LENGTH,
} from "./use-mfa-code-entry";

export const EnrollStep = defineTaggedUnion({
  Starting: {},
  Scan: { enrollment: MfaEnrollment },
  Verify: { enrollment: MfaEnrollment },
  RecoveryCodes: { recoveryCodes: Schema.Array(Schema.String) },
  Failed: { message: Schema.String },
});
type EnrollStep = typeof EnrollStep.Type;

const QrCode = defineTaggedUnion({
  Drawing: {},
  Drawn: { dataUrl: Schema.String },
  Unavailable: {},
});
type QrCode = typeof QrCode.Type;

const CopyResult = defineTaggedUnion({
  Idle: {},
  Copied: {},
  NotCopied: {},
});
type CopyResult = typeof CopyResult.Type;

const Model = Schema.Struct({
  dialog: Dialog.Model,
  step: EnrollStep,
  resumableEnrollment: Schema.Option(MfaEnrollment),
  code: Schema.String,
  submitting: Schema.Boolean,
  codeError: Schema.Option(Schema.String),
  qrCode: QrCode,
  copyResult: CopyResult,
  copyResultShownCount: Schema.Finite,
});
export type Model = typeof Model.Type;

const EnrollmentOnServer = Schema.Literals(["unchanged", "replaced"]);

export const Message = defineMessageUnion({
  ClickedOpen: {},
  GotDialogMessage: { message: Dialog.Message },
  SucceededEnroll: { enrollment: MfaEnrollment },
  FailedEnroll: { message: Schema.String },
  SucceededDrawQrCode: { dataUrl: Schema.String },
  FailedDrawQrCode: {},
  ClickedNext: {},
  ClickedBack: {},
  ChangedCode: { value: Schema.String },
  SubmittedCode: {},
  SucceededActivate: {},
  FailedActivate: { message: Schema.String, enrollmentOnServer: EnrollmentOnServer },
  ClickedCopy: { text: Schema.String },
  SucceededCopy: {},
  FailedCopy: {},
  CompletedCopyResultDisplay: { shownCount: Schema.Finite },
  ClickedCloseAfterSavingCodes: {},
  CompletedReportEnabled: {},
});
export type Message = typeof Message.Type;

const COPY_RESULT_DISPLAY = "3 seconds";
const QR_CODE_WIDTH = 192;

const ports = {
  outbound: { enabledAndClosed: Port.outbound(Schema.Struct({})) },
};

export const EnrollMfa = Command.define("EnrollMfa", {
  messages: [Message.SucceededEnroll, Message.FailedEnroll],
  execute: Effect.gen(function* () {
    const client = yield* SpaHttpClient;
    const enrollment = yield* declaredFailuresOnly(client.mfa.enroll());
    return Message.SucceededEnroll({ enrollment });
  }).pipe(
    Effect.catchCause((cause) =>
      Effect.succeed(Message.FailedEnroll({ message: mfaFailureMessage(cause) })),
    ),
  ),
});

export const ActivateMfa = Command.define("ActivateMfa", {
  args: { code: Schema.String, enrollment: MfaEnrollment },
  messages: [Message.SucceededActivate, Message.FailedActivate],
  execute: ({ code, enrollment }) =>
    Effect.gen(function* () {
      const client = yield* SpaHttpClient;
      yield* declaredFailuresOnly(
        client.mfa.activate({ payload: { code, enrollment_id: enrollment.enrollment_id } }),
      );
      return Message.SucceededActivate();
    }).pipe(
      Effect.catchCause((cause) =>
        Effect.succeed(
          Message.FailedActivate({
            message: mfaFailureMessage(cause),
            enrollmentOnServer: failureOutcome(
              cause,
              {
                EnrollmentChanged: "replaced",
                InvalidCode: "unchanged",
                Locked: "unchanged",
                RateLimited: "unchanged",
                AlreadyEnabled: "unchanged",
                MfaNotFound: "unchanged",
              },
              "unchanged",
            ),
          }),
        ),
      ),
    ),
});

export const DrawQrCode = Command.define("DrawQrCode", {
  args: { totpUri: Schema.String },
  messages: [Message.SucceededDrawQrCode, Message.FailedDrawQrCode],
  execute: ({ totpUri }) =>
    Effect.tryPromise(() =>
      import("qrcode").then(({ toDataURL }) =>
        toDataURL(totpUri, { width: QR_CODE_WIDTH, margin: 1 }),
      ),
    ).pipe(
      Effect.map((dataUrl) => Message.SucceededDrawQrCode({ dataUrl })),
      Effect.orElseSucceed(() => Message.FailedDrawQrCode()),
    ),
});

const CopyText = Command.define("CopyText", {
  args: { text: Schema.String },
  messages: [Message.SucceededCopy, Message.FailedCopy],
  execute: ({ text }) =>
    Effect.tryPromise(() => navigator.clipboard.writeText(text)).pipe(
      Effect.as(Message.SucceededCopy()),
      Effect.orElseSucceed(() => Message.FailedCopy()),
    ),
});

export const WaitBeforeHidingCopyResult = Command.define("WaitBeforeHidingCopyResult", {
  args: { shownCount: Schema.Finite },
  messages: [Message.CompletedCopyResultDisplay],
  execute: ({ shownCount }) =>
    Effect.sleep(COPY_RESULT_DISPLAY).pipe(
      Effect.as(Message.CompletedCopyResultDisplay({ shownCount })),
    ),
});

export const ReportEnabled = Command.define("ReportEnabled", {
  messages: [Message.CompletedReportEnabled],
  execute: Port.emit(ports.outbound.enabledAndClosed, {}).pipe(
    Effect.as(Message.CompletedReportEnabled()),
  ),
});

const DIALOG_ID = "mfa-enroll";
const CODE_INPUT_ID = "mfa-enroll-code";
const { hintId: CODE_HINT_ID, errorId: CODE_ERROR_ID } = mfaCodeEntryIds(CODE_INPUT_ID);
const TOTP_ENTRY = mfaCodeEntryText("totp");

type UpdateReturn = Update.Return<Model, Message, SpaHttpClient>;
type Step = Update.Step<Model, Message, SpaHttpClient>;

export const init = (): UpdateReturn => ({
  model: {
    dialog: Dialog.init({ id: DIALOG_ID }),
    step: EnrollStep.Starting(),
    resumableEnrollment: Option.none(),
    code: "",
    submitting: false,
    codeError: Option.none(),
    qrCode: QrCode.Drawing(),
    copyResult: CopyResult.Idle(),
    copyResultShownCount: 0,
  },
});

const readDialog = (model: Model) => Option.some(model.dialog);
const writeDialog = (model: Model, dialog: Dialog.Model): Model =>
  modifyFields(model, { dialog: () => dialog });
const toGotDialogMessage = (message: Dialog.Message): Message =>
  Message.GotDialogMessage({ message });

const reportEnabledAfterRecoveryCodes: Step = (model) =>
  EnrollStep.match(model.step, {
    RecoveryCodes: () => ({ model, commands: [ReportEnabled()] }),
    Starting: () => ({ model }),
    Scan: () => ({ model }),
    Verify: () => ({ model }),
    Failed: () => ({ model }),
  });

const foldDialogOutMessage = Dialog.OutMessage.match<Step>({
  Opened: () => (model) => ({ model }),
  Closed: () => reportEnabledAfterRecoveryCodes,
});

const foldDialog = Update.foldChild({
  update: Dialog.update,
  read: readDialog,
  write: writeDialog,
  toParentMessage: toGotDialogMessage,
  foldOutMessage: foldDialogOutMessage,
});

const foldDialogOpen = Update.foldChildStep({
  update: Dialog.open,
  read: readDialog,
  write: writeDialog,
  toParentMessage: toGotDialogMessage,
  foldOutMessage: foldDialogOutMessage,
});

const foldDialogClose = Update.foldChildStep({
  update: Dialog.close,
  read: readDialog,
  write: writeDialog,
  toParentMessage: toGotDialogMessage,
  foldOutMessage: foldDialogOutMessage,
});

const isCloseRequest = Schema.is(Dialog.Message.RequestedClose);

const isClosingBlocked = (model: Model): boolean =>
  model.submitting ||
  EnrollStep.match(model.step, {
    Starting: () => true,
    Scan: () => false,
    Verify: () => false,
    RecoveryCodes: () => false,
    Failed: () => false,
  });

const appendCommand = (
  result: UpdateReturn,
  command: NonNullable<UpdateReturn["commands"]>[number],
): UpdateReturn => ({ ...result, commands: [...(result.commands ?? []), command] });

const openDialog = (model: Model): UpdateReturn => {
  const reset = modifyFields(init().model, {
    dialog: () => model.dialog,
    resumableEnrollment: () => model.resumableEnrollment,
  });
  return Option.match(model.resumableEnrollment, {
    onNone: () => appendCommand(foldDialogOpen(reset), EnrollMfa()),
    onSome: (enrollment) =>
      foldDialogOpen(
        modifyFields(reset, {
          step: () => EnrollStep.Scan({ enrollment }),
          qrCode: () => model.qrCode,
        }),
      ),
  });
};

const showCopyResult = (model: Model, result: CopyResult): UpdateReturn => {
  const shownCount = model.copyResultShownCount + 1;
  return {
    model: modifyFields(model, {
      copyResult: () => result,
      copyResultShownCount: () => shownCount,
    }),
    commands: [WaitBeforeHidingCopyResult({ shownCount })],
  };
};

const verifyingEnrollment = (model: Model): Option.Option<MfaEnrollment> =>
  EnrollStep.match(model.step, {
    Verify: ({ enrollment }) => Option.some(enrollment),
    Starting: () => Option.none(),
    Scan: () => Option.none(),
    RecoveryCodes: () => Option.none(),
    Failed: () => Option.none(),
  });

export const update = (model: Model, message: Message): UpdateReturn =>
  Message.match<UpdateReturn>(message, {
    ClickedOpen: () => (model.dialog.isOpen ? { model } : openDialog(model)),
    GotDialogMessage: ({ message: dialogMessage }) =>
      isCloseRequest(dialogMessage) && isClosingBlocked(model)
        ? { model }
        : foldDialog(model, dialogMessage),
    SucceededEnroll: ({ enrollment }) => ({
      model: modifyFields(model, {
        resumableEnrollment: () => Option.some(enrollment),
        step: () => EnrollStep.Scan({ enrollment }),
      }),
      commands: [DrawQrCode({ totpUri: enrollment.totp_uri })],
    }),
    FailedEnroll: ({ message: failure }) => ({
      model: modifyFields(model, { step: () => EnrollStep.Failed({ message: failure }) }),
    }),
    SucceededDrawQrCode: ({ dataUrl }) => ({
      model: modifyFields(model, { qrCode: () => QrCode.Drawn({ dataUrl }) }),
    }),
    FailedDrawQrCode: () => ({
      model: modifyFields(model, { qrCode: () => QrCode.Unavailable() }),
    }),
    ClickedNext: () => ({
      model: EnrollStep.match(model.step, {
        Scan: ({ enrollment }) =>
          modifyFields(model, { step: () => EnrollStep.Verify({ enrollment }) }),
        Starting: () => model,
        Verify: () => model,
        RecoveryCodes: () => model,
        Failed: () => model,
      }),
    }),
    ClickedBack: () => ({
      model: Option.match(verifyingEnrollment(model), {
        onNone: () => model,
        onSome: (enrollment) =>
          model.submitting
            ? model
            : modifyFields(model, { step: () => EnrollStep.Scan({ enrollment }) }),
      }),
    }),
    ChangedCode: ({ value }) => ({ model: modifyFields(model, { code: () => value }) }),
    SubmittedCode: () => {
      const code = normalizeMfaCode(model.code, "totp");
      return Option.match(verifyingEnrollment(model), {
        onNone: () => ({ model }),
        onSome: (enrollment) =>
          model.submitting || code === ""
            ? { model }
            : {
                model: modifyFields(model, {
                  submitting: () => true,
                  codeError: () => Option.none(),
                }),
                commands: [ActivateMfa({ code, enrollment })],
              },
      });
    },
    SucceededActivate: () => ({
      model: Option.match(verifyingEnrollment(model), {
        onNone: () => modifyFields(model, { submitting: () => false }),
        onSome: (enrollment) =>
          modifyFields(model, {
            submitting: () => false,
            resumableEnrollment: () => Option.none(),
            step: () => EnrollStep.RecoveryCodes({ recoveryCodes: enrollment.recovery_codes }),
            copyResult: () => CopyResult.Idle(),
          }),
      }),
    }),
    FailedActivate: ({ message: failure, enrollmentOnServer }) => ({
      model: modifyFields(model, {
        submitting: () => false,
        codeError: () => Option.some(failure),
        resumableEnrollment: (current) =>
          enrollmentOnServer === "replaced" ? Option.none() : current,
      }),
    }),
    ClickedCopy: ({ text }) => ({ model, commands: [CopyText({ text })] }),
    SucceededCopy: () => showCopyResult(model, CopyResult.Copied()),
    FailedCopy: () => showCopyResult(model, CopyResult.NotCopied()),
    CompletedCopyResultDisplay: ({ shownCount }) => ({
      model:
        shownCount === model.copyResultShownCount
          ? modifyFields(model, { copyResult: () => CopyResult.Idle() })
          : model,
    }),
    ClickedCloseAfterSavingCodes: () => foldDialogClose(model),
    CompletedReportEnabled: () => ({ model }),
  });

const readTotpSecret = (totpUri: string): Option.Option<string> =>
  URL.canParse(totpUri)
    ? Option.fromNullishOr(new URL(totpUri).searchParams.get("secret"))
    : Option.none();

const copyButtonView = (
  h: HtmlBuilder<Message>,
  text: string,
  label: string,
  result: CopyResult,
): Html =>
  h.div(
    [h.Class("flex items-center gap-2")],
    [
      h.button(
        [
          h.Type("button"),
          h.Class(buttonVariants({ variant: "outline", size: "sm" })),
          h.OnClick(Message.ClickedCopy({ text })),
        ],
        [label],
      ),
      ...CopyResult.match(result, {
        Idle: () => [],
        Copied: () => [h.span([h.Class("text-xs text-muted-foreground")], ["コピーしました"])],
        NotCopied: () => [
          h.span([h.Class("text-xs text-destructive")], ["コピーできませんでした"]),
        ],
      }),
    ],
  );

const footerView = (h: HtmlBuilder<Message>, children: readonly Html[]): Html =>
  h.div([h.Class(dialogClassNames.footer)], [...children]);

const qrCodeView = (h: HtmlBuilder<Message>, qrCode: QrCode): Html =>
  QrCode.match(qrCode, {
    Drawing: () =>
      h.div(
        [h.Class("flex h-48 items-center justify-center")],
        [h.span([h.Class("size-5 animate-pulse rounded-full bg-muted"), h.AriaHidden(true)])],
      ),
    Drawn: ({ dataUrl }) =>
      h.img([
        h.Src(dataUrl),
        h.Width("192"),
        h.Height("192"),
        h.Alt("認証アプリで読み取る QR コード"),
        h.Class("mx-auto rounded-md border border-border bg-white p-2"),
      ]),
    Unavailable: () =>
      h.p(
        [h.Class("text-sm text-muted-foreground")],
        ["QR コードを表示できませんでした。下の secret を認証アプリに手入力してください。"],
      ),
  });

const scanView = (h: HtmlBuilder<Message>, model: Model, enrollment: MfaEnrollment): Html => {
  const totpSecret = readTotpSecret(enrollment.totp_uri);
  return h.div(
    [h.Class("space-y-4")],
    [
      qrCodeView(h, model.qrCode),
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
            [Option.getOrElse(totpSecret, () => "—")],
          ),
          ...Option.match(totpSecret, {
            onNone: () => [],
            onSome: (secret) => [copyButtonView(h, secret, "secret をコピー", model.copyResult)],
          }),
        ],
      ),
      footerView(h, [
        h.button(
          [h.Type("button"), h.Class(buttonVariants()), h.OnClick(Message.ClickedNext())],
          ["次へ"],
        ),
      ]),
    ],
  );
};

const verifyView = (h: HtmlBuilder<Message>, model: Model): Html => {
  const canSubmit = !model.submitting && normalizeMfaCode(model.code, "totp") !== "";
  const hasError = Option.isSome(model.codeError);
  return h.form(
    [h.OnSubmit(Message.SubmittedCode()), h.Class("space-y-4")],
    [
      h.div(
        [h.Class("space-y-2")],
        [
          h.label([h.For(CODE_INPUT_ID), h.Class(labelVariants())], [TOTP_ENTRY.labelText]),
          h.input([
            h.Id(CODE_INPUT_ID),
            h.Value(model.code),
            h.OnInput((value) => Message.ChangedCode({ value })),
            h.Disabled(model.submitting),
            h.Required(true),
            h.Autocomplete("one-time-code"),
            h.InputMode(TOTP_ENTRY.inputMode),
            h.Autocapitalize("off"),
            h.Autocorrect("off"),
            h.Spellcheck(false),
            h.Maxlength(PASTE_TOLERANT_MAX_LENGTH),
            h.Placeholder(TOTP_ENTRY.placeholder),
            h.AriaLabel(TOTP_ENTRY.labelText),
            h.AriaInvalid(hasError),
            h.AriaDescribedBy(hasError ? `${CODE_HINT_ID} ${CODE_ERROR_ID}` : CODE_HINT_ID),
            h.Class(inputClassName),
          ]),
          h.p([h.Id(CODE_HINT_ID), h.Class("text-xs text-muted-foreground")], [TOTP_ENTRY.hint]),
        ],
      ),
      ...Option.match(model.codeError, {
        onNone: () => [],
        onSome: (failure) => [
          h.p(
            [h.Id(CODE_ERROR_ID), h.Role("alert"), h.Class("text-sm text-destructive")],
            [failure],
          ),
        ],
      }),
      footerView(h, [
        h.button(
          [
            h.Type("button"),
            h.Class(buttonVariants({ variant: "outline" })),
            h.Disabled(model.submitting),
            h.OnClick(Message.ClickedBack()),
          ],
          ["戻る"],
        ),
        h.button(
          [h.Type("submit"), h.Class(buttonVariants()), h.Disabled(!canSubmit)],
          ["有効にする"],
        ),
      ]),
    ],
  );
};

const recoveryCodesView = (
  h: HtmlBuilder<Message>,
  model: Model,
  recoveryCodes: readonly string[],
): Html =>
  h.div(
    [h.Class("space-y-4")],
    [
      h.p(
        [h.Class("text-sm text-destructive")],
        [
          "このダイアログを閉じると再表示できません。認証アプリを使えなくなった時の唯一のログイン手段なので、必ず控えてから閉じてください。",
        ],
      ),
      h.ul(
        [h.Class("grid grid-cols-2 gap-2 rounded-md bg-muted p-3"), h.Translate("no")],
        recoveryCodes.map((code) => h.li([h.Key(code), h.Class("font-mono text-sm")], [code])),
      ),
      copyButtonView(h, recoveryCodes.join("\n"), "リカバリーコードをコピー", model.copyResult),
      footerView(h, [
        h.button(
          [
            h.Type("button"),
            h.Class(buttonVariants()),
            h.OnClick(Message.ClickedCloseAfterSavingCodes()),
          ],
          ["控えたので閉じる"],
        ),
      ]),
    ],
  );

const stepView = (h: HtmlBuilder<Message>, model: Model): Html =>
  EnrollStep.match(model.step, {
    Starting: () =>
      h.div(
        [h.Class("flex justify-center py-8"), h.Role("status"), h.AriaLive("polite")],
        [h.span([h.Class("sr-only")], ["読み込み中…"])],
      ),
    Failed: ({ message: failure }) => h.p([h.Class("py-2 text-sm text-destructive")], [failure]),
    Scan: ({ enrollment }) => scanView(h, model, enrollment),
    Verify: () => verifyView(h, model),
    RecoveryCodes: ({ recoveryCodes }) => recoveryCodesView(h, model, recoveryCodes),
  });

const ENROLL_DESCRIPTION = "認証アプリを登録すると、ログイン時に確認コードの入力を求めます。";

const dialogDescription = (step: EnrollStep): string =>
  EnrollStep.match(step, {
    RecoveryCodes: () => "リカバリーコードを安全な場所に保管してください。",
    Starting: () => ENROLL_DESCRIPTION,
    Scan: () => ENROLL_DESCRIPTION,
    Verify: () => ENROLL_DESCRIPTION,
    Failed: () => ENROLL_DESCRIPTION,
  });

const view = (model: Model, h: HtmlBuilder<Message>): Html =>
  h.div(
    [],
    [
      h.button(
        [
          h.Type("button"),
          h.Class(buttonVariants({ size: "sm" })),
          h.OnClick(Message.ClickedOpen()),
        ],
        ["有効にする"],
      ),
      h.submodel({
        slotId: model.dialog.id,
        model: model.dialog,
        view: Dialog.view,
        viewInputs: {
          hasDescription: true,
          toView: ({ dialog, backdrop, panel, title, description, closeButton, isVisible }) =>
            h.dialog(
              [...dialog],
              isVisible
                ? [
                    h.div([...backdrop, h.Class(dialogClassNames.overlay)]),
                    h.div(
                      [...panel, h.Class(dialogClassNames.content)],
                      [
                        h.div(
                          [h.Class(dialogClassNames.header)],
                          [
                            h.h2(
                              [...title, h.Class(dialogClassNames.title)],
                              ["多要素認証 (MFA) を有効にする"],
                            ),
                            h.p(
                              [...description, h.Class(dialogClassNames.description)],
                              [dialogDescription(model.step)],
                            ),
                          ],
                        ),
                        stepView(h, model),
                        h.button(
                          [
                            ...closeButton,
                            h.Disabled(isClosingBlocked(model)),
                            h.Class(dialogClassNames.close),
                          ],
                          [
                            h.svg(
                              [
                                h.AriaHidden(true),
                                h.Class("h-4 w-4"),
                                h.Xmlns("http://www.w3.org/2000/svg"),
                                h.Fill("none"),
                                h.ViewBox("0 0 24 24"),
                                h.StrokeWidth("2"),
                                h.Stroke("currentColor"),
                              ],
                              [
                                h.path([h.StrokeLinecap("round"), h.D("M18 6 6 18")]),
                                h.path([h.StrokeLinecap("round"), h.D("m6 6 12 12")]),
                              ],
                            ),
                            h.span([h.Class("sr-only")], ["Close"]),
                          ],
                        ),
                      ],
                    ),
                  ]
                : [],
            ),
        },
        toParentMessage: toGotDialogMessage,
      }),
    ],
  );

const makeEnrollElement = (container: HTMLElement) =>
  Runtime.makeElement({
    Model,
    init,
    update,
    view,
    container,
    ports,
    resources: SpaHttpClient.layer,
  });

export const embedEnrollElement = (container: HTMLElement) =>
  Runtime.embed(makeEnrollElement(container));
