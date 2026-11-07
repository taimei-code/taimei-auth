import { Effect, Option, Schema } from "effect";
import { Command, Runtime, type Update } from "foldkit";
import type { Document, HtmlBuilder } from "foldkit/html";
import { defineMessageUnion } from "foldkit/message";
import { UrlRequest, load } from "foldkit/navigation";
import { modifyFields } from "foldkit/struct";
import { Url, toString as urlToString } from "foldkit/url";

import { authErrorView } from "../auth/pages/AuthError";
import { AuthRoute, urlToAuthRoute } from "./auth-route";

const Model = Schema.Struct({ route: AuthRoute });
type Model = typeof Model.Type;

const Message = defineMessageUnion({
  ClickedLink: { request: UrlRequest },
  ChangedUrl: { url: Url },
  CompletedLoadDocument: {},
});
type Message = typeof Message.Type;

type UpdateReturn = Update.Return<Model, Message>;

const LoadDocument = Command.define("LoadDocument", {
  args: { href: Schema.String },
  messages: [Message.CompletedLoadDocument],
  execute: ({ href }) => load(href).pipe(Effect.as(Message.CompletedLoadDocument())),
});

const init: Runtime.RoutingApplicationInit<Model, Message> = (url) => ({
  model: { route: urlToAuthRoute(url) },
});

const update = (model: Model, message: Message): UpdateReturn =>
  Message.match<UpdateReturn>(message, {
    ClickedLink: ({ request }) =>
      UrlRequest.match(request, {
        Internal: ({ url }) => ({ model, commands: [LoadDocument({ href: urlToString(url) })] }),
        External: ({ href }) => ({ model, commands: [LoadDocument({ href })] }),
      }),
    ChangedUrl: ({ url }) => ({
      model: modifyFields(model, { route: () => urlToAuthRoute(url) }),
    }),
    CompletedLoadDocument: () => ({ model }),
  });

const view = (model: Model, h: HtmlBuilder<Message>): Document => ({
  title: "taimei-auth",
  body: AuthRoute.match(model.route, {
    Error: ({ reason }) => authErrorView(h, reason),
    NotFound: () => authErrorView(h, Option.none()),
  }),
});

export const startAuthApplication = (container: HTMLElement) =>
  Runtime.run(
    Runtime.makeApplication({
      Model,
      init,
      update,
      view,
      container,
      routing: {
        onUrlRequest: (request) => Message.ClickedLink({ request }),
        onUrlChange: (url) => Message.ChangedUrl({ url }),
      },
      devTools: false,
    }),
  );
