import { Array, Effect, Schema } from "effect";
import { Command, Submodel, type Update } from "foldkit";
import type { Html, HtmlBuilder } from "foldkit/html";
import { defineMessageUnion } from "foldkit/message";
import { defineTaggedUnion } from "foldkit/schema";
import { Monitor } from "lucide";

import { alertTextView } from "../../shared/ui/alert-text-view";
import { iconView, listLoadingStatusView } from "../../shared/ui/icon-view";
import {
  accountPageHeaderView,
  listEmptyView,
  listFootnoteView,
} from "../account-page-header-view";
import { listSessions } from "../auth-client-read";
import { setListIfLoading } from "../set-list-if-loading";

const SessionRow = Schema.Struct({
  id: Schema.String,
  userAgent: Schema.String,
  ipAddress: Schema.String,
  expiresAtLabel: Schema.String,
});
type SessionRow = typeof SessionRow.Type;

const SessionList = defineTaggedUnion({
  Loading: {},
  Failed: {},
  Loaded: { sessions: Schema.Array(SessionRow) },
});

export const Model = Schema.Struct({
  visit: Schema.Int,
  list: SessionList,
});
export type Model = typeof Model.Type;

export const Message = defineMessageUnion({
  SucceededLoadSessions: { visit: Schema.Int, sessions: Schema.Array(SessionRow) },
  FailedLoadSessions: { visit: Schema.Int },
});
export type Message = typeof Message.Type;

const expiresAtFormatter = new Intl.DateTimeFormat("ja-JP", {
  dateStyle: "medium",
  timeStyle: "short",
});

export const LoadSessions = Command.define("LoadSessions", {
  args: { visit: Schema.Int },
  messages: [Message.SucceededLoadSessions, Message.FailedLoadSessions],
  execute: ({ visit }) =>
    listSessions.pipe(
      Effect.map((sessions) =>
        Message.SucceededLoadSessions({
          visit,
          sessions: sessions.map((session) => ({
            id: session.id,
            userAgent: session.userAgent ?? "",
            ipAddress: session.ipAddress ?? "",
            expiresAtLabel: expiresAtFormatter.format(new Date(session.expiresAt)),
          })),
        }),
      ),
      Effect.catchTag("AuthClientReadFailed", () =>
        Effect.succeed(Message.FailedLoadSessions({ visit })),
      ),
    ),
});

export const init = (visit: number): Update.Return<Model, Message> => ({
  model: { visit, list: SessionList.Loading() },
  commands: [LoadSessions({ visit })],
});

type UpdateReturn = Update.Return<Model, Message>;

export const update = (model: Model, message: Message) =>
  Message.match<UpdateReturn>(message, {
    SucceededLoadSessions: ({ visit, sessions }) =>
      setListIfLoading(model, visit, SessionList.Loaded({ sessions }), SessionList.guards.Loading),
    FailedLoadSessions: ({ visit }) =>
      setListIfLoading(model, visit, SessionList.Failed(), SessionList.guards.Loading),
  });

const sessionRowView = (session: SessionRow, h: HtmlBuilder<Message>): Html =>
  h.keyed("li")(
    session.id,
    [h.Class("flex items-start gap-4 py-4")],
    [
      h.div(
        [h.Class("flex size-10 shrink-0 items-center justify-center rounded-md bg-muted")],
        [h.span([h.Class("size-5 text-muted-foreground")], [iconView(Monitor, h)])],
      ),
      h.div(
        [h.Class("min-w-0 flex-1")],
        [
          h.p(
            [h.Class("truncate font-medium"), h.Translate("no")],
            [session.userAgent || "不明なデバイス"],
          ),
          h.p(
            [h.Class("mt-1 text-sm text-muted-foreground")],
            [
              "IP: ",
              h.span([h.Translate("no")], [session.ipAddress || "—"]),
              ` ・ 期限: ${session.expiresAtLabel}`,
            ],
          ),
        ],
      ),
    ],
  );

const listView = (list: typeof SessionList.Type, h: HtmlBuilder<Message>): Html =>
  SessionList.match(list, {
    Loading: () => listLoadingStatusView("読み込み中…", h),
    Failed: () => alertTextView("セッションの取得に失敗しました", h),
    Loaded: ({ sessions }) =>
      Array.match(sessions, {
        onEmpty: () => listEmptyView("アクティブなセッションはありません。", h),
        onNonEmpty: (rows) =>
          h.ul(
            [h.Role("list"), h.Class("divide-y")],
            rows.map((session) => sessionRowView(session, h)),
          ),
      }),
  });

export const view = Submodel.defineView<Model, Message>((model, h) =>
  h.div(
    [],
    [
      ...accountPageHeaderView("セッション", "アクティブなログインセッション一覧", h),
      listView(model.list, h),
      listFootnoteView(
        "セッションの個別ログアウト / 全デバイスからの一括ログアウトは実装予定です。",
        h,
      ),
    ],
  ),
);
