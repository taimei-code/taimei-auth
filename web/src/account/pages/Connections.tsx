import { useAtomValue } from "@effect/atom-react";
import { Github } from "lucide-react";

import { providerLabel } from "../../auth/provider-label";
import { AsyncSection } from "../../shared/AsyncSection";
import { Separator } from "../../shared/ui/separator";
import { linkedAccountsAtom } from "../account-atom";

export const Connections = () => {
  const result = useAtomValue(linkedAccountsAtom);

  return (
    <div>
      <div>
        <h1 className="text-xl font-semibold tracking-tight">連携アカウント</h1>
        <p className="mt-1 text-sm text-muted-foreground">外部サービスとの連携状況</p>
      </div>
      <Separator className="my-6" />

      <AsyncSection
        result={result}
        failedText="連携アカウントの取得に失敗しました"
        empty={{
          when: (accounts) => accounts.length === 0,
          text: "連携アカウントはありません。",
        }}
      >
        {(accounts) => (
          <ul className="divide-y">
            {accounts.map((account) => (
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
        )}
      </AsyncSection>

      <p className="mt-6 text-xs text-muted-foreground">連携の追加 / 解除は実装予定です。</p>
    </div>
  );
};
