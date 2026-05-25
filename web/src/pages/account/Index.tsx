import { useEffect, useState } from "react";

import { authClient } from "@/lib/auth-client";
import { listMyMemberships } from "@/lib/account-api";
import { Separator } from "@/components/ui/separator";
import { ProfileForm } from "@/components/account/ProfileForm";
import { AvatarUploader } from "@/components/account/AvatarUploader";
import { DangerZone } from "@/components/account/DangerZone";

type CurrentCompany = {
  name: string;
  role: string;
  orgCode: string;
};

export const AccountIndex = () => {
  const { data: session } = authClient.useSession();
  const user = session?.user;
  const [currentCompany, setCurrentCompany] = useState<CurrentCompany | null>(null);

  // Phase A は user が 1 事業所のみのため先頭 membership を表示。
  // Phase C で session-scoped な current company 選択 (CompanySwitcher) に差し替える。
  useEffect(() => {
    if (!user) return;
    listMyMemberships()
      .then((memberships) => {
        const target = memberships.at(0);
        if (target) {
          setCurrentCompany({
            name: target.company_name,
            role: target.role,
            orgCode: target.company_org_code,
          });
        }
      })
      .catch((e) => console.error("failed to load memberships", e));
  }, [user]);

  if (!user) {
    return null;
  }

  return (
    <div>
      <div>
        <h1 className="text-xl font-semibold tracking-tight">プロフィール</h1>
        <p className="mt-1 text-sm text-muted-foreground">アカウント情報の表示と編集</p>
      </div>
      <Separator className="my-6" />

      {currentCompany && (
        <div className="mb-8 rounded-md border border-border bg-muted/40 p-4 text-sm">
          <p className="font-medium text-foreground">現在の事業所</p>
          <p className="mt-1 text-muted-foreground">
            {currentCompany.name} ({currentCompany.role})
            <span className="ml-2 text-xs">
              {currentCompany.orgCode === "PERSONAL" ? "個人事業主" : "法人"}
            </span>
          </p>
        </div>
      )}

      <div className="grid gap-10 md:grid-cols-[1fr_220px]">
        <ProfileForm initialName={user.name} email={user.email} />
        <AvatarUploader initialImageUrl={user.image ?? ""} fallbackName={user.name} />
      </div>

      <Separator className="my-10" />

      <DangerZone />
    </div>
  );
};
