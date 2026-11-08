import { Effect, Number, Option, Schema } from "effect";
import { Command, Update } from "foldkit";
import type { Document, HtmlBuilder } from "foldkit/html";
import { defineMessageUnion } from "foldkit/message";
import { defineTaggedUnion } from "foldkit/schema";
import { pushUrl, replaceUrl, UrlRequest } from "foldkit/navigation";
import { modifyFields } from "foldkit/struct";
import { toString as urlToString, Url } from "foldkit/url";

import * as AuthError from "../../auth/pages/AuthError";
import * as SignInOrSignUp from "../../auth/pages/SignInOrSignUp";
import * as MfaChallenge from "../../mfa/pages/MfaChallenge";
import { accountSignInUrlFrom, leaveSpaTo, loadDocument } from "../../shared/leave-spa";
import type { SpaHttpClient } from "../../shared/spa-http-client";
import {
  AuthRoute,
  enteredAuthRoute,
  errorRouter,
  signInRouter,
  signUpRouter,
  urlToAuthRoute,
} from "./route";

const AuthPage = defineTaggedUnion({
  SignInOrSignUp: { model: SignInOrSignUp.Model },
  MfaChallenge: { model: MfaChallenge.Model },
});
type AuthPage = typeof AuthPage.Type;

export const Model = Schema.Struct({
  route: AuthRoute,
  origin: Schema.String,
  pageVisit: Schema.Int,
  maybePage: Schema.Option(AuthPage),
});
export type Model = typeof Model.Type;

export const Message = defineMessageUnion({
  ClickedLink: { request: UrlRequest },
  ChangedUrl: { url: Url },
  CompletedLoadDocument: {},
  CompletedPushUrl: {},
  CompletedRedirectToInvalidRedirectUrlError: {},
  CompletedReplaceDocument: {},
  GotSignInOrSignUpMessage: { message: SignInOrSignUp.Message },
  GotMfaChallengeMessage: { message: MfaChallenge.Message },
});
export type Message = typeof Message.Type;

type UpdateReturn = Update.Return<Model, Message, SpaHttpClient>;

export const LoadDocument = Command.define("LoadDocument", {
  args: { href: Schema.String },
  messages: [Message.CompletedLoadDocument],
  execute: ({ href }) =>
    Effect.sync(() => loadDocument(href)).pipe(Effect.as(Message.CompletedLoadDocument())),
});

export const PushUrl = Command.define("PushUrl", {
  args: { href: Schema.String },
  messages: [Message.CompletedPushUrl],
  execute: ({ href }) => pushUrl(href).pipe(Effect.as(Message.CompletedPushUrl())),
});

export const RedirectToInvalidRedirectUrlError = Command.define(
  "RedirectToInvalidRedirectUrlError",
  {
    messages: [Message.CompletedRedirectToInvalidRedirectUrlError],
    execute: replaceUrl(errorRouter({ reason: Option.some("invalid_redirect_url") })).pipe(
      Effect.as(Message.CompletedRedirectToInvalidRedirectUrlError()),
    ),
  },
);

export const ReplaceDocument = Command.define("ReplaceDocument", {
  args: { href: Schema.String },
  messages: [Message.CompletedReplaceDocument],
  execute: ({ href }) =>
    Effect.sync(() => leaveSpaTo(href)).pipe(Effect.as(Message.CompletedReplaceDocument())),
});

const commandForInternalUrl = (url: Url) =>
  AuthRoute.matchOrElse(
    urlToAuthRoute(url),
    { NotFound: () => LoadDocument({ href: urlToString(url) }) },
    () => PushUrl({ href: urlToString(url) }),
  );

const originOf = (url: Url): string =>
  `${url.protocol}//${url.host}${Option.match(url.port, { onNone: () => "", onSome: (port) => `:${port}` })}`;

const withPage = (model: Model, page: AuthPage): Model =>
  modifyFields(model, { maybePage: (): Option.Option<AuthPage> => Option.some(page) });

const beginPageEntry = (model: Model): Model =>
  modifyFields(model, {
    pageVisit: Number.increment,
    maybePage: () => Option.none(),
  });

const enterSignInOrSignUp = (
  model: Model,
  kind: SignInOrSignUp.SignKind,
  params: SignInOrSignUp.Params,
  otherPageHref: string,
): UpdateReturn => {
  const init_ = SignInOrSignUp.init({
    kind,
    params,
    origin: model.origin,
    otherPageHref,
    visit: model.pageVisit,
  });
  return {
    model: withPage(model, AuthPage.SignInOrSignUp({ model: init_.model })),
    commands: Command.mapMessages(init_.commands, (message) =>
      Message.GotSignInOrSignUpMessage({ message }),
    ),
  };
};

const enterMfaChallenge = (model: Model): UpdateReturn => {
  const init_ = MfaChallenge.init({
    visit: model.pageVisit,
    signInHref: accountSignInUrlFrom(model.origin),
  });
  return {
    model: withPage(model, AuthPage.MfaChallenge({ model: init_.model })),
    commands: Command.mapMessages(init_.commands, (message) =>
      Message.GotMfaChallengeMessage({ message }),
    ),
  };
};

const canaryIconRemovalsOnLeaving = (model: Model) =>
  Option.exists(model.maybePage, AuthPage.guards.SignInOrSignUp)
    ? Command.mapMessages([SignInOrSignUp.RemoveCanaryIcon()], (message) =>
        Message.GotSignInOrSignUpMessage({ message }),
      )
    : [];

const enterRoute = (model: Model, route: AuthRoute): UpdateReturn => {
  const entered = beginPageEntry(model);
  const canaryIconRemovals = canaryIconRemovalsOnLeaving(model);
  return AuthRoute.match<UpdateReturn>(route, {
    SignIn: ({ _tag, ...params }) =>
      enterSignInOrSignUp(entered, "SignIn", params, signUpRouter(params)),
    SignUp: ({ _tag, ...params }) =>
      enterSignInOrSignUp(entered, "SignUp", params, signInRouter(params)),
    RejectedSignInParams: () => ({
      model: entered,
      commands: [...canaryIconRemovals, RedirectToInvalidRedirectUrlError()],
    }),
    MfaChallenge: () => {
      const mfaChallenge = enterMfaChallenge(entered);
      return {
        model: mfaChallenge.model,
        commands: [...canaryIconRemovals, ...(mfaChallenge.commands ?? [])],
      };
    },
    Error: () => ({ model: entered, commands: canaryIconRemovals }),
    NotFound: () => ({ model: entered, commands: canaryIconRemovals }),
  });
};

const enterIfNewRoute = (
  model: Model,
  maybePreviousRoute: Option.Option<AuthRoute>,
): UpdateReturn =>
  Option.match(enteredAuthRoute(maybePreviousRoute, model.route), {
    onNone: () => ({ model }),
    onSome: (route) => enterRoute(model, route),
  });

export const init = (url: Url): UpdateReturn => {
  return enterIfNewRoute(
    {
      route: urlToAuthRoute(url),
      origin: originOf(url),
      pageVisit: 0,
      maybePage: Option.none(),
    },
    Option.none(),
  );
};

const foldSignInOrSignUp = Update.foldChild({
  update: SignInOrSignUp.update,
  read: (model: Model) =>
    Option.flatMap(model.maybePage, (page) =>
      AuthPage.matchOrElse(page, { SignInOrSignUp: ({ model }) => Option.some(model) }, () =>
        Option.none(),
      ),
    ),
  write: (model: Model, nextSignInOrSignUp: SignInOrSignUp.Model) =>
    withPage(model, AuthPage.SignInOrSignUp({ model: nextSignInOrSignUp })),
  toParentMessage: (message) => Message.GotSignInOrSignUpMessage({ message }),
});

const foldMfaChallenge = Update.foldChild({
  update: MfaChallenge.update,
  read: (model: Model) =>
    Option.flatMap(model.maybePage, (page) =>
      AuthPage.matchOrElse(page, { MfaChallenge: ({ model }) => Option.some(model) }, () =>
        Option.none(),
      ),
    ),
  write: (model: Model, nextMfaChallenge: MfaChallenge.Model) =>
    withPage(model, AuthPage.MfaChallenge({ model: nextMfaChallenge })),
  toParentMessage: (message) => Message.GotMfaChallengeMessage({ message }),
  foldOutMessage: MfaChallenge.OutMessage.match<Update.Step<Model, Message>>({
    PassedChallenge:
      ({ redirectUrl }) =>
      (model) => ({ model, commands: [ReplaceDocument({ href: redirectUrl })] }),
  }),
});

export const update = (model: Model, message: Message) =>
  Message.match<UpdateReturn>(message, {
    ClickedLink: ({ request }) =>
      UrlRequest.match<UpdateReturn>(request, {
        Internal: ({ url }) => ({ model, commands: [commandForInternalUrl(url)] }),
        External: ({ href }) => ({ model, commands: [LoadDocument({ href })] }),
      }),
    ChangedUrl: ({ url }) =>
      enterIfNewRoute(
        modifyFields(model, { route: () => urlToAuthRoute(url) }),
        Option.some(model.route),
      ),
    CompletedLoadDocument: () => ({ model }),
    CompletedPushUrl: () => ({ model }),
    CompletedRedirectToInvalidRedirectUrlError: () => ({ model }),
    CompletedReplaceDocument: () => ({ model }),
    GotSignInOrSignUpMessage: ({ message: pageMessage }) => foldSignInOrSignUp(model, pageMessage),
    GotMfaChallengeMessage: ({ message: pageMessage }) => foldMfaChallenge(model, pageMessage),
  });

const pageView = (model: Model, h: HtmlBuilder<Message>) =>
  Option.match(model.maybePage, {
    onSome: (page) =>
      AuthPage.match(page, {
        SignInOrSignUp: ({ model: pageModel }) =>
          h.submodel({
            slotId: "sign-in-or-sign-up",
            view: SignInOrSignUp.view,
            model: pageModel,
            toParentMessage: (message) => Message.GotSignInOrSignUpMessage({ message }),
          }),
        MfaChallenge: ({ model: pageModel }) =>
          h.submodel({
            slotId: "mfa-challenge",
            view: MfaChallenge.view,
            model: pageModel,
            toParentMessage: (message) => Message.GotMfaChallengeMessage({ message }),
          }),
      }),
    onNone: () =>
      AuthRoute.matchOrElse(
        model.route,
        {
          Error: ({ reason }) => AuthError.view(reason, h),
          NotFound: () => AuthError.view(Option.none(), h),
        },
        () => h.div([]),
      ),
  });

export const view = (model: Model, h: HtmlBuilder<Message>): Document => ({
  title: "taimei-auth",
  body: pageView(model, h),
});
