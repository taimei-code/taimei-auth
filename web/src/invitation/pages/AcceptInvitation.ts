import { Effect, Schema } from "effect";
import { Command, Submodel, type Update } from "foldkit";
import type { Html, HtmlBuilder } from "foldkit/html";
import { defineMessageUnion } from "foldkit/message";
import { defineTaggedUnion } from "foldkit/schema";
import { modifyFields } from "foldkit/struct";

import { checkSession } from "../../auth/sign-in-client";
import type { FailureMessages } from "../../shared/failure-message";
import { ACCOUNT_HOME_PATH } from "../../shared/landing-paths";
import { type DeclaredFailure, SpaHttpClient } from "../../shared/spa-http-client";
import { cardClassNames, textLinkClassName } from "../../shared/ui/class-names";
import { fullScreenStatusView } from "../../shared/ui/icon-view";

const AcceptFailure = Schema.Literals([
  "EmailMismatch",
  "ExpiredOrUsed",
  "NotFound",
  "Unauthorized",
  "Unexpected",
]);
type AcceptFailure = typeof AcceptFailure.Type;

const Phase = defineTaggedUnion({
  Accepting: {},
  Leaving: {},
  Failed: { message: Schema.String },
});

export const Model = Schema.Struct({
  visit: Schema.Int,
  redirectUrl: Schema.String,
  phase: Phase,
});
export type Model = typeof Model.Type;

export const Message = defineMessageUnion({
  SucceededAcceptInvitation: { visit: Schema.Int },
  FailedAcceptInvitation: { visit: Schema.Int, failure: AcceptFailure },
});
export type Message = typeof Message.Type;

export const OutMessage = defineMessageUnion({
  AcceptedInvitation: { redirectUrl: Schema.String },
  RequiredSignIn: {},
});
export type OutMessage = typeof OutMessage.Type;

const ACCEPT_FAILED = "招待の受諾に失敗しました。";

const TOKEN_MISSING = "招待トークンが見つかりません。";

const DECLARED_FAILURE_MESSAGES: FailureMessages<DeclaredFailure<"invitation", "accept">> = {
  EmailMismatch:
    "この招待は別のメールアドレス宛です。招待されたアドレスでログインし直してください。",
  ExpiredOrUsed: "この招待は期限切れか、既に使用されています。",
  NotFound: "招待が見つかりません。",
};

const FAILURE_MESSAGES = { ...DECLARED_FAILURE_MESSAGES, Unexpected: ACCEPT_FAILED };

const failedAcceptInvitation = (visit: number, failure: AcceptFailure) => () =>
  Effect.succeed(Message.FailedAcceptInvitation({ visit, failure }));

export const AcceptInvitation = Command.define("AcceptInvitation", {
  args: { visit: Schema.Int, invitationToken: Schema.String },
  messages: [Message.SucceededAcceptInvitation, Message.FailedAcceptInvitation],
  execute: ({ visit, invitationToken }) =>
    Effect.gen(function* () {
      const isSignedIn = yield* checkSession;
      if (!isSignedIn) {
        return Message.FailedAcceptInvitation({ visit, failure: "Unauthorized" });
      }
      const client = yield* SpaHttpClient;
      yield* client.invitation.accept({ payload: { invitation_token: invitationToken } });
      return Message.SucceededAcceptInvitation({ visit });
    }).pipe(
      Effect.catchTags({
        EmailMismatch: failedAcceptInvitation(visit, "EmailMismatch"),
        ExpiredOrUsed: failedAcceptInvitation(visit, "ExpiredOrUsed"),
        NotFound: failedAcceptInvitation(visit, "NotFound"),
        Unauthorized: failedAcceptInvitation(visit, "Unauthorized"),
        UnknownError: failedAcceptInvitation(visit, "Unexpected"),
        HttpClientError: failedAcceptInvitation(visit, "Unexpected"),
        SchemaError: failedAcceptInvitation(visit, "Unexpected"),
      }),
    ),
});

export const init = (
  start: Readonly<{ visit: number; redirectUrl: string; invitationToken: string | undefined }>,
): Update.Return<Model, Message, SpaHttpClient> => {
  const { visit, redirectUrl, invitationToken } = start;
  if (invitationToken === undefined || invitationToken === "") {
    return { model: { visit, redirectUrl, phase: Phase.Failed({ message: TOKEN_MISSING }) } };
  } else {
    return {
      model: { visit, redirectUrl, phase: Phase.Accepting() },
      commands: [AcceptInvitation({ visit, invitationToken })],
    };
  }
};

type UpdateReturn = Update.ReturnWithOutMessage<Model, Message, OutMessage, SpaHttpClient>;

const withPhase = (model: Model, phase: typeof Phase.Type): Model =>
  modifyFields(model, { phase: () => phase });

const whileAccepting = (model: Model, visit: number, next: () => UpdateReturn): UpdateReturn =>
  visit === model.visit
    ? Phase.matchOrElse(model.phase, { Accepting: next }, () => ({ model }))
    : { model };

const failAcceptInvitation = (model: Model, failure: AcceptFailure): UpdateReturn =>
  failure === "Unauthorized"
    ? { model: withPhase(model, Phase.Leaving()), outMessage: OutMessage.RequiredSignIn() }
    : { model: withPhase(model, Phase.Failed({ message: FAILURE_MESSAGES[failure] })) };

export const update = (model: Model, message: Message) =>
  Message.match<UpdateReturn>(message, {
    SucceededAcceptInvitation: ({ visit }) =>
      whileAccepting(model, visit, () => ({
        model: withPhase(model, Phase.Leaving()),
        outMessage: OutMessage.AcceptedInvitation({ redirectUrl: model.redirectUrl }),
      })),
    FailedAcceptInvitation: ({ visit, failure }) =>
      whileAccepting(model, visit, () => failAcceptInvitation(model, failure)),
  });

const failedView = (message: string, h: HtmlBuilder<Message>): Html =>
  h.main(
    [
      h.Class(
        "relative flex min-h-svh flex-col items-center justify-center gap-6 bg-background p-6 md:p-10",
      ),
    ],
    [
      h.div(
        [h.Class(`${cardClassNames.root} w-full max-w-sm`)],
        [
          h.div(
            [h.Class(cardClassNames.header)],
            [
              h.h1([h.Class(cardClassNames.title)], ["招待を受諾できませんでした"]),
              h.div([h.Class(cardClassNames.description)], [message]),
            ],
          ),
          h.div(
            [h.Class(cardClassNames.content)],
            [
              h.a(
                [h.Href(ACCOUNT_HOME_PATH), h.Class(`${textLinkClassName} text-sm`)],
                ["アカウントに戻る"],
              ),
            ],
          ),
        ],
      ),
    ],
  );

export const view = Submodel.defineView<Model, Message>((model, h) =>
  Phase.match(model.phase, {
    Accepting: () => fullScreenStatusView("読み込み中…", h),
    Leaving: () => fullScreenStatusView("読み込み中…", h),
    Failed: ({ message }) => failedView(message, h),
  }),
);
