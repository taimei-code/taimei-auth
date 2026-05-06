import { useEffect, useState } from "react";
import { Monitor } from "lucide-react";

import { authClient } from "@/lib/auth-client";
import { Separator } from "@/components/ui/separator";
import { LoadingRow } from "@/components/account/LoadingRow";

type SessionList = Awaited<ReturnType<typeof authClient.listSessions>>["data"];
type SessionItem = NonNullable<SessionList>[number];

// 端末ごとに 1 回だけ作って再利用 (per-render の new Intl.DateTimeFormat 生成を回避)。
const dateFormatter = new Intl.DateTimeFormat("ja-JP", {
  dateStyle: "medium",
  timeStyle: "short",
});

export const Sessions = () => {
  const [sessions, setSessions] = useState<SessionList | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    authClient
      .listSessions()
      .then(({ data }) => setSessions(data))
      .catch((error: unknown) => {
        setErrorMessage(error instanceof Error ? error.message : "セッションの取得に失敗しました");
      })
      .finally(() => setLoading(false));
  }, []);

  return (
    <div>
      <div>
        <h1 className="text-xl font-semibold tracking-tight">セッション</h1>
        <p className="mt-1 text-sm text-muted-foreground">アクティブなログインセッション一覧</p>
      </div>
      <Separator className="my-6" />

      {loading ? (
        <LoadingRow />
      ) : errorMessage ? (
        <p role="alert" className="text-sm text-destructive">
          {errorMessage}
        </p>
      ) : sessions && sessions.length > 0 ? (
        <ul className="divide-y">
          {sessions.map((session: SessionItem) => (
            <li key={session.id} className="flex items-start gap-4 py-4">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-md bg-muted">
                <Monitor className="size-5 text-muted-foreground" aria-hidden="true" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium" translate="no">
                  {session.userAgent ?? "Unknown device"}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  IP: <span translate="no">{session.ipAddress ?? "—"}</span> ・ 期限:{" "}
                  {dateFormatter.format(new Date(session.expiresAt))}
                </p>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">アクティブなセッションはありません。</p>
      )}

      <p className="mt-6 text-xs text-muted-foreground">
        個別 revoke / 全デバイスログアウトは Phase 4 で実装予定。
      </p>
    </div>
  );
};
