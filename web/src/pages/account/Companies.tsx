import { useState } from "react";
import { Check, Loader2 } from "lucide-react";

import { AccountApiError, removeMember } from "@/lib/account-api";
import { useCompanyContext } from "@/lib/company-context";
import { authClient } from "@/lib/auth-client";
import { roleLabelJa } from "@/lib/role-label";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { TransferOwnershipModal } from "@/components/account/TransferOwnershipModal";

export const Companies = () => {
  const { memberships, currentCompanyId, switchCompany, refresh } = useCompanyContext();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const userId = authClient.useSession().data?.user.id ?? null;

  const handleSwitch = (companyId: string) => {
    if (busyId) return;
    setBusyId(companyId);
    switchCompany(companyId)
      .catch((e) => console.error("switch failed", e))
      .finally(() => setBusyId(null));
  };

  // 唯一の OWNER で抜けられなかった (409) company。委譲導線を出すため記録する。
  const [soleOwnerCompanyId, setSoleOwnerCompanyId] = useState<string | null>(null);

  const handleLeave = (companyId: string) => {
    if (!userId || busyId) return;
    setBusyId(companyId);
    setMessage(null);
    setSoleOwnerCompanyId(null);
    removeMember(companyId, userId)
      .then(() => refresh())
      .catch((err) => {
        if (err instanceof AccountApiError && err.status === 409) {
          setSoleOwnerCompanyId(companyId);
          setMessage("唯一のオーナーは事業所から抜けられません。先にオーナーを委譲してください。");
        } else {
          setMessage("事業所から抜けられませんでした。");
        }
      })
      .finally(() => setBusyId(null));
  };

  return (
    <div>
      <div>
        <h1 className="text-xl font-semibold tracking-tight">所属事業所</h1>
        <p className="mt-1 text-sm text-muted-foreground">所属する事業所の一覧と切り替え</p>
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
                  {roleLabelJa(m.role)} ・{" "}
                  {m.company_org_code === "PERSONAL" ? "個人事業主" : "法人"}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {!isCurrent && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleSwitch(m.company_id)}
                    disabled={busyId !== null}
                  >
                    {busyId === m.company_id ? <Loader2 className="size-4 animate-spin" /> : null}
                    切替
                  </Button>
                )}
                {soleOwnerCompanyId === m.company_id ? (
                  <TransferOwnershipModal
                    companyId={m.company_id}
                    companyName={m.company_name}
                    onTransferred={() => {
                      setSoleOwnerCompanyId(null);
                      setMessage(null);
                      void refresh();
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
                    onClick={() => handleLeave(m.company_id)}
                    disabled={busyId !== null}
                  >
                    抜ける
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {message && <p className="mt-4 text-sm text-destructive">{message}</p>}
    </div>
  );
};
