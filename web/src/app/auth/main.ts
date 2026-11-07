import { Effect, Option, Schema } from "effect";
import { Command, type Update } from "foldkit";
import type { Document, HtmlBuilder } from "foldkit/html";
import { defineMessageUnion } from "foldkit/message";
import { pushUrl, UrlRequest } from "foldkit/navigation";
import { modifyFields } from "foldkit/struct";
import { toString as urlToString, Url } from "foldkit/url";

import * as AuthError from "../../auth/pages/AuthError";
import { loadDocument } from "../../shared/leave-spa";
import { AuthRoute, urlToAuthRoute } from "./route";

export const Model = Schema.Struct({ route: AuthRoute });
export type Model = typeof Model.Type;

export const Message = defineMessageUnion({
  ClickedLink: { request: UrlRequest },
  ChangedUrl: { url: Url },
  CompletedLoadDocument: {},
  CompletedPushUrl: {},
});
export type Message = typeof Message.Type;

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

const commandForInternalUrl = (url: Url) =>
  AuthRoute.match(urlToAuthRoute(url), {
    Error: () => PushUrl({ href: urlToString(url) }),
    NotFound: () => LoadDocument({ href: urlToString(url) }),
  });

export const init = (url: Url): Update.Return<Model, Message> => ({
  model: { route: urlToAuthRoute(url) },
});

export const update = (model: Model, message: Message): Update.Return<Model, Message> =>
  Message.match<Update.Return<Model, Message>>(message, {
    ClickedLink: ({ request }) =>
      UrlRequest.match(request, {
        Internal: ({ url }) => ({ model, commands: [commandForInternalUrl(url)] }),
        External: ({ href }) => ({ model, commands: [LoadDocument({ href })] }),
      }),
    ChangedUrl: ({ url }) => ({ model: modifyFields(model, { route: () => urlToAuthRoute(url) }) }),
    CompletedLoadDocument: () => ({ model }),
    CompletedPushUrl: () => ({ model }),
  });

export const view = (model: Model, h: HtmlBuilder<Message>): Document => ({
  title: "taimei-auth",
  body: AuthRoute.match(model.route, {
    Error: ({ reason }) => AuthError.view(reason, h),
    NotFound: () => AuthError.view(Option.none(), h),
  }),
});
