import { Effect, Option, Schema } from "effect";
import { Command, Update } from "foldkit";
import type { Document, Html, HtmlBuilder } from "foldkit/html";
import { defineMessageUnion } from "foldkit/message";
import { UrlRequest, load, pushUrl } from "foldkit/navigation";
import { modifyFields } from "foldkit/struct";
import { Url, toString as urlToString } from "foldkit/url";
import {
  Building2,
  Monitor,
  Plug,
  Settings2,
  ShieldCheck,
  User,
  Users,
  type IconNode,
} from "lucide";

import * as Sessions from "../account/pages/SessionsPage";
import { searchReturningTo } from "../shared/leave-spa";
import { declaredFailuresOnly, SpaHttpClient } from "../shared/spa-http-client";
import { iconView } from "../shared/ui/icon-view";
import {
  AccountRoute,
  companiesRouter,
  companySettingsRouter,
  connectionsRouter,
  membersRouter,
  profileRouter,
  securityRouter,
  sessionsRouter,
  urlToAccountRoute,
} from "./account-route";
import { startRoutingApplication } from "./start-application";

type AccountRoute = typeof AccountRoute.Type;

const Model = Schema.Struct({
  route: AccountRoute,
  sessionsPage: Schema.Option(Sessions.Model),
});
type Model = typeof Model.Type;

const Message = defineMessageUnion({
  ClickedLink: { request: UrlRequest },
  ChangedUrl: { url: Url },
  CompletedNavigate: {},
  CompletedCheckAccountEntry: {},
  GotSessionsMessage: { message: Sessions.Message },
});
type Message = typeof Message.Type;

type UpdateReturn = Update.Return<Model, Message, SpaHttpClient>;

const NavigateInAccount = Command.define("NavigateInAccount", {
  args: { href: Schema.String },
  messages: [Message.CompletedNavigate],
  execute: ({ href }) => pushUrl(href).pipe(Effect.as(Message.CompletedNavigate())),
});

const LoadDocument = Command.define("LoadDocument", {
  args: { href: Schema.String },
  messages: [Message.CompletedNavigate],
  execute: ({ href }) => load(href).pipe(Effect.as(Message.CompletedNavigate())),
});

const companySignupHref = (returnTo: string) => {
  const { service_name, redirect_url } = searchReturningTo(returnTo);
  return `/auth/signup/company?service_name=${service_name}&redirect_url=${encodeURIComponent(redirect_url)}`;
};

const CheckAccountEntry = Command.define("CheckAccountEntry", {
  args: { returnTo: Schema.String },
  messages: [Message.CompletedCheckAccountEntry],
  execute: ({ returnTo }) =>
    Effect.gen(function* () {
      const client = yield* SpaHttpClient;
      const state = yield* declaredFailuresOnly(client.account.memberships());
      if (state.memberships.length === 0) yield* load(companySignupHref(returnTo));
      return Message.CompletedCheckAccountEntry();
    }).pipe(Effect.catch(() => Effect.succeed(Message.CompletedCheckAccountEntry()))),
});

const toSessionsMessage = (message: Sessions.Message) => Message.GotSessionsMessage({ message });

const enterRoute = (route: AccountRoute, model: Model): UpdateReturn =>
  AccountRoute.match<UpdateReturn>(route, {
    Sessions: () =>
      Update.foldChildInit(Sessions.page.init(undefined), {
        toParentModel: (sessionsPage) =>
          modifyFields(model, {
            route: () => route,
            sessionsPage: () => Option.some(sessionsPage),
          }),
        toParentMessage: toSessionsMessage,
      }),
    Profile: () => ({ model: modifyFields(model, { route: () => route }) }),
    Security: () => ({ model: modifyFields(model, { route: () => route }) }),
    Connections: () => ({ model: modifyFields(model, { route: () => route }) }),
    Companies: () => ({ model: modifyFields(model, { route: () => route }) }),
    Members: () => ({ model: modifyFields(model, { route: () => route }) }),
    CompanySettings: () => ({ model: modifyFields(model, { route: () => route }) }),
    NotFound: () => ({ model: modifyFields(model, { route: () => route }) }),
  });

const init = (url: Url): UpdateReturn => {
  const route = urlToAccountRoute(url);
  const entered = enterRoute(route, { route, sessionsPage: Option.none() });
  return {
    model: entered.model,
    commands: [CheckAccountEntry({ returnTo: url.pathname }), ...(entered.commands ?? [])],
  };
};

const foldSessions = Update.foldChild({
  update: Sessions.page.update,
  read: (model: Model) => model.sessionsPage,
  write: (model: Model, sessionsPage: Sessions.Model) =>
    modifyFields(model, { sessionsPage: () => Option.some(sessionsPage) }),
  toParentMessage: toSessionsMessage,
});

const isInAccount = (url: Url) =>
  url.pathname === "/account" || url.pathname.startsWith("/account/");

const update = (model: Model, message: Message): UpdateReturn =>
  Message.match<UpdateReturn>(message, {
    ClickedLink: ({ request }) =>
      UrlRequest.match<UpdateReturn>(request, {
        Internal: ({ url }) => ({
          model,
          commands: [
            isInAccount(url)
              ? NavigateInAccount({ href: urlToString(url) })
              : LoadDocument({ href: urlToString(url) }),
          ],
        }),
        External: ({ href }) => ({ model, commands: [LoadDocument({ href })] }),
      }),
    ChangedUrl: ({ url }) => enterRoute(urlToAccountRoute(url), model),
    CompletedNavigate: () => ({ model }),
    CompletedCheckAccountEntry: () => ({ model }),
    GotSessionsMessage: ({ message }) => foldSessions(model, message),
  });

const NAV_LINK_CLASS =
  "flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground data-[status=active]:bg-accent data-[status=active]:text-accent-foreground";

type NavItem = Readonly<{
  href: string;
  icon: IconNode;
  label: string;
  route: AccountRoute["_tag"];
}>;

const COMPANY_NAV: ReadonlyArray<NavItem> = [
  { href: companiesRouter(), icon: Building2, label: "所属事業所", route: "Companies" },
  { href: membersRouter(), icon: Users, label: "メンバー", route: "Members" },
  { href: companySettingsRouter(), icon: Settings2, label: "事業所設定", route: "CompanySettings" },
];

const ACCOUNT_NAV: ReadonlyArray<NavItem> = [
  { href: profileRouter(), icon: User, label: "プロフィール", route: "Profile" },
  { href: securityRouter(), icon: ShieldCheck, label: "セキュリティ", route: "Security" },
  { href: sessionsRouter(), icon: Monitor, label: "セッション", route: "Sessions" },
  { href: connectionsRouter(), icon: Plug, label: "連携アカウント", route: "Connections" },
];

const navLinksView = (h: HtmlBuilder<Message>, model: Model, items: ReadonlyArray<NavItem>) =>
  items.map((item) =>
    h.a(
      [
        h.Key(item.href),
        h.Href(item.href),
        h.Class(NAV_LINK_CLASS),
        h.DataAttribute("status", model.route._tag === item.route ? "active" : "inactive"),
        ...(model.route._tag === item.route ? [h.AriaCurrent("page")] : []),
      ],
      [h.span([h.Class("size-4")], [iconView(h, item.icon)]), item.label],
    ),
  );

const notMigratedView = (h: HtmlBuilder<Message>): Html =>
  h.p([h.Class("text-sm text-muted-foreground")], ["この画面は prototype では未移行"]);

const pageView = (h: HtmlBuilder<Message>, model: Model): Html =>
  Option.match(model.sessionsPage, {
    onNone: () => notMigratedView(h),
    onSome: (sessionsPage) =>
      model.route._tag === "Sessions"
        ? h.submodel({
            slotId: "sessions",
            model: sessionsPage,
            view: Sessions.page.view,
            toParentMessage: toSessionsMessage,
          })
        : notMigratedView(h),
  });

const view = (model: Model, h: HtmlBuilder<Message>): Document => ({
  title: "taimei-auth",
  body: h.div(
    [h.Class("flex min-h-svh bg-background")],
    [
      h.aside(
        [h.Class("flex w-60 flex-col gap-1 border-r p-4")],
        [
          h.div(
            [
              h.Class(
                "mb-1 px-3 text-xs font-medium uppercase tracking-wide text-muted-foreground",
              ),
            ],
            ["事業所"],
          ),
          ...navLinksView(h, model, COMPANY_NAV),
          h.div(
            [
              h.Class(
                "mb-1 mt-3 px-3 text-xs font-medium uppercase tracking-wide text-muted-foreground",
              ),
            ],
            ["アカウント"],
          ),
          ...navLinksView(h, model, ACCOUNT_NAV),
        ],
      ),
      h.main(
        [h.Class("flex-1 p-6 md:p-10")],
        [h.div([h.Class("mx-auto max-w-2xl")], [pageView(h, model)])],
      ),
    ],
  ),
});

export const startAccountApplication = (container: HTMLElement) =>
  startRoutingApplication({
    Model,
    init,
    update,
    view,
    container,
    routing: {
      onUrlRequest: (request) => Message.ClickedLink({ request }),
      onUrlChange: (url) => Message.ChangedUrl({ url }),
    },
    resources: SpaHttpClient.layer,
  });
