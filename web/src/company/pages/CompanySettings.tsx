import { Loader2 } from "lucide-react";

import { useCurrentCompany } from "../../account/current-company";
import { Separator } from "../../shared/ui/separator";
import { CompanySettingsForm } from "../CompanySettingsForm";

export const CompanySettings = () => {
  const { currentMembership, memberships, loading } = useCurrentCompany();

  if (loading) {
    return (
      <div className="flex min-h-[40svh] items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (currentMembership?.role !== "OWNER") {
    return (
      <p className="text-sm text-muted-foreground">事業所設定の編集はオーナーのみ可能です。</p>
    );
  }

  return (
    <div>
      <div>
        <h1 className="text-xl font-semibold tracking-tight">事業所設定</h1>
        <p className="mt-1 text-sm text-muted-foreground">事業所名と事業形態の編集</p>
      </div>
      <Separator className="my-6" />

      <CompanySettingsForm
        key={currentMembership.company_id}
        membership={currentMembership}
        isLastCompany={memberships.length <= 1}
      />
    </div>
  );
};
