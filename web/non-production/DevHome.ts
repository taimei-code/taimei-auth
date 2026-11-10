import { Array, Effect, Option, Schema } from "effect";
import type { Update } from "foldkit";
import type { Document, Html, HtmlBuilder } from "foldkit/html";
import { defineMessageUnion } from "foldkit/message";
import { modifyFields } from "foldkit/struct";

import { ACCOUNT_HOME_PATH } from "../src/shared/landing-paths";
import { Submission } from "../src/shared/submission";
import { alertTextView } from "../src/shared/ui/alert-text-view";
import { buttonLinkView, buttonView } from "../src/shared/ui/button-view";
import { alertVariants, badgeVariants, cardClassNames } from "../src/shared/ui/class-names";
import { searchInputView } from "../src/shared/ui/input-view";
import { cn } from "../src/shared/utils";
import { accountsMatching, FILTER_SHOWN_ABOVE_ACCOUNT_COUNT } from "./accounts-matching";
import {
  type Destination,
  DevHomeProps,
  PAGE_PROPS_ELEMENT_ID,
  PAGE_TITLES,
  type PageAccount,
  PagePropsFromJson,
  type Viewer,
} from "./page-props";

export const Flags = Schema.Option(DevHomeProps);
export type Flags = typeof Flags.Type;

export const flags: Effect.Effect<Flags> = Effect.sync(
  () => document.getElementById(PAGE_PROPS_ELEMENT_ID)?.textContent,
).pipe(
  Effect.flatMap((text) => Schema.decodeUnknownEffect(PagePropsFromJson)(text)),
  Effect.option,
);

export const Model = Schema.Struct({
  maybeProps: Flags,
  query: Schema.String,
});
export type Model = typeof Model.Type;

export const Message = defineMessageUnion({
  UpdatedQuery: { query: Schema.String },
});
export type Message = typeof Message.Type;

export const init = (maybeProps: Flags): Update.Return<Model, Message> => ({
  model: { maybeProps, query: "" },
});

export const update = (model: Model, message: Message) =>
  Message.match<Update.Return<Model, Message>>(message, {
    UpdatedQuery: ({ query }) => ({ model: modifyFields(model, { query: () => query }) }),
  });

const ACCOUNTS_FORM_ID = "accounts";

const BROWSER_ACCOUNT_GROUP_LABEL = "この browser でログインした利用者";

const noticeTextOf = (viewer: Viewer): Option.Option<string> => {
  if (viewer._tag === "SignedIn") {
    return viewer.notice === "JustSignedIn"
      ? Option.some(`${viewer.account.name} でログインしました`)
      : Option.none();
  } else {
    return viewer.notice === "JustSignedOut" ? Option.some("ログアウトしました") : Option.none();
  }
};

const signedInIdOf = (viewer: Viewer): Option.Option<string> =>
  viewer._tag === "SignedIn" ? Option.some(viewer.account.id) : Option.none();

const signedOutView = (h: HtmlBuilder<Message>): Html =>
  h.div(
    [h.Class("space-y-1")],
    [
      h.p([h.Class("font-medium")], ["ログインしていません"]),
      h.p(
        [h.Class("text-sm text-muted-foreground")],
        ["下の一覧から利用者を選ぶと、その利用者でログインします。"],
      ),
    ],
  );

const companyRowView = (company: PageAccount["companies"][number], h: HtmlBuilder<Message>): Html =>
  h.keyed("div")(
    company.id,
    [h.Class("flex items-center justify-between gap-3 px-3 py-2")],
    [
      h.dt(
        [h.Class("flex flex-wrap items-center gap-2")],
        [
          company.name,
          ...(company.isCurrent
            ? [h.div([h.Class(badgeVariants({ variant: "secondary" }))], ["現在の事業所"])]
            : []),
        ],
      ),
      h.dd([], [h.div([h.Class(badgeVariants({ variant: "outline" }))], [company.role])]),
    ],
  );

const signedInView = (account: PageAccount, signOutAction: string, h: HtmlBuilder<Message>): Html =>
  h.div(
    [h.Class("space-y-3")],
    [
      h.div(
        [h.Class("flex items-start justify-between gap-3")],
        [
          h.div(
            [h.Class("min-w-0 space-y-1")],
            [
              h.p([h.Class("font-medium")], [account.name]),
              h.p([h.Class("break-all text-sm text-muted-foreground")], [account.email]),
            ],
          ),
          h.form(
            [h.Method("post"), h.Action(signOutAction)],
            [
              buttonView(
                {
                  label: "ログアウト",
                  type: "submit",
                  look: "outlineSmall",
                  submission: Submission.Idle(),
                  isBlocked: false,
                },
                h,
              ),
            ],
          ),
        ],
      ),
      h.dl(
        [h.Class("divide-y rounded-md border text-sm"), h.AriaLabel("所属する事業所と role")],
        account.companies.map((company) => companyRowView(company, h)),
      ),
    ],
  );

const destinationView = (destination: Destination, h: HtmlBuilder<Message>): Html =>
  destination._tag === "Application"
    ? h.div(
        [h.Class("space-y-3")],
        [
          h.dl(
            [h.Class("text-sm")],
            [
              h.dt([h.Class("text-muted-foreground")], ["戻り先"]),
              h.dd([h.Class("break-all")], [destination.redirectUrl]),
            ],
          ),
          buttonLinkView({ label: "アプリケーションに戻る", href: destination.redirectUrl }, h),
        ],
      )
    : h.div(
        [h.Class("space-y-3")],
        [
          h.p(
            [h.Class("text-sm text-muted-foreground")],
            [
              "戻り先のアプリケーションが指定されていないので、taimei-auth のアカウント管理画面を開きます。",
            ],
          ),
          buttonLinkView({ label: "アカウント管理画面を開く", href: ACCOUNT_HOME_PATH }, h),
        ],
      );

const listMessageView = (text: string, h: HtmlBuilder<Message>): Html =>
  h.p([h.Class("px-4 py-2 text-sm text-muted-foreground")], [text]);

const accountGroupView = (
  label: string,
  children: ReadonlyArray<Html>,
  h: HtmlBuilder<Message>,
): Html =>
  h.fieldset(
    [h.Class("space-y-1")],
    [h.legend([h.Class("px-4 text-xs font-medium text-muted-foreground")], [label]), ...children],
  );

const accountRowsView = (
  accounts: ReadonlyArray<PageAccount>,
  maybeSignedInId: Option.Option<string>,
  h: HtmlBuilder<Message>,
): Html =>
  h.ul(
    [],
    accounts.map((account) => {
      const isSignedIn = Option.contains(maybeSignedInId, account.id);
      return h.keyed("li")(
        account.id,
        [],
        [
          buttonView(
            {
              label: account.email,
              type: "submit",
              look: "listRow",
              submission: Submission.Idle(),
              isBlocked: isSignedIn,
              submitValue: { name: "userId", value: account.id },
              ...(isSignedIn ? { note: "ログイン中" } : {}),
            },
            h,
          ),
        ],
      );
    }),
  );

const matchingGroupView = (
  label: string,
  accounts: ReadonlyArray<PageAccount>,
  maybeSignedInId: Option.Option<string>,
  h: HtmlBuilder<Message>,
): ReadonlyArray<Html> =>
  Array.isReadonlyArrayNonEmpty(accounts)
    ? [accountGroupView(label, [accountRowsView(accounts, maybeSignedInId, h)], h)]
    : [];

const browserGroupView = (
  props: DevHomeProps,
  shownAccounts: ReadonlyArray<PageAccount>,
  maybeSignedInId: Option.Option<string>,
  h: HtmlBuilder<Message>,
): ReadonlyArray<Html> =>
  Array.isReadonlyArrayNonEmpty(props.browserAccounts)
    ? matchingGroupView(BROWSER_ACCOUNT_GROUP_LABEL, shownAccounts, maybeSignedInId, h)
    : [
        accountGroupView(
          BROWSER_ACCOUNT_GROUP_LABEL,
          [
            listMessageView(
              "ログインした状態でこの browser の開発者ホームを開くと、その利用者がここに出ます。",
              h,
            ),
          ],
          h,
        ),
      ];

const accountListView = (props: DevHomeProps, query: string, h: HtmlBuilder<Message>): Html => {
  const maybeSignedInId = signedInIdOf(props.viewer);
  const shownDevAccounts = accountsMatching(props.devAccounts, query);
  const shownBrowserAccounts = accountsMatching(props.browserAccounts, query);
  const isFilterShown =
    props.devAccounts.length + props.browserAccounts.length > FILTER_SHOWN_ABOVE_ACCOUNT_COUNT;
  const isNothingShown = shownDevAccounts.length + shownBrowserAccounts.length === 0;

  return h.section(
    [h.Class("space-y-3 border-t pt-6"), h.AriaLabelledBy("accounts-heading")],
    [
      h.h2(
        [h.Id("accounts-heading"), h.Class("text-sm font-medium text-muted-foreground")],
        ["ログインする利用者を選ぶ"],
      ),
      ...(isFilterShown
        ? [
            searchInputView(
              {
                id: "account-filter",
                label: "利用者を絞り込む",
                placeholder: "名前かメールで絞り込む",
                value: query,
                onInput: (nextQuery) => Message.UpdatedQuery({ query: nextQuery }),
                controls: ACCOUNTS_FORM_ID,
              },
              h,
            ),
          ]
        : []),
      h.form(
        [
          h.Id(ACCOUNTS_FORM_ID),
          h.Method("post"),
          h.Action(props.signInAction),
          h.Class("-mx-4 space-y-3"),
        ],
        [
          ...matchingGroupView("開発用アカウント", shownDevAccounts, maybeSignedInId, h),
          ...browserGroupView(props, shownBrowserAccounts, maybeSignedInId, h),
          ...(isNothingShown
            ? [listMessageView(`「${query}」に一致する利用者はいません。`, h)]
            : []),
        ],
      ),
    ],
  );
};

const devHomeCardView = (props: DevHomeProps, query: string, h: HtmlBuilder<Message>): Html =>
  h.div(
    [h.Class(`${cardClassNames.root} w-full max-w-sm`)],
    [
      h.div(
        [h.Class(cardClassNames.header)],
        [
          h.div([h.Class(cardClassNames.title)], [h.h1([], [PAGE_TITLES.DevHome])]),
          h.div(
            [h.Class(cardClassNames.description)],
            ["ログインする利用者を切り替えて、アプリケーションに戻って確かめます。"],
          ),
        ],
      ),
      h.div(
        [h.Class(`${cardClassNames.content} space-y-6`)],
        [
          h.div(
            [h.Class("space-y-4")],
            [
              h.section(
                [h.Class("space-y-3"), h.AriaLabelledBy("signed-in")],
                [
                  h.h2(
                    [h.Id("signed-in"), h.Class("text-sm font-medium text-muted-foreground")],
                    ["ログイン中の利用者"],
                  ),
                  props.viewer._tag === "SignedIn"
                    ? signedInView(props.viewer.account, props.signOutAction, h)
                    : signedOutView(h),
                ],
              ),
              ...Option.match(noticeTextOf(props.viewer), {
                onNone: () => [],
                onSome: (notice) => [
                  h.div(
                    [h.Role("status"), h.Class(cn(alertVariants(), "bg-muted font-medium"))],
                    [notice],
                  ),
                ],
              }),
              destinationView(props.destination, h),
            ],
          ),
          accountListView(props, query, h),
        ],
      ),
    ],
  );

const unreadablePropsView = (h: HtmlBuilder<Message>): Html =>
  alertTextView("開発者ホームの情報を読めませんでした。ページを再読み込みしてください。", h);

export const view = (model: Model, h: HtmlBuilder<Message>): Document => ({
  title: PAGE_TITLES.DevHome,
  body: h.div(
    [],
    [
      h.header(
        [h.Class("bg-primary px-6 py-2 text-sm text-primary-foreground")],
        [
          h.p(
            [],
            [
              h.strong([h.Class("font-semibold")], ["本番以外の環境"]),
              "の画面です。本番の auth ホストにはありません。",
            ],
          ),
        ],
      ),
      h.main(
        [h.Class("flex flex-col items-center gap-6 p-6 md:p-10")],
        [
          Option.match(model.maybeProps, {
            onNone: () => unreadablePropsView(h),
            onSome: (props) => devHomeCardView(props, model.query, h),
          }),
        ],
      ),
    ],
  ),
});
