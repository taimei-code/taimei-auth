import { useState } from "react";
import { Building2, Loader2 } from "lucide-react";

import { useCompanyContext } from "@/lib/company-context";
import { orgCodeLabelJa, roleLabelJa } from "@/lib/role-label";

// sidebar 上部の事業所ピッカー。複数所属時に native select で切替 (DropdownMenu 依存を避ける)。
// 1 事業所のみなら read-only 表示。
export const CompanySwitcher = () => {
  const { memberships, currentMembership, switchCompany } = useCompanyContext();
  const [switching, setSwitching] = useState(false);

  if (!currentMembership) return null;

  const orgLabel = orgCodeLabelJa(currentMembership.company_org_code);

  return (
    <div className="mb-3 rounded-md border border-border bg-muted/40 p-3">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Building2 className="size-3.5" aria-hidden="true" />
        現在の事業所
      </div>
      {memberships.length > 1 ? (
        <div className="mt-1.5 flex items-center gap-2">
          <select
            aria-label="事業所を切り替え"
            value={currentMembership.company_id}
            disabled={switching}
            onChange={(e) => {
              const next = e.target.value;
              if (next === currentMembership.company_id) return;
              setSwitching(true);
              switchCompany(next)
                .catch((err) => console.error("switch company failed", err))
                .finally(() => setSwitching(false));
            }}
            className="w-full rounded-md border border-input bg-transparent px-2 py-1 text-sm font-medium"
          >
            {memberships.map((m) => (
              <option key={m.company_id} value={m.company_id}>
                {m.company_name}
              </option>
            ))}
          </select>
          {switching && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
        </div>
      ) : (
        <p className="mt-1 text-sm font-medium text-foreground">{currentMembership.company_name}</p>
      )}
      <p className="mt-1 text-xs text-muted-foreground">
        {orgLabel} ・ {roleLabelJa(currentMembership.role)}
      </p>
    </div>
  );
};
