import { Exit } from "effect";
import { type ReactNode, useState } from "react";
import { Check, Loader2, Plus } from "lucide-react";

import { orgCodeLabelJa } from "@core/company/org-code";
import { roleLabelJa } from "@core/membership/role-label";

import { companyStateAtom } from "../../account/account-atom";
import {
  useCurrentCompany,
  useSwitchCompany,
  type Membership,
} from "../../account/current-company";
import { useSelfUserId } from "../../auth/auth-client";
import { TransferOwnershipModal } from "../../membership/TransferOwnershipModal";
import { useRemoveMember } from "../../membership/membership-atom";
import { useWaitForValue } from "../../shared/atom-runtime";
import { leaveSpaAfterAccountDeleted } from "../../shared/leave-spa";
import { hasFailureTag } from "../../shared/failure-message";
import { notifyAfterRefresh, notifyError } from "../../shared/notify";
import { Button } from "../../shared/ui/button";
import { Separator } from "../../shared/ui/separator";
import { AddCompanyDialog } from "../AddCompanyDialog";

export const Companies = () => {
  const { memberships, currentCompanyId } = useCurrentCompany();
  const waitForCompanyState = useWaitForValue(companyStateAtom);
  const [busyCompanyId, setBusyCompanyId] = useState<string | null>(null);

  const selfUserId = useSelfUserId();
  const { switchCompany, switchPending } = useSwitchCompany();
  const removeMember = useRemoveMember();

  const handleSwitch = (companyId: string) => {
    if (busyCompanyId) return;
    setBusyCompanyId(companyId);
    switchCompany(companyId).finally(() => setBusyCompanyId(null));
  };

  const [soleOwnerCompanyId, setSoleOwnerCompanyId] = useState<string | null>(null);

  const handleLeave = (m: Membership) => {
    if (!selfUserId || busyCompanyId) return;
    setBusyCompanyId(m.company_id);
    setSoleOwnerCompanyId(null);
    let redirecting = false;
    removeMember(m.company_id, selfUserId)
      .then(
        Exit.match({
          onSuccess: ({ account_deleted }) => {
            if (account_deleted) {
              redirecting = true;
              leaveSpaAfterAccountDeleted();
              return;
            }
            return notifyAfterRefresh(waitForCompanyState, {
              done: `「${m.company_name}」から抜けました。`,
              staleShort: "事業所から抜けました",
            });
          },
          onFailure: (cause) => {
            if (hasFailureTag(cause, "LastOwner")) {
              setSoleOwnerCompanyId(m.company_id);
            } else {
              notifyError("事業所から抜けられませんでした。");
            }
          },
        }),
      )
      .finally(() => {
        if (!redirecting) setBusyCompanyId(null);
      });
  };

  const switchDisabled = busyCompanyId !== null || switchPending;
  const leaveDisabled = busyCompanyId !== null || selfUserId === null;

  return (
    <div>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">所属事業所</h1>
          <p className="mt-1 text-sm text-muted-foreground">所属する事業所の一覧と切り替え</p>
        </div>
        <AddCompanyDialog
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
        {memberships.map((m) => (
          <CompanyRow
            key={m.company_id}
            membership={m}
            isCurrent={m.company_id === currentCompanyId}
          >
            {m.company_id !== currentCompanyId && (
              <SwitchCompanyButton
                switching={busyCompanyId === m.company_id}
                busy={switchDisabled}
                onSwitch={() => handleSwitch(m.company_id)}
              />
            )}
            {soleOwnerCompanyId === m.company_id ? (
              <TransferOwnershipModal
                companyId={m.company_id}
                companyName={m.company_name}
                onTransferred={() => setSoleOwnerCompanyId(null)}
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
                disabled={leaveDisabled}
              >
                抜ける
              </Button>
            )}
          </CompanyRow>
        ))}
      </div>

      {soleOwnerCompanyId && (
        <p role="alert" className="mt-4 text-sm text-destructive">
          唯一のオーナーは事業所から抜けられません。先にオーナーを委譲してください。
        </p>
      )}
    </div>
  );
};

type CompanyRowProps = {
  membership: Membership;
  isCurrent: boolean;
  children: ReactNode;
};

const CompanyRow = ({ membership, isCurrent, children }: CompanyRowProps) => (
  <div className="flex items-center justify-between rounded-md border border-border px-4 py-3 text-sm">
    <div>
      <p className="flex items-center gap-2 font-medium text-foreground">
        {membership.company_name}
        {isCurrent && (
          <span className="inline-flex items-center gap-1 text-xs text-primary">
            <Check className="size-3" aria-hidden="true" />
            選択中
          </span>
        )}
      </p>
      <p className="text-xs text-muted-foreground">
        {roleLabelJa(membership.role)} ・ {orgCodeLabelJa(membership.company_org_code)}
      </p>
    </div>
    <div className="flex items-center gap-2">{children}</div>
  </div>
);

const SwitchCompanyButton = ({
  switching,
  busy,
  onSwitch,
}: {
  switching: boolean;
  busy: boolean;
  onSwitch: () => void;
}) => (
  <Button variant="outline" size="sm" onClick={onSwitch} disabled={busy}>
    {switching ? <Loader2 className="size-4 animate-spin" /> : null}
    切替
  </Button>
);
