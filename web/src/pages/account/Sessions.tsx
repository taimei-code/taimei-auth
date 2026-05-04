import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

import { authClient } from "@/lib/auth-client";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

// アクティブセッション一覧の表示のみ。個別 revoke / 全デバイスログアウトは Phase 4 で実装予定。
type SessionList = Awaited<
  ReturnType<typeof authClient.listSessions>
>["data"];

export const Sessions = () => {
  const [sessions, setSessions] = useState<SessionList | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      const { data } = await authClient.listSessions();
      setSessions(data);
      setLoading(false);
    })();
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">セッション</h1>
        <p className="text-sm text-muted-foreground">
          アクティブなログインセッション一覧
        </p>
      </div>

      {loading ? (
        <div className="flex justify-center p-8">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="space-y-3">
          {sessions?.map((s) => (
            <Card key={s.id}>
              <CardHeader>
                <CardTitle className="text-base">
                  {s.userAgent ?? "Unknown device"}
                </CardTitle>
                <CardDescription>
                  IP: {s.ipAddress ?? "—"} / 期限:{" "}
                  {new Date(s.expiresAt).toLocaleString("ja-JP")}
                </CardDescription>
              </CardHeader>
            </Card>
          ))}
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        個別 revoke / 全デバイスログアウトは Phase 4 で実装予定。
      </p>
    </div>
  );
};
