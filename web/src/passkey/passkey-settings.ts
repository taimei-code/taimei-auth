import type { PasskeyListResponse } from "@core/passkey/passkey-contract";
import { isPasskeyLimitReached } from "@core/passkey/policy";
import { Array, Effect, Option, Schema } from "effect";
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
import { SpaHttpClient } from "../shared/spa-http-client";
import { Submission, submissionWhile } from "../shared/submission";
import { alertTextView } from "../shared/ui/alert-text-view";
import { buttonView } from "../shared/ui/button-view";
import {
  Dialog,
  type DialogMessage,
  ReportingDialog,
  dialogFooterView,
  dialogView,
  isDialogVisible,
  reportingDialogFoldsOf,
} from "../shared/ui/dialog-view";
import { settingRowView } from "../shared/ui/setting-row-view";
import { NoticeTone } from "../shared/ui/toast-view";
import { passkeyFailureText } from "./passkey-failure-messages";
import { PasskeyRegistration, registerPasskey } from "./passkey-registration";
import { isPasskeySupported } from "./webauthn";

type PasskeyApi = SpaHttpClient["Service"]["passkey"];

const ListedPasskey = Schema.Struct({
  id: Schema.String,
  createdAt: Schema.String,
  maybeLastUsedAt: Schema.Option(Schema.String),
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

export const Model = Schema.Struct({
  busy: Busy,
  dialog: ReportingDialog.Model(OutMessage),
  maybeDeletionTarget: Schema.Option(ListedPasskey),
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
  args: PageRequestFields,
  messages: [
    Message.SucceededRegisterPasskey,
    Message.CancelledRegisterPasskey,
    Message.FailedRegisterPasskey,
  ],
  execute: (request) =>
    Effect.gen(function* () {
      const client = yield* SpaHttpClient;
      const registration = yield* registerPasskey(client.passkey);
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

export const init = (visit: number): Model => ({
  busy: Busy.Idle(),
  dialog: ReportingDialog.init({ id: DIALOG_ID }),
  maybeDeletionTarget: Option.none(),
  ...firstPageRequest(visit),
});

type UpdateReturn = Update.ReturnWithOutMessage<Model, Message, OutMessage, SpaHttpClient>;

const isIdle = (model: Model) => Busy.guards.Idle(model.busy);

const isRegistering = (model: Model) => Busy.guards.Registering(model.busy);

const isDeleting = (model: Model) => Busy.guards.Deleting(model.busy);

const backToIdle = (model: Model): Model => modifyFields(model, { busy: () => Busy.Idle() });

const toDialogMessage = (message: DialogMessage) => Message.GotDialogMessage({ message });

const dialogFolds = reportingDialogFoldsOf<OutMessage>()({
  isClosingBlocked: isDeleting,
  toParentMessage: toDialogMessage,
  whenClosed: (model) => (isDeleting(model) ? backToIdle(model) : model),
});

const whileIdle = (model: Model, next: () => UpdateReturn): UpdateReturn =>
  isIdle(model) ? next() : { model };

const startRegistration = (model: Model): UpdateReturn =>
  whileIdle(model, () => {
    const requested = withNextPageRequest(modifyFields(model, { busy: () => Busy.Registering() }));
    return { model: requested, commands: [RegisterPasskey(pageRequestOf(requested))] };
  });

const confirmDeletion = (model: Model): UpdateReturn =>
  whileIdle(model, () =>
    Option.match(
      Option.filter(model.maybeDeletionTarget, () => model.dialog.isOpen),
      {
        onNone: () => ({ model }),
        onSome: (passkey) => {
          const requested = withNextPageRequest(
            modifyFields(model, { busy: () => Busy.Deleting() }),
          );
          return {
            model: requested,
            commands: [DeletePasskey({ ...pageRequestOf(requested), passkeyId: passkey.id })],
          };
        },
      },
    ),
  );

const settleRegistration = (
  model: Model,
  response: PageRequest,
  maybeOutMessage: Option.Option<OutMessage>,
): UpdateReturn => {
  if (!(isCurrentPageRequest(model, response) && isRegistering(model))) {
    return { model };
  }
  const settled = backToIdle(model);
  return Option.match(maybeOutMessage, {
    onNone: () => ({ model: settled }),
    onSome: (outMessage) => ({ model: settled, outMessage }),
  });
};

const outMessageOfFailure = (failure: RegistrationFailure | DeletionFailure): OutMessage =>
  failure === "Unauthorized"
    ? OutMessage.RequiredSignIn()
    : OutMessage.Notified({ tone: "Error", text: passkeyFailureText(failure) });

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
    ClickedRegister: () => startRegistration(model),
    SucceededRegisterPasskey: (response) =>
      settleRegistration(model, response, Option.some(OutMessage.Registered())),
    CancelledRegisterPasskey: (response) => settleRegistration(model, response, Option.none()),
    FailedRegisterPasskey: ({ failure, ...response }) =>
      settleRegistration(model, response, Option.some(outMessageOfFailure(failure))),
    ClickedDelete: ({ passkey }) =>
      whileIdle(model, () =>
        dialogFolds.open(modifyFields(model, { maybeDeletionTarget: () => Option.some(passkey) })),
      ),
    ClickedCancelDeletion: () => whileIdle(model, () => dialogFolds.close(model)),
    ClickedConfirmDeletion: () => confirmDeletion(model),
    GotDialogMessage: ({ message: dialogMessage }) => dialogFolds.fold(model, dialogMessage),
    SucceededDeletePasskey: (response) => closeDeletionThen(model, response, OutMessage.Deleted()),
    FailedDeletePasskey: ({ failure, ...response }) =>
      closeDeletionThen(model, response, outMessageOfFailure(failure)),
  });

const LIST_UNAVAILABLE = "パスキーの一覧を取得できませんでした。";

const dayFormatter = new Intl.DateTimeFormat("ja-JP", { dateStyle: "medium" });

const dayOf = (iso: string): string => dayFormatter.format(new Date(iso));

const registeredOnText = (passkey: ListedPasskey): string => `登録日 ${dayOf(passkey.createdAt)}`;

const lastUsedOnText = (passkey: ListedPasskey): string =>
  `最後に使った日 ${Option.match(passkey.maybeLastUsedAt, { onNone: () => "未使用", onSome: dayOf })}`;

const passkeyText = (passkey: ListedPasskey): string =>
  `${registeredOnText(passkey)}、${lastUsedOnText(passkey)}`;

const passkeyItemView = (model: Model, passkey: ListedPasskey, h: HtmlBuilder<Message>): Html =>
  h.keyed("li")(
    passkey.id,
    [h.Class("flex items-center justify-between gap-3 py-2 text-sm text-muted-foreground")],
    [
      h.div(
        [h.Class("flex flex-wrap gap-x-4 gap-y-1")],
        [h.span([], [registeredOnText(passkey)]), h.span([], [lastUsedOnText(passkey)])],
      ),
      buttonView(
        {
          label: "削除",
          accessibleNamePrefix: `${passkeyText(passkey)} のパスキーを`,
          type: "button",
          look: "ghostSmall",
          submission: Submission.Idle(),
          isBlocked: !isIdle(model),
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

const registerButtonView = (model: Model, limitReached: boolean, h: HtmlBuilder<Message>): Html =>
  buttonView(
    {
      label: "登録する",
      type: "button",
      look: "outlineSmall",
      submission: submissionWhile(isRegistering(model)),
      isBlocked: isDeleting(model) || limitReached,
      describedBy: limitReached ? LIMIT_NOTICE_ID : undefined,
      onClick: Message.ClickedRegister(),
    },
    h,
  );

const deletionDialogView = (model: Model, h: HtmlBuilder<Message>): Html =>
  dialogView(
    model.dialog,
    toDialogMessage,
    {
      title: "パスキーの削除",
      description: Option.match(model.maybeDeletionTarget, {
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
      isClosingBlocked: isDeleting(model),
    },
    h,
  );

export const view = Submodel.defineView<
  Model,
  Message,
  Readonly<{ list: PasskeyList; mfaEnabled: boolean }>
>((model, { list, mfaEnabled }, h) =>
  PasskeyList.match(list, {
    Hidden: () =>
      isDialogVisible(model.dialog) ? passkeyRowView([deletionDialogView(model, h)], [], h) : null,
    Failed: () =>
      passkeyRowView([alertTextView(LIST_UNAVAILABLE, h), deletionDialogView(model, h)], [], h),
    Shown: ({ passkeys, registrable }) => {
      const offersRegistration = registrable && !mfaEnabled;
      const limitReached = offersRegistration && isPasskeyLimitReached(passkeys.length);
      return passkeyRowView(
        [
          limitReached ? limitNoticeView(h) : null,
          passkeysView(model, passkeys, h),
          deletionDialogView(model, h),
        ],
        offersRegistration ? [registerButtonView(model, limitReached, h)] : [],
        h,
      );
    },
  }),
);
