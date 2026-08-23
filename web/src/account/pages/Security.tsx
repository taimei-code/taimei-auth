import { useCallback, useEffect, useState } from "react";

import { MfaSettingsItem } from "../../mfa/MfaSettingsItem";
import { getMfaStatus, type MfaStatus } from "../../mfa/mfa-api";
import { AsyncSection } from "../../shared/AsyncSection";
import { Badge } from "../../shared/ui/badge";
import { Separator } from "../../shared/ui/separator";

const STATUS_UNAVAILABLE = "多要素認証 (MFA) の設定状態を取得できませんでした。";

export const Security = () => {
  const [status, setStatus] = useState<MfaStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // mfa-api の requestJson は 2xx 空 body を undefined に解決するため null へ正規化する
  // (正規化しないと下の isEmpty 判定を素通りし、MFA 行が文言なしで消える)。
  const refresh = useCallback(() => getMfaStatus().then((next) => setStatus(next ?? null)), []);

  useEffect(() => {
    refresh()
      .catch(() => setErrorMessage(STATUS_UNAVAILABLE))
      .finally(() => setLoading(false));
  }, [refresh]);

  return (
    <div>
      <div>
        <h1 className="text-xl font-semibold tracking-tight">セキュリティ</h1>
        <p className="mt-1 text-sm text-muted-foreground">認証方法とセキュリティ設定</p>
      </div>
      <Separator className="my-6" />

      <AsyncSection
        loading={loading}
        errorMessage={errorMessage}
        isEmpty={status === null}
        emptyText={STATUS_UNAVAILABLE}
      >
        <ul className="divide-y">
          {status && <MfaSettingsItem status={status} refresh={refresh} />}

          <li className="flex items-start justify-between gap-4 py-5">
            <div>
              <p className="font-medium">Passkey</p>
              <p className="mt-1 text-sm text-muted-foreground">
                指紋・顔認証・PIN でログインできます
              </p>
            </div>
            <Badge variant="secondary" className="shrink-0">
              実装予定
            </Badge>
          </li>
        </ul>
      </AsyncSection>
    </div>
  );
};
