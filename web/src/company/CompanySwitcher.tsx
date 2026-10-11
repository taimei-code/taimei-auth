import { Building2, Loader2 } from "lucide-react";

import { orgCodeLabelJa } from "@core/company/org-code";
import { roleLabelJa } from "@core/membership/role-label";

import { useCurrentCompany, useSwitchCompany } from "../account/current-company";
import { NativeSelect } from "../shared/ui/native-select";

export const CompanySwitcher = () => {
  const { memberships, currentMembership } = useCurrentCompany();
  const { switchCompany, switchPending } = useSwitchCompany();

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
          <NativeSelect
            aria-label="事業所を切り替え"
            title={currentMembership.company_name}
            value={currentMembership.company_id}
            disabled={switchPending}
            onChange={(e) => {
              const next = e.target.value;
              if (next === currentMembership.company_id) return;
              void switchCompany(next);
            }}
            className="h-8 py-1 pl-2 font-medium"
          >
            {memberships.map((m) => (
              <option key={m.company_id} value={m.company_id}>
                {m.company_name}
              </option>
            ))}
          </NativeSelect>
          {switchPending && (
            <Loader2 aria-hidden className="size-4 animate-spin text-muted-foreground" />
          )}
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
