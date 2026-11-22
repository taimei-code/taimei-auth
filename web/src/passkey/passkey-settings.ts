import type { PasskeyListResponse } from "@core/passkey/passkey-contract";
import { isPasskeyLimitReached } from "@core/passkey/policy";
import { Array, DateTime, Effect, Option, Schema, String } from "effect";
import { Command, Submodel, Update } from "foldkit";
import type { Html, HtmlBuilder } from "foldkit/html";
import { defineMessageUnion } from "foldkit/message";
import { defineTaggedUnion } from "foldkit/schema";
import { modifyFields } from "foldkit/struct";

import {
  isCurrentPageRequest,
  type PageRequest,
  PageRequestFields,
  firstPageRequest,
  pageRequestOf,
  withNextPageRequest,
} from "../shared/page-request";
import {
  MFA_CODE_PASTE_TOLERANT_MAX_LENGTH,
  MFA_CODE_TEXTS,
  normalizeMfaCode,
} from "../mfa/mfa-code";
import { focusField, requiredErrorText } from "../shared/required-field";
import { SpaHttpClient } from "../shared/spa-http-client";
import { Submission, submissionWhile } from "../shared/submission";
import { alertTextView } from "../shared/ui/alert-text-view";
import { buttonView } from "../shared/ui/button-view";
import {
  Dialog,
  type DialogContent,
  type DialogMessage,
  ReportingDialog,
  dialogFooterView,
  dialogView,
  isDialogVisible,
  reportingDialogFoldsOf,
} from "../shared/ui/dialog-view";
import { formView } from "../shared/ui/form-view";
import { inputView } from "../shared/ui/input-view";
import { settingRowView } from "../shared/ui/setting-row-view";
import { NoticeTone } from "../shared/ui/toast-view";
import { passkeyFailureText } from "./passkey-failure-messages";
import { PasskeyRegistration, registerPasskey } from "./passkey-registration";
import { isPasskeySupported } from "./webauthn";

type PasskeyApi = SpaHttpClient["Service"]["passkey"];

const UNKNOWN_PROVIDER_NAME = "パスキー";

const ListedPasskey = Schema.Struct({
  id: Schema.String,
  createdAt: Schema.DateTimeUtc,
  maybeLastUsedAt: Schema.Option(Schema.DateTimeUtc),
  providerName: Schema.String,
});
type ListedPasskey = typeof ListedPasskey.Type;

export const PasskeyList = defineTaggedUnion({
  Failed: {},
  Hidden: {},
  Shown: { passkeys: Schema.Array(ListedPasskey), registrable: Schema.Boolean },
});
export type PasskeyList = typeof PasskeyList.Type;

const passkeyListOf = (wire: PasskeyListResponse, browserSupported: boolean): PasskeyList =>
  Array.isReadonlyArrayEmpty(wire.passkeys) && !wire.can_register
    ? PasskeyList.Hidden()
    : PasskeyList.Shown({
        passkeys: wire.passkeys.map((passkey) => ({
          id: passkey.id,
          createdAt: passkey.created_at,
          maybeLastUsedAt: Option.fromNullishOr(passkey.last_used_at),
          providerName: passkey.provider_name ?? UNKNOWN_PROVIDER_NAME,
        })),
        registrable: wire.can_register && browserSupported,
      });

const listUnavailable = () => Effect.succeed(PasskeyList.Failed());

export const loadPasskeyList = (passkeyApi: PasskeyApi) =>
  Effect.all([passkeyApi.list(), isPasskeySupported]).pipe(
    Effect.map(([wire, browserSupported]) => passkeyListOf(wire, browserSupported)),
    Effect.catchTags({
      RateLimited: listUnavailable,
      HttpClientError: listUnavailable,
      SchemaError: listUnavailable,
    }),
  );

const Busy = defineTaggedUnion({
  Idle: {},
  Registering: {},
  Deleting: {},
});

export const OutMessage = defineMessageUnion({
  Registered: {},
  Deleted: {},
  Notified: { tone: NoticeTone, text: Schema.String },
  RequiredSignIn: {},
});
export type OutMessage = typeof OutMessage.Type;

const DialogSubject = defineTaggedUnion({
  Deletion: { passkey: ListedPasskey },
  TotpEntry: { code: Schema.String, maybeRejection: Schema.Option(Schema.String) },
});
type DialogSubject = typeof DialogSubject.Type;

export const Model = Schema.Struct({
  busy: Busy,
  dialog: ReportingDialog.Model(OutMessage),
  maybeDialogSubject: Schema.Option(DialogSubject),
  ...PageRequestFields,
});
export type Model = typeof Model.Type;

const RegistrationFailure = Schema.Literals([
  "RateLimited",
  "TotpRequired",
  "InvalidCode",
  "Locked",
  "NotEnabled",
  "PasskeyRejected",
  "PasskeyAlreadyRegistered",
  "PasskeyRegistrationUnavailable",
  "PasskeyLimitReached",
  "Unauthorized",
  "Unexpected",
]);
type RegistrationFailure = typeof RegistrationFailure.Type;

const DeletionFailure = Schema.Literals(["RateLimited", "NotFound", "Unauthorized", "Unexpected"]);
type DeletionFailure = typeof DeletionFailure.Type;

export const Message = defineMessageUnion({
  ClickedRegister: {},
  ClickedRegisterWithTotp: {},
  UpdatedTotpCode: { value: Schema.String },
  SubmittedTotpCode: {},
  ClickedCancelTotpEntry: {},
  CompletedFocusTotpCode: {},
  SucceededRegisterPasskey: PageRequestFields,
  CancelledRegisterPasskey: PageRequestFields,
  FailedRegisterPasskey: { ...PageRequestFields, failure: RegistrationFailure },
  ClickedDelete: { passkey: ListedPasskey },
  ClickedCancelDeletion: {},
  ClickedConfirmDeletion: {},
  GotDialogMessage: { message: Dialog.Message },
  SucceededDeletePasskey: PageRequestFields,
  FailedDeletePasskey: { ...PageRequestFields, failure: DeletionFailure },
});
export type Message = typeof Message.Type;

const failedRegister = (request: PageRequest, failure: RegistrationFailure) => () =>
  Effect.succeed(Message.FailedRegisterPasskey({ ...request, failure }));

export const RegisterPasskey = Command.define("RegisterPasskey", {
  args: { ...PageRequestFields, maybeTotpCode: Schema.Option(Schema.String) },
  messages: [
    Message.SucceededRegisterPasskey,
    Message.CancelledRegisterPasskey,
    Message.FailedRegisterPasskey,
  ],
  execute: ({ maybeTotpCode, ...request }) =>
    Effect.gen(function* () {
      const client = yield* SpaHttpClient;
      const registration = yield* registerPasskey(
        client.passkey,
        Option.getOrUndefined(maybeTotpCode),
      );
      return PasskeyRegistration.$match(registration, {
        Registered: () => Message.SucceededRegisterPasskey(request),
        Cancelled: () => Message.CancelledRegisterPasskey(request),
      });
    }).pipe(
      Effect.catchTags({
        RateLimited: failedRegister(request, "RateLimited"),
        TotpRequired: failedRegister(request, "TotpRequired"),
        InvalidCode: failedRegister(request, "InvalidCode"),
        Locked: failedRegister(request, "Locked"),
        NotEnabled: failedRegister(request, "NotEnabled"),
        PasskeyRejected: failedRegister(request, "PasskeyRejected"),
        PasskeyAlreadyRegistered: failedRegister(request, "PasskeyAlreadyRegistered"),
        PasskeyRegistrationUnavailable: failedRegister(request, "PasskeyRegistrationUnavailable"),
        PasskeyLimitReached: failedRegister(request, "PasskeyLimitReached"),
        Unauthorized: failedRegister(request, "Unauthorized"),
        PasskeyCreationFailed: failedRegister(request, "Unexpected"),
        HttpClientError: failedRegister(request, "Unexpected"),
        SchemaError: failedRegister(request, "Unexpected"),
      }),
    ),
});

const failedDelete = (request: PageRequest, failure: DeletionFailure) => () =>
  Effect.succeed(Message.FailedDeletePasskey({ ...request, failure }));

export const DeletePasskey = Command.define("DeletePasskey", {
  args: { ...PageRequestFields, passkeyId: Schema.String },
  messages: [Message.SucceededDeletePasskey, Message.FailedDeletePasskey],
  execute: ({ passkeyId, ...request }) =>
    Effect.gen(function* () {
      const client = yield* SpaHttpClient;
      yield* client.passkey.delete({ params: { passkeyId } });
      return Message.SucceededDeletePasskey(request);
    }).pipe(
      Effect.catchTags({
        RateLimited: failedDelete(request, "RateLimited"),
        NotFound: failedDelete(request, "NotFound"),
        Unauthorized: failedDelete(request, "Unauthorized"),
        HttpClientError: failedDelete(request, "Unexpected"),
        SchemaError: failedDelete(request, "Unexpected"),
      }),
    ),
});

const DIALOG_ID = "passkey-deletion-dialog";

const TOTP_CODE_INPUT_ID = "passkey-totp-code";

const FocusTotpCode = Command.define("FocusTotpCode", {
  messages: [Message.CompletedFocusTotpCode],
  execute: focusField(TOTP_CODE_INPUT_ID).pipe(Effect.as(Message.CompletedFocusTotpCode())),
});

export const init = (visit: number): Model => ({
  busy: Busy.Idle(),
  dialog: ReportingDialog.init({ id: DIALOG_ID }),
  maybeDialogSubject: Option.none(),
  ...firstPageRequest(visit),
});

type UpdateReturn = Update.ReturnWithOutMessage<Model, Message, OutMessage, SpaHttpClient>;

const isIdle = (model: Model) => Busy.guards.Idle(model.busy);

const isRegistering = (model: Model) => Busy.guards.Registering(model.busy);

const isDeleting = (model: Model) => Busy.guards.Deleting(model.busy);

const isBusy = (model: Model) => !isIdle(model);

const backToIdle = (model: Model): Model => modifyFields(model, { busy: () => Busy.Idle() });

const toDialogMessage = (message: DialogMessage) => Message.GotDialogMessage({ message });

const dialogFolds = reportingDialogFoldsOf<OutMessage>()({
  isClosingBlocked: isBusy,
  toParentMessage: toDialogMessage,
  whenClosed: (model) =>
    modifyFields(isDeleting(model) ? backToIdle(model) : model, {
      maybeDialogSubject: () => Option.none(),
    }),
});

const whileIdle = (model: Model, next: () => UpdateReturn): UpdateReturn =>
  isIdle(model) ? next() : { model };

const startRegistration = (model: Model, maybeTotpCode: Option.Option<string>): UpdateReturn =>
  whileIdle(model, () => {
    const requested = withNextPageRequest(modifyFields(model, { busy: () => Busy.Registering() }));
    return {
      model: requested,
      commands: [RegisterPasskey({ ...pageRequestOf(requested), maybeTotpCode })],
    };
  });

const maybeOpenSubject = (model: Model): Option.Option<DialogSubject> =>
  Option.filter(model.maybeDialogSubject, () => model.dialog.isOpen);

const maybeOpenTotpEntry = (model: Model) =>
  Option.filter(maybeOpenSubject(model), DialogSubject.guards.TotpEntry);

const withTotpEntry = (model: Model, code: string, maybeRejection: Option.Option<string>): Model =>
  modifyFields(model, {
    maybeDialogSubject: () => Option.some(DialogSubject.TotpEntry({ code, maybeRejection })),
  });

const openWith = (model: Model, subject: DialogSubject): UpdateReturn =>
  whileIdle(model, () => {
    const opened = dialogFolds.open(model);
    return {
      ...opened,
      model: modifyFields(opened.model, { maybeDialogSubject: () => Option.some(subject) }),
    };
  });

const openTotpEntry = (model: Model): UpdateReturn =>
  openWith(model, DialogSubject.TotpEntry({ code: "", maybeRejection: Option.none() }));

const updateTotpCode = (model: Model, value: string): UpdateReturn =>
  whileIdle(model, () =>
    Option.match(maybeOpenTotpEntry(model), {
      onNone: () => ({ model }),
      onSome: () => ({ model: withTotpEntry(model, value, Option.none()) }),
    }),
  );

const submitTotpCode = (model: Model): UpdateReturn =>
  whileIdle(model, () =>
    Option.match(maybeOpenTotpEntry(model), {
      onNone: () => ({ model }),
      onSome: (entry) => {
        const code = normalizeMfaCode(entry.code, "totp");
        return String.isEmpty(code)
          ? {
              model: withTotpEntry(
                model,
                entry.code,
                Option.some(requiredErrorText(MFA_CODE_TEXTS.totp.label)),
              ),
              commands: [FocusTotpCode()],
            }
          : startRegistration(model, Option.some(code));
      },
    }),
  );

const confirmDeletion = (model: Model): UpdateReturn =>
  whileIdle(model, () =>
    Option.match(Option.filter(maybeOpenSubject(model), DialogSubject.guards.Deletion), {
      onNone: () => ({ model }),
      onSome: ({ passkey }) => {
        const requested = withNextPageRequest(modifyFields(model, { busy: () => Busy.Deleting() }));
        return {
          model: requested,
          commands: [DeletePasskey({ ...pageRequestOf(requested), passkeyId: passkey.id })],
        };
      },
    }),
  );

const settleRegistration = (
  model: Model,
  response: PageRequest,
  settle: (settled: Model) => UpdateReturn,
): UpdateReturn =>
  isCurrentPageRequest(model, response) && isRegistering(model)
    ? settle(backToIdle(model))
    : { model };

const reportRegistration = (
  model: Model,
  maybeOutMessage: Option.Option<OutMessage>,
): UpdateReturn => {
  const isTotpEntryOpen = Option.isSome(maybeOpenTotpEntry(model));
  return Option.match(maybeOutMessage, {
    onNone: () => (isTotpEntryOpen ? dialogFolds.close(model) : { model }),
    onSome: (outMessage) =>
      isTotpEntryOpen ? dialogFolds.closeThen(model, outMessage) : { model, outMessage },
  });
};

const outMessageOfFailure = (failure: RegistrationFailure | DeletionFailure): OutMessage =>
  failure === "Unauthorized"
    ? OutMessage.RequiredSignIn()
    : OutMessage.Notified({ tone: "Error", text: passkeyFailureText(failure) });

const failRegistration = (model: Model, failure: RegistrationFailure): UpdateReturn => {
  const maybeEntry = maybeOpenTotpEntry(model);
  return (failure === "InvalidCode" || failure === "Locked") && Option.isSome(maybeEntry)
    ? {
        model: withTotpEntry(
          model,
          maybeEntry.value.code,
          Option.some(passkeyFailureText(failure)),
        ),
        commands: [FocusTotpCode()],
      }
    : reportRegistration(model, Option.some(outMessageOfFailure(failure)));
};

const closeDeletionThen = (
  model: Model,
  response: PageRequest,
  outMessage: OutMessage,
): UpdateReturn =>
  isCurrentPageRequest(model, response) && isDeleting(model)
    ? dialogFolds.closeThen(model, outMessage)
    : { model };

export const update = (model: Model, message: Message) =>
  Message.match<UpdateReturn>(message, {
    ClickedRegister: () => startRegistration(model, Option.none()),
    ClickedRegisterWithTotp: () => openTotpEntry(model),
    UpdatedTotpCode: ({ value }) => updateTotpCode(model, value),
    SubmittedTotpCode: () => submitTotpCode(model),
    ClickedCancelTotpEntry: () => whileIdle(model, () => dialogFolds.close(model)),
    CompletedFocusTotpCode: () => ({ model }),
    SucceededRegisterPasskey: (response) =>
      settleRegistration(model, response, (settled) =>
        reportRegistration(settled, Option.some(OutMessage.Registered())),
      ),
    CancelledRegisterPasskey: (response) =>
      settleRegistration(model, response, (settled) => reportRegistration(settled, Option.none())),
    FailedRegisterPasskey: ({ failure, ...response }) =>
      settleRegistration(model, response, (settled) => failRegistration(settled, failure)),
    ClickedDelete: ({ passkey }) => openWith(model, DialogSubject.Deletion({ passkey })),
    ClickedCancelDeletion: () => whileIdle(model, () => dialogFolds.close(model)),
    ClickedConfirmDeletion: () => confirmDeletion(model),
    GotDialogMessage: ({ message: dialogMessage }) => dialogFolds.fold(model, dialogMessage),
    SucceededDeletePasskey: (response) => closeDeletionThen(model, response, OutMessage.Deleted()),
    FailedDeletePasskey: ({ failure, ...response }) =>
      closeDeletionThen(model, response, outMessageOfFailure(failure)),
  });

const LIST_UNAVAILABLE = "パスキーの一覧を取得できませんでした。";

const dayFormatter = new Intl.DateTimeFormat("ja-JP", { dateStyle: "medium" });

const dayOf = (dateTime: DateTime.Utc): string => dayFormatter.format(DateTime.toDateUtc(dateTime));

const registeredOnText = (passkey: ListedPasskey): string => `登録日 ${dayOf(passkey.createdAt)}`;

const lastUsedOnText = (passkey: ListedPasskey): string =>
  `最後に使った日 ${Option.match(passkey.maybeLastUsedAt, { onNone: () => "未使用", onSome: dayOf })}`;

const passkeyText = (passkey: ListedPasskey): string =>
  `${passkey.providerName}、${registeredOnText(passkey)}、${lastUsedOnText(passkey)}`;

const passkeyItemView = (model: Model, passkey: ListedPasskey, h: HtmlBuilder<Message>): Html =>
  h.keyed("li")(
    passkey.id,
    [h.Class("flex items-center justify-between gap-3 py-2 text-sm text-muted-foreground")],
    [
      h.div(
        [h.Class("min-w-0")],
        [
          h.p([h.Class("font-medium text-foreground")], [passkey.providerName]),
          h.p(
            [h.Class("mt-1 flex flex-wrap gap-x-4 gap-y-1")],
            [h.span([], [registeredOnText(passkey)]), h.span([], [lastUsedOnText(passkey)])],
          ),
        ],
      ),
      buttonView(
        {
          label: "削除",
          accessibleNamePrefix: `${passkeyText(passkey)} のパスキーを`,
          type: "button",
          look: "ghostSmall",
          submission: Submission.Idle(),
          isBlocked: isBusy(model),
          onClick: Message.ClickedDelete({ passkey }),
        },
        h,
      ),
    ],
  );

const passkeysView = (
  model: Model,
  passkeys: ReadonlyArray<ListedPasskey>,
  h: HtmlBuilder<Message>,
): Html =>
  Array.isReadonlyArrayNonEmpty(passkeys)
    ? h.ul(
        [h.Role("list"), h.Class("mt-2 divide-y")],
        passkeys.map((passkey) => passkeyItemView(model, passkey, h)),
      )
    : h.p([h.Class("mt-2 text-sm text-muted-foreground")], ["登録したパスキーはありません"]);

const passkeyRowView = (
  details: ReadonlyArray<Html>,
  actions: ReadonlyArray<Html>,
  h: HtmlBuilder<Message>,
): Html =>
  settingRowView(
    { title: "パスキー", description: "指紋・顔認証・PIN でログインできます", details, actions },
    h,
  );

const LIMIT_NOTICE_ID = "passkey-limit-notice";

const limitNoticeView = (h: HtmlBuilder<Message>): Html =>
  h.p(
    [h.Id(LIMIT_NOTICE_ID), h.Class("mt-2 text-sm text-muted-foreground")],
    [
      "登録できるパスキーの数の上限に達しています。不要なパスキーを削除すると、新しく登録できます。",
    ],
  );

const registerButtonView = (
  model: Model,
  { limitReached, mfaEnabled }: Readonly<{ limitReached: boolean; mfaEnabled: boolean }>,
  h: HtmlBuilder<Message>,
): Html =>
  buttonView(
    {
      label: "登録する",
      type: "button",
      look: "outlineSmall",
      submission: submissionWhile(isRegistering(model)),
      isBlocked: isDeleting(model) || limitReached,
      describedBy: limitReached ? LIMIT_NOTICE_ID : undefined,
      onClick: mfaEnabled ? Message.ClickedRegisterWithTotp() : Message.ClickedRegister(),
    },
    h,
  );

const deletionContent = (
  model: Model,
  maybePasskey: Option.Option<ListedPasskey>,
  h: HtmlBuilder<Message>,
): DialogContent => ({
  title: "パスキーの削除",
  description: Option.match(maybePasskey, {
    onNone: () => "",
    onSome: (passkey) =>
      `${passkeyText(passkey)} のパスキーを削除します。削除すると、このパスキーではログインできなくなります。`,
  }),
  body: [
    dialogFooterView(
      [
        buttonView(
          {
            label: "キャンセル",
            type: "button",
            look: "outlineInline",
            submission: Submission.Idle(),
            isBlocked: isBusy(model),
            onClick: Message.ClickedCancelDeletion(),
          },
          h,
        ),
        buttonView(
          {
            label: "削除する",
            type: "button",
            look: "destructive",
            submission: submissionWhile(isDeleting(model)),
            isBlocked: false,
            onClick: Message.ClickedConfirmDeletion(),
          },
          h,
        ),
      ],
      h,
    ),
  ],
  isClosingBlocked: isBusy(model),
});

const totpSubmissionOf = (model: Model, maybeRejection: Option.Option<string>): Submission =>
  isRegistering(model)
    ? Submission.Submitting()
    : Option.match(maybeRejection, {
        onNone: () => Submission.Idle(),
        onSome: (message) => Submission.Rejected({ message }),
      });

const totpEntryContent = (
  model: Model,
  { code, maybeRejection }: Readonly<{ code: string; maybeRejection: Option.Option<string> }>,
  h: HtmlBuilder<Message>,
): DialogContent => {
  const texts = MFA_CODE_TEXTS.totp;
  const submission = totpSubmissionOf(model, maybeRejection);
  return {
    title: "パスキーを登録する",
    description:
      "本人確認のため、認証アプリの確認コードを入力してください。認証アプリを使えない時は、リカバリーコードで多要素認証 (MFA) を無効にしてから登録してください。",
    body: [
      formView(
        {
          onSubmit: Message.SubmittedTotpCode(),
          attributes: [h.Class("space-y-4")],
          children: [
            inputView(
              {
                id: TOTP_CODE_INPUT_ID,
                label: texts.label,
                type: "text",
                value: code,
                onInput: (value) => Message.UpdatedTotpCode({ value }),
                submission,
                placeholder: texts.placeholder,
                autocomplete: "one-time-code",
                inputMode: texts.inputMode,
                maxLength: MFA_CODE_PASTE_TOLERANT_MAX_LENGTH,
                isAutoCorrectionOff: true,
                hint: texts.hint,
                maybeErrorMessage: maybeRejection,
                enterKeyHint: "go",
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
                    isBlocked: isBusy(model),
                    onClick: Message.ClickedCancelTotpEntry(),
                  },
                  h,
                ),
                buttonView(
                  {
                    label: "次へ",
                    type: "submit",
                    look: "primaryInline",
                    submission,
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
      ),
    ],
    isClosingBlocked: isBusy(model),
  };
};

const subjectDialogView = (model: Model, h: HtmlBuilder<Message>): Html =>
  dialogView(
    model.dialog,
    toDialogMessage,
    Option.match(model.maybeDialogSubject, {
      onNone: () => deletionContent(model, Option.none(), h),
      onSome: DialogSubject.match({
        Deletion: ({ passkey }) => deletionContent(model, Option.some(passkey), h),
        TotpEntry: (entry) => totpEntryContent(model, entry, h),
      }),
    }),
    h,
  );

export const view = Submodel.defineView<
  Model,
  Message,
  Readonly<{ list: PasskeyList; mfaEnabled: boolean }>
>((model, { list, mfaEnabled }, h) =>
  PasskeyList.match(list, {
    Hidden: () =>
      isDialogVisible(model.dialog) ? passkeyRowView([subjectDialogView(model, h)], [], h) : null,
    Failed: () =>
      passkeyRowView([alertTextView(LIST_UNAVAILABLE, h), subjectDialogView(model, h)], [], h),
    Shown: ({ passkeys, registrable }) => {
      const limitReached = registrable && isPasskeyLimitReached(passkeys.length);
      return passkeyRowView(
        [
          limitReached ? limitNoticeView(h) : null,
          passkeysView(model, passkeys, h),
          subjectDialogView(model, h),
        ],
        registrable ? [registerButtonView(model, { limitReached, mfaEnabled }, h)] : [],
        h,
      );
    },
  }),
);
