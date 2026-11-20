import type { PasskeyListResponse } from "@core/passkey/passkey-contract";
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
import { Submission } from "../shared/submission";
import { alertTextView } from "../shared/ui/alert-text-view";
import { buttonView } from "../shared/ui/button-view";
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

export const Model = Schema.Struct({
  registration: Submission,
  ...PageRequestFields,
});
export type Model = typeof Model.Type;

const RegistrationFailure = Schema.Literals([
  "RateLimited",
  "TotpRequired",
  "PasskeyRejected",
  "PasskeyAlreadyRegistered",
  "PasskeyRegistrationUnavailable",
  "Unauthorized",
  "Unexpected",
]);
type RegistrationFailure = typeof RegistrationFailure.Type;

export const Message = defineMessageUnion({
  ClickedRegister: {},
  SucceededRegisterPasskey: PageRequestFields,
  CancelledRegisterPasskey: PageRequestFields,
  FailedRegisterPasskey: { ...PageRequestFields, failure: RegistrationFailure },
});
export type Message = typeof Message.Type;

export const OutMessage = defineMessageUnion({
  Registered: {},
  Notified: { tone: NoticeTone, text: Schema.String },
  RequiredSignIn: {},
});
export type OutMessage = typeof OutMessage.Type;

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
        PasskeyRejected: failedRegister(request, "PasskeyRejected"),
        PasskeyAlreadyRegistered: failedRegister(request, "PasskeyAlreadyRegistered"),
        PasskeyRegistrationUnavailable: failedRegister(request, "PasskeyRegistrationUnavailable"),
        Unauthorized: failedRegister(request, "Unauthorized"),
        PasskeyCreationFailed: failedRegister(request, "Unexpected"),
        HttpClientError: failedRegister(request, "Unexpected"),
        SchemaError: failedRegister(request, "Unexpected"),
      }),
    ),
});

export const init = (visit: number): Model => ({
  registration: Submission.Idle(),
  ...firstPageRequest(visit),
});

type UpdateReturn = Update.ReturnWithOutMessage<Model, Message, OutMessage, SpaHttpClient>;

const isRegistering = (model: Model) => Submission.guards.Submitting(model.registration);

const startRegistration = (model: Model): UpdateReturn => {
  if (isRegistering(model)) {
    return { model };
  }
  const requested = withNextPageRequest(
    modifyFields(model, { registration: () => Submission.Submitting() }),
  );
  return { model: requested, commands: [RegisterPasskey(pageRequestOf(requested))] };
};

const settleRegistration = (
  model: Model,
  response: PageRequest,
  maybeOutMessage: Option.Option<OutMessage>,
): UpdateReturn => {
  if (!(isCurrentPageRequest(model, response) && isRegistering(model))) {
    return { model };
  }
  const settled = modifyFields(model, { registration: () => Submission.Idle() });
  return Option.match(maybeOutMessage, {
    onNone: () => ({ model: settled }),
    onSome: (outMessage) => ({ model: settled, outMessage }),
  });
};

const outMessageOfFailure = (failure: RegistrationFailure): OutMessage =>
  failure === "Unauthorized"
    ? OutMessage.RequiredSignIn()
    : OutMessage.Notified({ tone: "Error", text: passkeyFailureText(failure) });

export const update = (model: Model, message: Message) =>
  Message.match<UpdateReturn>(message, {
    ClickedRegister: () => startRegistration(model),
    SucceededRegisterPasskey: (response) =>
      settleRegistration(model, response, Option.some(OutMessage.Registered())),
    CancelledRegisterPasskey: (response) => settleRegistration(model, response, Option.none()),
    FailedRegisterPasskey: ({ failure, ...response }) =>
      settleRegistration(model, response, Option.some(outMessageOfFailure(failure))),
  });

const LIST_UNAVAILABLE = "パスキーの一覧を取得できませんでした。";

const dayFormatter = new Intl.DateTimeFormat("ja-JP", { dateStyle: "medium" });

const dayOf = (iso: string): string => dayFormatter.format(new Date(iso));

const passkeyItemView = (passkey: ListedPasskey, h: HtmlBuilder<Message>): Html =>
  h.li(
    [h.Class("flex flex-wrap gap-x-4 gap-y-1 py-2 text-sm text-muted-foreground")],
    [
      h.span([], [`登録日 ${dayOf(passkey.createdAt)}`]),
      h.span(
        [],
        [
          `最後に使った日 ${Option.match(passkey.maybeLastUsedAt, { onNone: () => "未使用", onSome: dayOf })}`,
        ],
      ),
    ],
  );

const passkeysView = (passkeys: ReadonlyArray<ListedPasskey>, h: HtmlBuilder<Message>): Html =>
  Array.isReadonlyArrayNonEmpty(passkeys)
    ? h.ul(
        [h.Role("list"), h.Class("mt-2 divide-y")],
        passkeys.map((passkey) => passkeyItemView(passkey, h)),
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

const registerButtonView = (model: Model, h: HtmlBuilder<Message>): Html =>
  buttonView(
    {
      label: "登録する",
      type: "button",
      look: "outlineSmall",
      submission: model.registration,
      isBlocked: false,
      onClick: Message.ClickedRegister(),
    },
    h,
  );

export const view = Submodel.defineView<
  Model,
  Message,
  Readonly<{ list: PasskeyList; mfaEnabled: boolean }>
>((model, { list, mfaEnabled }, h) =>
  PasskeyList.match(list, {
    Hidden: () => null,
    Failed: () => passkeyRowView([alertTextView(LIST_UNAVAILABLE, h)], [], h),
    Shown: ({ passkeys, registrable }) =>
      passkeyRowView(
        [passkeysView(passkeys, h)],
        registrable && !mfaEnabled ? [registerButtonView(model, h)] : [],
        h,
      ),
  }),
);
