import { Array, Effect, Number, Option, Schema } from "effect";
import { Command, Update } from "foldkit";
import type { Document, Html, HtmlBuilder } from "foldkit/html";
import { defineMessageUnion } from "foldkit/message";
import { UrlRequest } from "foldkit/navigation";
import { defineTaggedUnion } from "foldkit/schema";
import { modifyFields } from "foldkit/struct";
import { Url } from "foldkit/url";
import {
  Building2,
  type IconNode,
  LogOut,
  Monitor,
  Plug,
  Settings2,
  ShieldCheck,
  User,
  Users,
} from "lucide";

import * as Connections from "../../account/pages/Connections";
import * as Profile from "../../account/pages/Profile";
import * as Sessions from "../../account/pages/Sessions";
import * as AuthError from "../../auth/pages/AuthError";
import { SIGN_OUT_FAILED, signOut } from "../../auth/sign-out";
import { leaveSpaToCompanySignup } from "../../shared/leave-spa";
import { SpaHttpClient } from "../../shared/spa-http-client";
import { Submission } from "../../shared/submission";
import { buttonView } from "../../shared/ui/button-view";
import { fullScreenStatusView, iconView } from "../../shared/ui/icon-view";
import { NoticeToast, noticeOf, noticeToastView } from "../../shared/ui/toast-view";
import * as DocumentNavigation from "../document-navigation";
import {
  AccountRoute,
  companiesRouter,
  companySettingsRouter,
  connectionsRouter,
  enteredAccountRoute,
  membersRouter,
  profileRouter,
  securityRouter,
  sessionsRouter,
  urlToAccountRoute,
} from "./route";

const AccountPage = defineTaggedUnion({
  Profile: { model: Profile.Model },
  Sessions: { model: Sessions.Model },
  Connections: { model: Connections.Model },
});
type AccountPage = typeof AccountPage.Type;

const Entry = defineTaggedUnion({
  Checking: {},
  Ready: { maybeCurrentCompany: Schema.Option(Profile.CurrentCompany) },
});
type Entry = typeof Entry.Type;

export const Model = Schema.Struct({
  route: AccountRoute,
  origin: Schema.String,
  pageVisit: Schema.Int,
  entry: Entry,
  maybePage: Schema.Option(AccountPage),
  signOut: Submission,
  toast: NoticeToast.Model,
});
export type Model = typeof Model.Type;

const LoadCompanyStateFailure = Schema.Literals(["Unauthorized", "Unexpected"]);

export const Message = defineMessageUnion({
  GotDocumentNavigationMessage: { message: DocumentNavigation.Message },
  ClickedLink: { request: UrlRequest },
  ChangedUrl: { url: Url },
  SucceededLoadCompanyState: {
    isCompanyMember: Schema.Boolean,
    maybeCurrentCompany: Schema.Option(Profile.CurrentCompany),
  },
  FailedLoadCompanyState: { failure: LoadCompanyStateFailure },
  ClickedSignOut: {},
  SucceededSignOut: {},
  FailedSignOut: {},
  CompletedLeaveToCompanySignup: {},
  GotProfileMessage: { message: Profile.Message },
  GotSessionsMessage: { message: Sessions.Message },
  GotConnectionsMessage: { message: Connections.Message },
  GotToastMessage: { message: NoticeToast.Message },
});
export type Message = typeof Message.Type;

type UpdateReturn = Update.Return<Model, Message, SpaHttpClient>;

const navigate = (command: Command.Command<DocumentNavigation.Message>) =>
  Command.mapMessage(command, (message) => Message.GotDocumentNavigationMessage({ message }));

const failedLoadCompanyState = (failure: typeof LoadCompanyStateFailure.Type) => () =>
  Effect.succeed(Message.FailedLoadCompanyState({ failure }));

export const LoadCompanyState = Command.define("LoadCompanyState", {
  messages: [Message.SucceededLoadCompanyState, Message.FailedLoadCompanyState],
  execute: Effect.gen(function* () {
    const client = yield* SpaHttpClient;
    const state = yield* client.account.memberships();
    return Message.SucceededLoadCompanyState({
      isCompanyMember: Array.isReadonlyArrayNonEmpty(state.memberships),
      maybeCurrentCompany: Array.findFirst(
        state.memberships,
        (membership) => membership.company_id === state.current_company_id,
      ).pipe(
        Option.map((membership) => ({
          companyName: membership.company_name,
          role: membership.role,
          orgCode: membership.company_org_code,
        })),
      ),
    });
  }).pipe(
    Effect.catchTags({
      Unauthorized: failedLoadCompanyState("Unauthorized"),
      HttpClientError: failedLoadCompanyState("Unexpected"),
      SchemaError: failedLoadCompanyState("Unexpected"),
    }),
  ),
});

export const LeaveToCompanySignup = Command.define("LeaveToCompanySignup", {
  messages: [Message.CompletedLeaveToCompanySignup],
  execute: Effect.sync(leaveSpaToCompanySignup).pipe(
    Effect.as(Message.CompletedLeaveToCompanySignup()),
  ),
});

export const SignOut = Command.define("SignOut", {
  messages: [Message.SucceededSignOut, Message.FailedSignOut],
  execute: Effect.promise(() => signOut()).pipe(
    Effect.map((result) =>
      result === "signedOut" ? Message.SucceededSignOut() : Message.FailedSignOut(),
    ),
  ),
});

const AFTER_SIGN_OUT_HREF = "/";

const TOAST_ID = "account-notices";

const toProfileMessage = (message: Profile.Message) => Message.GotProfileMessage({ message });
const toSessionsMessage = (message: Sessions.Message) => Message.GotSessionsMessage({ message });
const toConnectionsMessage = (message: Connections.Message) =>
  Message.GotConnectionsMessage({ message });
const toToastMessage = (message: typeof NoticeToast.Message.Type) =>
  Message.GotToastMessage({ message });

const withPage = (model: Model, page: AccountPage): Model =>
  modifyFields(model, { maybePage: (): Option.Option<AccountPage> => Option.some(page) });

const enterPage = (
  model: Model,
  maybeCurrentCompany: Option.Option<Profile.CurrentCompany>,
): UpdateReturn => {
  const entered = modifyFields(model, {
    pageVisit: Number.increment,
    maybePage: () => Option.none(),
  });
  const visit = entered.pageVisit;
  return AccountRoute.matchOrElse<UpdateReturn>(
    entered.route,
    {
      Profile: () => {
        const profileInit = Profile.init({ visit, maybeCurrentCompany });
        return {
          model: withPage(entered, AccountPage.Profile({ model: profileInit.model })),
          commands: Command.mapMessages(profileInit.commands, toProfileMessage),
        };
      },
      Sessions: () => {
        const sessionsInit = Sessions.init(visit);
        return {
          model: withPage(entered, AccountPage.Sessions({ model: sessionsInit.model })),
          commands: Command.mapMessages(sessionsInit.commands, toSessionsMessage),
        };
      },
      Connections: () => {
        const connectionsInit = Connections.init(visit);
        return {
          model: withPage(entered, AccountPage.Connections({ model: connectionsInit.model })),
          commands: Command.mapMessages(connectionsInit.commands, toConnectionsMessage),
        };
      },
    },
    () => ({ model: entered }),
  );
};

const enterRouteWhenReady = (model: Model): UpdateReturn =>
  Entry.matchOrElse(
    model.entry,
    { Ready: ({ maybeCurrentCompany }) => enterPage(model, maybeCurrentCompany) },
    () => ({ model }),
  );

export const init = (url: Url): UpdateReturn => ({
  model: {
    route: urlToAccountRoute(url),
    origin: DocumentNavigation.originOf(url),
    pageVisit: 0,
    entry: Entry.Checking(),
    maybePage: Option.none(),
    signOut: Submission.Idle(),
    toast: NoticeToast.init({ id: TOAST_ID }),
  },
  commands: [LoadCompanyState()],
});

const becomeReady = (
  model: Model,
  maybeCurrentCompany: Option.Option<Profile.CurrentCompany>,
): UpdateReturn =>
  Entry.guards.Checking(model.entry)
    ? enterRouteWhenReady(
        modifyFields(model, { entry: () => Entry.Ready({ maybeCurrentCompany }) }),
      )
    : { model };

const foldToast = Update.foldChild({
  update: NoticeToast.update,
  read: (model: Model) => Option.some(model.toast),
  write: (model: Model, nextToast: typeof NoticeToast.Model.Type) =>
    modifyFields(model, { toast: () => nextToast }),
  toParentMessage: toToastMessage,
  foldOutMessage: NoticeToast.OutMessage.match<Update.Step<Model, Message>>({
    DismissedToast: () => (model) => ({ model }),
  }),
});

const foldToastShow = Update.foldChild({
  update: NoticeToast.show,
  read: (model: Model) => Option.some(model.toast),
  write: (model: Model, nextToast: typeof NoticeToast.Model.Type) =>
    modifyFields(model, { toast: () => nextToast }),
  toParentMessage: toToastMessage,
  foldOutMessage: NoticeToast.OutMessage.match<Update.Step<Model, Message>>({
    DismissedToast: () => (model) => ({ model }),
  }),
});

const foldProfileOutMessage = Profile.OutMessage.match<Update.Step<Model, Message>>({
  Notified:
    ({ tone, text }) =>
    (model) =>
      foldToastShow(model, noticeOf(tone, text)),
  RequiredSignIn: () => (model) => ({
    model,
    commands: [navigate(DocumentNavigation.LeaveToSignIn())],
  }),
});

const foldProfile = Update.foldChild({
  update: Profile.update,
  read: (model: Model) =>
    Option.map(Option.filter(model.maybePage, AccountPage.guards.Profile), ({ model }) => model),
  write: (model: Model, nextProfile: Profile.Model) =>
    withPage(model, AccountPage.Profile({ model: nextProfile })),
  toParentMessage: toProfileMessage,
  foldOutMessage: foldProfileOutMessage,
});

const foldSessions = Update.foldChild({
  update: Sessions.update,
  read: (model: Model) =>
    Option.map(Option.filter(model.maybePage, AccountPage.guards.Sessions), ({ model }) => model),
  write: (model: Model, nextSessions: Sessions.Model) =>
    withPage(model, AccountPage.Sessions({ model: nextSessions })),
  toParentMessage: toSessionsMessage,
});

const foldConnections = Update.foldChild({
  update: Connections.update,
  read: (model: Model) =>
    Option.map(
      Option.filter(model.maybePage, AccountPage.guards.Connections),
      ({ model }) => model,
    ),
  write: (model: Model, nextConnections: Connections.Model) =>
    withPage(model, AccountPage.Connections({ model: nextConnections })),
  toParentMessage: toConnectionsMessage,
});

export const update = (model: Model, message: Message) =>
  Message.match<UpdateReturn>(message, {
    GotDocumentNavigationMessage: () => ({ model }),
    ClickedLink: ({ request }) =>
      UrlRequest.match<UpdateReturn>(request, {
        Internal: ({ url }) => ({
          model,
          commands: [
            navigate(
              DocumentNavigation.commandForInternalUrl(
                url,
                !AccountRoute.guards.NotFound(urlToAccountRoute(url)),
              ),
            ),
          ],
        }),
        External: ({ href }) => ({
          model,
          commands: [navigate(DocumentNavigation.LoadDocument({ href }))],
        }),
      }),
    ChangedUrl: ({ url }) => {
      const nextModel = modifyFields(model, { route: () => urlToAccountRoute(url) });
      return Option.isSome(enteredAccountRoute(Option.some(model.route), nextModel.route))
        ? enterRouteWhenReady(nextModel)
        : { model: nextModel };
    },
    SucceededLoadCompanyState: ({ isCompanyMember, maybeCurrentCompany }) =>
      isCompanyMember
        ? becomeReady(model, maybeCurrentCompany)
        : { model, commands: [LeaveToCompanySignup()] },
    FailedLoadCompanyState: ({ failure }) =>
      failure === "Unauthorized"
        ? { model, commands: [navigate(DocumentNavigation.LeaveToSignIn())] }
        : becomeReady(model, Option.none()),
    ClickedSignOut: () =>
      Submission.guards.Submitting(model.signOut)
        ? { model }
        : {
            model: modifyFields(model, { signOut: () => Submission.Submitting() }),
            commands: [SignOut()],
          },
    SucceededSignOut: () => ({
      model,
      commands: [navigate(DocumentNavigation.ReplaceDocument({ href: AFTER_SIGN_OUT_HREF }))],
    }),
    FailedSignOut: () =>
      foldToastShow(
        modifyFields(model, { signOut: () => Submission.Idle() }),
        noticeOf("Error", SIGN_OUT_FAILED),
      ),
    CompletedLeaveToCompanySignup: () => ({ model }),
    GotProfileMessage: ({ message: pageMessage }) => foldProfile(model, pageMessage),
    GotSessionsMessage: ({ message: pageMessage }) => foldSessions(model, pageMessage),
    GotConnectionsMessage: ({ message: pageMessage }) => foldConnections(model, pageMessage),
    GotToastMessage: ({ message: toastMessage }) => foldToast(model, toastMessage),
  });

const NAV_LINK_CLASS =
  "flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground data-[status=active]:bg-accent data-[status=active]:text-accent-foreground [&_svg]:size-4";

const NAV_GROUP_LABEL_CLASS =
  "mb-1 px-3 text-xs font-medium uppercase tracking-wide text-muted-foreground";

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

const navLinksView = (
  model: Model,
  items: ReadonlyArray<NavItem>,
  h: HtmlBuilder<Message>,
): ReadonlyArray<Html> =>
  items.map((item) =>
    h.keyed("a")(
      item.href,
      [
        h.Href(item.href),
        h.Class(NAV_LINK_CLASS),
        ...(model.route._tag === item.route
          ? [h.AriaCurrent("page"), h.DataAttribute("status", "active")]
          : []),
      ],
      [iconView(item.icon, h), item.label],
    ),
  );

const pageView = (model: Model, h: HtmlBuilder<Message>): ReadonlyArray<Html> =>
  Option.match(model.maybePage, {
    onNone: () => [],
    onSome: (page) => [
      AccountPage.match(page, {
        Profile: ({ model: pageModel }) =>
          h.submodel({
            slotId: "profile",
            view: Profile.view,
            model: pageModel,
            toParentMessage: toProfileMessage,
          }),
        Sessions: ({ model: pageModel }) =>
          h.submodel({
            slotId: "sessions",
            view: Sessions.view,
            model: pageModel,
            toParentMessage: toSessionsMessage,
          }),
        Connections: ({ model: pageModel }) =>
          h.submodel({
            slotId: "connections",
            view: Connections.view,
            model: pageModel,
            toParentMessage: toConnectionsMessage,
          }),
      }),
    ],
  });

const frameView = (model: Model, h: HtmlBuilder<Message>): Html =>
  h.div(
    [h.Class("flex min-h-svh bg-background")],
    [
      h.aside(
        [h.Class("flex w-60 flex-col gap-1 border-r p-4")],
        [
          h.div([h.Class(NAV_GROUP_LABEL_CLASS)], ["事業所"]),
          ...navLinksView(model, COMPANY_NAV, h),
          h.div([h.Class(`${NAV_GROUP_LABEL_CLASS} mt-3`)], ["アカウント"]),
          ...navLinksView(model, ACCOUNT_NAV, h),
          h.div(
            [h.Class("mt-auto border-t pt-3")],
            [
              buttonView(
                {
                  label: "ログアウト",
                  type: "button",
                  look: "navItem",
                  submission: Submission.Idle(),
                  isBlocked: Submission.guards.Submitting(model.signOut),
                  onClick: Message.ClickedSignOut(),
                  icon: LogOut,
                },
                h,
              ),
            ],
          ),
        ],
      ),
      h.main(
        [h.Class("flex-1 p-6 md:p-10")],
        [h.div([h.Class("mx-auto max-w-2xl")], pageView(model, h))],
      ),
      noticeToastView(model.toast, toToastMessage, h),
    ],
  );

export const view = (model: Model, h: HtmlBuilder<Message>): Document => ({
  title: "taimei-auth",
  body: Entry.match(model.entry, {
    Checking: () => fullScreenStatusView("読み込み中…", h),
    Ready: () =>
      AccountRoute.guards.NotFound(model.route)
        ? AuthError.view(Option.none(), h)
        : frameView(model, h),
  }),
});
