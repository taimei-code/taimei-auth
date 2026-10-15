import { useAtomValue } from "@effect/atom-react";
import { Monitor } from "lucide-react";

import { AsyncSection } from "../../shared/AsyncSection";
import { Separator } from "../../shared/ui/separator";
import { sessionsAtom } from "../account-atom";

const expiresAtFormatter = new Intl.DateTimeFormat("ja-JP", {
  dateStyle: "medium",
  timeStyle: "short",
});

export const Sessions = () => {
  const result = useAtomValue(sessionsAtom);

  return (
    <div>
      <div>
        <h1 className="text-xl font-semibold tracking-tight">セッション</h1>
        <p className="mt-1 text-sm text-muted-foreground">アクティブなログインセッション一覧</p>
      </div>
      <Separator className="my-6" />

      <AsyncSection
        result={result}
        failedText="セッションの取得に失敗しました"
        empty={{
          when: (sessions) => sessions.length === 0,
          text: "アクティブなセッションはありません。",
        }}
      >
        {(sessions) => (
          <ul className="divide-y">
            {sessions.map((session) => (
              <li key={session.id} className="flex items-start gap-4 py-4">
                <div className="flex size-10 shrink-0 items-center justify-center rounded-md bg-muted">
                  <Monitor className="size-5 text-muted-foreground" aria-hidden="true" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium" translate="no">
                    {session.userAgent || "Unknown device"}
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    IP: <span translate="no">{session.ipAddress || "—"}</span> ・ 期限:{" "}
                    {expiresAtFormatter.format(new Date(session.expiresAt))}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </AsyncSection>

      <p className="mt-6 text-xs text-muted-foreground">
        セッションの個別ログアウト / 全デバイスからの一括ログアウトは実装予定です。
      </p>
    </div>
  );
};
