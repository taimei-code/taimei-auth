import { Array, Effect, Schema } from "effect";
import { Command, Submodel, type Update } from "foldkit";
import type { Html, HtmlBuilder } from "foldkit/html";
import { defineMessageUnion } from "foldkit/message";
import { defineTaggedUnion } from "foldkit/schema";
import { Github } from "lucide";

import { providerLabel } from "../../auth/provider-label";
import { alertTextView } from "../../shared/ui/alert-text-view";
import { iconView, listLoadingStatusView } from "../../shared/ui/icon-view";
import {
  accountPageHeaderView,
  listEmptyView,
  listFootnoteView,
} from "../account-page-header-view";
import { listLinkedAccounts } from "../auth-client-read";
import { setListIfLoading } from "../set-list-if-loading";

const LinkedAccountRow = Schema.Struct({
  id: Schema.String,
  providerId: Schema.String,
  accountId: Schema.String,
});
type LinkedAccountRow = typeof LinkedAccountRow.Type;

const LinkedAccountList = defineTaggedUnion({
  Loading: {},
  Failed: {},
  Loaded: { accounts: Schema.Array(LinkedAccountRow) },
});

export const Model = Schema.Struct({
  visit: Schema.Int,
  list: LinkedAccountList,
});
export type Model = typeof Model.Type;

export const Message = defineMessageUnion({
  SucceededLoadLinkedAccounts: { visit: Schema.Int, accounts: Schema.Array(LinkedAccountRow) },
  FailedLoadLinkedAccounts: { visit: Schema.Int },
});
export type Message = typeof Message.Type;

export const LoadLinkedAccounts = Command.define("LoadLinkedAccounts", {
  args: { visit: Schema.Int },
  messages: [Message.SucceededLoadLinkedAccounts, Message.FailedLoadLinkedAccounts],
  execute: ({ visit }) =>
    listLinkedAccounts.pipe(
      Effect.map((accounts) =>
        Message.SucceededLoadLinkedAccounts({
          visit,
          accounts: accounts.map(({ id, providerId, accountId }) => ({
            id,
            providerId,
            accountId,
          })),
        }),
      ),
      Effect.catchTag("AuthClientReadFailed", () =>
        Effect.succeed(Message.FailedLoadLinkedAccounts({ visit })),
      ),
    ),
});

export const init = (visit: number): Update.Return<Model, Message> => ({
  model: { visit, list: LinkedAccountList.Loading() },
  commands: [LoadLinkedAccounts({ visit })],
});

type UpdateReturn = Update.Return<Model, Message>;

export const update = (model: Model, message: Message) =>
  Message.match<UpdateReturn>(message, {
    SucceededLoadLinkedAccounts: ({ visit, accounts }) =>
      setListIfLoading(model, visit, LinkedAccountList.Loaded({ accounts })),
    FailedLoadLinkedAccounts: ({ visit }) =>
      setListIfLoading(model, visit, LinkedAccountList.Failed()),
  });

const providerIconView = (providerId: string, h: HtmlBuilder<Message>): Html =>
  providerId === "github"
    ? h.span([h.Class("size-5")], [iconView(Github, h)])
    : h.span(
        [h.Class("text-base font-semibold uppercase"), h.AriaHidden(true)],
        [providerId.charAt(0)],
      );

const accountRowView = (account: LinkedAccountRow, h: HtmlBuilder<Message>): Html =>
  h.keyed("li")(
    account.id,
    [h.Class("flex items-center gap-4 py-4")],
    [
      h.div(
        [h.Class("flex size-10 shrink-0 items-center justify-center rounded-md bg-muted")],
        [providerIconView(account.providerId, h)],
      ),
      h.div(
        [h.Class("min-w-0 flex-1")],
        [
          h.p(
            [h.Class("font-medium capitalize"), h.Translate("no")],
            [providerLabel(account.providerId)],
          ),
          h.p(
            [h.Class("truncate text-sm text-muted-foreground"), h.Translate("no")],
            [account.accountId],
          ),
        ],
      ),
    ],
  );

const listView = (list: typeof LinkedAccountList.Type, h: HtmlBuilder<Message>): Html =>
  LinkedAccountList.match(list, {
    Loading: () => listLoadingStatusView("読み込み中…", h),
    Failed: () => alertTextView("連携アカウントの取得に失敗しました", h),
    Loaded: ({ accounts }) =>
      Array.match(accounts, {
        onEmpty: () => listEmptyView("連携アカウントはありません。", h),
        onNonEmpty: (rows) =>
          h.ul(
            [h.Class("divide-y")],
            rows.map((account) => accountRowView(account, h)),
          ),
      }),
  });

export const view = Submodel.defineView<Model, Message>((model, h) =>
  h.div(
    [],
    [
      ...accountPageHeaderView("連携アカウント", "外部サービスとの連携状況", h),
      listView(model.list, h),
      listFootnoteView("連携の追加 / 解除は実装予定です。", h),
    ],
  ),
);
