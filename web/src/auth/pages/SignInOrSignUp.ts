import { Effect, Option, Schema } from "effect";
import { Command, Submodel, type Update } from "foldkit";
import type { Html, HtmlBuilder } from "foldkit/html";
import { defineMessageUnion } from "foldkit/message";
import { defineTaggedUnion } from "foldkit/schema";
import { modifyFields } from "foldkit/struct";
import { Github, KeyRound, Mail } from "lucide";

import { acceptInvitationPath } from "@core/invitation/accept-path";
import { SERVICE_NAMES, TAIMEI_SERVICES } from "@core/services";

import {
  loadPasskeySignInEntry,
  PASSKEY_SIGN_IN_FAILED_MESSAGE,
  PasskeySignIn,
  signInWithPasskey,
} from "../../passkey/passkey-sign-in";
import { SpaHttpClient } from "../../shared/spa-http-client";
import {
  maybeRejectedMessage,
  Submission,
  submissionWhile,
  withoutRejection,
} from "../../shared/submission";
import { buttonView } from "../../shared/ui/button-view";
import { maybeAlertTextView } from "../../shared/ui/alert-text-view";
import { textLinkClassName } from "../../shared/ui/class-names";
import { inputView } from "../../shared/ui/input-view";
import { formView } from "../../shared/ui/form-view";
import {
  focusField,
  maybeFirstInvalidField,
  maybeFieldError,
  type RequiredField,
} from "../../shared/required-field";
import { authPageCardView } from "../auth-page-card-view";
import {
  canaryIconHref,
  canaryIconId,
  canaryTokensView,
  maybeCanaryTokenId,
} from "../canary-tokens";
import { signInClient } from "../sign-in-client";

export const Params = Schema.Struct({
  service_name: Schema.Literals(SERVICE_NAMES),
  redirect_url: Schema.String,
  sign_up_url: Schema.optional(Schema.String),
  invitation_token: Schema.optional(Schema.String),
});
export type Params = typeof Params.Type;

export const SignKind = Schema.Literals(["SignIn", "SignUp", "Reauthenticate"]);
export type SignKind = typeof SignKind.Type;

const Form = defineTaggedUnion({
  Editing: {},
  SentMagicLink: {},
});

const PasskeyEntry = defineTaggedUnion({
  Hidden: {},
  Shown: { submission: Submission },
});
type PasskeyEntry = typeof PasskeyEntry.Type;

export const Model = Schema.Struct({
  kind: SignKind,
  params: Params,
  origin: Schema.String,
  otherPageHref: Schema.String,
  visit: Schema.Int,
  email: Schema.String,
  name: Schema.String,
  form: Form,
  magicLink: Submission,
  gitHub: Submission,
  passkey: PasskeyEntry,
  showsRequiredErrors: Schema.Boolean,
});
export type Model = typeof Model.Type;

export const Message = defineMessageUnion({
  UpdatedEmail: { value: Schema.String },
  UpdatedName: { value: Schema.String },
  SubmittedMagicLinkForm: {},
  ClickedGitHubSignIn: {},
  SucceededSendMagicLink: { visit: Schema.Int },
  FailedSendMagicLink: { visit: Schema.Int, message: Schema.String },
  SucceededStartGitHubSignIn: {},
  FailedStartGitHubSignIn: { visit: Schema.Int, message: Schema.String },
  CompletedAddCanaryIcon: {},
  CompletedRemoveCanaryIcon: {},
  CompletedFocusField: {},
  CompletedLoadPasskeyEntry: { visit: Schema.Int, isShown: Schema.Boolean },
  ClickedPasskeySignIn: {},
  CompletedSignInWithPasskey: { visit: Schema.Int, result: PasskeySignIn },
});
export type Message = typeof Message.Type;

export const OutMessage = defineMessageUnion({
  SignedInWithPasskey: { redirectUrl: Schema.String },
});
export type OutMessage = typeof OutMessage.Type;

type UpdateReturn = Update.ReturnWithOutMessage<Model, Message, OutMessage, SpaHttpClient>;

type SignTexts = Readonly<{
  title: (serviceName: string) => string;
  description: string;
  submitLabel: string;
  gitHubLabel: string;
  gitHubFailedMessage: string;
  sentTail: string;
  otherPagePrompt: string;
  otherPageLabel: string;
}>;

const SIGN_IN_TEXTS: SignTexts = {
  title: (serviceName) => `${serviceName} にログイン`,
  description: "Magic Link または GitHub アカウントでログイン",
  submitLabel: "Magic Link を送信",
  gitHubLabel: "GitHub でログイン",
  gitHubFailedMessage: "GitHub ログインに失敗しました",
  sentTail:
    " に Magic Link を送信しました。メール内のリンクをクリックしてログインを完了してください。",
  otherPagePrompt: "アカウントをお持ちでない方は ",
  otherPageLabel: "新規登録",
};

const TEXTS: Readonly<Record<SignKind, SignTexts>> = {
  SignIn: SIGN_IN_TEXTS,
  SignUp: {
    title: (serviceName) => `${serviceName} に登録`,
    description: "Magic Link または GitHub で新規登録",
    submitLabel: "Magic Link で登録",
    gitHubLabel: "GitHub で登録",
    gitHubFailedMessage: "GitHub サインアップに失敗しました",
    sentTail:
      " に Magic Link を送信しました。メール内のリンクをクリックして登録を完了してください。",
    otherPagePrompt: "すでにアカウントをお持ちの方は ",
    otherPageLabel: "ログイン",
  },
  Reauthenticate: {
    ...SIGN_IN_TEXTS,
    title: (serviceName) => `${serviceName} にもう一度ログイン`,
    description: "本人確認のため、もう一度ログインしてください",
    otherPagePrompt: "",
    otherPageLabel: "元の画面へ戻る",
  },
};

const MAGIC_LINK_FAILED_MESSAGE = "Magic Link の送信に失敗しました";

const callbackUrlOf = (model: Model): string =>
  Option.match(Option.fromNullishOr(model.params.invitation_token), {
    onNone: () =>
      model.kind === "SignUp"
        ? (model.params.sign_up_url ?? model.params.redirect_url)
        : model.params.redirect_url,
    onSome: (token) => `${model.origin}${acceptInvitationPath(token)}`,
  });

const maybePasskeySubmission = (model: Model): Option.Option<Submission> =>
  PasskeyEntry.matchOrElse(
    model.passkey,
    { Shown: ({ submission }) => Option.some(submission) },
    () => Option.none(),
  );

const isPasskeySubmitting = (model: Model): boolean =>
  Option.exists(maybePasskeySubmission(model), Submission.guards.Submitting);

const isBusy = (model: Model): boolean =>
  Submission.guards.Submitting(model.magicLink) ||
  Submission.guards.Submitting(model.gitHub) ||
  isPasskeySubmitting(model);

const withoutPasskeyRejection = (entry: PasskeyEntry): PasskeyEntry =>
  PasskeyEntry.matchOrElse(
    entry,
    { Shown: ({ submission }) => PasskeyEntry.Shown({ submission: withoutRejection(submission) }) },
    () => entry,
  );

const NAME_FIELD = { id: "name", label: "お名前" } as const;
const EMAIL_FIELD = { id: "email", label: "メールアドレス" } as const;

const requiredFieldsOf = (model: Model): ReadonlyArray<RequiredField> => [
  ...(model.kind === "SignUp" ? [{ ...NAME_FIELD, value: model.name }] : []),
  { ...EMAIL_FIELD, value: model.email, isEmail: true },
];

export const FocusMagicLinkField = Command.define("FocusMagicLinkField", {
  args: { id: Schema.String },
  messages: [Message.CompletedFocusField],
  execute: ({ id }) => focusField(id).pipe(Effect.as(Message.CompletedFocusField())),
});

const maybeRejectedMessageOf = (model: Model): Option.Option<string> =>
  Option.firstSomeOf([
    maybeRejectedMessage(model.magicLink),
    maybeRejectedMessage(model.gitHub),
    Option.flatMap(maybePasskeySubmission(model), maybeRejectedMessage),
  ]);

const AddCanaryIcon = Command.define("AddCanaryIcon", {
  args: { tokenId: Schema.String },
  messages: [Message.CompletedAddCanaryIcon],
  execute: ({ tokenId }) =>
    Effect.sync(() => {
      if (document.getElementById(canaryIconId) === null) {
        const link = document.createElement("link");
        link.id = canaryIconId;
        link.rel = "icon";
        link.href = canaryIconHref(tokenId);
        link.type = "image/x-icon";
        document.head.appendChild(link);
      }
    }).pipe(Effect.as(Message.CompletedAddCanaryIcon())),
});

export const RemoveCanaryIcon = Command.define("RemoveCanaryIcon", {
  messages: [Message.CompletedRemoveCanaryIcon],
  execute: Effect.sync(() => document.getElementById(canaryIconId)?.remove()).pipe(
    Effect.as(Message.CompletedRemoveCanaryIcon()),
  ),
});

export const SendMagicLink = Command.define("SendMagicLink", {
  args: {
    visit: Schema.Int,
    email: Schema.String,
    maybeName: Schema.Option(Schema.String),
    callbackUrl: Schema.String,
  },
  messages: [Message.SucceededSendMagicLink, Message.FailedSendMagicLink],
  execute: ({ visit, email, maybeName, callbackUrl }) =>
    Effect.tryPromise(() =>
      signInClient.signIn.magicLink({
        email,
        callbackURL: callbackUrl,
        ...Option.match(maybeName, { onNone: () => ({}), onSome: (name) => ({ name }) }),
      }),
    ).pipe(
      Effect.map(({ error }) =>
        error === null
          ? Message.SucceededSendMagicLink({ visit })
          : Message.FailedSendMagicLink({
              visit,
              message: error.message ?? MAGIC_LINK_FAILED_MESSAGE,
            }),
      ),
      Effect.catchTag("UnknownError", () =>
        Effect.succeed(Message.FailedSendMagicLink({ visit, message: MAGIC_LINK_FAILED_MESSAGE })),
      ),
    ),
});

export const StartGitHubSignIn = Command.define("StartGitHubSignIn", {
  args: { visit: Schema.Int, callbackUrl: Schema.String, failedMessage: Schema.String },
  messages: [Message.SucceededStartGitHubSignIn, Message.FailedStartGitHubSignIn],
  execute: ({ visit, callbackUrl, failedMessage }) =>
    Effect.tryPromise(() =>
      signInClient.signIn.social({ provider: "github", callbackURL: callbackUrl }),
    ).pipe(
      Effect.map(({ error }) =>
        error === null
          ? Message.SucceededStartGitHubSignIn()
          : Message.FailedStartGitHubSignIn({ visit, message: error.message ?? failedMessage }),
      ),
      Effect.catchTag("UnknownError", () =>
        Effect.succeed(Message.FailedStartGitHubSignIn({ visit, message: failedMessage })),
      ),
    ),
});

export const LoadPasskeyEntry = Command.define("LoadPasskeyEntry", {
  args: { visit: Schema.Int },
  messages: [Message.CompletedLoadPasskeyEntry],
  execute: ({ visit }) =>
    Effect.gen(function* () {
      const isShown = yield* loadPasskeySignInEntry(yield* SpaHttpClient);
      return Message.CompletedLoadPasskeyEntry({ visit, isShown });
    }),
});

export const SignInWithPasskey = Command.define("SignInWithPasskey", {
  args: { visit: Schema.Int, redirectUrl: Schema.String },
  messages: [Message.CompletedSignInWithPasskey],
  execute: ({ visit, redirectUrl }) =>
    Effect.gen(function* () {
      const result = yield* signInWithPasskey(yield* SpaHttpClient, redirectUrl);
      return Message.CompletedSignInWithPasskey({ visit, result });
    }),
});

const OFFERS_PASSKEY: Readonly<Record<SignKind, boolean>> = {
  SignIn: true,
  SignUp: false,
  Reauthenticate: true,
};

const offersPasskey = (kind: SignKind, params: Params): boolean =>
  OFFERS_PASSKEY[kind] && params.invitation_token === undefined;

export const init = (
  start: Readonly<{
    kind: SignKind;
    params: Params;
    origin: string;
    otherPageHref: string;
    visit: number;
  }>,
): Update.Return<Model, Message, SpaHttpClient> => ({
  model: {
    ...start,
    email: "",
    name: "",
    form: Form.Editing(),
    magicLink: Submission.Idle(),
    gitHub: Submission.Idle(),
    passkey: PasskeyEntry.Hidden(),
    showsRequiredErrors: false,
  },
  commands: [
    ...Option.match(maybeCanaryTokenId, {
      onNone: () => [],
      onSome: (tokenId) => [AddCanaryIcon({ tokenId })],
    }),
    ...(offersPasskey(start.kind, start.params) ? [LoadPasskeyEntry({ visit: start.visit })] : []),
  ],
});

const submitMagicLink = (model: Model): Update.Return<Model, Message> =>
  isBusy(model)
    ? { model }
    : Option.match(maybeFirstInvalidField(requiredFieldsOf(model)), {
        onSome: (field) => ({
          model: modifyFields(model, { showsRequiredErrors: () => true }),
          commands: [FocusMagicLinkField({ id: field.id })],
        }),
        onNone: () => sendMagicLink(model),
      });

const sendMagicLink = (model: Model): Update.Return<Model, Message> => ({
  model: modifyFields(model, {
    magicLink: () => Submission.Submitting(),
    gitHub: () => Submission.Idle(),
    passkey: withoutPasskeyRejection,
  }),
  commands: [
    SendMagicLink({
      visit: model.visit,
      email: model.email,
      maybeName: model.kind === "SignUp" ? Option.some(model.name) : Option.none(),
      callbackUrl: callbackUrlOf(model),
    }),
  ],
});

const startGitHubSignIn = (model: Model): Update.Return<Model, Message> =>
  isBusy(model)
    ? { model }
    : {
        model: modifyFields(model, {
          gitHub: () => Submission.Submitting(),
          magicLink: () => Submission.Idle(),
          passkey: withoutPasskeyRejection,
        }),
        commands: [
          StartGitHubSignIn({
            visit: model.visit,
            callbackUrl: callbackUrlOf(model),
            failedMessage: TEXTS[model.kind].gitHubFailedMessage,
          }),
        ],
      };

const startPasskeySignIn = (model: Model): UpdateReturn =>
  isBusy(model) || PasskeyEntry.guards.Hidden(model.passkey)
    ? { model }
    : {
        model: modifyFields(model, {
          passkey: () => PasskeyEntry.Shown({ submission: Submission.Submitting() }),
          magicLink: () => Submission.Idle(),
          gitHub: () => Submission.Idle(),
        }),
        commands: [
          SignInWithPasskey({ visit: model.visit, redirectUrl: model.params.redirect_url }),
        ],
      };

const withPasskeySubmission = (model: Model, submission: Submission): Model =>
  modifyFields(model, { passkey: () => PasskeyEntry.Shown({ submission }) });

const forThisVisit = (model: Model, visit: number, next: () => UpdateReturn): UpdateReturn =>
  visit === model.visit ? next() : { model };

const finishPasskeySignIn = (model: Model, visit: number, result: PasskeySignIn): UpdateReturn =>
  PasskeySignIn.match<UpdateReturn>(result, {
    SignedIn: ({ redirectUrl }) => ({
      model,
      outMessage: OutMessage.SignedInWithPasskey({ redirectUrl }),
    }),
    Cancelled: () =>
      forThisVisit(model, visit, () => ({
        model: withPasskeySubmission(model, Submission.Idle()),
      })),
    Failed: () =>
      forThisVisit(model, visit, () => ({
        model: withPasskeySubmission(
          model,
          Submission.Rejected({ message: PASSKEY_SIGN_IN_FAILED_MESSAGE }),
        ),
      })),
  });

export const update = (model: Model, message: Message) =>
  Message.match<UpdateReturn>(message, {
    UpdatedEmail: ({ value }) => ({ model: modifyFields(model, { email: () => value }) }),
    UpdatedName: ({ value }) => ({ model: modifyFields(model, { name: () => value }) }),
    SubmittedMagicLinkForm: () => submitMagicLink(model),
    CompletedFocusField: () => ({ model }),
    ClickedGitHubSignIn: () => startGitHubSignIn(model),
    SucceededSendMagicLink: ({ visit }) =>
      forThisVisit(model, visit, () => ({
        model: modifyFields(model, {
          form: () => Form.SentMagicLink(),
          magicLink: () => Submission.Idle(),
        }),
      })),
    FailedSendMagicLink: ({ visit, message: failure }) =>
      forThisVisit(model, visit, () => ({
        model: modifyFields(model, { magicLink: () => Submission.Rejected({ message: failure }) }),
      })),
    SucceededStartGitHubSignIn: () => ({ model }),
    FailedStartGitHubSignIn: ({ visit, message: failure }) =>
      forThisVisit(model, visit, () => ({
        model: modifyFields(model, { gitHub: () => Submission.Rejected({ message: failure }) }),
      })),
    CompletedAddCanaryIcon: () => ({ model }),
    CompletedRemoveCanaryIcon: () => ({ model }),
    CompletedLoadPasskeyEntry: ({ visit, isShown }) =>
      forThisVisit(model, visit, () => ({
        model: modifyFields(model, {
          passkey: () =>
            isShown ? PasskeyEntry.Shown({ submission: Submission.Idle() }) : PasskeyEntry.Hidden(),
        }),
      })),
    ClickedPasskeySignIn: () => startPasskeySignIn(model),
    CompletedSignInWithPasskey: ({ visit, result }) => finishPasskeySignIn(model, visit, result),
  });

const sentView = (model: Model, h: HtmlBuilder<Message>): Html =>
  h.p(
    [h.Class("text-sm text-muted-foreground")],
    [h.strong([h.Class("font-medium text-foreground")], [model.email]), TEXTS[model.kind].sentTail],
  );

const magicLinkFormView = (model: Model, h: HtmlBuilder<Message>): Html =>
  formView(
    {
      onSubmit: Message.SubmittedMagicLinkForm(),
      attributes: [h.Class("space-y-3")],
      children: [
        ...(model.kind === "SignUp"
          ? [
              inputView(
                {
                  ...NAME_FIELD,
                  type: "text",
                  value: model.name,
                  enterKeyHint: "next",
                  maybeErrorMessage: maybeFieldError(model.showsRequiredErrors, {
                    ...NAME_FIELD,
                    value: model.name,
                  }),
                  onInput: (value) => Message.UpdatedName({ value }),
                  submission: submissionWhile(isBusy(model)),
                  placeholder: "山田 太郎",
                  autocomplete: "name",
                },
                h,
              ),
            ]
          : []),
        inputView(
          {
            ...EMAIL_FIELD,
            type: "email",
            value: model.email,
            enterKeyHint: "send",
            maybeErrorMessage: maybeFieldError(model.showsRequiredErrors, {
              ...EMAIL_FIELD,
              value: model.email,
              isEmail: true,
            }),
            onInput: (value) => Message.UpdatedEmail({ value }),
            submission: submissionWhile(isBusy(model)),
            placeholder: "you@example.com",
            autocomplete: "username",
          },
          h,
        ),
        buttonView(
          {
            label: TEXTS[model.kind].submitLabel,
            type: "submit",
            look: "primary",
            submission: model.magicLink,
            isBlocked: Submission.guards.Submitting(model.gitHub) || isPasskeySubmitting(model),
            icon: Mail,
          },
          h,
        ),
      ],
    },
    h,
  );

const passkeySignInView = (model: Model, h: HtmlBuilder<Message>): ReadonlyArray<Html> =>
  Option.match(maybePasskeySubmission(model), {
    onNone: () => [],
    onSome: (submission) => [
      buttonView(
        {
          label: "パスキーでログイン",
          type: "button",
          look: "outline",
          submission,
          isBlocked:
            Submission.guards.Submitting(model.magicLink) ||
            Submission.guards.Submitting(model.gitHub),
          onClick: Message.ClickedPasskeySignIn(),
          icon: KeyRound,
        },
        h,
      ),
    ],
  });

const socialSignInView = (model: Model, h: HtmlBuilder<Message>): ReadonlyArray<Html> =>
  model.params.invitation_token === undefined
    ? [
        h.div(
          [h.Class("relative")],
          [
            h.div(
              [h.Class("absolute inset-0 flex items-center")],
              [h.span([h.Class("w-full border-t")])],
            ),
            h.div(
              [h.Class("relative flex justify-center text-xs uppercase")],
              [h.span([h.Class("bg-card px-2 text-muted-foreground")], ["または"])],
            ),
          ],
        ),
        buttonView(
          {
            label: TEXTS[model.kind].gitHubLabel,
            type: "button",
            look: "outline",
            submission: model.gitHub,
            isBlocked: Submission.guards.Submitting(model.magicLink) || isPasskeySubmitting(model),
            onClick: Message.ClickedGitHubSignIn(),
            icon: Github,
          },
          h,
        ),
        ...passkeySignInView(model, h),
      ]
    : [
        h.p(
          [h.Class("text-center text-xs text-muted-foreground")],
          ["招待を受諾するには、招待されたメールアドレスで Magic Link をご利用ください。"],
        ),
      ];

const otherPageLinkView = (model: Model, h: HtmlBuilder<Message>): Html =>
  h.p(
    [h.Class("text-center text-sm text-muted-foreground")],
    [
      TEXTS[model.kind].otherPagePrompt,
      h.a(
        [h.Href(model.otherPageHref), h.Class(textLinkClassName)],
        [TEXTS[model.kind].otherPageLabel],
      ),
    ],
  );

const editingView = (model: Model, h: HtmlBuilder<Message>): ReadonlyArray<Html> => [
  magicLinkFormView(model, h),
  ...socialSignInView(model, h),
  otherPageLinkView(model, h),
];

export const view = Submodel.defineView<Model, Message>((model, h) =>
  authPageCardView(
    {
      title: TEXTS[model.kind].title(TAIMEI_SERVICES[model.params.service_name].name),
      description: TEXTS[model.kind].description,
      width: "sm",
      hidden: canaryTokensView(h),
      content: [
        ...Form.match(model.form, {
          Editing: () => editingView(model, h),
          SentMagicLink: () => [sentView(model, h)],
        }),
        ...maybeAlertTextView(maybeRejectedMessageOf(model), h),
      ],
    },
    h,
  ),
);
