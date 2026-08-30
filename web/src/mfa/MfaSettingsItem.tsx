import { Badge } from "../shared/ui/badge";
import { Button } from "../shared/ui/button";
import { MfaDisableDialog } from "./MfaDisableDialog";
import { MfaEnrollDialog } from "./MfaEnrollDialog";
import type { MfaStatus } from "./mfa-api";

// 再発行の導線が無い (復旧は運用スクリプト経由) ため、尽きる前に気づける残数で警告を出す。
const LOW_RECOVERY_CODE_THRESHOLD = 3;

const describeRecoveryCodeShortage = (remaining: number): string =>
  remaining === 0
    ? "リカバリーコードを使い切りました。認証アプリを使えなくなるとログインできなくなります (再発行の導線はありません)。"
    : "リカバリーコードの残りが少なくなっています。使い切ると、認証アプリを失った時にログインできなくなります (再発行の導線はありません)。";

export const MfaSettingsItem = ({
  status,
  refresh,
}: {
  status: MfaStatus;
  refresh: () => Promise<unknown>;
}) => (
  <li className="flex items-start justify-between gap-4 py-5">
    <div>
      <p className="font-medium">多要素認証 (MFA)</p>
      <p className="mt-1 text-sm text-muted-foreground">
        認証アプリ (TOTP) を登録すると、ログイン時に確認コードの入力を求めます
      </p>
      {status.enabled && (
        <>
          <p className="mt-2 text-sm text-muted-foreground">
            リカバリーコードの残り: {status.recoveryCodesRemaining} 個
          </p>
          {status.recoveryCodesRemaining <= LOW_RECOVERY_CODE_THRESHOLD && (
            <p className="mt-1 text-sm text-destructive">
              {describeRecoveryCodeShortage(status.recoveryCodesRemaining)}
            </p>
          )}
        </>
      )}
    </div>
    <div className="flex shrink-0 items-center gap-3">
      <Badge variant={status.enabled ? "default" : "secondary"}>
        {status.enabled ? "有効" : "無効"}
      </Badge>
      {status.inEffect ? (
        <MfaDisableDialog
          onDisabled={refresh}
          trigger={
            <Button variant="outline" size="sm">
              無効にする
            </Button>
          }
        />
      ) : (
        <MfaEnrollDialog onEnabled={refresh} trigger={<Button size="sm">有効にする</Button>} />
      )}
    </div>
  </li>
);
