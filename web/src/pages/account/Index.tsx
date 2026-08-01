import { authClient } from "@/lib/auth-client";
import { useCompanyContext } from "@/lib/company-context";
import { orgCodeLabelJa, roleLabelJa } from "@/lib/labels";
import { Separator } from "@/components/ui/separator";
import { ProfileForm } from "@/components/account/ProfileForm";
import { AvatarUploader } from "@/components/account/AvatarUploader";
import { DangerZone } from "@/components/account/DangerZone";

export const AccountIndex = () => {
  const { data: session } = authClient.useSession();
  const user = session?.user;
  const { currentMembership } = useCompanyContext();

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

      {currentMembership && (
        <div className="mb-8 rounded-md border border-border bg-muted/40 p-4 text-sm">
          <p className="font-medium text-foreground">現在の事業所</p>
          <p className="mt-1 text-muted-foreground">
            {currentMembership.company_name} ({roleLabelJa(currentMembership.role)})
            <span className="ml-2 text-xs">
              {orgCodeLabelJa(currentMembership.company_org_code)}
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
