import { useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/reactivity";

import { MfaSettingsItem } from "../../mfa/MfaSettingsItem";
import { mfaStatusAtom } from "../../mfa/mfa-atom";
import { AsyncSection } from "../../shared/AsyncSection";
import { failedBeforeAnyValue } from "../../shared/atom-runtime";
import { Badge } from "../../shared/ui/badge";
import { Separator } from "../../shared/ui/separator";

const STATUS_UNAVAILABLE = "多要素認証 (MFA) の設定状態を取得できませんでした。";

export const Security = () => {
  const result = useAtomValue(mfaStatusAtom);
  const status = AsyncResult.getOrElse(result, () => null);

  return (
    <div>
      <div>
        <h1 className="text-xl font-semibold tracking-tight">セキュリティ</h1>
        <p className="mt-1 text-sm text-muted-foreground">認証方法とセキュリティ設定</p>
      </div>
      <Separator className="my-6" />

      <AsyncSection
        loading={AsyncResult.isInitial(result)}
        errorMessage={failedBeforeAnyValue(result) ? STATUS_UNAVAILABLE : null}
        isEmpty={status === null}
        emptyText={STATUS_UNAVAILABLE}
      >
        <ul className="divide-y">
          {status && <MfaSettingsItem status={status} />}

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
