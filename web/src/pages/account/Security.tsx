import { useCallback, useEffect, useState } from "react";

import { getMfaStatus, type MfaStatus } from "@/lib/mfa-api";
import { AsyncSection } from "@/components/account/AsyncSection";
import { MfaDisableDialog } from "@/components/account/MfaDisableDialog";
import { MfaEnrollDialog } from "@/components/account/MfaEnrollDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";

// 再発行の導線を持たない (使い切った場合の復旧は運用スクリプト経由) ため、尽きる前に
// 気づける残数で警告を出す。
const LOW_RECOVERY_CODE_THRESHOLD = 3;

const STATUS_UNAVAILABLE = "多要素認証 (MFA) の設定状態を取得できませんでした。";

const describeRecoveryCodeShortage = (remaining: number): string =>
  remaining === 0
    ? "リカバリーコードを使い切りました。認証アプリを使えなくなるとログインできなくなります (再発行の導線はありません)。"
    : "リカバリーコードの残りが少なくなっています。使い切ると、認証アプリを失った時にログインできなくなります (再発行の導線はありません)。";

export const Security = () => {
  const [status, setStatus] = useState<MfaStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const refresh = useCallback(() => getMfaStatus().then(setStatus), []);

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
          <li className="flex items-start justify-between gap-4 py-5">
            <div>
              <p className="font-medium">多要素認証 (MFA)</p>
              <p className="mt-1 text-sm text-muted-foreground">
                認証アプリ (TOTP) を登録すると、ログイン時に確認コードの入力を求めます
              </p>
              {status?.enabled && (
                <>
                  <p className="mt-2 text-sm text-muted-foreground">
                    リカバリーコードの残り: {status.recovery_codes_remaining} 個
                  </p>
                  {status.recovery_codes_remaining <= LOW_RECOVERY_CODE_THRESHOLD && (
                    <p className="mt-1 text-sm text-destructive">
                      {describeRecoveryCodeShortage(status.recovery_codes_remaining)}
                    </p>
                  )}
                </>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-3">
              <Badge variant={status?.enabled ? "default" : "secondary"}>
                {status?.enabled ? "有効" : "無効"}
              </Badge>
              {status?.in_effect ? (
                <MfaDisableDialog
                  onDisabled={refresh}
                  trigger={
                    <Button variant="outline" size="sm">
                      無効にする
                    </Button>
                  }
                />
              ) : (
                <MfaEnrollDialog
                  onEnabled={refresh}
                  trigger={<Button size="sm">有効にする</Button>}
                />
              )}
            </div>
          </li>

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
