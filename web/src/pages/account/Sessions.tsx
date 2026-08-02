import { Monitor } from "lucide-react";

import { authClient } from "@/lib/auth-client";
import { useAsyncLoad } from "@/lib/use-async-load";
import { AsyncSection } from "@/components/account/AsyncSection";
import { Separator } from "@/components/ui/separator";

type SessionList = Awaited<ReturnType<typeof authClient.listSessions>>["data"];
type SessionItem = NonNullable<SessionList>[number];

// 端末ごとに 1 回だけ作って再利用 (per-render の new Intl.DateTimeFormat 生成を回避)。
const dateFormatter = new Intl.DateTimeFormat("ja-JP", {
  dateStyle: "medium",
  timeStyle: "short",
});

export const Sessions = () => {
  const {
    data: sessions,
    loading,
    errorMessage,
  } = useAsyncLoad(
    () => authClient.listSessions().then(({ data }) => data),
    "セッションの取得に失敗しました",
  );

  return (
    <div>
      <div>
        <h1 className="text-xl font-semibold tracking-tight">セッション</h1>
        <p className="mt-1 text-sm text-muted-foreground">アクティブなログインセッション一覧</p>
      </div>
      <Separator className="my-6" />

      <AsyncSection
        loading={loading}
        errorMessage={errorMessage}
        isEmpty={!sessions || sessions.length === 0}
        emptyText="アクティブなセッションはありません。"
      >
        <ul className="divide-y">
          {sessions?.map((session: SessionItem) => (
            <li key={session.id} className="flex items-start gap-4 py-4">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-md bg-muted">
                <Monitor className="size-5 text-muted-foreground" aria-hidden="true" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium" translate="no">
                  {session.userAgent ?? "Unknown device"}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  IP: <span translate="no">{session.ipAddress || "—"}</span> ・ 期限:{" "}
                  {dateFormatter.format(new Date(session.expiresAt))}
                </p>
              </div>
            </li>
          ))}
        </ul>
      </AsyncSection>

      <p className="mt-6 text-xs text-muted-foreground">
        セッションの個別ログアウト / 全デバイスからの一括ログアウトは実装予定です。
      </p>
    </div>
  );
};
