import { useEffect, useState } from "react";
import { Loader2, Github } from "lucide-react";

import { authClient } from "@/lib/auth-client";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

// 連携アカウント (OAuth provider) 一覧の表示のみ。追加 / 解除は Phase 4 で実装予定。
type AccountList = Awaited<
  ReturnType<typeof authClient.listAccounts>
>["data"];

export const Connections = () => {
  const [accounts, setAccounts] = useState<AccountList | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      const { data } = await authClient.listAccounts();
      setAccounts(data);
      setLoading(false);
    })();
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">連携アカウント</h1>
        <p className="text-sm text-muted-foreground">
          外部サービスとの連携状況
        </p>
      </div>

      {loading ? (
        <div className="flex justify-center p-8">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      ) : accounts && accounts.length > 0 ? (
        <div className="space-y-3">
          {accounts.map((a) => (
            <Card key={a.id}>
              <CardHeader className="flex-row items-center gap-3 space-y-0">
                {a.providerId === "github" ? (
                  <Github className="size-6" />
                ) : (
                  <span className="size-6 text-2xl leading-none">
                    {a.providerId.charAt(0).toUpperCase()}
                  </span>
                )}
                <div>
                  <CardTitle className="text-base capitalize">
                    {a.providerId}
                  </CardTitle>
                  <CardDescription>{a.accountId}</CardDescription>
                </div>
              </CardHeader>
            </Card>
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          連携アカウントはありません。
        </p>
      )}

      <p className="text-xs text-muted-foreground">
        追加 / 解除は Phase 4 で実装予定。
      </p>
    </div>
  );
};
