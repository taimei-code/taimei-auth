import { Effect, Schema } from "effect";
import { AsyncData, Command, Submodel, type Update } from "foldkit";
import type { Html, HtmlBuilder } from "foldkit/html";
import { defineMessageUnion } from "foldkit/message";
import { Monitor } from "lucide";

import { definePage } from "../../app/define-page";
import { iconView } from "../../shared/ui/icon-view";
import { authClient } from "../../auth/auth-client";
import { readAuthClient } from "../account-atom";

const SessionRow = Schema.Struct({
  id: Schema.String,
  userAgent: Schema.String,
  ipAddress: Schema.String,
  expiresAt: Schema.String,
});
type SessionRow = typeof SessionRow.Type;

export const Model = Schema.Struct({
  sessions: AsyncData.Schema(Schema.Array(SessionRow), Schema.String).schema,
});
export type Model = typeof Model.Type;

export const Message = defineMessageUnion({
  SucceededLoadSessions: { sessions: Schema.Array(SessionRow) },
  FailedLoadSessions: {},
});
export type Message = typeof Message.Type;

type UpdateReturn = Update.Return<Model, Message>;

const LOAD_FAILED_TEXT = "セッションの取得に失敗しました";

const expiresAtFormatter = new Intl.DateTimeFormat("ja-JP", {
  dateStyle: "medium",
  timeStyle: "short",
});

const LoadSessions = Command.define("LoadSessions", {
  messages: [Message.SucceededLoadSessions, Message.FailedLoadSessions],
  execute: readAuthClient(() => authClient.listSessions()).pipe(
    Effect.map((sessions) =>
      Message.SucceededLoadSessions({
        sessions: sessions.map((session) => ({
          id: session.id,
          userAgent: session.userAgent ?? "",
          ipAddress: session.ipAddress ?? "",
          expiresAt: new Date(session.expiresAt).toISOString(),
        })),
      }),
    ),
    Effect.catchTag("AuthClientReadFailed", () => Effect.succeed(Message.FailedLoadSessions())),
  ),
});

const init = (): UpdateReturn => ({
  model: { sessions: AsyncData.Loading() },
  commands: [LoadSessions()],
});

const update = (model: Model, message: Message): UpdateReturn =>
  Message.match<UpdateReturn>(message, {
    SucceededLoadSessions: ({ sessions }) => ({
      model: { sessions: AsyncData.Success({ data: sessions }) },
    }),
    FailedLoadSessions: () => ({
      model: { sessions: AsyncData.Failure({ error: LOAD_FAILED_TEXT }) },
    }),
  });

const sessionRowView = (h: HtmlBuilder<Message>, session: SessionRow): Html =>
  h.li(
    [h.Key(session.id), h.Class("flex items-start gap-4 py-4")],
    [
      h.div(
        [h.Class("flex size-10 shrink-0 items-center justify-center rounded-md bg-muted")],
        [h.span([h.Class("size-5 text-muted-foreground")], [iconView(h, Monitor)])],
      ),
      h.div(
        [h.Class("min-w-0 flex-1")],
        [
          h.p(
            [h.Class("truncate font-medium"), h.Translate("no")],
            [session.userAgent || "Unknown device"],
          ),
          h.p(
            [h.Class("mt-1 text-sm text-muted-foreground")],
            [
              "IP: ",
              h.span([h.Translate("no")], [session.ipAddress || "—"]),
              ` ・ 期限: ${expiresAtFormatter.format(new Date(session.expiresAt))}`,
            ],
          ),
        ],
      ),
    ],
  );

const statusText = (h: HtmlBuilder<Message>, text: string): Html =>
  h.p([h.Class("text-sm text-muted-foreground")], [text]);

const sessionsView = (h: HtmlBuilder<Message>, model: Model): Html =>
  AsyncData.match(model.sessions, {
    onIdle: () => statusText(h, "読み込み中…"),
    onLoading: () => statusText(h, "読み込み中…"),
    onRefreshing: (sessions) =>
      h.ul(
        [h.Class("divide-y")],
        sessions.map((s) => sessionRowView(h, s)),
      ),
    onFailure: (failure) => h.p([h.Class("text-sm text-destructive")], [failure]),
    onStale: ({ data }) =>
      h.ul(
        [h.Class("divide-y")],
        data.map((s) => sessionRowView(h, s)),
      ),
    onSuccess: (sessions) =>
      sessions.length === 0
        ? statusText(h, "アクティブなセッションはありません。")
        : h.ul(
            [h.Class("divide-y")],
            sessions.map((s) => sessionRowView(h, s)),
          ),
  });

const view = Submodel.defineView<Model, Message>((model, h) =>
  h.div(
    [],
    [
      h.div(
        [],
        [
          h.h1([h.Class("text-xl font-semibold tracking-tight")], ["セッション"]),
          h.p(
            [h.Class("mt-1 text-sm text-muted-foreground")],
            ["アクティブなログインセッション一覧"],
          ),
        ],
      ),
      h.hr([h.Class("my-6 shrink-0 bg-border h-[1px] w-full border-0")]),
      sessionsView(h, model),
      h.p(
        [h.Class("mt-6 text-xs text-muted-foreground")],
        ["セッションの個別ログアウト / 全デバイスからの一括ログアウトは実装予定です。"],
      ),
    ],
  ),
);

export const page = definePage({ Model, init, update, view });
