import { Array, Effect, Number, Option, Schema } from "effect";
import { Nav } from "@foldkit/ui";
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

import * as CurrentCompany from "../../account/current-company";
import * as Connections from "../../account/pages/Connections";
import * as Profile from "../../account/pages/Profile";
import * as Security from "../../account/pages/Security";
import * as Sessions from "../../account/pages/Sessions";
import * as AuthError from "../../auth/pages/AuthError";
import * as Companies from "../../company/pages/Companies";
import * as CompanySettings from "../../company/pages/CompanySettings";
import * as Members from "../../membership/pages/Members";
import { SIGN_OUT_FAILED, signOut } from "../../auth/sign-out";
import { leaveSpaToCompanySignup } from "../../shared/leave-spa";
import { SpaHttpClient } from "../../shared/spa-http-client";
import { Submission } from "../../shared/submission";
import { buttonView } from "../../shared/ui/button-view";
import { Dialog, hasHeldReportIn, releaseDialogsIn } from "../../shared/ui/dialog-view";
import { fullScreenStatusView, iconView } from "../../shared/ui/icon-view";
import {
  NoticeToast,
  type NoticeTone,
  noticeOf,
  noticeToastView,
} from "../../shared/ui/toast-view";
import * as DocumentNavigation from "../document-navigation";
import { documentTitleOf, ERROR_PAGE_NAME } from "../document-title";
import {
  AccountRoute,
  companiesRouter,
  companySettingsRouter,
  connectionsRouter,
  accountRouteToEnter,
  membersRouter,
  profileRouter,
  securityRouter,
  sessionsRouter,
  urlToAccountRoute,
} from "./route";

const AccountPage = defineTaggedUnion({
  Profile: { model: Profile.Model },
  Companies: { model: Companies.Model },
  CompanySettings: { model: CompanySettings.Model },
  Members: { model: Members.Model },
  Security: { model: Security.Model },
  Sessions: { model: Sessions.Model },
  Connections: { model: Connections.Model },
});
type AccountPage = typeof AccountPage.Type;

const Entry = defineTaggedUnion({
  Checking: {},
  Ready: { currentCompany: CurrentCompany.Model },
});
type Entry = typeof Entry.Type;

export const Model = Schema.Struct({
  route: AccountRoute,
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
  SucceededLoadCompanyState: { state: CurrentCompany.CompanyMemberships },
  FailedLoadCompanyState: { failure: LoadCompanyStateFailure },
  ClickedSignOut: {},
  SucceededSignOut: {},
  FailedSignOut: {},
  CompletedLeaveToCompanySignup: {},
  GotCurrentCompanyMessage: { message: CurrentCompany.Message },
  GotProfileMessage: { message: Profile.Message },
  GotCompaniesMessage: { message: Companies.Message },
  GotCompanySettingsMessage: { message: CompanySettings.Message },
  GotMembersMessage: { message: Members.Message },
  GotSecurityMessage: { message: Security.Message },
  GotSessionsMessage: { message: Sessions.Message },
  GotConnectionsMessage: { message: Connections.Message },
  GotToastMessage: { message: NoticeToast.Message },
  GotLeftPageDialogMessage: { message: Dialog.Message },
});
export type Message = typeof Message.Type;

type UpdateReturn = Update.Return<Model, Message, SpaHttpClient>;
type Step = Update.Step<Model, Message, SpaHttpClient>;

const navigate = (command: Command.Command<DocumentNavigation.Message>) =>
  Command.mapMessage(command, (message) => Message.GotDocumentNavigationMessage({ message }));

const failedLoadCompanyState = (failure: typeof LoadCompanyStateFailure.Type) => () =>
  Effect.succeed(Message.FailedLoadCompanyState({ failure }));

export const LoadCompanyState = Command.define("LoadCompanyState", {
  messages: [Message.SucceededLoadCompanyState, Message.FailedLoadCompanyState],
  execute: CurrentCompany.readCompanyState.pipe(
    Effect.map((state) => Message.SucceededLoadCompanyState({ state })),
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

const EMPTY_COMPANY_STATE: CurrentCompany.CompanyMemberships = {
  maybeCurrentCompanyId: Option.none(),
  memberships: [],
};

const toCurrentCompanyMessage = (message: CurrentCompany.Message) =>
  Message.GotCurrentCompanyMessage({ message });
const toProfileMessage = (message: Profile.Message) => Message.GotProfileMessage({ message });
const toCompaniesMessage = (message: Companies.Message) => Message.GotCompaniesMessage({ message });
const toCompanySettingsMessage = (message: CompanySettings.Message) =>
  Message.GotCompanySettingsMessage({ message });
const toMembersMessage = (message: Members.Message) => Message.GotMembersMessage({ message });
const toSecurityMessage = (message: Security.Message) => Message.GotSecurityMessage({ message });
const toSessionsMessage = (message: Sessions.Message) => Message.GotSessionsMessage({ message });
const toConnectionsMessage = (message: Connections.Message) =>
  Message.GotConnectionsMessage({ message });
const toToastMessage = (message: typeof NoticeToast.Message.Type) =>
  Message.GotToastMessage({ message });

const withPage = (model: Model, page: AccountPage): Model =>
  modifyFields(model, { maybePage: (): Option.Option<AccountPage> => Option.some(page) });

const leaveToSignIn: Step = (model) => ({
  model,
  commands: [navigate(DocumentNavigation.LeaveToSignIn())],
});

const leaveAfterAccountDeleted: Step = (model) => ({
  model,
  commands: [navigate(DocumentNavigation.LeaveAfterAccountDeleted())],
});

const AFTER_LEAVING_PAGE: CurrentCompany.RefreshTexts = {
  maybeDoneText: Option.none(),
  actionText: "画面を移動しました",
};

const discardPage: Step = (model) => {
  const releaseDialogsAndEmptyPage: Step = (stepModel) => ({
    model: modifyFields(stepModel, {
      pageVisit: Number.increment,
      maybePage: () => Option.none(),
    }),
    commands: Command.mapMessages(releaseDialogsIn(stepModel.maybePage), (message) =>
      Message.GotLeftPageDialogMessage({ message }),
    ),
  });
  return hasHeldReportIn(model.maybePage)
    ? Update.combine(model, [releaseDialogsAndEmptyPage, refreshCompanyState(AFTER_LEAVING_PAGE)])
    : releaseDialogsAndEmptyPage(model);
};

const initPage = (entered: Model, currentCompany: CurrentCompany.Model): UpdateReturn => {
  const visit = entered.pageVisit;
  return AccountRoute.matchOrElse<UpdateReturn>(
    entered.route,
    {
      Profile: () => {
        const profileInit = Profile.init(visit);
        return {
          model: withPage(entered, AccountPage.Profile({ model: profileInit.model })),
          commands: Command.mapMessages(profileInit.commands, toProfileMessage),
        };
      },
      Companies: () => {
        const companiesInit = Companies.init(visit);
        return {
          model: withPage(entered, AccountPage.Companies({ model: companiesInit.model })),
          commands: Command.mapMessages(companiesInit.commands, toCompaniesMessage),
        };
      },
      CompanySettings: () => ({
        model: withPage(
          entered,
          AccountPage.CompanySettings({
            model: CompanySettings.init(
              visit,
              CurrentCompany.maybeCurrentMembership(currentCompany.state),
            ),
          }),
        ),
      }),
      Members: ({ service_name, redirect_url }) => {
        const membersInit = Members.init(
          visit,
          CurrentCompany.maybeCurrentMembership(currentCompany.state),
          { service_name, redirect_url },
        );
        return {
          model: withPage(entered, AccountPage.Members({ model: membersInit.model })),
          commands: Command.mapMessages(membersInit.commands, toMembersMessage),
        };
      },
      Security: () => {
        const securityInit = Security.init(visit);
        return {
          model: withPage(entered, AccountPage.Security({ model: securityInit.model })),
          commands: Command.mapMessages(securityInit.commands, toSecurityMessage),
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

const enterPage = (model: Model, currentCompany: CurrentCompany.Model): UpdateReturn =>
  Update.combine(model, [discardPage, (entered) => initPage(entered, currentCompany)]);

const enterRouteWhenReady: Step = (model) =>
  Entry.matchOrElse(
    model.entry,
    { Ready: ({ currentCompany }) => enterPage(model, currentCompany) },
    () => ({ model }),
  );

export const init = (url: Url): UpdateReturn => ({
  model: {
    route: urlToAccountRoute(url),
    pageVisit: 0,
    entry: Entry.Checking(),
    maybePage: Option.none(),
    signOut: Submission.Idle(),
    toast: NoticeToast.init({ id: TOAST_ID }),
  },
  commands: [LoadCompanyState()],
});

const becomeReady = (model: Model, state: CurrentCompany.CompanyMemberships): UpdateReturn =>
  Entry.guards.Checking(model.entry)
    ? enterRouteWhenReady(
        modifyFields(model, {
          entry: () => Entry.Ready({ currentCompany: CurrentCompany.init(state) }),
        }),
      )
    : { model };

const toastChild = {
  read: (model: Model) => Option.some(model.toast),
  write: (model: Model, nextToast: typeof NoticeToast.Model.Type): Model =>
    modifyFields(model, { toast: () => nextToast }),
  toParentMessage: toToastMessage,
  foldOutMessage: NoticeToast.OutMessage.match<Step>({
    DismissedToast: () => (model) => ({ model }),
  }),
};

const foldToast = Update.foldChild({ ...toastChild, update: NoticeToast.update });

const foldToastShow = Update.foldChild({ ...toastChild, update: NoticeToast.show });

const notify = (tone: NoticeTone, text: string): Step => foldToastShow(noticeOf(tone, text));

const notifyDone =
  (maybeDoneText: Option.Option<string>): Step =>
  (model) =>
    Option.match(maybeDoneText, {
      onNone: () => ({ model }),
      onSome: (text) => notify("Success", text)(model),
    });

const isCompanySwitchBlocked = (model: Model): boolean =>
  Option.exists(model.maybePage, (page) =>
    AccountPage.match(page, {
      Profile: () => false,
      Companies: () => false,
      CompanySettings: ({ model: settings }) => CompanySettings.isSubmitting(settings),
      Members: ({ model: members }) => Members.isSubmitting(members),
      Security: () => false,
      Sessions: () => false,
      Connections: () => false,
    }),
  );

const reenterCompanyPage: Step = (model) =>
  AccountRoute.isAnyOf(["CompanySettings", "Members"])(model.route)
    ? enterRouteWhenReady(model)
    : { model };

const currentCompanyChild = {
  read: (model: Model) =>
    Entry.matchOrElse(
      model.entry,
      { Ready: ({ currentCompany }) => Option.some(currentCompany) },
      () => Option.none(),
    ),
  write: (model: Model, nextCurrentCompany: CurrentCompany.Model): Model =>
    modifyFields(model, {
      entry: (): Entry => Entry.Ready({ currentCompany: nextCurrentCompany }),
    }),
  toParentMessage: toCurrentCompanyMessage,
  foldOutMessage: CurrentCompany.OutMessage.match<Step>({
    Notified: ({ tone, text }) => notify(tone, text),
    RequiredSignIn: () => leaveToSignIn,
    RefreshedCompanyState: ({ maybeDoneText }) => notifyDone(maybeDoneText),
    UpdatedCurrentCompany: ({ maybeDoneText }) =>
      Update.combine([notifyDone(maybeDoneText), reenterCompanyPage]),
  }),
};

const foldCurrentCompany = Update.foldChild({
  ...currentCompanyChild,
  update: CurrentCompany.update,
});

const foldCurrentCompanySwitch = Update.foldChild({
  ...currentCompanyChild,
  update: CurrentCompany.switchTo,
});

const foldCurrentCompanyRefresh = Update.foldChild({
  ...currentCompanyChild,
  update: CurrentCompany.refresh,
});

const refreshCompanyState = (texts: CurrentCompany.RefreshTexts): Step =>
  foldCurrentCompanyRefresh(texts);

const selectCompany = (companyId: string): Step => foldCurrentCompanySwitch(companyId);

const foldUnlessLeftPageChangedCompany = (
  model: Model,
  maybeCompanyChangeVisit: Option.Option<number>,
  foldPage: Step,
): UpdateReturn =>
  Option.exists(maybeCompanyChangeVisit, (visit) => visit !== model.pageVisit)
    ? refreshCompanyState(AFTER_LEAVING_PAGE)(model)
    : foldPage(model);

const pushCompanies: Step = (model) => ({
  model,
  commands: [navigate(DocumentNavigation.PushUrl({ href: companiesRouter() }))],
});

const foldProfile = Update.foldChild({
  update: Profile.update,
  read: (model: Model) =>
    Option.map(Option.filter(model.maybePage, AccountPage.guards.Profile), ({ model }) => model),
  write: (model: Model, nextProfile: Profile.Model) =>
    withPage(model, AccountPage.Profile({ model: nextProfile })),
  toParentMessage: toProfileMessage,
  foldOutMessage: Profile.OutMessage.match<Step>({
    Notified: ({ tone, text }) => notify(tone, text),
    RequiredSignIn: () => leaveToSignIn,
  }),
});

const foldCompanies = Update.foldChild({
  update: Companies.update,
  read: (model: Model) =>
    Option.map(Option.filter(model.maybePage, AccountPage.guards.Companies), ({ model }) => model),
  write: (model: Model, nextCompanies: Companies.Model) =>
    withPage(model, AccountPage.Companies({ model: nextCompanies })),
  toParentMessage: toCompaniesMessage,
  foldOutMessage: Companies.OutMessage.match<Step>({
    Notified: ({ tone, text }) => notify(tone, text),
    RequiredSignIn: () => leaveToSignIn,
    UpdatedCompanyState: ({ texts }) => refreshCompanyState(texts),
    SelectedCompany: ({ companyId }) => selectCompany(companyId),
  }),
});

const foldCompanySettings = Update.foldChild({
  update: CompanySettings.update,
  read: (model: Model) =>
    Option.map(
      Option.filter(model.maybePage, AccountPage.guards.CompanySettings),
      ({ model }) => model,
    ),
  write: (model: Model, nextSettings: CompanySettings.Model) =>
    withPage(model, AccountPage.CompanySettings({ model: nextSettings })),
  toParentMessage: toCompanySettingsMessage,
  foldOutMessage: CompanySettings.OutMessage.match<Step>({
    Notified: ({ tone, text }) => notify(tone, text),
    RequiredSignIn: () => leaveToSignIn,
    UpdatedCompanyState: ({ texts }) => refreshCompanyState(texts),
    DeletedCompany: ({ companyName }) =>
      Update.combine([
        pushCompanies,
        refreshCompanyState({
          maybeDoneText: Option.some(`「${companyName}」を削除しました。`),
          actionText: "事業所を削除しました",
        }),
      ]),
  }),
});

const foldMembers = Update.foldChild({
  update: Members.update,
  read: (model: Model) =>
    Option.map(Option.filter(model.maybePage, AccountPage.guards.Members), ({ model }) => model),
  write: (model: Model, nextMembers: Members.Model) =>
    withPage(model, AccountPage.Members({ model: nextMembers })),
  toParentMessage: toMembersMessage,
  foldOutMessage: Members.OutMessage.match<Step>({
    Notified: ({ tone, text }) => notify(tone, text),
    RequiredSignIn: () => leaveToSignIn,
  }),
});

const foldSecurity = Update.foldChild({
  update: Security.update,
  read: (model: Model) =>
    Option.map(Option.filter(model.maybePage, AccountPage.guards.Security), ({ model }) => model),
  write: (model: Model, nextSecurity: Security.Model) =>
    withPage(model, AccountPage.Security({ model: nextSecurity })),
  toParentMessage: toSecurityMessage,
  foldOutMessage: Security.OutMessage.match<Step>({
    Notified: ({ tone, text }) => notify(tone, text),
    RequiredSignIn: () => leaveToSignIn,
  }),
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
    ClickedLink: ({ request }) => ({
      model,
      commands: [
        navigate(
          DocumentNavigation.commandForLink(
            request,
            (url) => !AccountRoute.guards.NotFound(urlToAccountRoute(url)),
          ),
        ),
      ],
    }),
    ChangedUrl: ({ url }) => {
      const nextModel = modifyFields(model, { route: () => urlToAccountRoute(url) });
      return Option.isSome(accountRouteToEnter(Option.some(model.route), nextModel.route))
        ? enterRouteWhenReady(nextModel)
        : { model: nextModel };
    },
    SucceededLoadCompanyState: ({ state }) =>
      Array.match(state.memberships, {
        onEmpty: () => ({ model, commands: [LeaveToCompanySignup()] }),
        onNonEmpty: () => becomeReady(model, state),
      }),
    FailedLoadCompanyState: ({ failure }) =>
      failure === "Unauthorized" ? leaveToSignIn(model) : becomeReady(model, EMPTY_COMPANY_STATE),
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
      notify("Error", SIGN_OUT_FAILED)(modifyFields(model, { signOut: () => Submission.Idle() })),
    CompletedLeaveToCompanySignup: () => ({ model }),
    GotCurrentCompanyMessage: ({ message: childMessage }) =>
      Schema.is(CurrentCompany.Message.SelectedCompany)(childMessage) &&
      isCompanySwitchBlocked(model)
        ? { model }
        : foldCurrentCompany(model, childMessage),
    GotProfileMessage: ({ message: pageMessage }) =>
      Profile.isAccountDeleted(pageMessage)
        ? leaveAfterAccountDeleted(model)
        : foldProfile(model, pageMessage),
    GotCompaniesMessage: ({ message: pageMessage }) =>
      Companies.isLastCompanyLeft(pageMessage)
        ? leaveAfterAccountDeleted(model)
        : foldUnlessLeftPageChangedCompany(
            model,
            Companies.visitOfCompanyChange(pageMessage),
            foldCompanies(pageMessage),
          ),
    GotCompanySettingsMessage: ({ message: pageMessage }) =>
      CompanySettings.isLastCompanyDeleted(pageMessage)
        ? leaveAfterAccountDeleted(model)
        : foldUnlessLeftPageChangedCompany(
            model,
            CompanySettings.visitOfCompanyChange(pageMessage),
            foldCompanySettings(pageMessage),
          ),
    GotMembersMessage: ({ message: pageMessage }) => foldMembers(model, pageMessage),
    GotSecurityMessage: ({ message: pageMessage }) => foldSecurity(model, pageMessage),
    GotSessionsMessage: ({ message: pageMessage }) => foldSessions(model, pageMessage),
    GotConnectionsMessage: ({ message: pageMessage }) => foldConnections(model, pageMessage),
    GotToastMessage: ({ message: toastMessage }) => foldToast(model, toastMessage),
    GotLeftPageDialogMessage: () => ({ model }),
  });

const NAV_LINK_CLASS =
  "flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground data-[current]:bg-accent data-[current]:font-semibold data-[current]:text-accent-foreground [&_svg]:size-4";

const NAV_GROUP_LABEL_CLASS =
  "mb-1 px-3 text-xs font-medium uppercase tracking-wide text-muted-foreground";

type NavRoute = Exclude<AccountRoute["_tag"], "NotFound">;

const NAV_ITEMS: Readonly<
  Record<NavRoute, Readonly<{ href: string; icon: IconNode; label: string }>>
> = {
  Companies: { href: companiesRouter(), icon: Building2, label: "所属事業所" },
  Members: { href: membersRouter({}), icon: Users, label: "メンバー" },
  CompanySettings: { href: companySettingsRouter(), icon: Settings2, label: "事業所設定" },
  Profile: { href: profileRouter(), icon: User, label: "プロフィール" },
  Security: { href: securityRouter(), icon: ShieldCheck, label: "セキュリティ" },
  Sessions: { href: sessionsRouter(), icon: Monitor, label: "セッション" },
  Connections: { href: connectionsRouter(), icon: Plug, label: "連携アカウント" },
};

const COMPANY_NAV_ROUTES: ReadonlyArray<NavRoute> = ["Companies", "Members", "CompanySettings"];

const ACCOUNT_NAV_ROUTES: ReadonlyArray<NavRoute> = [
  "Profile",
  "Security",
  "Sessions",
  "Connections",
];

const NAV_ROUTES: ReadonlyArray<NavRoute> = [...COMPANY_NAV_ROUTES, ...ACCOUNT_NAV_ROUTES];

const navLinkView = (item: Nav.ItemInfo<NavRoute>, h: HtmlBuilder<Message>): Html =>
  h.keyed("a")(
    item.value,
    [...item.link, h.Class(NAV_LINK_CLASS)],
    [iconView(NAV_ITEMS[item.value].icon, h), NAV_ITEMS[item.value].label],
  );

const navGroupView = (
  label: string,
  labelClass: string,
  items: ReadonlyArray<Nav.ItemInfo<NavRoute>>,
  h: HtmlBuilder<Message>,
): ReadonlyArray<Html> => [
  h.div([h.Class(labelClass)], [label]),
  ...items.map((item) => navLinkView(item, h)),
];

const sidebarNavView = (model: Model, h: HtmlBuilder<Message>): Html =>
  Nav.view<NavRoute>({
    items: NAV_ROUTES,
    ariaLabel: "アカウントのメニュー",
    toHref: (route) => NAV_ITEMS[route].href,
    isItemCurrent: (route) => AccountRoute.isAnyOf([route])(model.route),
    toView: ({ nav, items }) => {
      const [companyItems, accountItems] = Array.splitAt(items, COMPANY_NAV_ROUTES.length);
      return h.nav(
        [...nav, h.Class("flex flex-col gap-1")],
        [
          ...navGroupView("事業所", NAV_GROUP_LABEL_CLASS, companyItems, h),
          ...navGroupView("アカウント", `${NAV_GROUP_LABEL_CLASS} mt-3`, accountItems, h),
        ],
      );
    },
  });

const pageView = (
  model: Model,
  currentCompany: CurrentCompany.Model,
  h: HtmlBuilder<Message>,
): ReadonlyArray<Html> =>
  Option.match(model.maybePage, {
    onNone: () => [],
    onSome: (page) => [
      AccountPage.match(page, {
        Profile: ({ model: pageModel }) =>
          h.submodel({
            slotId: "profile",
            view: Profile.view,
            model: pageModel,
            viewInputs: { currentCompany },
            toParentMessage: toProfileMessage,
          }),
        Companies: ({ model: pageModel }) =>
          h.submodel({
            slotId: "companies",
            view: Companies.view,
            model: pageModel,
            viewInputs: { currentCompany },
            toParentMessage: toCompaniesMessage,
          }),
        CompanySettings: ({ model: pageModel }) =>
          h.submodel({
            slotId: "company-settings",
            view: CompanySettings.view,
            model: pageModel,
            viewInputs: { currentCompany },
            toParentMessage: toCompanySettingsMessage,
          }),
        Members: ({ model: pageModel }) =>
          h.submodel({
            slotId: "members",
            view: Members.view,
            model: pageModel,
            viewInputs: { currentCompany },
            toParentMessage: toMembersMessage,
          }),
        Security: ({ model: pageModel }) =>
          h.submodel({
            slotId: "security",
            view: Security.view,
            model: pageModel,
            toParentMessage: toSecurityMessage,
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

const frameView = (
  model: Model,
  currentCompany: CurrentCompany.Model,
  h: HtmlBuilder<Message>,
): Html =>
  h.div(
    [h.Class("flex min-h-svh bg-background")],
    [
      h.aside(
        [h.Class("flex w-60 flex-col gap-1 border-r p-4")],
        [
          h.submodel({
            slotId: "current-company",
            view: CurrentCompany.view,
            model: currentCompany,
            viewInputs: { isBlocked: isCompanySwitchBlocked(model) },
            toParentMessage: toCurrentCompanyMessage,
          }),
          sidebarNavView(model, h),
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
        [h.div([h.Class("mx-auto max-w-2xl")], pageView(model, currentCompany, h))],
      ),
      noticeToastView(model.toast, toToastMessage, h),
    ],
  );

export const view = (model: Model, h: HtmlBuilder<Message>): Document => ({
  title: documentTitleOf(
    AccountRoute.guards.NotFound(model.route) ? ERROR_PAGE_NAME : NAV_ITEMS[model.route._tag].label,
  ),
  body: Entry.match(model.entry, {
    Checking: () => fullScreenStatusView("読み込み中…", h),
    Ready: ({ currentCompany }) =>
      AccountRoute.guards.NotFound(model.route)
        ? AuthError.view(Option.none(), h)
        : frameView(model, currentCompany, h),
  }),
});
