import { Effect, Option, Schema } from "effect";
import { Command, Submodel, type Update } from "foldkit";
import type { Html, HtmlBuilder } from "foldkit/html";
import { defineMessageUnion } from "foldkit/message";
import { defineTaggedUnion } from "foldkit/schema";
import { modifyFields } from "foldkit/struct";
import { Github, Mail } from "lucide";

import { acceptInvitationPath } from "@core/invitation/accept-path";
import { SERVICE_NAMES, TAIMEI_SERVICES } from "@core/services";

import { maybeRejectedMessage, Submission } from "../../shared/submission";
import { buttonView } from "../../shared/ui/button-view";
import { textLinkClassName } from "../../shared/ui/class-names";
import { inputView } from "../../shared/ui/input-view";
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

export const SignKind = Schema.Literals(["SignIn", "SignUp"]);
export type SignKind = typeof SignKind.Type;

const Form = defineTaggedUnion({
  Editing: {},
  SentMagicLink: {},
});

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
});
export type Message = typeof Message.Type;

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

const TEXTS: Readonly<Record<SignKind, SignTexts>> = {
  SignIn: {
    title: (serviceName) => `${serviceName} にログイン`,
    description: "Magic Link または GitHub アカウントでログイン",
    submitLabel: "Magic Link を送信",
    gitHubLabel: "GitHub でログイン",
    gitHubFailedMessage: "GitHub ログインに失敗しました",
    sentTail:
      " に Magic Link を送信しました。メール内のリンクをクリックしてログインを完了してください。",
    otherPagePrompt: "アカウントをお持ちでない方は ",
    otherPageLabel: "新規登録",
  },
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

const isBusy = (model: Model): boolean =>
  Submission.guards.Submitting(model.magicLink) || Submission.guards.Submitting(model.gitHub);

const hasRequiredInput = (model: Model): boolean =>
  model.email !== "" && (model.kind === "SignIn" || model.name !== "");

const maybeRejectedMessageOf = (model: Model): Option.Option<string> =>
  Option.orElse(maybeRejectedMessage(model.magicLink), () => maybeRejectedMessage(model.gitHub));

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

export const init = (
  start: Readonly<{
    kind: SignKind;
    params: Params;
    origin: string;
    otherPageHref: string;
    visit: number;
  }>,
): Update.Return<Model, Message> => ({
  model: {
    ...start,
    email: "",
    name: "",
    form: Form.Editing(),
    magicLink: Submission.Idle(),
    gitHub: Submission.Idle(),
  },
  commands: Option.match(maybeCanaryTokenId, {
    onNone: () => [],
    onSome: (tokenId) => [AddCanaryIcon({ tokenId })],
  }),
});

const submitMagicLink = (model: Model): Update.Return<Model, Message> =>
  isBusy(model) || !hasRequiredInput(model)
    ? { model }
    : {
        model: modifyFields(model, {
          magicLink: () => Submission.Submitting(),
          gitHub: () => Submission.Idle(),
        }),
        commands: [
          SendMagicLink({
            visit: model.visit,
            email: model.email,
            maybeName: model.kind === "SignUp" ? Option.some(model.name) : Option.none(),
            callbackUrl: callbackUrlOf(model),
          }),
        ],
      };

const startGitHubSignIn = (model: Model): Update.Return<Model, Message> =>
  isBusy(model)
    ? { model }
    : {
        model: modifyFields(model, {
          gitHub: () => Submission.Submitting(),
          magicLink: () => Submission.Idle(),
        }),
        commands: [
          StartGitHubSignIn({
            visit: model.visit,
            callbackUrl: callbackUrlOf(model),
            failedMessage: TEXTS[model.kind].gitHubFailedMessage,
          }),
        ],
      };

const forThisVisit = (
  model: Model,
  visit: number,
  next: () => Update.Return<Model, Message>,
): Update.Return<Model, Message> => (visit === model.visit ? next() : { model });

export const update = (model: Model, message: Message) =>
  Message.match<Update.Return<Model, Message>>(message, {
    UpdatedEmail: ({ value }) => ({ model: modifyFields(model, { email: () => value }) }),
    UpdatedName: ({ value }) => ({ model: modifyFields(model, { name: () => value }) }),
    SubmittedMagicLinkForm: () => submitMagicLink(model),
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
  });

const sentView = (model: Model, h: HtmlBuilder<Message>): Html =>
  h.p(
    [h.Class("text-sm text-muted-foreground")],
    [h.strong([h.Class("font-medium text-foreground")], [model.email]), TEXTS[model.kind].sentTail],
  );

const busySubmission = (model: Model): Submission =>
  isBusy(model) ? Submission.Submitting() : Submission.Idle();

const magicLinkFormView = (model: Model, h: HtmlBuilder<Message>): Html =>
  h.form(
    [h.Class("space-y-3"), h.OnSubmit(Message.SubmittedMagicLinkForm())],
    [
      ...(model.kind === "SignUp"
        ? [
            inputView(
              {
                id: "name",
                label: "お名前",
                type: "text",
                value: model.name,
                onInput: (value) => Message.UpdatedName({ value }),
                submission: busySubmission(model),
                placeholder: "山田 太郎",
              },
              h,
            ),
          ]
        : []),
      inputView(
        {
          id: "email",
          label: "メールアドレス",
          type: "email",
          value: model.email,
          onInput: (value) => Message.UpdatedEmail({ value }),
          submission: busySubmission(model),
          placeholder: "you@example.com",
        },
        h,
      ),
      buttonView(
        {
          label: TEXTS[model.kind].submitLabel,
          type: "submit",
          look: "primary",
          submission: model.magicLink,
          isBlocked: Submission.guards.Submitting(model.gitHub) || !hasRequiredInput(model),
          icon: Mail,
        },
        h,
      ),
    ],
  );

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
            isBlocked: Submission.guards.Submitting(model.magicLink),
            onClick: Message.ClickedGitHubSignIn(),
            icon: Github,
          },
          h,
        ),
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
        ...Option.match(maybeRejectedMessageOf(model), {
          onNone: () => [],
          onSome: (failure) => [h.p([h.Class("text-sm text-destructive")], [failure])],
        }),
      ],
    },
    h,
  ),
);
