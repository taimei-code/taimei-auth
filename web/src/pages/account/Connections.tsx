import { useEffect, useState } from "react";
import { Github } from "lucide-react";

import { authClient } from "@/lib/auth-client";
import { Separator } from "@/components/ui/separator";
import { LoadingRow } from "@/components/account/LoadingRow";

type AccountList = Awaited<ReturnType<typeof authClient.listAccounts>>["data"];
type AccountItem = NonNullable<AccountList>[number];

export const Connections = () => {
  const [accounts, setAccounts] = useState<AccountList | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    authClient
      .listAccounts()
      .then(({ data }) => setAccounts(data))
      .catch((error: unknown) => {
        setErrorMessage(
          error instanceof Error ? error.message : "連携アカウントの取得に失敗しました",
        );
      })
      .finally(() => setLoading(false));
  }, []);

  return (
    <div>
      <div>
        <h1 className="text-xl font-semibold tracking-tight">連携アカウント</h1>
        <p className="mt-1 text-sm text-muted-foreground">外部サービスとの連携状況</p>
      </div>
      <Separator className="my-6" />

      {loading ? (
        <LoadingRow />
      ) : errorMessage ? (
        <p role="alert" className="text-sm text-destructive">
          {errorMessage}
        </p>
      ) : accounts && accounts.length > 0 ? (
        <ul className="divide-y">
          {accounts.map((account: AccountItem) => (
            <li key={account.id} className="flex items-center gap-4 py-4">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-md bg-muted">
                {account.providerId === "github" ? (
                  <Github className="size-5" aria-hidden="true" />
                ) : (
                  <span className="text-base font-semibold uppercase" aria-hidden="true">
                    {account.providerId.charAt(0)}
                  </span>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-medium capitalize" translate="no">
                  {account.providerId}
                </p>
                <p className="truncate text-sm text-muted-foreground" translate="no">
                  {account.accountId}
                </p>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">連携アカウントはありません。</p>
      )}

      <p className="mt-6 text-xs text-muted-foreground">追加 / 解除は Phase 4 で実装予定。</p>
    </div>
  );
};
