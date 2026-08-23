import { Github } from "lucide-react";

import { authClient } from "../../auth/auth-client";
import { providerLabel } from "../../auth/provider-label";
import { AsyncSection } from "../../shared/AsyncSection";
import { useAsyncLoad } from "../../shared/use-async-load";
import { Separator } from "../../shared/ui/separator";

type AccountList = Awaited<ReturnType<typeof authClient.listAccounts>>["data"];
type AccountItem = NonNullable<AccountList>[number];

export const Connections = () => {
  const {
    data: accounts,
    loading,
    errorMessage,
  } = useAsyncLoad(
    () => authClient.listAccounts().then(({ data }) => data),
    "連携アカウントの取得に失敗しました",
  );

  return (
    <div>
      <div>
        <h1 className="text-xl font-semibold tracking-tight">連携アカウント</h1>
        <p className="mt-1 text-sm text-muted-foreground">外部サービスとの連携状況</p>
      </div>
      <Separator className="my-6" />

      <AsyncSection
        loading={loading}
        errorMessage={errorMessage}
        isEmpty={!accounts || accounts.length === 0}
        emptyText="連携アカウントはありません。"
      >
        <ul className="divide-y">
          {accounts?.map((account: AccountItem) => (
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
                  {providerLabel(account.providerId)}
                </p>
                <p className="truncate text-sm text-muted-foreground" translate="no">
                  {account.accountId}
                </p>
              </div>
            </li>
          ))}
        </ul>
      </AsyncSection>

      <p className="mt-6 text-xs text-muted-foreground">連携の追加 / 解除は実装予定です。</p>
    </div>
  );
};
