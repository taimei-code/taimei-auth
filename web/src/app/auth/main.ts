import { Effect, Number, Option, Schema } from "effect";
import { Command, Update } from "foldkit";
import type { Document, HtmlBuilder } from "foldkit/html";
import { defineMessageUnion } from "foldkit/message";
import { defineTaggedUnion } from "foldkit/schema";
import { replaceUrl, UrlRequest } from "foldkit/navigation";
import { modifyFields } from "foldkit/struct";
import { Url } from "foldkit/url";

import * as AuthError from "../../auth/pages/AuthError";
import * as SignInOrSignUp from "../../auth/pages/SignInOrSignUp";
import * as SignUpCompany from "../../company/pages/SignUpCompany";
import * as AcceptInvitation from "../../invitation/pages/AcceptInvitation";
import { redirectUrlAfterAccept } from "../../invitation/redirect-target";
import * as MfaChallenge from "../../mfa/pages/MfaChallenge";
import { accountSignInUrlFrom } from "../../shared/leave-spa";
import type { SpaHttpClient } from "../../shared/spa-http-client";
import * as DocumentNavigation from "../document-navigation";
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
  SignUpCompany: { model: SignUpCompany.Model },
  AcceptInvitation: { model: AcceptInvitation.Model },
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
  GotDocumentNavigationMessage: { message: DocumentNavigation.Message },
  ClickedLink: { request: UrlRequest },
  ChangedUrl: { url: Url },
  CompletedRedirectToInvalidRedirectUrlError: {},
  GotSignInOrSignUpMessage: { message: SignInOrSignUp.Message },
  GotSignUpCompanyMessage: { message: SignUpCompany.Message },
  GotAcceptInvitationMessage: { message: AcceptInvitation.Message },
  GotMfaChallengeMessage: { message: MfaChallenge.Message },
});
export type Message = typeof Message.Type;

type UpdateReturn = Update.Return<Model, Message, SpaHttpClient>;

const navigate = (command: Command.Command<DocumentNavigation.Message>) =>
  Command.mapMessage(command, (message) => Message.GotDocumentNavigationMessage({ message }));

export const RedirectToInvalidRedirectUrlError = Command.define(
  "RedirectToInvalidRedirectUrlError",
  {
    messages: [Message.CompletedRedirectToInvalidRedirectUrlError],
    execute: replaceUrl(errorRouter({ reason: Option.some("invalid_redirect_url") })).pipe(
      Effect.as(Message.CompletedRedirectToInvalidRedirectUrlError()),
    ),
  },
);

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

const enterSignUpCompany = (model: Model, redirectUrl: string): UpdateReturn => {
  const init_ = SignUpCompany.init({ visit: model.pageVisit, redirectUrl });
  return {
    model: withPage(model, AuthPage.SignUpCompany({ model: init_.model })),
    commands: Command.mapMessages(init_.commands, (message) =>
      Message.GotSignUpCompanyMessage({ message }),
    ),
  };
};

const enterAcceptInvitation = (
  model: Model,
  search: Readonly<{ invitation_token?: string; service_name?: string; redirect_url?: string }>,
): UpdateReturn => {
  const init_ = AcceptInvitation.init({
    visit: model.pageVisit,
    redirectUrl: redirectUrlAfterAccept(search),
    invitationToken: search.invitation_token,
  });
  return {
    model: withPage(model, AuthPage.AcceptInvitation({ model: init_.model })),
    commands: Command.mapMessages(init_.commands, (message) =>
      Message.GotAcceptInvitationMessage({ message }),
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
    SignUpCompany: ({ redirect_url }) => {
      const signUpCompany = enterSignUpCompany(entered, redirect_url);
      return {
        model: signUpCompany.model,
        commands: [...canaryIconRemovals, ...(signUpCompany.commands ?? [])],
      };
    },
    AcceptInvitation: ({ _tag, ...search }) => {
      const acceptInvitation = enterAcceptInvitation(entered, search);
      return {
        model: acceptInvitation.model,
        commands: [...canaryIconRemovals, ...(acceptInvitation.commands ?? [])],
      };
    },
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
      origin: DocumentNavigation.originOf(url),
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

const foldSignUpCompanyOutMessage = SignUpCompany.OutMessage.match<Update.Step<Model, Message>>({
  ConfirmedCompanyMembership:
    ({ redirectUrl }) =>
    (model) => ({
      model,
      commands: [navigate(DocumentNavigation.ReplaceDocument({ href: redirectUrl }))],
    }),
  RequiredSignIn: () => (model) => ({
    model,
    commands: [navigate(DocumentNavigation.LeaveToSignIn())],
  }),
  SignedOut: () => (model) => ({
    model,
    commands: [
      navigate(DocumentNavigation.LoadDocument({ href: accountSignInUrlFrom(model.origin) })),
    ],
  }),
});

const foldSignUpCompany = Update.foldChild({
  update: SignUpCompany.update,
  read: (model: Model) =>
    Option.flatMap(model.maybePage, (page) =>
      AuthPage.matchOrElse(page, { SignUpCompany: ({ model }) => Option.some(model) }, () =>
        Option.none(),
      ),
    ),
  write: (model: Model, nextSignUpCompany: SignUpCompany.Model) =>
    withPage(model, AuthPage.SignUpCompany({ model: nextSignUpCompany })),
  toParentMessage: (message) => Message.GotSignUpCompanyMessage({ message }),
  foldOutMessage: foldSignUpCompanyOutMessage,
});

const foldAcceptInvitationOutMessage = AcceptInvitation.OutMessage.match<
  Update.Step<Model, Message>
>({
  AcceptedInvitation:
    ({ redirectUrl }) =>
    (model) => ({
      model,
      commands: [navigate(DocumentNavigation.ReplaceDocument({ href: redirectUrl }))],
    }),
  RequiredSignIn: () => (model) => ({
    model,
    commands: [navigate(DocumentNavigation.LeaveToSignIn())],
  }),
});

const foldAcceptInvitation = Update.foldChild({
  update: AcceptInvitation.update,
  read: (model: Model) =>
    Option.flatMap(model.maybePage, (page) =>
      AuthPage.matchOrElse(page, { AcceptInvitation: ({ model }) => Option.some(model) }, () =>
        Option.none(),
      ),
    ),
  write: (model: Model, nextAcceptInvitation: AcceptInvitation.Model) =>
    withPage(model, AuthPage.AcceptInvitation({ model: nextAcceptInvitation })),
  toParentMessage: (message) => Message.GotAcceptInvitationMessage({ message }),
  foldOutMessage: foldAcceptInvitationOutMessage,
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
      (model) => ({
        model,
        commands: [navigate(DocumentNavigation.ReplaceDocument({ href: redirectUrl }))],
      }),
  }),
});

export const update = (model: Model, message: Message) =>
  Message.match<UpdateReturn>(message, {
    GotDocumentNavigationMessage: () => ({ model }),
    ClickedLink: ({ request }) => ({
      model,
      commands: [
        navigate(
          DocumentNavigation.commandForLink(
            request,
            (url) => !AuthRoute.guards.NotFound(urlToAuthRoute(url)),
          ),
        ),
      ],
    }),
    ChangedUrl: ({ url }) =>
      enterIfNewRoute(
        modifyFields(model, { route: () => urlToAuthRoute(url) }),
        Option.some(model.route),
      ),
    CompletedRedirectToInvalidRedirectUrlError: () => ({ model }),
    GotSignInOrSignUpMessage: ({ message: pageMessage }) => foldSignInOrSignUp(model, pageMessage),
    GotSignUpCompanyMessage: ({ message: pageMessage }) => foldSignUpCompany(model, pageMessage),
    GotAcceptInvitationMessage: ({ message: pageMessage }) =>
      foldAcceptInvitation(model, pageMessage),
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
        SignUpCompany: ({ model: pageModel }) =>
          h.submodel({
            slotId: "sign-up-company",
            view: SignUpCompany.view,
            model: pageModel,
            toParentMessage: (message) => Message.GotSignUpCompanyMessage({ message }),
          }),
        AcceptInvitation: ({ model: pageModel }) =>
          h.submodel({
            slotId: "accept-invitation",
            view: AcceptInvitation.view,
            model: pageModel,
            toParentMessage: (message) => Message.GotAcceptInvitationMessage({ message }),
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
