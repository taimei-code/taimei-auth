import { Loader2 } from "lucide-react";

import { canInviteRole, isAtLeast, type Role } from "@core/membership/policy";

import { useCurrentCompany } from "../../account/current-company";
import { InviteMemberForm } from "../../invitation/InviteMemberForm";
import { PendingInvitations } from "../../invitation/PendingInvitations";
import { Separator } from "../../shared/ui/separator";
import { MemberList } from "../MemberList";

const ROLES_IN_SELECT_ORDER: readonly Role[] = ["MEMBER", "ADMIN", "OWNER"];

export const Members = () => {
  const { currentMembership, loading: companyLoading } = useCurrentCompany();

  if (companyLoading) {
    return (
      <div className="flex min-h-[40svh] items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!currentMembership) {
    return <p className="text-sm text-muted-foreground">事業所が見つかりません。</p>;
  }

  const companyId = currentMembership.company_id;
  const canManage = isAtLeast(currentMembership.role, "ADMIN");
  const assignableRoles = ROLES_IN_SELECT_ORDER.filter((role) =>
    canInviteRole(currentMembership.role, role),
  );

  return (
    <div>
      <div>
        <h1 className="text-xl font-semibold tracking-tight">メンバー</h1>
        <p className="mt-1 text-sm text-muted-foreground">事業所のメンバー一覧と招待</p>
      </div>
      <Separator className="my-6" />

      <MemberList
        key={companyId}
        companyId={companyId}
        canManage={canManage}
        assignableRoles={assignableRoles}
      />

      {canManage && (
        <>
          <Separator className="my-8" />
          <InviteMemberForm companyId={companyId} assignableRoles={assignableRoles} />
          <PendingInvitations companyId={companyId} />
        </>
      )}
    </div>
  );
};
