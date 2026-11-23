import { Effect, Match, Option, Schema } from "effect";
import { Command, type Update } from "foldkit";
import type { Document, Html, HtmlBuilder } from "foldkit/html";
import { defineMessageUnion } from "foldkit/message";

import { focusField } from "../src/shared/required-field";
import { Submission } from "../src/shared/submission";
import { alertTextView } from "../src/shared/ui/alert-text-view";
import { buttonView } from "../src/shared/ui/button-view";
import { alertVariants, badgeVariants, cardClassNames } from "../src/shared/ui/class-names";
import {
  codeListTextareaView,
  hiddenInputView,
  searchInputView,
} from "../src/shared/ui/input-view";
import { cn } from "../src/shared/utils";
import { FILTER_SHOWN_ABOVE_ITEM_COUNT, itemsMatching, withQuery } from "./list-filter";
import { nonProductionBannerView } from "./non-production-banner-view";
import { FeatureFlagsProps, type FlagNotice, type FlagStatus, PAGE_TITLES } from "./page-props";

type FlagOnPage = FeatureFlagsProps["flags"][number];

export const Flags = Schema.Option(FeatureFlagsProps);
export type Flags = typeof Flags.Type;

export const Model = Schema.Struct({
  maybeProps: Flags,
  query: Schema.String,
  companyIdDrafts: Schema.Record(Schema.String, Schema.String),
});
export type Model = typeof Model.Type;

export const Message = defineMessageUnion({
  UpdatedQuery: { query: Schema.String },
  UpdatedCompanyIds: { flag: Schema.String, text: Schema.String },
  CompletedFocusNotice: {},
});
export type Message = typeof Message.Type;

const NOTICE_ID = "flag-notice";
const FLAG_TABLE_ID = "flag-table";

const FocusFlagNotice = Command.define("FocusFlagNotice", {
  messages: [Message.CompletedFocusNotice],
  execute: focusField(NOTICE_ID).pipe(Effect.as(Message.CompletedFocusNotice())),
});

export const init = (maybeProps: Flags): Update.Return<Model, Message> => ({
  model: { maybeProps, query: "", companyIdDrafts: {} },
  ...(Option.exists(maybeProps, ({ notice }) => notice !== null)
    ? { commands: [FocusFlagNotice()] }
    : {}),
});

export const update = (model: Model, message: Message) =>
  Message.match<Update.Return<Model, Message>>(message, {
    UpdatedQuery: ({ query }) => ({ model: withQuery(model, query) }),
    UpdatedCompanyIds: ({ flag, text }) => ({
      model: { ...model, companyIdDrafts: { ...model.companyIdDrafts, [flag]: text } },
    }),
    CompletedFocusNotice: () => ({ model }),
  });

const STATE_LABELS: Record<FlagStatus, string> = {
  On: "全体 on",
  Off: "全体 off",
  OnlyFor: "事業所だけ on",
};

const SWITCHED_LABELS: Record<"on" | "off" | "onlyFor", string> = {
  on: STATE_LABELS.On,
  off: STATE_LABELS.Off,
  onlyFor: STATE_LABELS.OnlyFor,
};

const STATUS_BADGE_CLASS: Record<FlagStatus, string> = {
  On: badgeVariants({ variant: "default" }),
  OnlyFor: cn(badgeVariants({ variant: "outline" }), "border-dashed border-foreground"),
  Off: badgeVariants({ variant: "secondary" }),
};

const noticeTextOf = (notice: FlagNotice): string =>
  Match.valueTags(notice, {
    Switched: ({ flag, state }) => `${flag} を${SWITCHED_LABELS[state]} に切り替えました`,
    NoCompanyIds: () => "事業所 ID を 1 つ以上書いてください。",
    UnknownCompanyIds: ({ ids }) =>
      `見つからない事業所 ID があるので切り替えませんでした: ${ids.join(", ")}`,
  });

const hiddenFieldsOf = (
  flag: FlagOnPage,
  state: "on" | "off" | "onlyFor",
  h: HtmlBuilder<Message>,
): ReadonlyArray<Html> => [
  hiddenInputView({ id: `flag-${flag.name}-${state}-flag`, name: "flag", value: flag.name }, h),
  hiddenInputView({ id: `flag-${flag.name}-${state}-state`, name: "state", value: state }, h),
];

const statusView = (flag: FlagOnPage, h: HtmlBuilder<Message>): Html =>
  h.div(
    [h.Class("space-y-1")],
    [
      h.span(
        [h.Class(cn(STATUS_BADGE_CLASS[flag.status], "whitespace-nowrap"))],
        [STATE_LABELS[flag.status]],
      ),
      ...(flag.status === "OnlyFor"
        ? [
            h.ul(
              [h.Class("space-y-1.5 text-xs text-muted-foreground")],
              flag.companies.map((company) =>
                h.keyed("li")(
                  company.id,
                  [],
                  [
                    h.span(
                      [h.Class("block text-foreground")],
                      [company.name ?? "名前の無い事業所"],
                    ),
                    h.span([h.Class("block font-mono")], [company.id]),
                  ],
                ),
              ),
            ),
          ]
        : []),
    ],
  );

const switchForm = (
  props: FeatureFlagsProps,
  flag: FlagOnPage,
  state: "on" | "off",
  h: HtmlBuilder<Message>,
): Html =>
  h.form(
    [h.Method("post"), h.Action(props.switchAction)],
    [
      ...hiddenFieldsOf(flag, state, h),
      buttonView(
        {
          label: `${SWITCHED_LABELS[state]} にする`,
          accessibleNamePrefix: `${flag.name} を `,
          type: "submit",
          look: "outlineSmall",
          submission: Submission.Idle(),
          isBlocked: false,
        },
        h,
      ),
    ],
  );

type CompanyIdDrafts = Model["companyIdDrafts"];

const onlyForDisclosure = (
  props: FeatureFlagsProps,
  drafts: CompanyIdDrafts,
  flag: FlagOnPage,
  h: HtmlBuilder<Message>,
): Html =>
  h.details(
    [h.Class("group w-full")],
    [
      h.summary(
        [
          h.Class(
            "inline-flex min-h-9 cursor-pointer list-none items-center gap-1.5 rounded-md border px-3 text-sm font-medium hover:bg-accent [&::-webkit-details-marker]:hidden",
          ),
        ],
        [
          h.span([h.AriaHidden(true), h.Class("transition-transform group-open:rotate-90")], ["▸"]),
          h.span([h.Class("sr-only")], [`${flag.name} を `]),
          flag.status === "OnlyFor" ? "on にする事業所を変える" : "事業所だけ on にする",
        ],
      ),
      h.form(
        [h.Method("post"), h.Action(props.switchAction), h.Class("mt-2 max-w-md space-y-2")],
        [
          ...hiddenFieldsOf(flag, "onlyFor", h),
          codeListTextareaView(
            {
              id: `flag-${flag.name}-company-ids`,
              name: "companyIds",
              label: "on にする事業所 ID",
              hint: "1 行に 1 つ書きます。",
              value: drafts[flag.name] ?? flag.companies.map(({ id }) => id).join("\n"),
              onInput: (text) => Message.UpdatedCompanyIds({ flag: flag.name, text }),
            },
            h,
          ),
          buttonView(
            {
              label: "この事業所だけ on にする",
              accessibleNamePrefix: `${flag.name} を `,
              type: "submit",
              look: "primarySmall",
              submission: Submission.Idle(),
              isBlocked: false,
            },
            h,
          ),
        ],
      ),
    ],
  );

const actionsView = (
  props: FeatureFlagsProps,
  drafts: CompanyIdDrafts,
  flag: FlagOnPage,
  h: HtmlBuilder<Message>,
): Html =>
  h.div(
    [h.Class("flex flex-wrap items-start gap-2")],
    [
      ...(flag.status === "On" ? [] : [switchForm(props, flag, "on", h)]),
      ...(flag.status === "Off" ? [] : [switchForm(props, flag, "off", h)]),
      ...(flag.audience === "companies" ? [onlyForDisclosure(props, drafts, flag, h)] : []),
    ],
  );

const flagRowView = (
  props: FeatureFlagsProps,
  drafts: CompanyIdDrafts,
  flag: FlagOnPage,
  h: HtmlBuilder<Message>,
): Html =>
  h.keyed("tr")(
    flag.name,
    [h.Role("row"), h.Class("block border-b py-3 md:table-row md:py-0")],
    [
      h.th(
        [
          h.Role("rowheader"),
          h.Scope("row"),
          h.Class(
            "block break-all pb-2 text-left align-top md:table-cell md:whitespace-nowrap md:break-normal md:py-3 md:pr-4",
          ),
        ],
        [h.span([h.Class("font-mono font-medium")], [flag.name])],
      ),
      h.td(
        [h.Role("cell"), h.Class("block pb-2 align-top md:table-cell md:py-3 md:pr-4")],
        [statusView(flag, h)],
      ),
      h.td(
        [h.Role("cell"), h.Class("block align-top md:table-cell md:py-3")],
        [actionsView(props, drafts, flag, h)],
      ),
    ],
  );

const filterStatusText = (
  props: FeatureFlagsProps,
  shown: ReadonlyArray<FlagOnPage>,
  query: string,
): ReadonlyArray<string> => {
  if (query.trim() === "") {
    return [];
  }
  return shown.length === 0
    ? [`「${query}」に一致するフラグはありません。`]
    : [`${props.flags.length} 件のうち ${shown.length} 件を表示しています。`];
};

const flagsCardView = (props: FeatureFlagsProps, model: Model, h: HtmlBuilder<Message>): Html => {
  const { query } = model;
  const shown = itemsMatching(props.flags, query, ({ name }) => name);
  return h.div(
    [h.Class(`${cardClassNames.root} w-full`)],
    [
      h.div(
        [h.Class(cardClassNames.header)],
        [h.h1([h.Class(cardClassNames.title)], [PAGE_TITLES.FeatureFlags])],
      ),
      h.div(
        [h.Class(`${cardClassNames.content} space-y-4`)],
        [
          h.p(
            [h.Class("text-sm text-muted-foreground")],
            ["この worker の memory にあります。立ち上げ直すと、すべて全体 on に戻ります。"],
          ),
          ...(props.notice === null
            ? []
            : [
                h.div(
                  [
                    h.Id(NOTICE_ID),
                    h.Tabindex(-1),
                    h.Role("status"),
                    h.Class(cn(alertVariants(), "bg-muted font-medium")),
                  ],
                  [noticeTextOf(props.notice)],
                ),
              ]),
          ...(props.flags.length > FILTER_SHOWN_ABOVE_ITEM_COUNT
            ? [
                searchInputView(
                  {
                    id: "flag-filter",
                    label: "フラグを絞り込む",
                    placeholder: "フラグの名前で絞り込む",
                    value: query,
                    onInput: (nextQuery) => Message.UpdatedQuery({ query: nextQuery }),
                    controls: FLAG_TABLE_ID,
                  },
                  h,
                ),
                h.p(
                  [h.Role("status"), h.Class("text-sm text-muted-foreground")],
                  filterStatusText(props, shown, query),
                ),
              ]
            : []),
          h.div(
            [h.Id(FLAG_TABLE_ID), h.Hidden(shown.length === 0)],
            [
              h.table(
                [h.Role("table"), h.Class("block w-full text-sm md:table")],
                [
                  h.caption([h.Class("sr-only")], ["フィーチャーフラグのステータスと切り替え"]),
                  h.thead(
                    [h.Class("hidden md:table-header-group")],
                    [
                      h.tr(
                        [h.Class("border-b text-left text-muted-foreground")],
                        ["フラグ", "ステータス", "切り替える"].map((label) =>
                          h.th([h.Scope("col"), h.Class("py-2 pr-4 font-medium")], [label]),
                        ),
                      ),
                    ],
                  ),
                  h.tbody(
                    [h.Role("rowgroup"), h.Class("block md:table-row-group")],
                    shown.map((flag) => flagRowView(props, model.companyIdDrafts, flag, h)),
                  ),
                ],
              ),
            ],
          ),
        ],
      ),
    ],
  );
};

export const view = (model: Model, h: HtmlBuilder<Message>): Document => ({
  title: PAGE_TITLES.FeatureFlags,
  body: h.div(
    [],
    [
      nonProductionBannerView(h),
      h.main(
        [h.Class("flex flex-col items-center p-6 md:p-10")],
        [
          Option.match(model.maybeProps, {
            onNone: () =>
              alertTextView(
                "フィーチャーフラグの情報を読めませんでした。ページを再読み込みしてください。",
                h,
              ),
            onSome: (props) =>
              h.div(
                [h.Class("w-full max-w-3xl space-y-4")],
                [
                  h.a(
                    [
                      h.Href(props.homeHref),
                      h.Class(
                        "inline-block py-1 text-sm text-muted-foreground underline underline-offset-4",
                      ),
                    ],
                    ["開発者ホームに戻る"],
                  ),
                  flagsCardView(props, model, h),
                ],
              ),
          }),
        ],
      ),
    ],
  ),
});
