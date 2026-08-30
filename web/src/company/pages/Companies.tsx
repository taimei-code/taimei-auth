import { useState } from "react";
import { Check, Loader2, Plus } from "lucide-react";

import { orgCodeLabelJa } from "@core/company/org-code";
import { roleLabelJa } from "@core/membership/role-label";

import {
  setCurrentCompany,
  useCurrentCompany,
  type Membership,
} from "../../account/current-company";
import { authClient } from "../../auth/auth-client";
import { redirectAfterAuthChange } from "../../auth/auth-redirect";
import { TransferOwnershipModal } from "../../membership/TransferOwnershipModal";
import { removeMember } from "../../membership/membership-api";
import { notifyAfterRefresh, notifyError } from "../../shared/notify";
import { RequestJsonError } from "../../shared/request-json";
import { Button } from "../../shared/ui/button";
import { Separator } from "../../shared/ui/separator";
import { AddCompanyDialog } from "../AddCompanyDialog";

export const Companies = () => {
  const { memberships, currentCompanyId, refresh } = useCurrentCompany();
  const [busyCompanyId, setBusyCompanyId] = useState<string | null>(null);

  const selfUserId = authClient.useSession().data?.user.id ?? null;

  const handleSwitch = (companyId: string) => {
    if (busyCompanyId) return;
    setBusyCompanyId(companyId);
    setCurrentCompany(companyId)
      .then(() => notifyAfterRefresh(refresh, { staleShort: "事業所を切り替えました" }))
      .catch(() => notifyError("事業所を切り替えられませんでした。"))
      .finally(() => setBusyCompanyId(null));
  };

  // 唯一の OWNER で抜けられなかった (409) company。委譲導線を出すため記録する。
  const [soleOwnerCompanyId, setSoleOwnerCompanyId] = useState<string | null>(null);

  const handleLeave = (m: Membership) => {
    if (!selfUserId || busyCompanyId) return;
    setBusyCompanyId(m.company_id);
    setSoleOwnerCompanyId(null);
    let redirecting = false;
    removeMember(m.company_id, selfUserId)
      .then(({ accountDeleted }) => {
        if (accountDeleted) {
          // 遷移完了まで busy を維持する (解除すると再クリックでき、2 回目の 401 が誤表示される)
          redirecting = true;
          redirectAfterAuthChange("deleteAccount");
          return;
        }
        return notifyAfterRefresh(refresh, {
          done: `「${m.company_name}」から抜けました。`,
          staleShort: "事業所から抜けました",
        });
      })
      .catch((err) => {
        if (err instanceof RequestJsonError && err.status === 409) {
          // toast にしない: 「オーナーを委譲」ボタンの出現理由として導線と一緒に残す (shared/notify.tsx の経路規則)
          setSoleOwnerCompanyId(m.company_id);
        } else {
          notifyError("事業所から抜けられませんでした。");
        }
      })
      .finally(() => {
        if (!redirecting) setBusyCompanyId(null);
      });
  };

  return (
    <div>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">所属事業所</h1>
          <p className="mt-1 text-sm text-muted-foreground">所属する事業所の一覧と切り替え</p>
        </div>
        <AddCompanyDialog
          onCreated={refresh}
          trigger={
            <Button size="sm" className="shrink-0">
              <Plus className="size-4" aria-hidden="true" />
              事業所を追加
            </Button>
          }
        />
      </div>
      <Separator className="my-6" />

      <div className="space-y-2">
        {memberships.map((m) => {
          const isCurrent = m.company_id === currentCompanyId;
          return (
            <div
              key={m.company_id}
              className="flex items-center justify-between rounded-md border border-border px-4 py-3 text-sm"
            >
              <div>
                <p className="flex items-center gap-2 font-medium text-foreground">
                  {m.company_name}
                  {isCurrent && (
                    <span className="inline-flex items-center gap-1 text-xs text-primary">
                      <Check className="size-3" aria-hidden="true" />
                      選択中
                    </span>
                  )}
                </p>
                <p className="text-xs text-muted-foreground">
                  {roleLabelJa(m.role)} ・ {orgCodeLabelJa(m.company_org_code)}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {!isCurrent && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleSwitch(m.company_id)}
                    disabled={busyCompanyId !== null}
                  >
                    {busyCompanyId === m.company_id ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : null}
                    切替
                  </Button>
                )}
                {soleOwnerCompanyId === m.company_id ? (
                  <TransferOwnershipModal
                    companyId={m.company_id}
                    companyName={m.company_name}
                    onTransferred={() => {
                      setSoleOwnerCompanyId(null);
                      return refresh();
                    }}
                    trigger={
                      <Button variant="outline" size="sm">
                        オーナーを委譲
                      </Button>
                    }
                  />
                ) : (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleLeave(m)}
                    disabled={busyCompanyId !== null || !selfUserId}
                  >
                    抜ける
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {soleOwnerCompanyId && (
        <p role="alert" className="mt-4 text-sm text-destructive">
          唯一のオーナーは事業所から抜けられません。先にオーナーを委譲してください。
        </p>
      )}
    </div>
  );
};
